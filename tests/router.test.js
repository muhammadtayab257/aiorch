'use strict';

const { Router } = require('../src/core/router');
const { Logger } = require('../src/core/logger');

function makeLogger() {
  return new Logger(false);
}

function makeProvider(name, impl) {
  return { name, complete: jest.fn().mockImplementation(impl) };
}

describe('Router', () => {
  test('finalizes a successful call with cost and tokens', async () => {
    const provider = makeProvider('openai', async () => ({
      text: 'hi',
      model: 'gpt-4o',
      tokens: { input: 1000, output: 1000 },
      raw: {}
    }));
    const costState = { total: 0, calls: 0 };
    const router = new Router({
      providers: new Map([['openai', provider]]),
      fallbackOrder: ['openai'],
      retries: 0,
      logger: makeLogger(),
      costState
    });
    const res = await router.complete({ prompt: 'hi' });
    expect(res.provider).toBe('openai');
    expect(res.text).toBe('hi');
    expect(res.cost).toBeCloseTo(0.02, 6);
    expect(res.tokens.total).toBe(2000);
    expect(costState.total).toBeCloseTo(0.02, 6);
    expect(costState.calls).toBe(1);
  });

  test('falls back to the next provider on failure', async () => {
    const openai = makeProvider('openai', async () => {
      const err = new Error('boom');
      err.status = 500;
      err.retryable = false;
      throw err;
    });
    const anthropic = makeProvider('anthropic', async () => ({
      text: 'ok',
      model: 'claude-3-5-sonnet',
      tokens: { input: 100, output: 50 },
      raw: {}
    }));
    const router = new Router({
      providers: new Map([['openai', openai], ['anthropic', anthropic]]),
      fallbackOrder: ['openai', 'anthropic'],
      retries: 0,
      logger: makeLogger(),
      costState: { total: 0, calls: 0 }
    });
    const res = await router.complete({ prompt: 'hi' });
    expect(res.provider).toBe('anthropic');
    expect(openai.complete).toHaveBeenCalled();
    expect(anthropic.complete).toHaveBeenCalled();
  });

  test('respects the preferred provider', async () => {
    const openai = makeProvider('openai', async () => ({ text: 'o', model: 'gpt-4o', tokens: { input: 0, output: 0 }, raw: {} }));
    const anthropic = makeProvider('anthropic', async () => ({ text: 'a', model: 'claude-3-5-sonnet', tokens: { input: 0, output: 0 }, raw: {} }));
    const router = new Router({
      providers: new Map([['openai', openai], ['anthropic', anthropic]]),
      fallbackOrder: ['openai', 'anthropic'],
      retries: 0,
      logger: makeLogger(),
      costState: { total: 0, calls: 0 }
    });
    const res = await router.complete({ prompt: 'hi', provider: 'anthropic' });
    expect(res.provider).toBe('anthropic');
    expect(openai.complete).not.toHaveBeenCalled();
  });

  test('throws when no providers can handle the request', async () => {
    const router = new Router({
      providers: new Map(),
      fallbackOrder: [],
      retries: 0,
      logger: makeLogger(),
      costState: { total: 0, calls: 0 }
    });
    await expect(router.complete({ prompt: 'hi' })).rejects.toThrow(/No providers/);
  });
});
