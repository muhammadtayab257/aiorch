'use strict';

/**
 * Sleep for a given duration.
 * @param {number} ms - Milliseconds to wait.
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Determine whether an error is worth retrying. Retry on network
 * failures and rate limits; never retry on auth or validation errors.
 * @param {Error & {code?: string, status?: number, statusCode?: number, retryable?: boolean}} err
 * @returns {boolean}
 */
function isRetryable(err) {
  if (!err) return false;
  if (err.retryable === true) return true;
  if (err.retryable === false) return false;
  const status = err.status || err.statusCode;
  if (status === 429) return true;
  if (typeof status === 'number' && status >= 500 && status < 600) return true;
  if (status === 401 || status === 403 || status === 400 || status === 404) return false;
  const netCodes = ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED', 'EAI_AGAIN', 'EPIPE'];
  if (err.code && netCodes.includes(err.code)) return true;
  if (err.name === 'AbortError') return true;
  return false;
}

/**
 * Compute the backoff delay for a given attempt using exponential growth
 * with optional jitter. Attempt 0 -> base, 1 -> base*2, 2 -> base*4, ...
 * @param {number} attempt - Zero-based attempt index.
 * @param {number} base - Base delay in ms.
 * @param {number} cap - Maximum delay in ms.
 * @param {boolean} jitter - Whether to apply random jitter.
 * @returns {number} Delay in ms.
 */
function computeBackoff(attempt, base, cap, jitter) {
  const raw = base * Math.pow(2, attempt);
  const bounded = Math.min(raw, cap);
  if (!jitter) return bounded;
  const randomFactor = 0.5 + Math.random() * 0.5;
  return Math.floor(bounded * randomFactor);
}

/**
 * Execute an async function with retry + exponential backoff.
 * The provided function is called with the current attempt number (1-based).
 * @param {(attempt: number) => Promise<any>} fn - The async operation.
 * @param {object} [opts] - Options.
 * @param {number} [opts.retries=3] - Maximum retries on top of the first attempt.
 * @param {number} [opts.baseDelayMs=1000] - Base delay for backoff.
 * @param {number} [opts.maxDelayMs=30000] - Max delay cap.
 * @param {boolean} [opts.jitter=false] - Apply random jitter.
 * @param {(info: object) => void} [opts.onRetry] - Callback invoked before each retry.
 * @param {(err: Error) => boolean} [opts.shouldRetry] - Override retry predicate.
 * @returns {Promise<any>}
 */
async function withRetry(fn, opts = {}) {
  const retries = Number.isInteger(opts.retries) ? opts.retries : 3;
  const baseDelayMs = opts.baseDelayMs || 1000;
  const maxDelayMs = opts.maxDelayMs || 30000;
  const jitter = opts.jitter === true;
  const shouldRetry = typeof opts.shouldRetry === 'function' ? opts.shouldRetry : isRetryable;
  const onRetry = typeof opts.onRetry === 'function' ? opts.onRetry : null;

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn(attempt + 1);
    } catch (err) {
      lastErr = err;
      const hasMore = attempt < retries;
      if (!hasMore || !shouldRetry(err)) throw err;
      const delay = computeBackoff(attempt, baseDelayMs, maxDelayMs, jitter);
      if (onRetry) onRetry({ attempt: attempt + 1, nextAttempt: attempt + 2, delay, error: err });
      await sleep(delay);
    }
  }
  throw lastErr;
}

module.exports = { withRetry, isRetryable, computeBackoff, sleep };
