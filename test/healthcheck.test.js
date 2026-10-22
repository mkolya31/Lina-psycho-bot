import test from 'node:test';
import assert from 'node:assert/strict';
import { checkHealth } from '../scripts/healthcheck.js';

test('container health check requires HTTP 200 and the expected health response', async () => {
  assert.equal(await checkHealth({ port: '8080', fetchImpl: async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:8080/healthz');
    assert.ok(options.signal instanceof AbortSignal);
    return new Response('ok', { status: 200 });
  } }), true);
  for (const [body, status] of [['unavailable', 503], ['ok', 404], ['unexpected', 200]]) {
    assert.equal(await checkHealth({ fetchImpl: async () => new Response(body, { status }) }), false);
  }
  assert.equal(await checkHealth({ fetchImpl: async () => { throw new Error('connection refused'); } }), false);
});
