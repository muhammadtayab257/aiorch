'use strict';

const { AISync, ValidationError, AllProvidersFailedError, CostLimitError } = require('../src');

function fakeFactory(name, impl) {
  return () => ({ name, complete: jest.fn().mockImplementation(impl) });
}

function buildClient(responses) {
  const calls = [];
  return {
    calls,
    complete: async (options) => {
      calls.push(options);
      const res = typeof responses === 'function' ? responses(options, calls.length - 1) : responses;
      if (res && res.__throw) throw res.__throw;
      return res;
    }
  };
}

describe('AISync', () => {
  test('rejects config without any API keys', () => {
    expect(() => new AISync({})).toThrow(ValidationError);
  });

  test('performs a successful call and tracks cost', async () => {
    const ai = new AISync({
      openai: 'sk',
      logging: false,
      _providerFactories: {
        openai: fakeFactory('openai', async () => ({
          text: 'hello',
          model: 'gpt-4o',
          tokens: { input: 1000, output: 500 },
          raw: {}
        }))
      }
    });
    const res = await ai.complete({ prompt: 'hi' });
    expect(res.text).toBe('hello');
    expect(res.provider).toBe('openai');
    expect(res.tokens.total).toBe(1500);
    expect(res.cost).toBeCloseTo(0.005 + 0.0075, 6);
    expect(ai.getTotalCost()).toBeCloseTo(res.cost, 6);
    expect(ai.getCallCount()).toBe(1);
  });

  test('falls back through providers until one succeeds', async () => {
    const ai = new AISync({
      openai: 'sk-o',
      anthropic: 'sk-a',
      gemini: 'sk-g',
      fallbackOrder: ['openai', 'anthropic', 'gemini'],
      retries: 0,
      logging: false,
      _providerFactories: {
        openai: fakeFactory('openai', async () => {
          const e = new Error('boom');
          e.retryable = false;
          throw e;
        }),
        anthropic: fakeFactory('anthropic', async () => {
          const e = new Error('nope');
          e.retryable = false;
          throw e;
        }),
        gemini: fakeFactory('gemini', async () => ({
          text: 'from gemini',
          model: 'gemini-1.5-pro',
          tokens: { input: 10, output: 10 },
          raw: {}
        }))
      }
    });
    const res = await ai.complete({ prompt: 'hi' });
    expect(res.provider).toBe('gemini');
  });

  test('throws AllProvidersFailedError when every provider fails', async () => {
    const ai = new AISync({
      openai: 'sk',
      anthropic: 'sk',
      fallbackOrder: ['openai', 'anthropic'],
      retries: 0,
      logging: false,
      _providerFactories: {
        openai: fakeFactory('openai', async () => {
          const e = new Error('a'); e.retryable = false; throw e;
        }),
        anthropic: fakeFactory('anthropic', async () => {
          const e = new Error('b'); e.retryable = false; throw e;
        })
      }
    });
    await expect(ai.complete({ prompt: 'hi' })).rejects.toBeInstanceOf(AllProvidersFailedError);
  });

  test('validates complete() options', async () => {
    const ai = new AISync({ openai: 'sk', logging: false });
    await expect(ai.complete({})).rejects.toBeInstanceOf(ValidationError);
  });

  test('resetUsage clears totals', async () => {
    const ai = new AISync({
      openai: 'sk',
      logging: false,
      _providerFactories: {
        openai: fakeFactory('openai', async () => ({
          text: 'x', model: 'gpt-4o', tokens: { input: 100, output: 100 }, raw: {}
        }))
      }
    });
    await ai.complete({ prompt: 'hi' });
    expect(ai.getTotalCost()).toBeGreaterThan(0);
    ai.resetUsage();
    expect(ai.getTotalCost()).toBe(0);
    expect(ai.getCallCount()).toBe(0);
  });

  test('getConfiguredProviders returns only active providers', () => {
    const ai = new AISync({
      openai: 'sk',
      gemini: 'sk',
      logging: false,
      _providerFactories: {
        openai: fakeFactory('openai', async () => ({ text: '', model: 'gpt-4o', tokens: { input: 0, output: 0 }, raw: {} })),
        gemini: fakeFactory('gemini', async () => ({ text: '', model: 'gemini-1.5-pro', tokens: { input: 0, output: 0 }, raw: {} }))
      }
    });
    const list = ai.getConfiguredProviders();
    expect(list.sort()).toEqual(['gemini', 'openai']);
  });

  // Silence the unused helper lint.
  test('buildClient helper produces an object', () => {
    expect(buildClient({ text: 'x' })).toHaveProperty('complete');
  });
});

