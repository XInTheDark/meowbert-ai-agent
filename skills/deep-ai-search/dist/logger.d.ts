export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export interface Logger {
    debug: (msg: string, extra?: unknown) => void;
    info: (msg: string, extra?: unknown) => void;
    warn: (msg: string, extra?: unknown) => void;
    error: (msg: string, extra?: unknown) => void;
}
export declare function createLogger(level: LogLevel): Logger;
