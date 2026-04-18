'use strict';

const {
  validateConfig,
  validateCompleteOptions,
  validateFallbackOrder,
  ValidationError,
  SUPPORTED_PROVIDERS
} = require('../src/utils/validator');

describe('validateConfig', () => {
  test('accepts a config with at least one API key', () => {
    expect(() => validateConfig({ openai: 'sk-test' })).not.toThrow();
  });

  test('throws when no keys provided', () => {
    expect(() => validateConfig({})).toThrow(ValidationError);
  });

  test('throws when config is not an object', () => {
    expect(() => validateConfig(null)).toThrow(ValidationError);
  });

  test('validates retries range', () => {
    expect(() => validateConfig({ openai: 'k', retries: -1 })).toThrow(ValidationError);
    expect(() => validateConfig({ openai: 'k', retries: 11 })).toThrow(ValidationError);
    expect(() => validateConfig({ openai: 'k', retries: 2 })).not.toThrow();
  });

  test('validates logging option type', () => {
    expect(() => validateConfig({ openai: 'k', logging: 'yes' })).toThrow(ValidationError);
    expect(() => validateConfig({ openai: 'k', logging: true })).not.toThrow();
    expect(() => validateConfig({ openai: 'k', logging: { log: () => {} } })).not.toThrow();
  });

  test('validates fallbackOrder providers', () => {
    expect(() => validateConfig({ openai: 'k', fallbackOrder: ['openai'] })).not.toThrow();
    expect(() => validateConfig({ openai: 'k', fallbackOrder: [] })).toThrow(ValidationError);
    expect(() => validateConfig({ openai: 'k', fallbackOrder: ['openai', 'anthropic'] })).toThrow(/no API key/);
    expect(() => validateConfig({ openai: 'k', fallbackOrder: ['bogus'] })).toThrow(/unsupported/);
  });
});

describe('validateCompleteOptions', () => {
  test('requires a prompt', () => {
    expect(() => validateCompleteOptions({})).toThrow(ValidationError);
    expect(() => validateCompleteOptions({ prompt: '' })).toThrow(ValidationError);
    expect(() => validateCompleteOptions({ prompt: '   ' })).toThrow(ValidationError);
  });

  test('accepts a minimal valid call', () => {
    expect(() => validateCompleteOptions({ prompt: 'hi' })).not.toThrow();
  });

  test('rejects unsupported providers', () => {
    expect(() => validateCompleteOptions({ prompt: 'hi', provider: 'xyz' })).toThrow(ValidationError);
  });

  test('validates maxTokens and temperature ranges', () => {
    expect(() => validateCompleteOptions({ prompt: 'hi', maxTokens: 0 })).toThrow(ValidationError);
    expect(() => validateCompleteOptions({ prompt: 'hi', temperature: 3 })).toThrow(ValidationError);
    expect(() => validateCompleteOptions({ prompt: 'hi', temperature: -1 })).toThrow(ValidationError);
    expect(() => validateCompleteOptions({ prompt: 'hi', maxTokens: 10, temperature: 0.7 })).not.toThrow();
  });

  test('rejects empty model string', () => {
    expect(() => validateCompleteOptions({ prompt: 'hi', model: '' })).toThrow(ValidationError);
  });
});

describe('validateFallbackOrder', () => {
  test('requires non-empty array', () => {
    expect(() => validateFallbackOrder([], { openai: 'k' })).toThrow(ValidationError);
    expect(() => validateFallbackOrder('openai', { openai: 'k' })).toThrow(ValidationError);
  });

  test('checks all supported providers list', () => {
    expect(SUPPORTED_PROVIDERS).toEqual(expect.arrayContaining(['openai', 'anthropic', 'gemini']));
  });
});
