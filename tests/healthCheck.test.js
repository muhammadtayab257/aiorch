'use strict';

const { runHealthCheck } = require('../src/core/healthCheck');

function makeProvider(impl) {
  return { complete: jest.fn().mockImplementation(impl) };
}

describe('runHealthCheck', () => {
  test('returns an empty object when no providers configured', async () => {
    const result = await runHealthCheck(new Map());
    expect(result).toEqual({});
  });

  test('reports ok: true and latency for healthy providers', async () => {
    const providers = new Map([
      ['openai', makeProvider(async () => ({ text: 'ok' }))],
      ['gemini', makeProvider(async () => ({ text: 'ok' }))]
    ]);
    const result = await runHealthCheck(providers, { timeoutMs: 1000 });
    expect(result.openai.ok).toBe(true);
    expect(result.gemini.ok).toBe(true);
    expect(typeof result.openai.latency).toBe('number');
    expect(result.openai.latency).toBeGreaterThanOrEqual(0);
  });

  test('captures error message without throwing when a provider fails', async () => {
    const providers = new Map([
      ['openai', makeProvider(async () => ({ text: 'ok' }))],
      ['anthropic', makeProvider(async () => { throw new Error('service unavailable'); })]
    ]);
    const result = await runHealthCheck(providers);
    expect(result.openai.ok).toBe(true);
    expect(result.anthropic.ok).toBe(false);
    expect(result.anthropic.error).toMatch(/service unavailable/);
  });

  test('returns status map even when every provider fails', async () => {
    const providers = new Map([
      ['openai', makeProvider(async () => { throw new Error('down'); })],
      ['anthropic', makeProvider(async () => { throw new Error('down'); })]
    ]);
    const result = await runHealthCheck(providers);
    expect(result.openai.ok).toBe(false);
    expect(result.anthropic.ok).toBe(false);
  });

  test('times out slow providers', async () => {
    const providers = new Map([
      ['openai', makeProvider(() => new Promise(() => {}))]
    ]);
    const result = await runHealthCheck(providers, { timeoutMs: 50 });
    expect(result.openai.ok).toBe(false);
    expect(result.openai.error).toMatch(/timed out/);
  });

  test('invokes complete with a minimal, cheap prompt', async () => {
    const spy = jest.fn().mockResolvedValue({ text: 'ok' });
    const providers = new Map([['openai', { complete: spy }]]);
    await runHealthCheck(providers);
    const args = spy.mock.calls[0][0];
    expect(typeof args.prompt).toBe('string');
    expect(args.prompt.length).toBeGreaterThan(0);
    expect(args.maxTokens).toBeLessThanOrEqual(16);
  });
});
