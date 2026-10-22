import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, message, callback, user } from './helpers.js';
import { TelegramApiError } from '../src/telegram.js';

test('repeated start and registration show appropriate messages and retain registration', async (t) => {
  const { bot, store, calls } = fixture(t);
  await bot(message('/start recruitment'));
  assert.equal(store.stats().unconfirmed, 1);
  assert.match(calls.at(-1).payload.text, /не согласие на участие/);
  assert.equal(calls.at(-1).payload.reply_markup.inline_keyboard[0][0].callback_data, 'register');
  await bot(callback());
  const registered = store.get(42).registered_at;
  assert.equal(calls.at(-2).method, 'answerCallbackQuery');
  assert.match(calls.at(-1).payload.text, /Вы зарегистрированы/);
  await bot(callback());
  await bot(message());
  assert.equal(store.get(42).registered_at, registered);
  assert.deepEqual(store.stats(), { total: 1, registered: 1, unconfirmed: 0 });
  assert.match(calls.at(-1).payload.text, /уже зарегистрированы/);
});

test('only /start creates participants, including for administrators', async (t) => {
  const { bot, store, calls } = fixture(t);
  await bot(callback());
  assert.match(calls.at(-1).payload.text, /Сначала отправьте/);
  await bot(message('/help'));
  await bot(message('случайный текст'));
  await bot(message('/stats', user(9001)));
  assert.equal(store.stats().total, 0);
  await bot(message('/start', user(9001)));
  assert.equal(store.stats().total, 1);
});

test('both admins see exact statistics; unauthorized commands and page buttons reveal no data', async (t) => {
  const { bot, calls } = fixture(t);
  await bot(message());
  await bot(message('/start', user(43)));
  await bot(callback());
  for (const id of [9001, 9002]) {
    await bot(message('/stats', user(id)));
    assert.equal(calls.at(-1).payload.text, 'Запустили бота: 2\nЗарегистрировались: 1\nНе подтвердили: 1');
    await bot(message('/participants', user(id)));
    assert.match(calls.at(-1).payload.text, /Telegram ID: 42/);
    assert.match(calls.at(-1).payload.text, /Telegram ID: 43/);
    assert.match(calls.at(-1).payload.text, /Username: —/);
    assert.match(calls.at(-1).payload.text, /Не подтвердил/);
    assert.match(calls.at(-1).payload.text, /Зарегистрирован/);
  }
  for (const command of ['/stats', '/participants', '/participants 2']) {
    await bot(message(command));
    assert.equal(calls.at(-1).payload.text, 'Эта команда доступна только администраторам.');
  }
  const count = calls.length;
  await bot(callback('participants:2'));
  assert.equal(calls.length, count + 1);
  assert.equal(calls.at(-1).method, 'answerCallbackQuery');
  assert.match(calls.at(-1).payload.text, /только администраторам/);
});

test('group, channel, bot, forwarded-chat and inline callbacks never expose data or register users', async (t) => {
  const { bot, store, calls } = fixture(t);
  await bot(message('/start', user(), { chat: { id: -1, type: 'group' } }));
  await bot(message('/stats', user(9001), { chat: { id: -1, type: 'supergroup' } }));
  await bot(message('/start', user(42, { is_bot: true })));
  await bot(callback('participants:1', user(9001), { message: { chat: { id: 42, type: 'private' } } }));
  await bot(callback('register', user(), { message: undefined, inline_message_id: 'inline' }));
  await bot({ channel_post: { text: '/start' } });
  await bot({ message: {} });
  assert.equal(calls.length, 0);
  assert.equal(store.stats().total, 0);
});

test('long names and special characters remain plain text within Telegram limits on every page', async (t) => {
  const { bot, store, calls } = fixture(t);
  for (let id = 1; id <= 12; id++) {
    store.start(user(id, { first_name: '<b>\n' + '🙂'.repeat(512), username: '🙂'.repeat(256) }), id);
  }
  const admin = user(9001);
  await bot(message('/participants', admin));
  const first = calls.at(-1).payload;
  assert.match(first.text, /Страница 1\/3/);
  assert.equal(first.parse_mode, undefined);
  assert.match(first.text, /<b>/);
  assert.equal(first.reply_markup.inline_keyboard[0][0].callback_data, 'participants:2');
  await bot(callback('participants:2', admin));
  assert.match(calls.at(-1).payload.text, /Страница 2\/3/);
  assert.equal(calls.at(-1).payload.reply_markup.inline_keyboard[0].length, 2);
  await bot(message('/participants 3', admin));
  assert.match(calls.at(-1).payload.text, /Страница 3\/3/);
  for (const { method, payload } of calls) {
    if (method === 'sendMessage') assert.ok(payload.text.length <= 4096, payload.text.length);
  }
  await bot(message('/participants 999999999', admin));
  assert.match(calls.at(-1).payload.text, /Страница 3\/3/);
  for (const value of ['0', '-1', 'NaN', '2 garbage', '9999999999']) {
    await bot(message(`/participants ${value}`, admin));
    assert.match(calls.at(-1).payload.text, /Использование/);
  }
});

test('expired callback answers do not prevent registration confirmation', async (t) => {
  const { bot, store, telegram, calls } = fixture(t);
  await bot(message());
  const call = telegram.call;
  telegram.call = (method, payload) => {
    if (method === 'answerCallbackQuery') throw new TelegramApiError(method, 400);
    return call(method, payload);
  };
  await bot(callback());
  assert.ok(store.get(42).registered_at);
  assert.match(calls.at(-1).payload.text, /Вы зарегистрированы/);
});

test('empty participant list and bot-addressed commands work', async (t) => {
  const { bot, calls } = fixture(t);
  await bot(message('/participants@LinaBot', user(9001)));
  assert.match(calls.at(-1).payload.text, /Пока никто/);
  await bot(message('/start@LinaBot'));
  assert.match(calls.at(-1).payload.text, /Здравствуйте/);
});
