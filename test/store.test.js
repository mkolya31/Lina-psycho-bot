import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, basename } from 'node:path';
import { ParticipantStore } from '../src/store.js';
import { fixture, user } from './helpers.js';

test('start, confirmation and profile changes preserve first timestamps without duplicates', (t) => {
  let now = new Date('2026-10-21T10:00:00Z');
  const store = new ParticipantStore(':memory:', { now: () => now });
  t.after(() => store.close());
  assert.deepEqual(store.stats(), { total: 0, registered: 0, unconfirmed: 0 });
  const first = store.start(user(), 42);
  assert.equal(first.username, null);
  assert.equal(first.registered_at, null);
  now = new Date('2026-10-21T11:00:00Z');
  const registered = store.register(user(), 42);
  now = new Date('2026-10-22T10:00:00Z');
  store.start(user(42, { first_name: 'Новое', last_name: 'Имя', username: 'new_name' }), 42);
  const repeated = store.register(user(42, { first_name: 'Новое', last_name: 'Имя' }), 42);
  assert.equal(repeated.first_started_at, first.first_started_at);
  assert.equal(repeated.registered_at, registered.registered_at);
  assert.equal(repeated.telegram_name, 'Новое Имя');
  assert.equal(repeated.username, null);
  store.start(user(43), 43);
  assert.deepEqual(store.stats(), { total: 2, registered: 1, unconfirmed: 1 });
  assert.equal(store.register(user(44), 44), undefined);
  assert.equal(store.stats().total, 2);
});

test('participants and deduplication survive closing and reopening the SQLite file', () => {
  const directory = mkdtempSync(join(tmpdir(), 'lina-bot-test-'));
  const file = join(directory, 'nested', 'participants.sqlite');
  let store;
  try {
    store = new ParticipantStore(file);
    const first = store.start(user(42, { username: 'anna' }), 42);
    const registered = store.register(user(42), 42);
    store.start(user(43), 43);
    store.markProcessed(123);
    store.close();
    store = new ParticipantStore(file);
    assert.equal(store.get(42).first_started_at, first.first_started_at);
    assert.equal(store.get(42).registered_at, registered.registered_at);
    assert.deepEqual(store.stats(), { total: 2, registered: 1, unconfirmed: 1 });
    assert.equal(store.hasProcessed(123), true);
  } finally {
    store?.close();
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('lina-bot-test-'));
    rmSync(directory, { recursive: true });
  }
});

test('pagination is stable when timestamps tie; update IDs are not a high-water mark', (t) => {
  const { store } = fixture(t);
  store.now = () => new Date('2026-10-21T10:00:00Z');
  for (const id of [50, 42, 48, 44]) store.start(user(id), id);
  assert.deepEqual(store.list(1, 2).map((person) => person.telegram_id), [42, 44]);
  assert.deepEqual(store.list(2, 2).map((person) => person.telegram_id), [48, 50]);
  store.markProcessed(100);
  assert.equal(store.hasProcessed(99), false);
  store.markProcessed(99);
  store.markProcessed(99);
  assert.equal(store.hasProcessed(99), true);
  store.now = () => new Date('2026-11-01T10:00:00Z');
  store.pruneUpdates();
  assert.equal(store.hasProcessed(100), false);
  assert.equal(store.stats().total, 4);
});
