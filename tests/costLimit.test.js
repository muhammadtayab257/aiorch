'use strict';

const {
  CostLimitError,
  checkLimits,
  estimateCallCost,
  estimateTokens,
  getCostLimitStatus
} = require('../src/core/costLimit');

describe('estimateTokens', () => {
  test('returns 0 for empty or non-string input', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens(undefined)).toBe(0);
  });

  test('approximates ~4 chars per token', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('a'.repeat(400))).toBe(100);
  });
});

describe('estimateCallCost', () => {
  test('uses maxTokens when provided', () => {
    const cost = estimateCallCost({ prompt: 'a'.repeat(4000), maxTokens: 1000 }, 'gpt-4o');
    // ~1000 input tokens, 1000 output tokens
    expect(cost).toBeCloseTo(0.005 + 0.015, 6);
  });

  test('falls back to default output token estimate', () => {
    const cost = estimateCallCost({ prompt: 'hi' }, 'gpt-4o');
    expect(cost).toBeGreaterThan(0);
  });

  test('returns 0 for unknown model', () => {
    expect(estimateCallCost({ prompt: 'hi' }, 'unknown-model')).toBe(0);
  });
});

describe('checkLimits', () => {
  test('no-op when no limits configured', () => {
    expect(() => checkLimits({ limits: {}, costState: { total: 100 }, options: { prompt: 'hi' }, defaultModel: 'gpt-4o' })).not.toThrow();
    expect(() => checkLimits({ limits: null, costState: { total: 100 }, options: { prompt: 'hi' }, defaultModel: 'gpt-4o' })).not.toThrow();
  });

  test('throws CostLimitError when session total at/over limit', () => {
    try {
      checkLimits({
        limits: { maxCostPerSession: 1.0 },
        costState: { total: 1.0 },
        options: { prompt: 'hi' },
        defaultModel: 'gpt-4o'
      });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CostLimitError);
      expect(err.type).toBe('session');
      expect(err.currentCost).toBe(1.0);
      expect(err.limit).toBe(1.0);
    }
  });

  test('throws CostLimitError when estimated call cost exceeds limit', () => {
    try {
      checkLimits({
        limits: { maxCostPerCall: 0.0001 },
        costState: { total: 0 },
        options: { prompt: 'a'.repeat(4000), maxTokens: 1000 },
        defaultModel: 'gpt-4o'
      });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CostLimitError);
      expect(err.type).toBe('call');
      expect(err.estimated).toBeGreaterThan(0.0001);
    }
  });

  test('does not throw when estimated call cost is within limit', () => {
    expect(() =>
      checkLimits({
        limits: { maxCostPerCall: 1.0 },
        costState: { total: 0 },
        options: { prompt: 'hi', maxTokens: 10 },
        defaultModel: 'gpt-4o'
      })
    ).not.toThrow();
  });
});

describe('CostLimitError', () => {
  test('session message includes current and limit', () => {
    const err = new CostLimitError({ type: 'session', currentCost: 0.5, limit: 0.4 });
    expect(err.message).toMatch(/Session cost limit/);
    expect(err.code).toBe('COST_LIMIT_EXCEEDED');
  });

  test('call message includes estimated and limit', () => {
    const err = new CostLimitError({ type: 'call', currentCost: 0, limit: 0.05, estimated: 0.1 });
    expect(err.message).toMatch(/Per-call/);
    expect(err.estimated).toBe(0.1);
  });
});

describe('getCostLimitStatus', () => {
  test('returns null fields when no limits configured', () => {
    const status = getCostLimitStatus({}, { total: 0, calls: 0 });
    expect(status).toEqual({ session: null, call: null });
  });

  test('computes session usage percentage and remaining', () => {
    const status = getCostLimitStatus(
      { maxCostPerSession: 1.0, maxCostPerCall: 0.05 },
      { total: 0.25, calls: 3 }
    );
    expect(status.session.limit).toBe(1.0);
    expect(status.session.current).toBe(0.25);
    expect(status.session.remaining).toBe(0.75);
    expect(status.session.usagePct).toBeCloseTo(0.25, 6);
    expect(status.session.exceeded).toBe(false);
    expect(status.call).toEqual({ limit: 0.05 });
  });

  test('marks session exceeded when total >= limit', () => {
    const status = getCostLimitStatus({ maxCostPerSession: 0.1 }, { total: 0.2, calls: 1 });
    expect(status.session.exceeded).toBe(true);
    expect(status.session.remaining).toBe(0);
  });
});
