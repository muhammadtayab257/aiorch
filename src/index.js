'use strict';

const { Router, ProviderError } = require('./core/router');
const { Logger } = require('./core/logger');
const { OpenAIProvider } = require('./providers/openai');
const { AnthropicProvider } = require('./providers/anthropic');
const { GeminiProvider } = require('./providers/gemini');
const { calculateCost, getPricingTable } = require('./utils/cost');
const {
  SUPPORTED_PROVIDERS,
  ValidationError,
  validateConfig,
  validateCompleteOptions,
  validateStreamOptions
} = require('./utils/validator');
const { AllProvidersFailedError } = require('./core/fallback');
const { CostLimitError, checkLimits, getCostLimitStatus, estimateCallCost } = require('./core/costLimit');
const { runHealthCheck } = require('./core/healthCheck');

const DEFAULT_FALLBACK_ORDER = ['openai', 'anthropic', 'gemini'];
const DEFAULT_RETRIES = 3;

/**
 * Resolve the effective fallback order for a given config. Drops
 * providers without a configured API key so the router never tries
 * an unusable entry.
 * @param {object} config
 * @returns {string[]}
 */
function resolveFallbackOrder(config) {
  const requested = Array.isArray(config.fallbackOrder) && config.fallbackOrder.length > 0
    ? config.fallbackOrder
    : DEFAULT_FALLBACK_ORDER;
  return requested.filter((name) => typeof config[name] === 'string' && config[name].length > 0);
}

/**
 * Instantiate every provider that has an API key configured.
 * @param {object} config
 * @param {object} [providerFactories] - Optional override map for tests.
 * @returns {Map<string, object>} Map of provider name -> instance.
 */
function buildProviders(config, providerFactories) {
  const factories = providerFactories || {
    openai: (key) => new OpenAIProvider({ apiKey: key, defaultModel: config.defaults && config.defaults.openai }),
    anthropic: (key) => new AnthropicProvider({ apiKey: key, defaultModel: config.defaults && config.defaults.anthropic }),
    gemini: (key) => new GeminiProvider({ apiKey: key, defaultModel: config.defaults && config.defaults.gemini })
  };
  const map = new Map();
  for (const name of SUPPORTED_PROVIDERS) {
    const key = config[name];
    if (typeof key === 'string' && key.length > 0) {
      map.set(name, factories[name](key));
    }
  }
  return map;
}

/**
 * AISync — a unified interface over OpenAI, Anthropic, and Gemini
 * with automatic fallback, retry, cost tracking, and logging.
 */
class AISync {
  /**
   * @param {object} config - Configuration.
   * @param {string} [config.openai] - OpenAI API key.
   * @param {string} [config.anthropic] - Anthropic API key.
   * @param {string} [config.gemini] - Gemini API key.
   * @param {string[]} [config.fallbackOrder] - Provider order; defaults to [openai, anthropic, gemini].
   * @param {number} [config.retries=3] - Max retries per provider.
   * @param {boolean|object} [config.logging=true] - Disable with false, or pass a custom logger with a log(entry) method.
   * @param {{openai?: string, anthropic?: string, gemini?: string}} [config.defaults] - Default models per provider.
   * @param {object} [config._providerFactories] - Test hook to inject provider instances.
   */
  constructor(config) {
    validateConfig(config);
    const retries = Number.isInteger(config.retries) ? config.retries : DEFAULT_RETRIES;
    const loggingOpt = config.logging === undefined ? true : config.logging;
    this.logger = new Logger(loggingOpt);
    this.providers = buildProviders(config, config._providerFactories);
    this.fallbackOrder = resolveFallbackOrder(config);
    this.costState = { total: 0, calls: 0 };
    this.limits = {
      maxCostPerCall: typeof config.maxCostPerCall === 'number' ? config.maxCostPerCall : undefined,
      maxCostPerSession: typeof config.maxCostPerSession === 'number' ? config.maxCostPerSession : undefined
    };
    this.router = new Router({
      providers: this.providers,
      fallbackOrder: this.fallbackOrder,
      retries,
      logger: this.logger,
      costState: this.costState
    });
  }

