'use strict';

const SUPPORTED_PROVIDERS = ['openai', 'anthropic', 'gemini'];

/**
 * Error thrown when user input fails validation.
 */
class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.code = 'VALIDATION_ERROR';
  }
}

/**
 * Validate the config passed to the AISync constructor.
 * At least one provider API key is required.
 * @param {object} config - User-supplied config object.
 * @returns {void}
 * @throws {ValidationError} When config is malformed.
 */
function validateConfig(config) {
  if (!config || typeof config !== 'object') {
    throw new ValidationError('AISync config must be an object.');
  }
  const hasAnyKey = SUPPORTED_PROVIDERS.some((p) => typeof config[p] === 'string' && config[p].length > 0);
  if (!hasAnyKey) {
    throw new ValidationError('At least one provider API key must be supplied (openai, anthropic, or gemini).');
  }
  if (config.fallbackOrder !== undefined) {
    validateFallbackOrder(config.fallbackOrder, config);
  }
  if (config.retries !== undefined) {
    if (!Number.isInteger(config.retries) || config.retries < 0 || config.retries > 10) {
      throw new ValidationError('retries must be an integer between 0 and 10.');
    }
  }
  if (config.logging !== undefined && typeof config.logging !== 'boolean' && typeof config.logging !== 'object') {
    throw new ValidationError('logging must be a boolean or a logger object with a log(entry) method.');
  }
  if (config.maxCostPerCall !== undefined) {
    if (typeof config.maxCostPerCall !== 'number' || !Number.isFinite(config.maxCostPerCall) || config.maxCostPerCall <= 0) {
      throw new ValidationError('maxCostPerCall must be a positive finite number.');
    }
  }
  if (config.maxCostPerSession !== undefined) {
    if (typeof config.maxCostPerSession !== 'number' || !Number.isFinite(config.maxCostPerSession) || config.maxCostPerSession <= 0) {
      throw new ValidationError('maxCostPerSession must be a positive finite number.');
    }
  }
}

/**
 * Validate that a fallback order only contains supported, configured providers.
 * @param {string[]} order - User-supplied fallback order.
 * @param {object} config - Full config (to verify keys exist).
 * @returns {void}
 * @throws {ValidationError}
 */
function validateFallbackOrder(order, config) {
  if (!Array.isArray(order) || order.length === 0) {
    throw new ValidationError('fallbackOrder must be a non-empty array of provider names.');
  }
  for (const name of order) {
    if (!SUPPORTED_PROVIDERS.includes(name)) {
      throw new ValidationError(`fallbackOrder contains unsupported provider "${name}". Supported: ${SUPPORTED_PROVIDERS.join(', ')}.`);
    }
    if (!config[name]) {
      throw new ValidationError(`fallbackOrder references "${name}" but no API key was provided for it.`);
    }
  }
}

/**
 * Validate the options object passed to ai.complete().
 * @param {object} options - Per-call options.
 * @returns {void}
 * @throws {ValidationError}
 */
function validateCompleteOptions(options) {
  if (!options || typeof options !== 'object') {
    throw new ValidationError('complete() requires an options object.');
  }
  if (typeof options.prompt !== 'string' || options.prompt.trim().length === 0) {
    throw new ValidationError('complete() requires a non-empty "prompt" string.');
  }
  if (options.provider !== undefined && !SUPPORTED_PROVIDERS.includes(options.provider)) {
    throw new ValidationError(`Unsupported provider "${options.provider}". Supported: ${SUPPORTED_PROVIDERS.join(', ')}.`);
  }
  if (options.model !== undefined && (typeof options.model !== 'string' || options.model.length === 0)) {
    throw new ValidationError('model must be a non-empty string when provided.');
  }
  if (options.maxTokens !== undefined && (!Number.isInteger(options.maxTokens) || options.maxTokens <= 0)) {
    throw new ValidationError('maxTokens must be a positive integer when provided.');
  }
  if (options.temperature !== undefined && (typeof options.temperature !== 'number' || options.temperature < 0 || options.temperature > 2)) {
    throw new ValidationError('temperature must be a number between 0 and 2 when provided.');
  }
}

/**
 * Validate the arguments passed to ai.stream(). Reuses the
 * complete() option validation and additionally requires a
 * function callback for chunk delivery.
 * @param {object} options - Per-call options.
 * @param {*} onChunk - Chunk callback supplied by the caller.
 * @returns {void}
 * @throws {ValidationError}
 */
function validateStreamOptions(options, onChunk) {
  validateCompleteOptions(options);
  if (typeof onChunk !== 'function') {
    throw new ValidationError('stream() requires a chunk callback function as the second argument.');
  }
}

module.exports = {
  SUPPORTED_PROVIDERS,
  ValidationError,
  validateConfig,
  validateFallbackOrder,
  validateCompleteOptions,
  validateStreamOptions
};
