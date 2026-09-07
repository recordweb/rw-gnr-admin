// =============================================================================
// logger.js - Minimal structured logging
// -----------------------------------------------------------------------------
// Not as elaborate as the chaincode's structured JSON logging - just clear,
// consistently-shaped, actionable log lines with a level, a message, and an
// optional metadata object, so operators can grep/parse Docker logs.
// =============================================================================

function log(level, message, meta) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    message,
    ...(meta ? { meta } : {}),
  };
  const line = JSON.stringify(entry);
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  info: (message, meta) => log('info', message, meta),
  warn: (message, meta) => log('warn', message, meta),
  error: (message, meta) => log('error', message, meta),
};
