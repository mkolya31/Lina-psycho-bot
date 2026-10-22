import { pathToFileURL } from 'node:url';
import { loadConfig, ConfigurationError } from '../src/config.js';
import { TelegramClient, TelegramApiError } from '../src/telegram.js';
import { WEBHOOK_PATH } from '../src/server.js';
import { log } from '../src/log.js';

export async function setWebhook(env = process.env, client) {
  const config = loadConfig(env);
  let url;
  try {
    url = new URL(env.WEBHOOK_URL);
  } catch {
    throw new ConfigurationError('Задайте WEBHOOK_URL с публичным HTTPS-адресом');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search
    || url.pathname !== WEBHOOK_PATH) {
    throw new ConfigurationError(`WEBHOOK_URL должен быть HTTPS-адресом с путём ${WEBHOOK_PATH} без параметров`);
  }
  const telegram = client ?? new TelegramClient(config.botToken);
  await telegram.call('setWebhook', {
    url: url.href,
    secret_token: config.webhookSecret,
    allowed_updates: ['message', 'callback_query'],
    max_connections: 10,
    drop_pending_updates: false,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await setWebhook();
    log('webhook_registered');
  } catch (error) {
    log('webhook_registration_failed', error instanceof ConfigurationError ? { reason: error.message }
      : error instanceof TelegramApiError ? { status: error.status } : { category: 'internal' });
    process.exitCode = 1;
  }
}
