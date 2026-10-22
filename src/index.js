import { loadConfig, ConfigurationError } from './config.js';
import { ParticipantStore } from './store.js';
import { TelegramClient } from './telegram.js';
import { createBot } from './bot.js';
import { createWebhookServer } from './server.js';
import { log } from './log.js';

let store;
try {
  const config = loadConfig();
  store = new ParticipantStore(config.dbPath);
  const telegram = new TelegramClient(config.botToken);
  const handleUpdate = createBot({ store, telegram, adminIds: config.adminIds, timeZone: config.timeZone });
  const server = createWebhookServer({ secret: config.webhookSecret, store, handleUpdate, log });
  server.on('error', () => {
    log('server_failed');
    store.close();
    process.exitCode = 1;
  });
  server.listen(config.port, config.host, () => log('server_started', { port: config.port }));

  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    log('shutdown_started');
    const deadline = setTimeout(() => {
      log('shutdown_timeout');
      process.exit(1);
    }, 25_000);
    deadline.unref();
    server.close(() => {
      clearTimeout(deadline);
      store.close();
      log('shutdown_complete');
    });
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
} catch (error) {
  log('startup_failed', error instanceof ConfigurationError ? { reason: error.message } : { category: 'internal' });
  store?.close();
  process.exitCode = 1;
}
