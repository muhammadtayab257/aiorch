'use strict';

const { OpenAIProvider } = require('../src/providers/openai');
const { AnthropicProvider } = require('../src/providers/anthropic');
const { GeminiProvider } = require('../src/providers/gemini');
const { AISync } = require('../src');

async function* toAsync(items) {
  for (const item of items) yield item;
}

function openaiClient(chunks) {
  return {
    chat: {
      completions: {
        create: jest.fn().mockImplementation(async () => toAsync(chunks))
      }
    }
  };
}

function anthropicClient(events) {
  return { messages: { create: jest.fn().mockImplementation(async () => toAsync(events)) } };
}

function geminiClient(chunks, usage) {
  const genModel = {
    generateContentStream: jest.fn().mockResolvedValue({
      stream: toAsync(chunks.map((t) => ({ text: () => t }))),
      response: Promise.resolve({ usageMetadata: usage || {} })
    })
  };
  return { getGenerativeModel: jest.fn().mockReturnValue(genModel) };
}

describe('OpenAIProvider.stream', () => {
  test('concatenates deltas, captures final usage, emits chunks', async () => {
    const client = openaiClient([
      { model: 'gpt-4o', choices: [{ delta: { content: 'Hel' } }] },
      { choices: [{ delta: { content: 'lo ' } }] },
      { choices: [{ delta: { content: 'world.' } }] },
      { choices: [{ delta: {} }], usage: { prompt_tokens: 3, completion_tokens: 5 } }
    ]);
    const provider = new OpenAIProvider({ apiKey: 'sk', client });
    const received = [];
    const result = await provider.stream({ prompt: 'hi', maxTokens: 100, temperature: 0.2 }, (c) => received.push(c));
    expect(received).toEqual(['Hel', 'lo ', 'world.']);
    expect(result.text).toBe('Hello world.');
    expect(result.tokens).toEqual({ input: 3, output: 5 });
    expect(result.model).toBe('gpt-4o');
    const payload = client.chat.completions.create.mock.calls[0][0];
    expect(payload.stream).toBe(true);
    expect(payload.stream_options).toEqual({ include_usage: true });
  });

  test('surfaces errors as ProviderError', async () => {
    const client = {
      chat: { completions: { create: async () => { const e = new Error('rate'); e.status = 429; throw e; } } }
    };
    const provider = new OpenAIProvider({ apiKey: 'sk', client });
    await expect(provider.stream({ prompt: 'hi' }, () => {})).rejects.toMatchObject({
      name: 'ProviderError',
      retryable: true
    });
  });
});

