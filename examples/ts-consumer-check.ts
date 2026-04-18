// Compile-only TypeScript verification. Not meant to be executed.
// Confirms that TS consumers get proper types from the generated .d.ts.
// Run:  npx tsc --noEmit examples/ts-consumer-check.ts

import { AIOrch, CostLimitError, AllProvidersFailedError } from '../src';

async function demo(): Promise<void> {
  const ai = new AIOrch({
    openai: process.env.OPENAI_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY,
    gemini: process.env.GEMINI_API_KEY,
    fallbackOrder: ['openai', 'anthropic', 'gemini'],
    retries: 3,
    logging: true,
    maxCostPerCall: 0.05,
    maxCostPerSession: 1.0
  });

  // complete() — result should be fully typed
  const res = await ai.complete({
    prompt: 'hello',
    provider: 'openai',
    model: 'gpt-4o',
    maxTokens: 200,
    temperature: 0.2
  });
  const _text: string = res.text;
  const _provider: string = res.provider;
  const _cost: number = res.cost;
  const _tokens: { input: number; output: number; total: number } = res.tokens;
  const _latency: number = res.latency;

  // stream() — onChunk callback must accept a string
  await ai.stream({ prompt: 'hi' }, (chunk: string) => process.stdout.write(chunk));

  // healthCheck() — typed status map
  const status = await ai.healthCheck({ timeoutMs: 5000 });
  for (const name of Object.keys(status)) {
    const ok: boolean = status[name].ok;
    const lat: number = status[name].latency;
    void ok; void lat;
  }

  // cost helpers
  const total: number = ai.getTotalCost();
  const calls: number = ai.getCallCount();
  const limits = ai.getCostLimitStatus();
  void total; void calls; void limits;

  // error classes are exported and constructable as types
  try {
    await ai.complete({ prompt: 'x' });
  } catch (err) {
    if (err instanceof CostLimitError) {
      const t: string = err.type;
      const c: number = err.currentCost;
      void t; void c;
    }
    if (err instanceof AllProvidersFailedError) {
      const failures = err.failures;
      void failures;
    }
  }
}

void demo;