describe('AISync cost limits', () => {
  function factoryReturning(name, cost) {
    const tokens = { input: 1000, output: 1000 };
    return () => ({
      name,
      defaultModel: 'gpt-4o',
      complete: jest.fn().mockResolvedValue({ text: 'ok', model: 'gpt-4o', tokens, raw: {}, _expectedCost: cost })
    });
  }

  test('validates maxCostPerCall and maxCostPerSession types', () => {
    expect(() => new AISync({ openai: 'sk', maxCostPerCall: 0 })).toThrow(ValidationError);
    expect(() => new AISync({ openai: 'sk', maxCostPerSession: 'lots' })).toThrow(ValidationError);
    expect(() => new AISync({ openai: 'sk', maxCostPerCall: 0.05, maxCostPerSession: 1.0 })).not.toThrow();
  });

  test('throws CostLimitError when session total already exceeds limit', async () => {
    const ai = new AISync({
      openai: 'sk',
      logging: false,
      maxCostPerSession: 0.001,
      _providerFactories: { openai: factoryReturning('openai') }
    });
    ai.costState.total = 0.002;
    await expect(ai.complete({ prompt: 'hi' })).rejects.toBeInstanceOf(CostLimitError);
    await expect(ai.complete({ prompt: 'hi' })).rejects.toMatchObject({ type: 'session' });
  });

  test('throws CostLimitError when estimated call cost exceeds limit', async () => {
    const ai = new AISync({
      openai: 'sk',
      logging: false,
      maxCostPerCall: 0.0001,
      _providerFactories: { openai: factoryReturning('openai') }
    });
    await expect(
      ai.complete({ prompt: 'a'.repeat(4000), maxTokens: 1000 })
    ).rejects.toMatchObject({ name: 'CostLimitError', type: 'call' });
  });

  test('getCostLimitStatus reflects configured limits', async () => {
    const ai = new AISync({
      openai: 'sk',
      logging: false,
      maxCostPerCall: 0.05,
      maxCostPerSession: 1.0,
      _providerFactories: { openai: factoryReturning('openai') }
    });
    const status = ai.getCostLimitStatus();
    expect(status.session.limit).toBe(1.0);
    expect(status.session.remaining).toBe(1.0);
    expect(status.call).toEqual({ limit: 0.05 });
  });
});

describe('AISync healthCheck', () => {
  function factory(name, impl) {
    return () => ({ name, defaultModel: 'm', complete: jest.fn().mockImplementation(impl) });
  }

  test('returns status map for configured providers', async () => {
    const ai = new AISync({
      openai: 'sk',
      anthropic: 'sk',
      logging: false,
      _providerFactories: {
        openai: factory('openai', async () => ({ text: 'ok' })),
        anthropic: factory('anthropic', async () => { throw new Error('down'); })
      }
    });
    const result = await ai.healthCheck();
    expect(result.openai.ok).toBe(true);
    expect(result.anthropic.ok).toBe(false);
    expect(result.anthropic.error).toMatch(/down/);
  });

  test('never throws even when all providers fail', async () => {
    const ai = new AISync({
      openai: 'sk',
      logging: false,
      _providerFactories: {
        openai: factory('openai', async () => { throw new Error('nope'); })
      }
    });
    const result = await ai.healthCheck();
    expect(result.openai.ok).toBe(false);
  });
});
