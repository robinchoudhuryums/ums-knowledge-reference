import { getCorrelationId } from './correlationId';

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

function buildLogEntry(level: LogLevel, message: string, meta?: Record<string, unknown>): string {
  const entry: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level,
    message,
  };

  const correlationId = getCorrelationId();
  if (correlationId) {
    entry.correlationId = correlationId;
  }

  if (meta) {
    for (const [key, value] of Object.entries(meta)) {
      if (!(key in entry)) {
        entry[key] = value;
      }
    }
  }

  return JSON.stringify(entry);
}

export const logger = {
  info(message: string, meta?: Record<string, unknown>) {
    console.log(buildLogEntry('info', message, meta));
  },
  warn(message: string, meta?: Record<string, unknown>) {
    console.warn(buildLogEntry('warn', message, meta));
  },
  error(message: string, meta?: Record<string, unknown>) {
    console.error(buildLogEntry('error', message, meta));
  },
  debug(message: string, meta?: Record<string, unknown>) {
    if (process.env.NODE_ENV !== 'production') {
      console.debug(buildLogEntry('debug', message, meta));
    }
  },
};
