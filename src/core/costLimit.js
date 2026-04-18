'use strict';

const { calculateCost } = require('../utils/cost');

const DEFAULT_OUTPUT_TOKEN_ESTIMATE = 512;
const AVG_CHARS_PER_TOKEN = 4;

/**
 * Error thrown when a configured cost limit would be (or has been) exceeded.
 * Carries a type ("call" or "session") and the numeric context so callers
 * can decide how to respond (retry smaller, abort, alert, etc.).
 */
class CostLimitError extends Error {
  /**
   * @param {object} details
   * @param {'call'|'session'} details.type - Which limit was triggered.
   * @param {number} details.currentCost - Running session total at time of check.
   * @param {number} details.limit - The configured limit in USD.
   * @param {number} [details.estimated] - Estimated cost of the pending call (for type="call").
   */
  constructor({ type, currentCost, limit, estimated }) {
    const msg = type === 'session'
      ? `Session cost limit reached. Current: $${currentCost.toFixed(6)}, limit: $${limit.toFixed(6)}.`
      : `Per-call cost limit would be exceeded. Estimated: $${(estimated || 0).toFixed(6)}, limit: $${limit.toFixed(6)}.`;
    super(msg);
    this.name = 'CostLimitError';
    this.code = 'COST_LIMIT_EXCEEDED';
    this.type = type;
    this.currentCost = currentCost;
    this.limit = limit;
    if (estimated !== undefined) this.estimated = estimated;
  }
}

/**
 * Rough token estimate for a string: ~4 characters per token.
 * Used only to enforce pre-call cost limits, never for billing.
 * @param {string} text
 * @returns {number}
 */
function estimateTokens(text) {
  if (typeof text !== 'string' || text.length === 0) return 0;
  return Math.ceil(text.length / AVG_CHARS_PER_TOKEN);
}

/**
 * Estimate the USD cost of a call before it runs. Uses char-based
 * token estimation for input and the caller-specified maxTokens for
 * output (falling back to a reasonable default).
 * @param {object} options - complete() / stream() options.
 * @param {string} defaultModel - Model name used when options.model is unset.
 * @returns {number} Estimated USD cost.
 */
function estimateCallCost(options, defaultModel) {
  const model = options.model || defaultModel || '';
  const input = estimateTokens(options.prompt);
  const output = Number.isInteger(options.maxTokens) && options.maxTokens > 0
    ? options.maxTokens
    : DEFAULT_OUTPUT_TOKEN_ESTIMATE;
  return calculateCost(model, input, output);
}

/**
 * Enforce pre-call cost limits. Throws CostLimitError when the session
 * is already at its limit, or when the estimated per-call cost exceeds
 * maxCostPerCall. A no-op when no limits are configured.
 * @param {object} args
 * @param {{maxCostPerCall?: number, maxCostPerSession?: number}} args.limits
 * @param {{total: number}} args.costState
 * @param {object} args.options - The pending call options.
 * @param {string} args.defaultModel - Best-guess default model for the estimate.
 * @returns {void}
 * @throws {CostLimitError}
 */
function checkLimits({ limits, costState, options, defaultModel }) {
  if (!limits) return;
  if (typeof limits.maxCostPerSession === 'number' && costState.total >= limits.maxCostPerSession) {
    throw new CostLimitError({
      type: 'session',
      currentCost: costState.total,
      limit: limits.maxCostPerSession
    });
  }
  if (typeof limits.maxCostPerCall === 'number') {
    const estimated = estimateCallCost(options, defaultModel);
    if (estimated > limits.maxCostPerCall) {
      throw new CostLimitError({
        type: 'call',
        currentCost: costState.total,
        limit: limits.maxCostPerCall,
        estimated
      });
    }
  }
}

/**
 * Summarize the current state of cost limits so callers can surface
 * dashboards or warnings without scraping internals.
 * @param {{maxCostPerCall?: number, maxCostPerSession?: number}} limits
 * @param {{total: number, calls: number}} costState
 * @returns {{session: object|null, call: object|null}}
 */
function getCostLimitStatus(limits, costState) {
  const l = limits || {};
  const session = typeof l.maxCostPerSession === 'number'
    ? {
        limit: l.maxCostPerSession,
        current: costState.total,
        remaining: Math.max(0, l.maxCostPerSession - costState.total),
        usagePct: l.maxCostPerSession === 0 ? 1 : costState.total / l.maxCostPerSession,
        exceeded: costState.total >= l.maxCostPerSession
      }
    : null;
  const call = typeof l.maxCostPerCall === 'number' ? { limit: l.maxCostPerCall } : null;
  return { session, call };
}

module.exports = {
  CostLimitError,
  checkLimits,
  estimateCallCost,
  estimateTokens,
  getCostLimitStatus
};
