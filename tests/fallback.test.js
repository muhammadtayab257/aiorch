'use strict';

const {
  runWithFallback,
  resolveProviderOrder,
  AllProvidersFailedError
} = require('../src/core/fallback');

describe('resolveProviderOrder', () => {
  const available = new Set(['openai', 'anthropic', 'gemini']);

  test('preferred provider goes first', () => {
    const order = resolveProviderOrder('anthropic', ['openai', 'anthropic', 'gemini'], available);
    expect(order).toEqual(['anthropic', 'openai', 'gemini']);
  });

  test('omits preferred when not available', () => {
    const order = resolveProviderOrder('openai', ['openai', 'gemini'], new Set(['gemini']));
    expect(order).toEqual(['gemini']);
  });

  test('uses fallback order when preferred is undefined', () => {
    const order = resolveProviderOrder(undefined, ['openai', 'anthropic'], available);
    expect(order).toEqual(['openai', 'anthropic']);
  });

  test('deduplicates entries', () => {
    const order = resolveProviderOrder('openai', ['openai', 'openai', 'anthropic'], available);
    expect(order).toEqual(['openai', 'anthropic']);
  });
});

describe('runWithFallback', () => {
  test('returns first successful provider', async () => {
    const run = jest.fn().mockImplementation((name) => {
      if (name === 'openai') return Promise.resolve({ provider: name });
      return Promise.reject(new Error('should not be called'));
    });
    const result = await runWithFallback(['openai', 'anthropic'], run);
    expect(result).toEqual({ provider: 'openai' });
    expect(run).toHaveBeenCalledTimes(1);
  });

  test('falls back on failure and reports', async () => {
    const run = jest.fn().mockImplementation((name) => {
      if (name === 'openai') return Promise.reject(new Error('openai down'));
      return Promise.resolve({ provider: name });
    });
    const onFallback = jest.fn();
    const result = await runWithFallback(['openai', 'anthropic'], run, onFallback);
    expect(result.provider).toBe('anthropic');
    expect(onFallback).toHaveBeenCalledWith(expect.objectContaining({ from: 'openai', to: 'anthropic' }));
  });

  test('throws AllProvidersFailedError when everyone fails', async () => {
    const run = jest.fn().mockRejectedValue(new Error('down'));
    await expect(runWithFallback(['openai', 'anthropic'], run)).rejects.toBeInstanceOf(AllProvidersFailedError);
  });

  test('throws when the order is empty', async () => {
    await expect(runWithFallback([], jest.fn())).rejects.toBeInstanceOf(AllProvidersFailedError);
  });
});