describe('AnthropicProvider.stream', () => {
  test('handles message_start, content_block_delta, message_delta', async () => {
    const client = anthropicClient([
      { type: 'message_start', message: { model: 'claude-3-5-sonnet-20241022', usage: { input_tokens: 4 } } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi ' } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'there.' } },
      { type: 'message_delta', usage: { output_tokens: 6 } }
    ]);
    const provider = new AnthropicProvider({ apiKey: 'sk', client });
    const received = [];
    const result = await provider.stream({ prompt: 'hi' }, (c) => received.push(c));
    expect(received).toEqual(['Hi ', 'there.']);
    expect(result.text).toBe('Hi there.');
    expect(result.tokens).toEqual({ input: 4, output: 6 });
  });

  test('ignores non-text deltas', async () => {
    const client = anthropicClient([
      { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{}' } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'ok' } }
    ]);
    const provider = new AnthropicProvider({ apiKey: 'sk', client });
    const received = [];
    const result = await provider.stream({ prompt: 'hi' }, (c) => received.push(c));
    expect(received).toEqual(['ok']);
    expect(result.text).toBe('ok');
  });
});

describe('GeminiProvider.stream', () => {
  test('concatenates text() chunks and picks up final usage', async () => {
    const client = geminiClient(['Hel', 'lo ', 'Gemini.'], { promptTokenCount: 2, candidatesTokenCount: 4 });
    const provider = new GeminiProvider({ apiKey: 'sk', client });
    const received = [];
    const result = await provider.stream({ prompt: 'hi', maxTokens: 50 }, (c) => received.push(c));
    expect(received).toEqual(['Hel', 'lo ', 'Gemini.']);
    expect(result.text).toBe('Hello Gemini.');
    expect(result.tokens).toEqual({ input: 2, output: 4 });
  });
});

describe('AISync.stream integration', () => {
  function streamFactory(name, impl) {
    return () => ({
      name,
      defaultModel: 'gpt-4o',
      complete: jest.fn(),
      stream: jest.fn().mockImplementation(impl)
    });
  }

  test('delivers chunks and returns standardized response', async () => {
    const ai = new AISync({
      openai: 'sk',
      logging: false,
      _providerFactories: {
        openai: streamFactory('openai', async (_opts, onChunk) => {
          onChunk('one ');
          onChunk('two');
          return { text: 'one two', model: 'gpt-4o', tokens: { input: 10, output: 10 }, raw: {} };
        })
      }
    });
    const pieces = [];
    const res = await ai.stream({ prompt: 'hi' }, (c) => pieces.push(c));
    expect(pieces.join('')).toBe('one two');
    expect(res.text).toBe('one two');
    expect(res.provider).toBe('openai');
    expect(res.cost).toBeGreaterThan(0);
  });

  test('falls back when no chunks have been emitted', async () => {
    const ai = new AISync({
      openai: 'sk',
      anthropic: 'sk',
      fallbackOrder: ['openai', 'anthropic'],
      retries: 0,
      logging: false,
      _providerFactories: {
        openai: streamFactory('openai', async () => {
          const err = new Error('boom'); err.retryable = false; throw err;
        }),
        anthropic: streamFactory('anthropic', async (_opts, onChunk) => {
          onChunk('hi');
          return { text: 'hi', model: 'claude-3-5-sonnet', tokens: { input: 1, output: 1 }, raw: {} };
        })
      }
    });
    const pieces = [];
    const res = await ai.stream({ prompt: 'x' }, (c) => pieces.push(c));
    expect(res.provider).toBe('anthropic');
    expect(pieces).toEqual(['hi']);
  });

  test('does NOT fall back once chunks have been emitted', async () => {
    const ai = new AISync({
      openai: 'sk',
      anthropic: 'sk',
      fallbackOrder: ['openai', 'anthropic'],
      retries: 0,
      logging: false,
      _providerFactories: {
        openai: streamFactory('openai', async (_opts, onChunk) => {
          onChunk('partial');
          const err = new Error('network broke'); err.retryable = false; throw err;
        }),
        anthropic: streamFactory('anthropic', async () => ({ text: 'x', model: 'y', tokens: { input: 0, output: 0 }, raw: {} }))
      }
    });
    const pieces = [];
    await expect(ai.stream({ prompt: 'x' }, (c) => pieces.push(c))).rejects.toThrow(/network broke/);
    expect(pieces).toEqual(['partial']);
  });

  test('retries before first chunk is emitted', async () => {
    let attempts = 0;
    const ai = new AISync({
      openai: 'sk',
      logging: false,
      retries: 2,
      _providerFactories: {
        openai: streamFactory('openai', async (_opts, onChunk) => {
          attempts++;
          if (attempts < 2) {
            const err = new Error('transient'); err.status = 503; throw err;
          }
          onChunk('ok');
          return { text: 'ok', model: 'gpt-4o', tokens: { input: 0, output: 0 }, raw: {} };
        })
      }
    });
    const pieces = [];
    const res = await ai.stream({ prompt: 'hi' }, (c) => pieces.push(c));
    expect(attempts).toBe(2);
    expect(res.text).toBe('ok');
  });

  test('validates onChunk is a function', async () => {
    const ai = new AISync({ openai: 'sk', logging: false });
    await expect(ai.stream({ prompt: 'hi' })).rejects.toThrow(/chunk callback/);
  });
});
