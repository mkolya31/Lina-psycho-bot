// Callers supply only fixed event names and safe metadata, never errors, URLs or updates.
export function log(event, metadata = {}) {
  console.log(JSON.stringify({ time: new Date().toISOString(), event, ...metadata }));
}
