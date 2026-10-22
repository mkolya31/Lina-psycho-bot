import { messages } from './messages.js';
import { TelegramApiError } from './telegram.js';

const PAGE_SIZE = 5;
const registrationText = 'Зарегистрироваться';
const registrationKeyboard = {
  keyboard: [[{ text: registrationText, style: 'success' }]],
  resize_keyboard: true,
  one_time_keyboard: true,
};
const removeKeyboard = { remove_keyboard: true };
const isUser = (user) => user && Number.isSafeInteger(user.id) && user.id > 0
  && user.is_bot === false && typeof user.first_name === 'string'
  && (user.last_name == null || typeof user.last_name === 'string')
  && (user.username == null || typeof user.username === 'string');
const isPrivate = (user, chat) => isUser(user) && chat?.type === 'private' && chat.id === user.id;
const clean = (value, limit) => Array.from(String(value)).slice(0, limit).join('').replace(/[\p{Cc}\p{Cf}]/gu, ' ');

export function createBot({ store, telegram, adminIds, timeZone = 'Europe/Moscow' }) {
  const formatter = new Intl.DateTimeFormat('ru-RU', {
    timeZone, dateStyle: 'short', timeStyle: 'medium',
  });
  const date = (value) => value ? formatter.format(new Date(value)) : '—';
  const send = (chatId, text, replyMarkup) => telegram.call('sendMessage', {
    chat_id: chatId, text, link_preview_options: { is_disabled: true },
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
  const answer = async (id, text) => {
    try {
      await telegram.call('answerCallbackQuery', { callback_query_id: id, ...(text ? { text } : {}) });
    } catch (error) {
      // An expired callback must not prevent a durable registration or its chat confirmation.
      if (!(error instanceof TelegramApiError && error.status === 400)) throw error;
    }
  };
  const participants = async (chatId, requestedPage) => {
    const { total } = store.stats();
    if (!total) return send(chatId, 'Пока никто не запускал бота.');
    const pages = Math.ceil(total / PAGE_SIZE);
    const page = Math.max(1, Math.min(requestedPage, pages));
    const rows = store.list(page, PAGE_SIZE).map((person, index) => [
      `${(page - 1) * PAGE_SIZE + index + 1}. ${clean(person.telegram_name, 160)}`,
      `Username: ${person.username ? `@${clean(person.username, 64)}` : '—'}`,
      `Telegram ID: ${person.telegram_id}`,
      `Статус: ${person.registered_at ? 'Зарегистрирован' : 'Не подтвердил'}`,
      `Первый запуск: ${date(person.first_started_at)}`,
      `Регистрация: ${date(person.registered_at)}`,
    ].join('\n'));
    const buttons = [];
    if (page > 1) buttons.push({ text: '← Назад', callback_data: `participants:${page - 1}` });
    if (page < pages) buttons.push({ text: 'Далее →', callback_data: `participants:${page + 1}` });
    return send(chatId, `Участники: ${total}. Страница ${page}/${pages}.\nВремя: ${timeZone}\n\n${rows.join('\n\n')}`,
      buttons.length ? { inline_keyboard: [buttons] } : undefined);
  };

  return async function handleUpdate(update) {
    const callback = update.callback_query;
    if (callback) {
      if (typeof callback.id !== 'string' || !isPrivate(callback.from, callback.message?.chat)) return;
      const { from: user, message } = callback;
      if (callback.data === 'register') {
        const person = store.register(user, message.chat.id);
        await answer(callback.id, person ? 'Регистрация подтверждена' : 'Отправьте /start');
        await send(message.chat.id, person ? messages.registered : messages.startFirst, removeKeyboard);
      } else if (typeof callback.data === 'string' && /^participants:[1-9]\d{0,8}$/.test(callback.data)) {
        if (!adminIds.has(user.id)) return answer(callback.id, messages.forbidden);
        await answer(callback.id);
        await participants(message.chat.id, Number(callback.data.split(':')[1]));
      } else {
        await answer(callback.id, 'Кнопка устарела. Отправьте /start.');
      }
      return;
    }

    const message = update.message;
    if (!message || !isPrivate(message.from, message.chat) || typeof message.text !== 'string') return;
    const { from: user, chat } = message;
    if (message.text.trim() === registrationText) {
      const person = store.register(user, chat.id);
      return send(chat.id, person ? messages.registered : messages.startFirst, removeKeyboard);
    }
    const match = /^\/(start|stats|participants|help)(?:@[A-Za-z0-9_]+)?(?:\s+([\s\S]*))?$/.exec(message.text.trim());
    if (!match) return send(chat.id, messages.help);
    const [, command, argument] = match;
    if (command === 'start') {
      const person = store.start(user, chat.id);
      return send(chat.id, messages.welcome + (person.registered_at ? `\n\n${messages.alreadyRegistered}` : ''), registrationKeyboard);
    }
    if (command === 'help') return send(chat.id, messages.help);
    if (!adminIds.has(user.id)) return send(chat.id, messages.forbidden);
    if (command === 'stats') {
      const stats = store.stats();
      return send(chat.id, `Запустили бота: ${stats.total}\nЗарегистрировались: ${stats.registered}\nНе подтвердили: ${stats.unconfirmed}`);
    }
    if (argument !== undefined && !/^[1-9]\d{0,8}$/.test(argument.trim())) {
      return send(chat.id, 'Использование: /participants или /participants 2');
    }
    return participants(chat.id, argument === undefined ? 1 : Number(argument.trim()));
  };
}
