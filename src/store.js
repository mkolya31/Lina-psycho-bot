import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export class ParticipantStore {
  constructor(path, { now = () => new Date() } = {}) {
    this.now = now;
    if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    try {
      this.db.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;');
      const version = this.db.prepare('PRAGMA user_version').get().user_version;
      if (version > 1) throw new Error('Unsupported database schema');
      if (version === 0) {
        this.db.exec(`
          BEGIN IMMEDIATE;
          CREATE TABLE participants (
            telegram_id INTEGER PRIMARY KEY CHECK (telegram_id > 0),
            chat_id INTEGER NOT NULL,
            telegram_name TEXT NOT NULL,
            username TEXT,
            first_started_at TEXT NOT NULL,
            registered_at TEXT
          ) STRICT;
          CREATE INDEX participants_started ON participants(first_started_at, telegram_id);
          CREATE TABLE processed_updates (
            update_id INTEGER PRIMARY KEY,
            processed_at TEXT NOT NULL
          ) STRICT;
          CREATE INDEX processed_updates_time ON processed_updates(processed_at);
          PRAGMA user_version = 1;
          COMMIT;
        `);
      }
      this.pruneUpdates();
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  start(user, chatId) {
    this.db.prepare(`
      INSERT INTO participants (telegram_id, chat_id, telegram_name, username, first_started_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(telegram_id) DO UPDATE SET
        chat_id = excluded.chat_id,
        telegram_name = excluded.telegram_name,
        username = excluded.username
    `).run(user.id, chatId, [user.first_name, user.last_name].filter(Boolean).join(' '),
      user.username || null, this.now().toISOString());
    return this.get(user.id);
  }

  register(user, chatId) {
    // Only /start creates participants; confirmation never changes the first registration time.
    this.db.prepare(`
      UPDATE participants SET chat_id = ?, telegram_name = ?, username = ?,
        registered_at = COALESCE(registered_at, ?)
      WHERE telegram_id = ?
    `).run(chatId, [user.first_name, user.last_name].filter(Boolean).join(' '),
      user.username || null, this.now().toISOString(), user.id);
    return this.get(user.id);
  }

  get(id) {
    return this.db.prepare('SELECT * FROM participants WHERE telegram_id = ?').get(id);
  }

  stats() {
    return { ...this.db.prepare(`
      SELECT COUNT(*) AS total, COUNT(registered_at) AS registered,
        COUNT(*) - COUNT(registered_at) AS unconfirmed FROM participants
    `).get() };
  }

  list(page, pageSize) {
    return this.db.prepare(`
      SELECT * FROM participants ORDER BY first_started_at, telegram_id LIMIT ? OFFSET ?
    `).all(pageSize, (page - 1) * pageSize);
  }

  hasProcessed(id) {
    return Boolean(this.db.prepare('SELECT 1 FROM processed_updates WHERE update_id = ?').get(id));
  }

  markProcessed(id) {
    this.db.prepare('INSERT OR IGNORE INTO processed_updates VALUES (?, ?)').run(id, this.now().toISOString());
  }

  pruneUpdates() {
    const cutoff = new Date(this.now().getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    this.db.prepare('DELETE FROM processed_updates WHERE processed_at < ?').run(cutoff);
  }

  ping() {
    this.db.prepare('SELECT 1').get();
  }

  close() {
    this.db.close();
  }
}
