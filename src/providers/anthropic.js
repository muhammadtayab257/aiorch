'use strict';

const { ProviderError } = require('../core/router');

const DEFAULT_MODEL = 'claude-3-5-sonnet-20241022';
const DEFAULT_MAX_TOKENS = 1024;

/**
 * Anthropic provider adapter. Wraps the official @anthropic-ai/sdk
 * and normalizes requests/responses/errors.
 */
class AnthropicProvider {
  /**
   * @param {object} opts
   * @param {string} opts.apiKey - Anthropic API key.
   * @param {string} [opts.defaultModel] - Model to use when not provided in the call.
   * @param {object} [opts.client] - Pre-built client (primarily for tests).
   */
  constructor({ apiKey, defaultModel, client } = {}) {
    if (!apiKey && !client) {
      throw new Error('AnthropicProvider requires an apiKey.');
    }
    this.name = 'anthropic';
    this.defaultModel = defaultModel || DEFAULT_MODEL;
    this.client = client || AnthropicProvider.createClient(apiKey);
  }

  /**
   * Lazily require the Anthropic SDK and construct a client.
   * Static so tests can override it.
   * @param {string} apiKey
   * @returns {object} Anthropic client.
   */
  static createClient(apiKey) {
    const pkg = require('@anthropic-ai/sdk');
    const Ctor = pkg && pkg.default ? pkg.default : pkg.Anthropic || pkg;
    return new Ctor({ apiKey });
  }

  /**
   * Execute a messages completion.
   * @param {object} options - Normalized request options.
   * @returns {Promise<{text: string, model: string, tokens: {input: number, output: number}, raw: object}>}
   */
  async complete(options) {
    const model = options.model || this.defaultModel;
    const payload = {
      model,
      max_tokens: Number.isInteger(options.maxTokens) ? options.maxTokens : DEFAULT_MAX_TOKENS,
      messages: [{ role: 'user', content: options.prompt }]
    };
    if (typeof options.temperature === 'number') payload.temperature = options.temperature;

    try {
      const response = await this.client.messages.create(payload);
      return this.normalize(response, model);
    } catch (err) {
      throw this.toProviderError(err);
    }
  }

  /**
   * Execute a streaming messages request. Emits text deltas via
   * onChunk; returns the concatenated result and final token usage.
   * @param {object} options - Normalized request options.
   * @param {(chunk: string) => void} onChunk - Invoked with each text delta.
   * @returns {Promise<{text: string, model: string, tokens: {input: number, output: number}, raw: object}>}
   */
  async stream(options, onChunk) {
    const model = options.model || this.defaultModel;
    const payload = {
      model,
      max_tokens: Number.isInteger(options.maxTokens) ? options.maxTokens : DEFAULT_MAX_TOKENS,
      messages: [{ role: 'user', content: options.prompt }],
      stream: true
    };
    if (typeof options.temperature === 'number') payload.temperature = options.temperature;

    let text = '';
    let inputTokens = 0;
    let outputTokens = 0;
    let resolvedModel = model;
    try {
      const stream = await this.client.messages.create(payload);
      for await (const event of stream) {
        if (event && event.type === 'message_start' && event.message) {
          resolvedModel = event.message.model || resolvedModel;
          if (event.message.usage) inputTokens = event.message.usage.input_tokens || inputTokens;
        } else if (event && event.type === 'content_block_delta' && event.delta && event.delta.type === 'text_delta') {
          const piece = event.delta.text || '';
          if (piece) { text += piece; onChunk(piece); }
        } else if (event && event.type === 'message_delta' && event.usage) {
          outputTokens = event.usage.output_tokens || outputTokens;
        }
      }
    } catch (err) {
      throw this.toProviderError(err);
    }
    return {
      text,
      model: resolvedModel,
      tokens: { input: inputTokens, output: outputTokens },
      raw: { streamed: true }
    };
  }

  /**
   * Convert an Anthropic response into the standardized shape.
   * @param {object} response - Raw Anthropic response.
   * @param {string} requestedModel - Model originally requested.
   * @returns {object} Standardized response.
   */
  normalize(response, requestedModel) {
    const blocks = response && Array.isArray(response.content) ? response.content : [];
    const text = blocks
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('');
    const usage = response && response.usage ? response.usage : {};
    return {
      text,
      model: response && response.model ? response.model : requestedModel,
      tokens: {
        input: Number.isFinite(usage.input_tokens) ? usage.input_tokens : 0,
        output: Number.isFinite(usage.output_tokens) ? usage.output_tokens : 0
      },
      raw: response
    };
  }

  /**
   * Translate SDK errors into a standardized ProviderError.
   * @param {Error & {status?: number, code?: string}} err
   * @returns {ProviderError}
   */
  toProviderError(err) {
    const status = err && (err.status || err.statusCode);
    const code = err && err.code ? err.code : err && err.name;
    let retryable;
    if (status === 429) retryable = true;
    else if (typeof status === 'number' && status >= 500) retryable = true;
    else if (status === 401 || status === 403 || status === 400) retryable = false;
    return new ProviderError({
      provider: 'anthropic',
      message: err && err.message ? err.message : 'Anthropic request failed.',
      code,
      status,
      retryable,
      cause: err
    });
  }
}

module.exports = { AnthropicProvider };
