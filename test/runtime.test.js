import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { testEnv } from './helpers.js';

const root = fileURLToPath(new URL('..', import.meta.url));

function launch(env) {
  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: root, env: { ...process.env, ...env }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = [];
  child.stdout.on('data', (chunk) => output.push(chunk.toString()));
  child.stderr.on('data', (chunk) => output.push(chunk.toString()));
  return { child, output };
}

test('entry point rejects incomplete configuration without leaking secrets', async () => {
  const { child, output } = launch({ ...testEnv, ADMIN_IDS: '' });
  const code = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', resolve);
  });
  assert.equal(code, 1);
  assert.match(output.join(''), /startup_failed/);
  assert.ok(!output.join('').includes(testEnv.BOT_TOKEN));
  assert.ok(!output.join('').includes(testEnv.WEBHOOK_SECRET));
});

test('entry point starts a working health endpoint without contacting Telegram', { timeout: 10_000 }, async (t) => {
  const reservation = createServer();
  await new Promise((resolve, reject) => {
    reservation.once('error', reject);
    reservation.listen(0, '127.0.0.1', resolve);
  });
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const { child, output } = launch({ ...testEnv, DB_PATH: ':memory:', HOST: '127.0.0.1', PORT: String(port) });
  t.after(async () => {
    if (child.exitCode !== null) return;
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill();
    await exited;
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server startup timed out')), 5000);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', () => { clearTimeout(timer); reject(new Error('Server exited before startup')); });
    child.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('server_started')) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  const response = await fetch(`http://127.0.0.1:${port}/healthz`);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'ok');
  assert.ok(!output.join('').includes(testEnv.BOT_TOKEN));
  assert.ok(!output.join('').includes(testEnv.WEBHOOK_SECRET));
});
