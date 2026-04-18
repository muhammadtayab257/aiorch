'use strict';

const { Logger } = require('../src/core/logger');

describe('Logger', () => {
  test('no-ops when disabled', () => {
    const sink = { log: jest.fn() };
    const logger = new Logger(false);
    logger.sink = sink;
    logger.logSuccess({ provider: 'openai' });
    expect(sink.log).not.toHaveBeenCalled();
  });

  test('emits structured success entries', () => {
    const sink = { log: jest.fn() };
    const logger = new Logger(sink);
    logger.logSuccess({ provider: 'openai', model: 'gpt-4o', cost: 0.01, latency: 50 });
    expect(sink.log).toHaveBeenCalledTimes(1);
    const entry = sink.log.mock.calls[0][0];
    expect(entry.event).toBe('ai_call');
    expect(entry.status).toBe('success');
    expect(entry.provider).toBe('openai');
    expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('extracts message and code from error on failure', () => {
    const sink = { log: jest.fn() };
    const logger = new Logger(sink);
    const err = Object.assign(new Error('boom'), { code: 'X1' });
    logger.logFailure({ provider: 'openai', error: err });
    const entry = sink.log.mock.calls[0][0];
    expect(entry.status).toBe('failure');
    expect(entry.error).toBe('boom');
    expect(entry.errorCode).toBe('X1');
  });

  test('logs fallback and retry events', () => {
    const sink = { log: jest.fn() };
    const logger = new Logger(sink);
    logger.logFallback({ from: 'openai', to: 'anthropic', reason: 'timeout' });
    logger.logRetry({ provider: 'openai', attempt: 1, delay: 1000 });
    expect(sink.log).toHaveBeenCalledTimes(2);
    expect(sink.log.mock.calls[0][0].event).toBe('ai_fallback');
    expect(sink.log.mock.calls[1][0].event).toBe('ai_retry');
  });

  test('swallows sink errors', () => {
    const sink = { log: () => { throw new Error('sink broken'); } };
    const logger = new Logger(sink);
    expect(() => logger.logSuccess({ provider: 'openai' })).not.toThrow();
  });

  test('default sink uses console.log', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const logger = new Logger(true);
    logger.logSuccess({ provider: 'openai' });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
