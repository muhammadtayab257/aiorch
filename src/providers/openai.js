'use strict';

const { ProviderError } = require('../core/router');

const DEFAULT_MODEL = 'gpt-4o';

/**
 * OpenAI provider adapter. Wraps the official `openai` SDK and
 * normalizes requests/responses/errors.
 */
class OpenAIProvider {
  /**
   * @param {object} opts
   * @param {string} opts.apiKey - OpenAI API key.
   * @param {string} [opts.defaultModel] - Model to use when not provided in the call.
   * @param {object} [opts.client] - Pre-built client (primarily for tests).
   */
  constructor({ apiKey, defaultModel, client } = {}) {
    if (!apiKey && !client) {
      throw new Error('OpenAIProvider requires an apiKey.');
    }
    this.name = 'openai';
    this.defaultModel = defaultModel || DEFAULT_MODEL;
    this.client = client || OpenAIProvider.createClient(apiKey);
  }

  /**
   * Lazily require the OpenAI SDK and construct a client.
   * Kept as a static so tests can override it.
   * @param {string} apiKey
   * @returns {object} OpenAI client.
   */
  static createClient(apiKey) {
    const OpenAI = require('openai');
    const Ctor = OpenAI && OpenAI.default ? OpenAI.default : OpenAI;
    return new Ctor({ apiKey });
  }

  /**
   * Execute a chat completion.
   * @param {object} options - Normalized request options.
   * @returns {Promise<{text: string, model: string, tokens: {input: number, output: number}, raw: object}>}
   */
  async complete(options) {
    const model = options.model || this.defaultModel;
    const payload = {
      model,
      messages: [{ role: 'user', content: options.prompt }]
    };
    if (Number.isInteger(options.maxTokens)) payload.max_tokens = options.maxTokens;
    if (typeof options.temperature === 'number') payload.temperature = options.temperature;

    try {
      const response = await this.client.chat.completions.create(payload);
      return this.normalize(response, model);
    } catch (err) {
      throw this.toProviderError(err);
    }
  }

  /**
   * Execute a streaming chat completion. The callback is invoked
   * once per text delta; the returned result contains the fully
   * concatenated text plus final token usage.
   * @param {object} options - Normalized request options.
   * @param {(chunk: string) => void} onChunk - Invoked with each text delta.
   * @returns {Promise<{text: string, model: string, tokens: {input: number, output: number}, raw: object}>}
   */
  async stream(options, onChunk) {
    const model = options.model || this.defaultModel;
    const payload = {
      model,
      messages: [{ role: 'user', content: options.prompt }],
      stream: true,
      stream_options: { include_usage: true }
    };
    if (Number.isInteger(options.maxTokens)) payload.max_tokens = options.maxTokens;
    if (typeof options.temperature === 'number') payload.temperature = options.temperature;

    let text = '';
    let usage = {};
    let resolvedModel = model;
    try {
      const stream = await this.client.chat.completions.create(payload);
      for await (const chunk of stream) {
        if (chunk && chunk.model) resolvedModel = chunk.model;
        const delta = chunk && chunk.choices && chunk.choices[0] && chunk.choices[0].delta;
        const piece = delta && typeof delta.content === 'string' ? delta.content : '';
        if (piece) { text += piece; onChunk(piece); }
        if (chunk && chunk.usage) usage = chunk.usage;
      }
    } catch (err) {
      throw this.toProviderError(err);
    }
    return {
      text,
      model: resolvedModel,
      tokens: {
        input: Number.isFinite(usage.prompt_tokens) ? usage.prompt_tokens : 0,
        output: Number.isFinite(usage.completion_tokens) ? usage.completion_tokens : 0
      },
      raw: { streamed: true }
    };
  }

  /**
   * Convert an OpenAI response into the standardized shape.
   * @param {object} response - Raw OpenAI response.
   * @param {string} requestedModel - The model requested by the caller.
   * @returns {object} Standardized response.
   */
  normalize(response, requestedModel) {
    const choice = response && response.choices && response.choices[0];
    const text = choice && choice.message && typeof choice.message.content === 'string' ? choice.message.content : '';
    const usage = response && response.usage ? response.usage : {};
    return {
      text,
      model: response && response.model ? response.model : requestedModel,
      tokens: {
        input: Number.isFinite(usage.prompt_tokens) ? usage.prompt_tokens : 0,
        output: Number.isFinite(usage.completion_tokens) ? usage.completion_tokens : 0
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
      provider: 'openai',
      message: err && err.message ? err.message : 'OpenAI request failed.',
      code,
      status,
      retryable,
      cause: err
    });
  }
}

module.exports = { OpenAIProvider };
