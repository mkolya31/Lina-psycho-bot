export class TelegramApiError extends Error {
  constructor(method, status = 0) {
    // Never retain Telegram's raw description or fetch error: either may contain secrets or PII.
    super(`Telegram API request failed: ${method} (${status})`);
    this.name = 'TelegramApiError';
    this.method = method;
    this.status = status;
    this.retryable = status === 0 || status === 429 || status >= 500;
  }
}

export class TelegramClient {
  constructor(token, { fetchImpl = fetch, timeoutMs = 8000 } = {}) {
    this.token = token;
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async call(method, payload) {
    let response;
    let body;
    try {
      response = await this.fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      body = await response.json();
    } catch {
      throw new TelegramApiError(method);
    }
    if (!response.ok || body?.ok !== true) {
      const status = Number.isInteger(body?.error_code) ? body.error_code : response.status;
      throw new TelegramApiError(method, status >= 400 ? status : 502);
    }
    return body.result;
  }
}
