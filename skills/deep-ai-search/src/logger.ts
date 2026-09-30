export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const levelRank: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

export interface Logger {
  debug: (msg: string, extra?: unknown) => void;
  info: (msg: string, extra?: unknown) => void;
  warn: (msg: string, extra?: unknown) => void;
  error: (msg: string, extra?: unknown) => void;
}

function formatExtra(extra: unknown): string {
  if (extra === undefined) return '';
  try {
    if (typeof extra === 'string') return ` ${extra}`;
    return ` ${JSON.stringify(extra)}`;
  } catch {
    return ' [unserializable extra]';
  }
}

export function createLogger(level: LogLevel): Logger {
  const current = levelRank[level];

  function log(at: LogLevel, msg: string, extra?: unknown) {
    if (levelRank[at] < current) return;
    // MCP servers should log to stderr, never stdout (stdout is the protocol transport).
    console.error(`[${at}] ${msg}${formatExtra(extra)}`);
  }

  return {
    debug: (msg, extra) => log('debug', msg, extra),
    info: (msg, extra) => log('info', msg, extra),
    warn: (msg, extra) => log('warn', msg, extra),
    error: (msg, extra) => log('error', msg, extra)
  };
}

