'use strict';

/**
 * Error thrown when every configured provider fails.
 * Aggregates the underlying errors so callers can inspect them.
 */
class AllProvidersFailedError extends Error {
  /**
   * @param {Array<{provider: string, error: Error}>} failures
   */
  constructor(failures) {
    const summary = failures
      .map((f) => `${f.provider}: ${f.error && f.error.message ? f.error.message : 'unknown error'}`)
      .join('; ');
    super(`All providers failed. Attempts: ${summary}`);
    this.name = 'AllProvidersFailedError';
    this.code = 'ALL_PROVIDERS_FAILED';
    this.failures = failures;
  }
}

/**
 * Resolve the ordered list of providers to try for a given call.
 * The preferred provider (if any) goes first, followed by the rest of
 * the fallback order with duplicates removed. Only providers with
 * configured API keys are kept.
 * @param {string|undefined} preferred - Provider explicitly requested by the caller.
 * @param {string[]} fallbackOrder - Configured fallback order.
 * @param {Set<string>} availableProviders - Providers with valid API keys.
 * @returns {string[]} Ordered list of providers to try.
 */
function resolveProviderOrder(preferred, fallbackOrder, availableProviders) {
  const order = [];
  const seen = new Set();
  const push = (name) => {
    if (!name || seen.has(name)) return;
    if (!availableProviders.has(name)) return;
    seen.add(name);
    order.push(name);
  };
  push(preferred);
  for (const name of fallbackOrder) push(name);
  return order;
}

/**
 * Execute a call against the first provider that succeeds, using
 * the resolved order. On each failure, invoke the onFallback hook
 * and move to the next provider. If a canFallback predicate is
 * supplied and returns false at failure time, the error is re-thrown
 * immediately without trying further providers — used by streaming
 * to avoid switching providers after chunks have already reached the
 * caller.
 * @param {string[]} order - Ordered list of providers to try.
 * @param {(provider: string) => Promise<object>} runProvider - Runner function per provider.
 * @param {(info: object) => void} [onFallback] - Hook called after each provider failure (except when the last one fails).
 * @param {() => boolean} [canFallback] - Optional predicate; return false to abort further fallback.
 * @returns {Promise<object>} The successful provider response.
 * @throws {AllProvidersFailedError}
 */
async function runWithFallback(order, runProvider, onFallback, canFallback) {
  if (!Array.isArray(order) || order.length === 0) {
    throw new AllProvidersFailedError([{ provider: 'none', error: new Error('No providers available.') }]);
  }
  const failures = [];
  for (let i = 0; i < order.length; i++) {
    const provider = order[i];
    try {
      return await runProvider(provider);
    } catch (err) {
      failures.push({ provider, error: err });
      if (typeof canFallback === 'function' && !canFallback()) throw err;
      const hasNext = i < order.length - 1;
      if (hasNext && typeof onFallback === 'function') {
        onFallback({ from: provider, to: order[i + 1], reason: err && err.message ? err.message : 'unknown' });
      }
    }
  }
  throw new AllProvidersFailedError(failures);
}

module.exports = { runWithFallback, resolveProviderOrder, AllProvidersFailedError };
