'use strict';

const { OpenAIProvider } = require('../src/providers/openai');

function buildClient(impl) {
  return {
    chat: {
      completions: {
        create: jest.fn().mockImplementation(impl)
      }
    }
  };
}

describe('OpenAIProvider', () => {
  test('throws without an apiKey or client', () => {
    expect(() => new OpenAIProvider({})).toThrow(/apiKey/);
  });

  test('normalizes a chat completion response', async () => {
    const client = buildClient(async () => ({
      model: 'gpt-4o',
      choices: [{ message: { content: 'Hello there.' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 }
    }));
    const provider = new OpenAIProvider({ apiKey: 'sk', client });
    const result = await provider.complete({ prompt: 'hi', maxTokens: 100, temperature: 0.2 });
    expect(result.text).toBe('Hello there.');
    expect(result.model).toBe('gpt-4o');
    expect(result.tokens).toEqual({ input: 10, output: 5 });
    const payload = client.chat.completions.create.mock.calls[0][0];
    expect(payload.messages[0]).toEqual({ role: 'user', content: 'hi' });
    expect(payload.max_tokens).toBe(100);
    expect(payload.temperature).toBe(0.2);
  });

  test('uses the default model when none provided', async () => {
    const client = buildClient(async () => ({
      model: 'gpt-4o',
      choices: [{ message: { content: '' } }],
      usage: {}
    }));
    const provider = new OpenAIProvider({ apiKey: 'sk', client });
    await provider.complete({ prompt: 'hi' });
    expect(client.chat.completions.create.mock.calls[0][0].model).toBe('gpt-4o');
  });

  test('wraps API errors with ProviderError and correct retryable flag', async () => {
    const client = buildClient(async () => {
      const err = new Error('rate');
      err.status = 429;
      throw err;
    });
    const provider = new OpenAIProvider({ apiKey: 'sk', client });
    await expect(provider.complete({ prompt: 'hi' })).rejects.toMatchObject({
      name: 'ProviderError',
      provider: 'openai',
      status: 429,
      retryable: true
    });
  });

  test('marks 401 as non-retryable', async () => {
    const client = buildClient(async () => {
      const err = new Error('unauthorized');
      err.status = 401;
      throw err;
    });
    const provider = new OpenAIProvider({ apiKey: 'sk', client });
    await expect(provider.complete({ prompt: 'hi' })).rejects.toMatchObject({ retryable: false });
  });

  test('handles missing usage gracefully', async () => {
    const client = buildClient(async () => ({
      model: 'gpt-4o',
      choices: [{ message: { content: 'x' } }]
    }));
    const provider = new OpenAIProvider({ apiKey: 'sk', client });
    const result = await provider.complete({ prompt: 'hi' });
    expect(result.tokens).toEqual({ input: 0, output: 0 });
  });
});
