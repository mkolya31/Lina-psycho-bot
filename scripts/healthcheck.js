import { pathToFileURL } from 'node:url';

export async function checkHealth({ port = process.env.PORT || '3000', fetchImpl = fetch } = {}) {
  try {
    const response = await fetchImpl(`http://127.0.0.1:${port}/healthz`, {
      signal: AbortSignal.timeout(3000),
    });
    return response.status === 200 && (await response.text()).trim() === 'ok';
  } catch {
    return false;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await checkHealth() ? 0 : 1;
}
