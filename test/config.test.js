import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, ConfigurationError } from '../src/config.js';
import { setWebhook } from '../scripts/set-webhook.js';
import { testEnv } from './helpers.js';

test('configuration validates required secrets, IDs, port and display timezone', () => {
  const config = loadConfig(testEnv);
  assert.deepEqual([...config.adminIds], [9001, 9002]);
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 3000);
  for (const overrides of [
    { BOT_TOKEN: '' }, { BOT_TOKEN: 'bad token' }, { WEBHOOK_SECRET: '' },
    { WEBHOOK_SECRET: 'secret with spaces' }, { WEBHOOK_SECRET: 'a'.repeat(257) },
    { ADMIN_IDS: '' }, { ADMIN_IDS: '9001,' }, { ADMIN_IDS: '-1' },
    { ADMIN_IDS: '@lina' }, { ADMIN_IDS: '9007199254740992' },
    { PORT: '0' }, { PORT: '65536' }, { PORT: '1e3' }, { DISPLAY_TIMEZONE: 'not/a/zone' },
  ]) {
    assert.throws(() => loadConfig({ ...testEnv, ...overrides }), ConfigurationError);
  }
  const custom = loadConfig({ ...testEnv, HOST: '0.0.0.0', PORT: '8080', DISPLAY_TIMEZONE: 'UTC' });
  assert.equal(custom.port, 8080);
  assert.equal(custom.timeZone, 'UTC');
});

test('webhook setup explicitly uses secret, supported updates and preserves pending events', async () => {
  const calls = [];
  const telegram = { async call(...args) { calls.push(args); } };
  await setWebhook({ ...testEnv, WEBHOOK_URL: 'https://global.kolyach.me/telegram/webhook' }, telegram);
  assert.deepEqual(calls, [['setWebhook', {
    url: 'https://global.kolyach.me/telegram/webhook', secret_token: 'webhook_secret',
    allowed_updates: ['message', 'callback_query'], max_connections: 10, drop_pending_updates: false,
  }]]);
  for (const url of [undefined, 'broken', 'http://example.com/telegram/webhook',
    'https://example.com/wrong', 'https://user:pass@example.com/telegram/webhook',
    'https://example.com/telegram/webhook?secret=hidden', 'https://example.com/telegram/webhook#hash']) {
    await assert.rejects(setWebhook({ ...testEnv, WEBHOOK_URL: url }, telegram), ConfigurationError);
  }
  assert.equal(calls.length, 1);
});
