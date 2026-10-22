import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebhookServer } from '../src/server.js';
import { TelegramApiError } from '../src/telegram.js';
import { fixture, message, callback } from './helpers.js';

async function httpFixture(t, options = {}) {
  const context = fixture(t);
  const logs = [];
  const server = createWebhookServer({
    secret: 'test-secret', store: context.store, handleUpdate: context.bot,
    log: (...args) => logs.push(args), ...options,
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body, headers = {}) => fetch(`${base}/telegram/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'test-secret', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { ...context, server, logs, base, post };
}

test('secret, method, route, content type, JSON and size validation happen before bot processing', async (t) => {
  const { base, post, calls, store } = await httpFixture(t);
  assert.equal((await fetch(`${base}/healthz`)).status, 200);
  assert.equal((await fetch(`${base}/missing`)).status, 404);
  assert.equal((await fetch(`${base}/telegram/webhook`)).status, 405);
  assert.equal((await post(message(), { 'x-telegram-bot-api-secret-token': '' })).status, 403);
  assert.equal((await post(message(), { 'x-telegram-bot-api-secret-token': 'wrong-value' })).status, 403);
  assert.equal((await post(message(), { 'x-telegram-bot-api-secret-token': 'bad-secret!' })).status, 403);
  assert.equal((await post(message(), { 'content-type': 'text/plain' })).status, 415);
  for (const body of ['broken', 'null', '[]', '{}', '{"update_id":-1}', '{"update_id":1.5}']) {
    assert.equal((await post(body)).status, 400);
  }
  assert.equal((await post('x'.repeat(65 * 1024))).status, 413);
  assert.equal(store.stats().total, 0);
  assert.equal(calls.length, 0);
});

test('full webhook registration flow deduplicates updates including out-of-order IDs', async (t) => {
  const { post, store, calls } = await httpFixture(t);
  assert.equal((await post({ ...message(), update_id: 100 })).status, 200);
  assert.equal((await post({ ...callback(), update_id: 99 })).status, 200);
  const count = calls.length;
  assert.equal((await post({ ...message(), update_id: 100 })).status, 200);
  assert.equal((await post({ ...callback(), update_id: 99 })).status, 200);
  assert.equal(calls.length, count);
  assert.deepEqual(store.stats(), { total: 1, registered: 1, unconfirmed: 0 });
  assert.equal((await post({ update_id: 101, edited_message: {} })).status, 200);
});

test('concurrent copies of the same update share one in-flight handler', async (t) => {
  let executions = 0;
  const { post, store } = await httpFixture(t, {
    handleUpdate: async () => {
      executions++;
      await new Promise((resolve) => setTimeout(resolve, 25));
    },
  });
  const responses = await Promise.all([post(message()), post(message()), post(message())]);
  assert.deepEqual(responses.map((response) => response.status), [200, 200, 200]);
  assert.equal(executions, 1);
  assert.equal(store.hasProcessed(1), true);
});

test('network/API failures allow redelivery without losing or duplicating stored participants', async (t) => {
  const { post, telegram, store, logs } = await httpFixture(t);
  const originalCall = telegram.call;
  telegram.call = () => { throw new TelegramApiError('sendMessage', 429); };
  const failed = await post(message());
  assert.equal(failed.status, 503);
  assert.equal(failed.headers.get('retry-after'), '5');
  assert.equal(store.hasProcessed(1), false);
  assert.equal(store.stats().total, 1);
  telegram.call = originalCall;
  assert.equal((await post(message())).status, 200);
  assert.equal(store.hasProcessed(1), true);
  assert.equal(store.stats().total, 1);
  assert.deepEqual(logs[0], ['webhook_failed', { method: 'sendMessage', status: 429 }]);
});

test('blocked recipients are acknowledged; unexpected errors are not logged verbatim', async (t) => {
  const { post, telegram, store, logs } = await httpFixture(t);
  telegram.call = () => { throw new TelegramApiError('sendMessage', 403); };
  assert.equal((await post(message())).status, 200);
  assert.equal(store.hasProcessed(1), true);
  assert.equal(logs[0][0], 'telegram_delivery_rejected');
  telegram.call = () => { throw new Error('SECRET_TOKEN private user data'); };
  assert.equal((await post({ ...message(), update_id: 2 })).status, 503);
  assert.equal(store.hasProcessed(2), false);
  assert.ok(!JSON.stringify(logs).includes('SECRET_TOKEN'));
  assert.ok(!JSON.stringify(logs).includes('private user data'));
});

test('health check reflects database availability', async (t) => {
  const { base, store } = await httpFixture(t);
  store.ping = () => { throw new Error('database unavailable'); };
  assert.equal((await fetch(`${base}/healthz`)).status, 503);
});
