'use strict';

/**
 * Pricing table (USD per 1K tokens) for supported models.
 * Prices are separated into input and output tokens.
 * Extend this table as new models are supported.
 * @type {Object<string, {input: number, output: number}>}
 */
const PRICING = {
  'gpt-4o': { input: 0.005, output: 0.015 },
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  'gpt-4-turbo': { input: 0.01, output: 0.03 },
  'claude-3-5-sonnet': { input: 0.003, output: 0.015 },
  'claude-3-5-sonnet-20241022': { input: 0.003, output: 0.015 },
  'claude-3-opus': { input: 0.015, output: 0.075 },
  'claude-3-haiku': { input: 0.00025, output: 0.00125 },
  'gemini-1.5-pro': { input: 0.00125, output: 0.005 },
  'gemini-1.5-flash': { input: 0.000075, output: 0.0003 }
};

/**
 * Normalize a model identifier to look up pricing.
 * Strips vendor prefixes and common date suffixes so that
 * "claude-3-5-sonnet-20241022" resolves the same as "claude-3-5-sonnet".
 * @param {string} model - Raw model identifier from provider.
 * @returns {string} Normalized model key.
 */
function normalizeModel(model) {
  if (!model || typeof model !== 'string') return '';
  const lower = model.toLowerCase().trim();
  if (PRICING[lower]) return lower;
  const withoutDate = lower.replace(/-\d{8}$/, '').replace(/-\d{4}-\d{2}-\d{2}$/, '');
  if (PRICING[withoutDate]) return withoutDate;
  return lower;
}

/**
 * Calculate the USD cost of a single API call.
 * Returns 0 when the model is unknown rather than throwing,
 * so unknown models do not break the caller's flow.
 * @param {string} model - Model name used for the call.
 * @param {number} inputTokens - Number of input (prompt) tokens.
 * @param {number} outputTokens - Number of output (completion) tokens.
 * @returns {number} Cost in USD, rounded to 6 decimal places.
 */
function calculateCost(model, inputTokens, outputTokens) {
  const key = normalizeModel(model);
  const pricing = PRICING[key];
  if (!pricing) return 0;
  const safeInput = Number.isFinite(inputTokens) ? inputTokens : 0;
  const safeOutput = Number.isFinite(outputTokens) ? outputTokens : 0;
  const cost = (safeInput / 1000) * pricing.input + (safeOutput / 1000) * pricing.output;
  return Math.round(cost * 1e6) / 1e6;
}

/**
 * Returns a copy of the pricing table. Useful for introspection
 * and testing without letting callers mutate the source of truth.
 * @returns {Object<string, {input: number, output: number}>}
 */
function getPricingTable() {
  return JSON.parse(JSON.stringify(PRICING));
}

module.exports = { calculateCost, getPricingTable, normalizeModel };
