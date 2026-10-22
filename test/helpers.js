import { ParticipantStore } from '../src/store.js';
import { createBot } from '../src/bot.js';

export const user = (id = 42, extra = {}) => ({ id, is_bot: false, first_name: 'Анна', ...extra });
export const message = (text = '/start', from = user(), extra = {}) => ({
  update_id: 1,
  message: { message_id: 10, from, chat: { id: from.id, type: 'private' }, text, ...extra },
});
export const callback = (data = 'register', from = user(), extra = {}) => ({
  update_id: 2,
  callback_query: {
    id: 'callback-1', from, data,
    message: { message_id: 20, chat: { id: from.id, type: 'private' } },
    ...extra,
  },
});
export function fixture(t) {
  const store = new ParticipantStore(':memory:');
  t.after(() => store.close());
  const calls = [];
  const telegram = { async call(method, payload) { calls.push({ method, payload }); return true; } };
  const bot = createBot({ store, telegram, adminIds: new Set([9001, 9002]) });
  return { store, calls, telegram, bot };
}
export const testEnv = {
  BOT_TOKEN: '123456:test_secret_token', WEBHOOK_SECRET: 'webhook_secret', ADMIN_IDS: '9001,9002',
};
