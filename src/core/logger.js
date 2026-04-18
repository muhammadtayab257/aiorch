'use strict';

/**
 * Internal logger that emits structured JSON entries to stdout
 * or to a caller-supplied sink. Prompt content is never logged
 * by default to avoid leaking sensitive data.
 */
class Logger {
  /**
   * @param {boolean|object} logging - true/false for default behavior,
   *   or a logger object with a log(entry) method to replace the sink.
   */
  constructor(logging) {
    if (logging === false || logging === undefined || logging === null) {
      this.enabled = false;
      this.sink = null;
      return;
    }
    this.enabled = true;
    if (typeof logging === 'object' && typeof logging.log === 'function') {
      this.sink = logging;
    } else {
      this.sink = { log: (entry) => console.log(JSON.stringify(entry)) };
    }
  }

  /**
   * Emit a successful call entry.
   * @param {object} details - Call details.
   * @returns {void}
   */
  logSuccess(details) {
    this.emit({ level: 'info', event: 'ai_call', status: 'success', ...details });
  }

  /**
   * Emit a failed call entry. The error message is captured but not the stack.
   * @param {object} details - Call details plus an error field.
   * @returns {void}
   */
  logFailure(details) {
    const { error, ...rest } = details;
    const errMsg = error instanceof Error ? error.message : String(error);
    const errCode = error && error.code ? error.code : undefined;
    this.emit({ level: 'error', event: 'ai_call', status: 'failure', error: errMsg, errorCode: errCode, ...rest });
  }

  /**
   * Emit a fallback notification entry.
   * @param {object} details - Fallback context.
   * @returns {void}
   */
  logFallback(details) {
    this.emit({ level: 'warn', event: 'ai_fallback', ...details });
  }

  /**
   * Emit a retry notification entry.
   * @param {object} details - Retry context.
   * @returns {void}
   */
  logRetry(details) {
    this.emit({ level: 'warn', event: 'ai_retry', ...details });
  }

  /**
   * Base emit method. Adds a timestamp and forwards to the sink.
   * @param {object} entry - Raw structured entry.
   * @returns {void}
   */
  emit(entry) {
    if (!this.enabled || !this.sink) return;
    const stamped = { timestamp: new Date().toISOString(), ...entry };
    try {
      this.sink.log(stamped);
    } catch {
      // Never let logging failures break the caller.
    }
  }
}

module.exports = { Logger };