  /**
   * Run a completion. Routes through the preferred provider first,
   * falling back through the remaining order on failure.
   * @param {object} options
   * @param {string} options.prompt - The user prompt (required).
   * @param {'openai'|'anthropic'|'gemini'} [options.provider] - Preferred provider.
   * @param {string} [options.model] - Model override.
   * @param {number} [options.maxTokens] - Max output tokens.
   * @param {number} [options.temperature] - Sampling temperature 0..2.
   * @returns {Promise<{text: string, provider: string, model: string, cost: number, tokens: {input: number, output: number, total: number}, latency: number, raw: object}>}
   */
  async complete(options) {
    validateCompleteOptions(options);
    this.enforceCostLimits(options);
    return this.router.complete(options);
  }

  /**
   * Stream a completion. The onChunk callback is invoked with each
   * text delta as it arrives from the provider. The returned promise
   * resolves with the same standardized response shape as complete()
   * once the stream finishes. Retries and fallback only apply until
   * the first chunk is delivered — after that, errors are terminal.
   * @param {object} options - Same options as complete().
   * @param {(chunk: string) => void} onChunk - Chunk handler.
   * @returns {Promise<object>} Final standardized response.
   */
  async stream(options, onChunk) {
    validateStreamOptions(options, onChunk);
    this.enforceCostLimits(options);
    return this.router.stream(options, onChunk);
  }

  /**
   * Probe every configured provider with a minimal request and
   * return a status map. Never throws; failed providers appear as
   * `{ ok: false, latency, error }` in the result.
   * @param {object} [opts]
   * @param {number} [opts.timeoutMs=10000] - Per-provider timeout.
   * @returns {Promise<Object<string, {ok: boolean, latency: number, error?: string}>>}
   */
  async healthCheck(opts) {
    return runHealthCheck(this.providers, opts || {});
  }

  /**
   * Enforce any configured pre-call cost limits. Called by both
   * complete() and stream().
   * @param {object} options - The pending call options.
   * @returns {void}
   * @throws {CostLimitError}
   */
  enforceCostLimits(options) {
    const defaultModel = this.getDefaultModelFor(options.provider);
    checkLimits({ limits: this.limits, costState: this.costState, options, defaultModel });
  }

  /**
   * Best-guess default model for a provider. Used to estimate cost
   * before a call runs, for the per-call cost limit check.
   * @param {string} [providerName]
   * @returns {string}
   */
  getDefaultModelFor(providerName) {
    const target = providerName || this.fallbackOrder[0];
    const provider = target ? this.providers.get(target) : null;
    return provider && provider.defaultModel ? provider.defaultModel : '';
  }

  /**
   * Summary of how close the session is to its configured cost
   * limits. Returns null fields for limits that aren't configured.
   * @returns {{session: object|null, call: object|null}}
   */
  getCostLimitStatus() {
    return getCostLimitStatus(this.limits, this.costState);
  }

  /**
   * Cumulative USD cost of all calls made through this instance.
   * @returns {number}
   */
  getTotalCost() {
    return this.costState.total;
  }

  /**
   * Total number of successful calls made through this instance.
   * @returns {number}
   */
  getCallCount() {
    return this.costState.calls;
  }

  /**
   * Reset cumulative cost and call counters.
   * @returns {void}
   */
  resetUsage() {
    this.costState.total = 0;
    this.costState.calls = 0;
  }

  /**
   * Names of providers currently configured and usable.
   * @returns {string[]}
   */
  getConfiguredProviders() {
    return Array.from(this.providers.keys());
  }
}

module.exports = {
  AISync,
  OpenAIProvider,
  AnthropicProvider,
  GeminiProvider,
  Logger,
  ValidationError,
  AllProvidersFailedError,
  ProviderError,
  CostLimitError,
  calculateCost,
  estimateCallCost,
  getPricingTable,
  SUPPORTED_PROVIDERS
};
