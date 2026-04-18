'use strict';

const HEALTH_PROMPT = 'ping';
const HEALTH_MAX_TOKENS = 5;
const DEFAULT_TIMEOUT_MS = 10000;

/**
 * Probe a single provider with a minimal prompt. Never throws —
 * any failure is captured into the returned status object. The
 * timeout timer is always cleared so the Node event loop can exit
 * promptly even when the provider responded quickly.
 * @param {object} provider - Provider instance.
 * @param {number} timeoutMs - Per-provider timeout.
 * @returns {Promise<{ok: boolean, latency: number, error?: string}>}
 */
async function checkProvider(provider, timeoutMs) {
  const startedAt = Date.now();
  let timer;
  try {
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Health check timed out after ${timeoutMs}ms.`)), timeoutMs);
    });
    const call = provider.complete({ prompt: HEALTH_PROMPT, maxTokens: HEALTH_MAX_TOKENS });
    await Promise.race([call, timeoutPromise]);
    return { ok: true, latency: Date.now() - startedAt };
  } catch (err) {
    return {
      ok: false,
      latency: Date.now() - startedAt,
      error: err && err.message ? err.message : String(err)
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Probe every configured provider in parallel and return a status map.
 * Never throws — even if every provider fails, the function resolves
 * with the full result set. This makes it safe to call from health
 * endpoints and startup probes.
 * @param {Map<string, object>} providers - Map of name -> provider instance.
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs=10000] - Per-provider timeout.
 * @returns {Promise<Object<string, {ok: boolean, latency: number, error?: string}>>}
 */
async function runHealthCheck(providers, opts = {}) {
  const timeoutMs = Number.isInteger(opts.timeoutMs) && opts.timeoutMs > 0
    ? opts.timeoutMs
    : DEFAULT_TIMEOUT_MS;
  const names = Array.from(providers.keys());
  if (names.length === 0) return {};
  const outcomes = await Promise.all(
    names.map((name) => checkProvider(providers.get(name), timeoutMs))
  );
  const results = {};
  for (let i = 0; i < names.length; i++) results[names[i]] = outcomes[i];
  return results;
}

module.exports = { runHealthCheck, HEALTH_PROMPT, HEALTH_MAX_TOKENS };
