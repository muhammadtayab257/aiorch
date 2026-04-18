'use strict';

const { ProviderError } = require('../core/router');

const DEFAULT_MODEL = 'gemini-2.0-flash';

/**
 * Gemini provider adapter. Wraps the official @google/generative-ai
 * SDK and normalizes requests/responses/errors.
 */
class GeminiProvider {
  /**
   * @param {object} opts
   * @param {string} opts.apiKey - Gemini API key.
   * @param {string} [opts.defaultModel] - Model to use when not provided in the call.
   * @param {object} [opts.client] - Pre-built GoogleGenerativeAI client (primarily for tests).
   */
  constructor({ apiKey, defaultModel, client } = {}) {
    if (!apiKey && !client) {
      throw new Error('GeminiProvider requires an apiKey.');
    }
    this.name = 'gemini';
    this.defaultModel = defaultModel || DEFAULT_MODEL;
    this.client = client || GeminiProvider.createClient(apiKey);
  }

  /**
   * Lazily require the Gemini SDK and construct a client.
   * Static so tests can override it.
   * @param {string} apiKey
   * @returns {object} GoogleGenerativeAI client.
   */
  static createClient(apiKey) {
    const pkg = require('@google/generative-ai');
    const Ctor = pkg.GoogleGenerativeAI || (pkg.default && pkg.default.GoogleGenerativeAI) || pkg;
    return new Ctor(apiKey);
  }

  /**
   * Build the generationConfig for a Gemini call.
   * @param {object} options - Normalized complete() options.
   * @returns {object|undefined}
   */
  buildGenerationConfig(options) {
    const config = {};
    if (Number.isInteger(options.maxTokens)) config.maxOutputTokens = options.maxTokens;
    if (typeof options.temperature === 'number') config.temperature = options.temperature;
    return Object.keys(config).length ? config : undefined;
  }

  /**
   * Execute a generate-content call.
   * @param {object} options - Normalized request options.
   * @returns {Promise<{text: string, model: string, tokens: {input: number, output: number}, raw: object}>}
   */
  async complete(options) {
    const model = options.model || this.defaultModel;
    const generationConfig = this.buildGenerationConfig(options);
    try {
      const genModel = this.client.getGenerativeModel({ model, generationConfig });
      const response = await genModel.generateContent(options.prompt);
      return this.normalize(response, model);
    } catch (err) {
      throw this.toProviderError(err);
    }
  }

  /**
   * Execute a streaming generateContent call. Emits text chunks via
   * onChunk as they arrive; returns the concatenated text plus the
   * final usageMetadata once the stream completes.
   * @param {object} options - Normalized request options.
   * @param {(chunk: string) => void} onChunk - Invoked with each text chunk.
   * @returns {Promise<{text: string, model: string, tokens: {input: number, output: number}, raw: object}>}
   */
  async stream(options, onChunk) {
    const model = options.model || this.defaultModel;
    const generationConfig = this.buildGenerationConfig(options);
    let text = '';
    let usage = {};
    try {
      const genModel = this.client.getGenerativeModel({ model, generationConfig });
      const result = await genModel.generateContentStream(options.prompt);
      for await (const chunk of result.stream) {
        let piece = '';
        if (chunk && typeof chunk.text === 'function') {
          try { piece = chunk.text() || ''; } catch { piece = ''; }
        }
        if (piece) { text += piece; onChunk(piece); }
      }
      const final = result.response ? await result.response : null;
      if (final && final.usageMetadata) usage = final.usageMetadata;
    } catch (err) {
      throw this.toProviderError(err);
    }
    return {
      text,
      model,
      tokens: {
        input: Number.isFinite(usage.promptTokenCount) ? usage.promptTokenCount : 0,
        output: Number.isFinite(usage.candidatesTokenCount) ? usage.candidatesTokenCount : 0
      },
      raw: { streamed: true }
    };
  }

  /**
   * Convert a Gemini response into the standardized shape.
   * @param {object} response - Raw Gemini response object from generateContent().
   * @param {string} requestedModel - Model originally requested.
   * @returns {object} Standardized response.
   */
  normalize(response, requestedModel) {
    const inner = response && response.response ? response.response : response;
    let text = '';
    if (inner && typeof inner.text === 'function') {
      try {
        text = inner.text() || '';
      } catch {
        text = '';
      }
    } else if (inner && Array.isArray(inner.candidates)) {
      const parts = (inner.candidates[0] && inner.candidates[0].content && inner.candidates[0].content.parts) || [];
      text = parts.map((p) => p && p.text ? p.text : '').join('');
    }
    const usage = (inner && inner.usageMetadata) || {};
    return {
      text,
      model: requestedModel,
      tokens: {
        input: Number.isFinite(usage.promptTokenCount) ? usage.promptTokenCount : 0,
        output: Number.isFinite(usage.candidatesTokenCount) ? usage.candidatesTokenCount : 0
      },
      raw: response
    };
  }

  /**
   * Translate SDK errors into a standardized ProviderError.
   * Gemini errors often encode status via message text, so we also
   * sniff for "quota" / "rate" / "unavailable" signals.
   * @param {Error & {status?: number, code?: string}} err
   * @returns {ProviderError}
   */
  toProviderError(err) {
    const status = err && (err.status || err.statusCode);
    const code = err && err.code ? err.code : err && err.name;
    const msg = err && err.message ? err.message.toLowerCase() : '';
    let retryable;
    if (status === 429 || msg.includes('quota') || msg.includes('rate') || msg.includes('exhausted')) retryable = true;
    else if ((typeof status === 'number' && status >= 500) || msg.includes('unavailable') || msg.includes('internal')) retryable = true;
    else if (status === 401 || status === 403 || status === 400 || msg.includes('api key') || msg.includes('permission')) retryable = false;
    return new ProviderError({
      provider: 'gemini',
      message: err && err.message ? err.message : 'Gemini request failed.',
      code,
      status,
      retryable,
      cause: err
    });
  }
}

module.exports = { GeminiProvider };
