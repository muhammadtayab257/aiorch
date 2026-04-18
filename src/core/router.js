'use strict';

const { withRetry, isRetryable } = require('./retry');
const { runWithFallback, resolveProviderOrder } = require('./fallback');
const { calculateCost } = require('../utils/cost');

/**
 * Normalize a provider-specific error into a ProviderError.
 * Preserves retryability signals so the retry layer can decide
 * whether to try again.
 */
class ProviderError extends Error {
  constructor({ provider, message, code, status, retryable, cause }) {
    super(`[${provider}] ${message}`);
    this.name = 'ProviderError';
    this.provider = provider;
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    if (cause) this.cause = cause;
  }
}

/**
 * Router dispatches complete() calls across providers applying
 * retry + fallback + logging + cost tracking.
 */
class Router {
  /**
   * @param {object} deps
   * @param {Map<string, object>} deps.providers - Map of provider name -> provider instance.
   * @param {string[]} deps.fallbackOrder - Ordered list of providers to try.
   * @param {number} deps.retries - Max retries per provider.
   * @param {import('./logger').Logger} deps.logger - Logger instance.
   * @param {object} deps.costState - Shared mutable cost-tracking state.
   */
  constructor({ providers, fallbackOrder, retries, logger, costState }) {
    this.providers = providers;
    this.fallbackOrder = fallbackOrder;
    this.retries = retries;
    this.logger = logger;
    this.costState = costState;
  }

  /**
   * Entry point for a completion request.
   * @param {object} options - Validated complete() options.
   * @returns {Promise<object>} Standardized response.
   */
  async complete(options) {
    const available = new Set(this.providers.keys());
    const order = resolveProviderOrder(options.provider, this.fallbackOrder, available);
    if (order.length === 0) {
      throw new Error('No providers are available to handle this request.');
    }
    const onFallback = (info) => this.logger.logFallback(info);
    return runWithFallback(order, (name) => this.runProvider(name, options), onFallback);
  }

  /**
   * Entry point for a streaming completion. Routes through the
   * preferred provider first, falling back on failure — but only
   * while no chunks have been emitted to the caller. Once any chunk
   * has been delivered, errors are rethrown without further retry or
   * fallback to avoid duplicating output.
   * @param {object} options - Validated stream() options.
   * @param {(chunk: string) => void} onChunk - Caller's chunk handler.
   * @returns {Promise<object>} Final standardized response (post-stream totals).
   */
  async stream(options, onChunk) {
    const available = new Set(this.providers.keys());
    const order = resolveProviderOrder(options.provider, this.fallbackOrder, available);
    if (order.length === 0) {
      throw new Error('No providers are available to handle this request.');
    }
    let emitted = false;
    const wrappedOnChunk = (text) => { emitted = true; onChunk(text); };
    const onFallback = (info) => this.logger.logFallback(info);
    const canFallback = () => !emitted;
    const runProvider = (name) => this.runProviderStream(name, options, wrappedOnChunk, () => emitted);
    return runWithFallback(order, runProvider, onFallback, canFallback);
  }

  /**
   * Run a single provider with retry and logging.
   * @param {string} name - Provider name.
   * @param {object} options - Original complete options.
   * @returns {Promise<object>} Standardized response annotated with cost/latency.
   */
  async runProvider(name, options) {
    const provider = this.providers.get(name);
    const onRetry = (info) =>
      this.logger.logRetry({
        provider: name,
        attempt: info.attempt,
        nextAttempt: info.nextAttempt,
        delay: info.delay,
        error: info.error && info.error.message ? info.error.message : 'unknown'
      });

    const startedAt = Date.now();
    try {
      const result = await withRetry((attempt) => provider.complete({ ...options, attempt }), {
        retries: this.retries,
        onRetry
      });
      return this.finalize(name, result, startedAt);
    } catch (err) {
      const latency = Date.now() - startedAt;
      this.logger.logFailure({ provider: name, model: options.model || null, latency, error: err });
      throw err;
    }
  }

  /**
   * Run a single provider's streaming call with retry and logging.
   * Retries only occur before the first chunk has been emitted; once
   * data has reached the caller, errors are considered terminal.
   * @param {string} name - Provider name.
   * @param {object} options - Original stream options.
   * @param {(chunk: string) => void} onChunk - Wrapped chunk handler.
   * @param {() => boolean} getEmitted - Snapshot accessor for emitted state.
   * @returns {Promise<object>} Standardized response annotated with cost/latency.
   */
  async runProviderStream(name, options, onChunk, getEmitted) {
    const provider = this.providers.get(name);
    const onRetry = (info) => this.logger.logRetry({
      provider: name,
      attempt: info.attempt,
      nextAttempt: info.nextAttempt,
      delay: info.delay,
      error: info.error && info.error.message ? info.error.message : 'unknown'
    });
    const shouldRetry = (err) => !getEmitted() && isRetryable(err);
    const startedAt = Date.now();
    try {
      const result = await withRetry((attempt) => provider.stream({ ...options, attempt }, onChunk), {
        retries: this.retries,
        onRetry,
        shouldRetry
      });
      return this.finalize(name, result, startedAt);
    } catch (err) {
      const latency = Date.now() - startedAt;
      this.logger.logFailure({ provider: name, model: options.model || null, latency, error: err });
      throw err;
    }
  }

  /**
   * Post-process a provider response: compute cost, update totals,
   * log success, and shape the public response object.
   * @param {string} name - Provider name.
   * @param {object} result - Provider's standardized result.
   * @param {number} startedAt - Request start timestamp (ms).
   * @returns {object} Public response.
   */
  finalize(name, result, startedAt) {
    const latency = Date.now() - startedAt;
    const inputTokens = result.tokens && Number.isFinite(result.tokens.input) ? result.tokens.input : 0;
    const outputTokens = result.tokens && Number.isFinite(result.tokens.output) ? result.tokens.output : 0;
    const totalTokens = inputTokens + outputTokens;
    const cost = calculateCost(result.model, inputTokens, outputTokens);
    this.costState.total = Math.round((this.costState.total + cost) * 1e6) / 1e6;
    this.costState.calls += 1;
    this.logger.logSuccess({
      provider: name,
      model: result.model,
      tokens: { input: inputTokens, output: outputTokens, total: totalTokens },
      cost,
      latency
    });
    return {
      text: result.text,
      provider: name,
      model: result.model,
      cost,
      tokens: { input: inputTokens, output: outputTokens, total: totalTokens },
      latency,
      raw: result.raw
    };
  }
}

module.exports = { Router, ProviderError };
