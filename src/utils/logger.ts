/**
 * logger.ts
 *
 * Lightweight contextual logger that wraps the global console.  Each logger
 * instance is tagged with a module name so log lines are easy to filter in
 * the Metro / Xcode / Android Studio output.
 *
 * In production builds (NODE_ENV === 'production') debug-level messages are
 * suppressed.  For remote logging (e.g. Sentry, Datadog) replace the console
 * calls with your SDK calls inside each method.
 */

export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

const isDevelopment = process.env.NODE_ENV !== 'production';

class Logger {
  constructor(private readonly context: string) {}

  debug(message: string, ...args: unknown[]): void {
    if (isDevelopment) {
      console.debug(`[${LogLevel.DEBUG}][${this.context}] ${message}`, ...args);
    }
  }

  info(message: string, ...args: unknown[]): void {
    console.info(`[${LogLevel.INFO}][${this.context}] ${message}`, ...args);
  }

  warn(message: string, ...args: unknown[]): void {
    console.warn(`[${LogLevel.WARN}][${this.context}] ${message}`, ...args);
  }

  error(message: string, ...args: unknown[]): void {
    console.error(`[${LogLevel.ERROR}][${this.context}] ${message}`, ...args);
  }
}

/**
 * Factory that creates a Logger bound to the given context (module) name.
 *
 * @example
 *   const logger = createLogger('AuthService');
 *   logger.info('User logged in');
 */
export const createLogger = (context: string): Logger => new Logger(context);
