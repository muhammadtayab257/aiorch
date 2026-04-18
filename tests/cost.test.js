'use strict';

const { calculateCost, getPricingTable, normalizeModel } = require('../src/utils/cost');

describe('calculateCost', () => {
  test('computes gpt-4o cost from input and output tokens', () => {
    const cost = calculateCost('gpt-4o', 1000, 1000);
    expect(cost).toBeCloseTo(0.02, 6);
  });

  test('computes claude-3-5-sonnet cost with date suffix', () => {
    const cost = calculateCost('claude-3-5-sonnet-20241022', 1000, 500);
    expect(cost).toBeCloseTo(0.003 + 0.015 * 0.5, 6);
  });

  test('computes gemini-1.5-pro cost', () => {
    const cost = calculateCost('gemini-1.5-pro', 2000, 1000);
    expect(cost).toBeCloseTo(2 * 0.00125 + 1 * 0.005, 6);
  });

  test('returns 0 for unknown models instead of throwing', () => {
    expect(calculateCost('totally-fake-model', 100, 100)).toBe(0);
  });

  test('handles non-finite token counts gracefully', () => {
    expect(calculateCost('gpt-4o', NaN, undefined)).toBe(0);
  });

  test('rounds to 6 decimal places', () => {
    const cost = calculateCost('gpt-4o', 1, 1);
    expect(cost.toString().split('.')[1].length).toBeLessThanOrEqual(6);
  });
});

describe('getPricingTable', () => {
  test('returns a non-empty deep copy', () => {
    const a = getPricingTable();
    const b = getPricingTable();
    expect(Object.keys(a).length).toBeGreaterThan(0);
    a['gpt-4o'].input = 999;
    expect(b['gpt-4o'].input).not.toBe(999);
  });
});

describe('normalizeModel', () => {
  test('strips numeric date suffix', () => {
    expect(normalizeModel('claude-3-5-sonnet-20241022')).toBe('claude-3-5-sonnet');
  });

  test('handles empty input', () => {
    expect(normalizeModel('')).toBe('');
    expect(normalizeModel(undefined)).toBe('');
  });

  test('returns lowercased unknown models untouched', () => {
    expect(normalizeModel('Unknown-Model-X')).toBe('unknown-model-x');
  });
});
