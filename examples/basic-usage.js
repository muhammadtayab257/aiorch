'use strict';

/* eslint-disable no-console */

require('dotenv').config();
const { AISync } = require('..');

/**
 * Basic usage example. Demonstrates the unified API, automatic
 * fallback, cost tracking, and logging.
 */
async function main() {
  const ai = new AISync({
    openai: process.env.OPENAI_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY,
    gemini: process.env.GEMINI_API_KEY,
    fallbackOrder: ['openai', 'anthropic', 'gemini'],
    retries: 3,
    logging: true
  });

  if (ai.getConfiguredProviders().length === 0) {
    console.error('No provider API keys found. Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or GEMINI_API_KEY.');
    process.exit(1);
  }

  console.log('Configured providers:', ai.getConfiguredProviders().join(', '));

  const response = await ai.complete({
    prompt: 'In one sentence, explain what a large language model is.',
    // provider: 'openai',   // uncomment to force a provider
    // model: 'gpt-4o',      // uncomment to override the default model
    maxTokens: 200,
    temperature: 0.3
  });

  console.log('---');
  console.log('Text    :', response.text);
  console.log('Provider:', response.provider);
  console.log('Model   :', response.model);
  console.log('Tokens  :', response.tokens);
  console.log('Cost    : $' + response.cost.toFixed(6));
  console.log('Latency :', response.latency, 'ms');
  console.log('---');
  console.log('Total session cost: $' + ai.getTotalCost().toFixed(6));
  console.log('Total calls       :', ai.getCallCount());
}

main().catch((err) => {
  console.error('Request failed:', err.message);
  if (err.failures) {
    for (const f of err.failures) {
      console.error(`  - ${f.provider}: ${f.error && f.error.message}`);
    }
  }
  process.exit(1);
});
