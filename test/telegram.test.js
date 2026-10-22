import test from 'node:test';
import assert from 'node:assert/strict';
import { TelegramClient, TelegramApiError } from '../src/telegram.js';

test('Telegram client sends JSON and returns the API result', async () => {
  const client = new TelegramClient('123:secret', { fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.telegram.org/bot123:secret/sendMessage');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['content-type'], 'application/json');
    assert.deepEqual(JSON.parse(options.body), { chat_id: 42, text: 'Привет' });
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json({ ok: true, result: { message_id: 10 } });
  } });
  assert.deepEqual(await client.call('sendMessage', { chat_id: 42, text: 'Привет' }), { message_id: 10 });
});

test('API and transport errors are sanitized; retryable statuses remain distinguishable', async () => {
  for (const status of [400, 401, 403, 429, 500]) {
    const client = new TelegramClient('123:secret', { fetchImpl: async () => Response.json({
      ok: false, error_code: status, description: '123:secret PII',
    }, { status }) });
    await assert.rejects(client.call('sendMessage', {}), (error) => {
      assert.ok(error instanceof TelegramApiError);
      assert.equal(error.status, status);
      assert.equal(error.retryable, status === 429 || status >= 500);
      assert.ok(!error.message.includes('secret'));
      assert.ok(!error.message.includes('PII'));
      return true;
    });
  }
  for (const fetchImpl of [
    async () => { throw new Error('https://api.telegram.org/bot123:secret/sendMessage'); },
    async () => new Response('invalid JSON', { status: 502 }),
    async () => Response.json({ unexpected: true }),
  ]) {
    const client = new TelegramClient('123:secret', { fetchImpl });
    await assert.rejects(client.call('sendMessage', {}), (error) => {
      assert.equal(error.retryable, true);
      assert.ok(!error.stack.includes('123:secret'));
      return true;
    });
  }
});
