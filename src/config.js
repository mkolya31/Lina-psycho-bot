export class ConfigurationError extends Error {}

export function loadConfig(env = process.env) {
  const required = (name) => {
    const value = env[name]?.trim();
    if (!value) throw new ConfigurationError(`Не задана переменная ${name}`);
    return value;
  };
  const botToken = required('BOT_TOKEN');
  if (!/^\d+:[A-Za-z0-9_-]+$/.test(botToken)) {
    throw new ConfigurationError('Некорректный формат BOT_TOKEN');
  }
  const webhookSecret = required('WEBHOOK_SECRET');
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(webhookSecret)) {
    throw new ConfigurationError('WEBHOOK_SECRET: допустимы 1–256 символов A-Z, a-z, 0-9, _ и -');
  }
  const ids = required('ADMIN_IDS').split(',').map((id) => id.trim());
  if (ids.some((id) => !/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)))) {
    throw new ConfigurationError('ADMIN_IDS должен содержать положительные Telegram ID через запятую');
  }
  const portText = env.PORT ?? '3000';
  const port = Number(portText);
  if (!/^\d+$/.test(portText) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigurationError('PORT должен быть целым числом от 1 до 65535');
  }
  const timeZone = env.DISPLAY_TIMEZONE?.trim() || 'Europe/Moscow';
  try {
    new Intl.DateTimeFormat('ru-RU', { timeZone }).format();
  } catch {
    throw new ConfigurationError('Некорректный DISPLAY_TIMEZONE');
  }
  return {
    botToken,
    webhookSecret,
    adminIds: new Set(ids.map(Number)),
    host: env.HOST?.trim() || '127.0.0.1',
    port,
    dbPath: env.DB_PATH?.trim() || './data/participants.sqlite',
    timeZone,
  };
}
