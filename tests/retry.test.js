'use strict';

const { withRetry, isRetryable, computeBackoff } = require('../src/core/retry');

describe('isRetryable', () => {
  test('retries on 429', () => {
    expect(isRetryable({ status: 429 })).toBe(true);
  });

  test('retries on 5xx', () => {
    expect(isRetryable({ status: 503 })).toBe(true);
  });

  test('does not retry on 401/403/400/404', () => {
    expect(isRetryable({ status: 401 })).toBe(false);
    expect(isRetryable({ status: 403 })).toBe(false);
    expect(isRetryable({ status: 400 })).toBe(false);
    expect(isRetryable({ status: 404 })).toBe(false);
  });

  test('retries on common network errors', () => {
    expect(isRetryable({ code: 'ECONNRESET' })).toBe(true);
    expect(isRetryable({ code: 'ETIMEDOUT' })).toBe(true);
  });

  test('respects explicit retryable flag', () => {
    expect(isRetryable({ retryable: true, status: 401 })).toBe(true);
    expect(isRetryable({ retryable: false, status: 429 })).toBe(false);
  });

  test('returns false for empty/undefined error', () => {
    expect(isRetryable(null)).toBe(false);
    expect(isRetryable({})).toBe(false);
  });
});

describe('computeBackoff', () => {
  test('grows exponentially up to the cap', () => {
    expect(computeBackoff(0, 1000, 30000, false)).toBe(1000);
    expect(computeBackoff(1, 1000, 30000, false)).toBe(2000);
    expect(computeBackoff(2, 1000, 30000, false)).toBe(4000);
    expect(computeBackoff(10, 1000, 30000, false)).toBe(30000);
  });

  test('jitter keeps result within bounds', () => {
    for (let i = 0; i < 20; i++) {
      const d = computeBackoff(2, 1000, 30000, true);
      expect(d).toBeGreaterThanOrEqual(1);
      expect(d).toBeLessThanOrEqual(4000);
    }
  });
});

describe('withRetry', () => {
  test('returns value on first success', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, { retries: 3, baseDelayMs: 1 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('retries retryable errors then succeeds', async () => {
    let calls = 0;
    const fn = jest.fn().mockImplementation(() => {
      calls++;
      if (calls < 3) {
        const err = new Error('rate limited');
        err.status = 429;
        return Promise.reject(err);
      }
      return Promise.resolve('done');
    });
    const onRetry = jest.fn();
    const result = await withRetry(fn, { retries: 5, baseDelayMs: 1, onRetry });
    expect(result).toBe('done');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  test('does not retry non-retryable errors', async () => {
    const err = new Error('unauthorized');
    err.status = 401;
    const fn = jest.fn().mockRejectedValue(err);
    await expect(withRetry(fn, { retries: 3, baseDelayMs: 1 })).rejects.toThrow('unauthorized');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('gives up after exhausting retries', async () => {
    const err = new Error('boom');
    err.status = 503;
    const fn = jest.fn().mockRejectedValue(err);
    await expect(withRetry(fn, { retries: 2, baseDelayMs: 1 })).rejects.toThrow('boom');
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
