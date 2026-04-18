'use strict';

const { GeminiProvider } = require('../src/providers/gemini');

function buildClient(genModelImpl) {
  const getGenerativeModel = jest.fn().mockReturnValue({
    generateContent: jest.fn().mockImplementation(genModelImpl)
  });
  return { getGenerativeModel };
}

describe('GeminiProvider', () => {
  test('throws without an apiKey or client', () => {
    expect(() => new GeminiProvider({})).toThrow(/apiKey/);
  });

  test('normalizes a generateContent response', async () => {
    const client = buildClient(async () => ({
      response: {
        text: () => 'Hello from Gemini.',
        usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 3 }
      }
    }));
    const provider = new GeminiProvider({ apiKey: 'sk', client });
    const result = await provider.complete({ prompt: 'hi', maxTokens: 50, temperature: 0.5 });
    expect(result.text).toBe('Hello from Gemini.');
    expect(result.tokens).toEqual({ input: 7, output: 3 });
    expect(client.getGenerativeModel).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gemini-2.0-flash',
      generationConfig: { maxOutputTokens: 50, temperature: 0.5 }
    }));
  });

  test('falls back to candidates.parts when text() is missing', async () => {
    const client = buildClient(async () => ({
      response: {
        candidates: [{ content: { parts: [{ text: 'one' }, { text: 'two' }] } }],
        usageMetadata: {}
      }
    }));
    const provider = new GeminiProvider({ apiKey: 'sk', client });
    const result = await provider.complete({ prompt: 'hi' });
    expect(result.text).toBe('onetwo');
  });

  test('omits generationConfig when no options provided', async () => {
    const client = buildClient(async () => ({ response: { text: () => '' } }));
    const provider = new GeminiProvider({ apiKey: 'sk', client });
    await provider.complete({ prompt: 'hi' });
    const call = client.getGenerativeModel.mock.calls[0][0];
    expect(call.generationConfig).toBeUndefined();
  });

  test('wraps errors with ProviderError and flags rate/quota as retryable', async () => {
    const client = buildClient(async () => {
      throw new Error('Resource has been exhausted (quota).');
    });
    const provider = new GeminiProvider({ apiKey: 'sk', client });
    await expect(provider.complete({ prompt: 'hi' })).rejects.toMatchObject({
      provider: 'gemini',
      retryable: true
    });
  });

  test('treats API key errors as non-retryable', async () => {
    const client = buildClient(async () => {
      throw new Error('Invalid API key provided.');
    });
    const provider = new GeminiProvider({ apiKey: 'sk', client });
    await expect(provider.complete({ prompt: 'hi' })).rejects.toMatchObject({ retryable: false });
  });
});
