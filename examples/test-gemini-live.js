'use strict';

/* eslint-disable no-console */

/**
 * Live end-to-end test against the real Gemini API.
 * Reads the API key from process.env.GEMINI_API_KEY — never hardcoded.
 * Run:  GEMINI_API_KEY=... node examples/test-gemini-live.js
 */

const { AIOrch } = require('..');

async function testComplete(ai) {
  console.log('\n=== 1. complete() ===');
  const res = await ai.complete({
    prompt: 'In one sentence, what is TCP?',
    maxTokens: 800,
    temperature: 0.2
  });
  console.log('Text    :', res.text);
  console.log('Provider:', res.provider);
  console.log('Model   :', res.model);
  console.log('Tokens  :', res.tokens);
  console.log('Cost    : $' + res.cost.toFixed(6));
  console.log('Latency :', res.latency, 'ms');
}

async function testStream(ai) {
  console.log('\n=== 2. stream() ===');
  process.stdout.write('Streamed text: ');
  const res = await ai.stream(
    { prompt: 'Count from one to five in words, separated by commas.', maxTokens: 800 },
    (chunk) => process.stdout.write(chunk)
  );
  console.log('\n---');
  console.log('Provider:', res.provider);
  console.log('Tokens  :', res.tokens);
  console.log('Cost    : $' + res.cost.toFixed(6));
}

async function testHealth(ai) {
  console.log('\n=== 3. healthCheck() ===');
  const status = await ai.healthCheck({ timeoutMs: 15000 });
  console.log(status);
}

async function main() {
  if (!process.env.GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY env var is required.');
    process.exit(1);
  }
  const ai = new AIOrch({
    gemini: process.env.GEMINI_API_KEY,
    defaults: { gemini: 'gemini-flash-latest' },
    logging: false
  });
  console.log('Configured providers:', ai.getConfiguredProviders().join(', '));

  await testComplete(ai);
  await testStream(ai);
  await testHealth(ai);

  console.log('\n=== session summary ===');
  console.log('Total calls:', ai.getCallCount());
  console.log('Total cost : $' + ai.getTotalCost().toFixed(6));
}

main().catch((err) => {
  console.error('\nTest failed:', err.message);
  if (err.failures) {
    for (const f of err.failures) {
      console.error(`  - ${f.provider}: ${f.error && f.error.message}`);
    }
  }
  process.exit(1);
});
