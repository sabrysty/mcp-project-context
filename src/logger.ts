export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

// With the stdio transport, stdout carries the MCP protocol: any stray write there
// corrupts the JSON-RPC stream. Every log line therefore goes to stderr.
const writeToStderr = (line: string): void => {
  console.error(line);
};

export function createLogger(
  minLevel: LogLevel = 'info',
  write: (line: string) => void = writeToStderr,
): Logger {
  const log = (level: LogLevel, message: string, context?: Record<string, unknown>): void => {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;
    const suffix = context ? ` ${JSON.stringify(context)}` : '';
    write(`[${new Date().toISOString()}] ${level.toUpperCase()} ${message}${suffix}`);
  };

  return {
    debug: (message, context) => {
      log('debug', message, context);
    },
    info: (message, context) => {
      log('info', message, context);
    },
    warn: (message, context) => {
      log('warn', message, context);
    },
    error: (message, context) => {
      log('error', message, context);
    },
  };
}
