'use strict';

const { AnthropicProvider } = require('../src/providers/anthropic');

function buildClient(impl) {
  return { messages: { create: jest.fn().mockImplementation(impl) } };
}

describe('AnthropicProvider', () => {
  test('throws without an apiKey or client', () => {
    expect(() => new AnthropicProvider({})).toThrow(/apiKey/);
  });

  test('normalizes a messages response', async () => {
    const client = buildClient(async () => ({
      model: 'claude-3-5-sonnet-20241022',
      content: [
        { type: 'text', text: 'Hello ' },
        { type: 'text', text: 'world.' }
      ],
      usage: { input_tokens: 12, output_tokens: 8 }
    }));
    const provider = new AnthropicProvider({ apiKey: 'sk', client });
    const result = await provider.complete({ prompt: 'hi', maxTokens: 256, temperature: 0.1 });
    expect(result.text).toBe('Hello world.');
    expect(result.tokens).toEqual({ input: 12, output: 8 });
    const payload = client.messages.create.mock.calls[0][0];
    expect(payload.max_tokens).toBe(256);
    expect(payload.temperature).toBe(0.1);
    expect(payload.messages[0]).toEqual({ role: 'user', content: 'hi' });
  });

  test('applies default max_tokens when not provided', async () => {
    const client = buildClient(async () => ({
      model: 'claude-3-5-sonnet-20241022',
      content: [],
      usage: {}
    }));
    const provider = new AnthropicProvider({ apiKey: 'sk', client });
    await provider.complete({ prompt: 'hi' });
    expect(client.messages.create.mock.calls[0][0].max_tokens).toBe(1024);
  });

  test('wraps errors with ProviderError', async () => {
    const client = buildClient(async () => {
      const err = new Error('server error');
      err.status = 500;
      throw err;
    });
    const provider = new AnthropicProvider({ apiKey: 'sk', client });
    await expect(provider.complete({ prompt: 'hi' })).rejects.toMatchObject({
      provider: 'anthropic',
      status: 500,
      retryable: true
    });
  });

  test('marks 403 as non-retryable', async () => {
    const client = buildClient(async () => {
      const err = new Error('forbidden');
      err.status = 403;
      throw err;
    });
    const provider = new AnthropicProvider({ apiKey: 'sk', client });
    await expect(provider.complete({ prompt: 'hi' })).rejects.toMatchObject({ retryable: false });
  });

  test('filters non-text content blocks', async () => {
    const client = buildClient(async () => ({
      model: 'claude-3-5-sonnet-20241022',
      content: [
        { type: 'tool_use', input: {} },
        { type: 'text', text: 'visible' }
      ],
      usage: { input_tokens: 1, output_tokens: 1 }
    }));
    const provider = new AnthropicProvider({ apiKey: 'sk', client });
    const result = await provider.complete({ prompt: 'hi' });
    expect(result.text).toBe('visible');
  });
});
