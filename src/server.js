import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { TelegramApiError } from './telegram.js';

export const WEBHOOK_PATH = '/telegram/webhook';
const MAX_BODY_BYTES = 64 * 1024;

class RequestError extends Error {
  constructor(status) {
    super('Invalid webhook request');
    this.status = status;
  }
}

function authorized(value, expected) {
  if (typeof value !== 'string') return false;
  const actual = Buffer.from(value);
  const secret = Buffer.from(expected);
  return actual.length === secret.length && timingSafeEqual(actual, secret);
}

async function readUpdate(request) {
  if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new RequestError(415);
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      request.resume();
      throw new RequestError(413);
    }
    chunks.push(chunk);
  }
  let update;
  try {
    update = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new RequestError(400);
  }
  if (!update || Array.isArray(update) || !Number.isSafeInteger(update.update_id) || update.update_id < 0) {
    throw new RequestError(400);
  }
  return update;
}

export function createWebhookServer({ secret, store, handleUpdate, log = () => {} }) {
  const inFlight = new Map();
  let completed = 0;
  const processUpdate = async (update) => {
    if (store.hasProcessed(update.update_id)) return;
    if (inFlight.has(update.update_id)) return inFlight.get(update.update_id);
    if (inFlight.size >= 100) throw new RequestError(503);
    const work = (async () => {
      try {
        await handleUpdate(update);
      } catch (error) {
        // Permanent delivery failures (e.g. the user blocked the bot) must not loop forever.
        // Other failures return 503 so Telegram can redeliver the update.
        if (!(error instanceof TelegramApiError && [400, 403].includes(error.status))) throw error;
        log('telegram_delivery_rejected', { method: error.method, status: error.status });
      }
      store.markProcessed(update.update_id);
      if (++completed % 1000 === 0) store.pruneUpdates();
    })();
    inFlight.set(update.update_id, work);
    try {
      await work;
    } finally {
      inFlight.delete(update.update_id);
    }
  };

  const server = createServer(async (request, response) => {
    const reply = (status, body = '') => {
      response.writeHead(status, {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
        ...(status === 503 ? { 'retry-after': '5' } : {}),
      });
      response.end(body);
    };
    try {
      if (request.url === '/healthz' && request.method === 'GET') {
        store.ping();
        return reply(200, 'ok');
      }
      if (request.url !== WEBHOOK_PATH) return reply(404);
      if (request.method !== 'POST') return reply(405);
      if (!authorized(request.headers['x-telegram-bot-api-secret-token'], secret)) return reply(403);
      const update = await readUpdate(request);
      await processUpdate(update);
      reply(200, 'ok');
    } catch (error) {
      if (error instanceof RequestError) return reply(error.status);
      log('webhook_failed', error instanceof TelegramApiError
        ? { method: error.method, status: error.status } : { category: 'internal' });
      reply(503);
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  return server;
}
