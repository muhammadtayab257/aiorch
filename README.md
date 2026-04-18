# aisync

> Unified Node.js interface for OpenAI, Anthropic, and Gemini — with automatic fallback, retry with exponential backoff, cost tracking, and structured logging.

One API. Three providers. Zero lock-in.

## Features

- **Single interface** for OpenAI (`gpt-4o`), Anthropic (`claude-3-5-sonnet`), and Google Gemini (`gemini-1.5-pro`).
- **Automatic fallback** — if the preferred provider fails, the next one in your configured order is tried.
- **Retry with exponential backoff** — configurable, with 1s / 2s / 4s defaults. Only retries on network errors and rate limits; never retries auth errors.
- **Streaming** — `ai.stream()` delivers text deltas via a callback, with the same fallback and retry semantics (until the first chunk is emitted).
- **Cost tracking** — every call returns a USD cost, and a cumulative total is exposed via `getTotalCost()`.
- **Cost limit protection** — pre-call `maxCostPerCall` and `maxCostPerSession` guards throw `CostLimitError` before money is spent.
- **Health check** — `ai.healthCheck()` probes every configured provider in parallel and never throws.
- **Structured JSON logging** — opt-out-able, pluggable sink. Prompt content is never logged by default.
- **Standardized response shape** across providers.
- **Input validation** at the entry point with descriptive errors.
- Modern async/await. JSDoc-annotated throughout. ES2022. No callbacks (except the stream chunk callback).

## Installation

```bash
npm install aisync
```

You also need at least one provider API key. Export them as environment variables (or pass them directly to the constructor):

```bash
export OPENAI_API_KEY=sk-...
export ANTHROPIC_API_KEY=sk-ant-...
export GEMINI_API_KEY=...
```

## Quick start

```js
const { AISync } = require('aisync');

const ai = new AISync({
  openai: process.env.OPENAI_API_KEY,
  anthropic: process.env.ANTHROPIC_API_KEY,
  gemini: process.env.GEMINI_API_KEY,
  fallbackOrder: ['openai', 'anthropic', 'gemini'],
  retries: 3,
  logging: true
});

const response = await ai.complete({
  prompt: 'Summarize this text...',
  provider: 'openai', // optional — uses fallbackOrder if omitted
  model: 'gpt-4o'     // optional — uses provider default if omitted
});

console.log(response.text);      // the AI response
console.log(response.provider);  // which provider actually answered
console.log(response.cost);      // USD cost of this call
console.log(response.tokens);    // { input, output, total }
console.log(response.latency);   // milliseconds
```

## Configuration

| Option          | Type                                | Default                              | Description                                                                                |
|-----------------|-------------------------------------|--------------------------------------|--------------------------------------------------------------------------------------------|
| `openai`        | string                              | —                                    | OpenAI API key.                                                                            |
| `anthropic`     | string                              | —                                    | Anthropic API key.                                                                         |
| `gemini`        | string                              | —                                    | Google Gemini API key.                                                                     |
| `fallbackOrder` | `string[]`                          | `['openai', 'anthropic', 'gemini']`  | Order to try providers in. Unknown providers throw; providers without keys are skipped.    |
| `retries`       | integer (0–10)                      | `3`                                  | Max retries per provider. Uses exponential backoff starting at 1s.                         |
| `logging`       | `boolean` or logger object          | `true`                               | `false` to disable, or pass `{ log(entry) {} }` to use a custom sink.                      |
| `defaults`      | `{ openai?, anthropic?, gemini? }`  | —                                    | Override the per-provider default model.                                                   |
| `maxCostPerCall`    | positive number (USD)           | —                                    | Pre-call limit; throws `CostLimitError` if the estimated cost would exceed this.           |
| `maxCostPerSession` | positive number (USD)           | —                                    | Session-wide limit; throws `CostLimitError` once the running total reaches this.           |

At least one provider key must be supplied.

### Per-call options

| Option        | Type                                    | Description                                       |
|---------------|-----------------------------------------|---------------------------------------------------|
| `prompt`      | string (required)                       | The user prompt.                                  |
| `provider`    | `'openai' \| 'anthropic' \| 'gemini'`   | Preferred provider. Falls back on failure.        |
| `model`       | string                                  | Override the provider's default model.            |
| `maxTokens`   | positive integer                        | Max output tokens.                                |
| `temperature` | number between 0 and 2                  | Sampling temperature.                             |

### Response shape

```js
{
  text: 'the model response',
  provider: 'openai',             // provider that actually answered
  model: 'gpt-4o',                // model used
  cost: 0.00152,                  // USD
  tokens: { input: 120, output: 80, total: 200 },
  latency: 412,                   // ms
  raw: { /* provider response */ }
}
```

## Cost tracking

Costs are computed from token counts using current per-model pricing:

| Model                                     | Input $/1K tokens | Output $/1K tokens |
|-------------------------------------------|------------------:|-------------------:|
| OpenAI `gpt-4o`                           | 0.005             | 0.015              |
| Anthropic `claude-3-5-sonnet`             | 0.003             | 0.015              |
| Google `gemini-1.5-pro`                   | 0.00125           | 0.005              |

Every call returns a `cost` field. The `AISync` instance accumulates totals:

```js
await ai.complete({ prompt: 'question 1' });
await ai.complete({ prompt: 'question 2' });

console.log(ai.getTotalCost());  // e.g. 0.003240
console.log(ai.getCallCount());  // 2

ai.resetUsage();                 // reset both counters to 0
```

Models not in the pricing table return `cost: 0` rather than throwing, so unknown or preview models never break your flow.

## Fallback and retry behavior

- **Retry** happens first, per provider. Retryable errors: HTTP 429 (rate limit), HTTP 5xx, and network errors (`ECONNRESET`, `ETIMEDOUT`, `ENOTFOUND`, `ECONNREFUSED`, `EAI_AGAIN`, `EPIPE`). Non-retryable: 400, 401, 403, 404, and validation errors.
- **Fallback** happens after retries are exhausted for a provider — the next one in `fallbackOrder` is tried.
- If every provider fails, an `AllProvidersFailedError` is thrown. Its `.failures` property contains `{ provider, error }` entries so you can see exactly what went wrong.

```js
const { AllProvidersFailedError } = require('aisync');

try {
  await ai.complete({ prompt: 'hi' });
} catch (err) {
  if (err instanceof AllProvidersFailedError) {
    for (const f of err.failures) {
      console.error(f.provider, f.error.message);
    }
  }
}
```

## Logging

Logging is on by default and emits structured JSON to stdout. Prompt content is never included. Each entry carries a `timestamp`, `event`, and `status`.

```json
{"timestamp":"2025-01-12T09:30:02.112Z","level":"info","event":"ai_call","status":"success","provider":"openai","model":"gpt-4o","tokens":{"input":120,"output":80,"total":200},"cost":0.00152,"latency":412}
```

To disable:

```js
const ai = new AISync({ openai: '...', logging: false });
```

To use a custom sink (e.g. pino, winston, a file, a shipping service):

```js
const ai = new AISync({
  openai: '...',
  logging: { log: (entry) => myLogger.info(entry) }
});
```

## Examples

### Force a specific provider

```js
const res = await ai.complete({
  prompt: 'Write a haiku about TCP/IP.',
  provider: 'anthropic',
  model: 'claude-3-5-sonnet-20241022'
});
```

### OpenAI only

```js
const ai = new AISync({ openai: process.env.OPENAI_API_KEY });
const res = await ai.complete({ prompt: 'Hello!' });
```

### Anthropic only

```js
const ai = new AISync({ anthropic: process.env.ANTHROPIC_API_KEY });
const res = await ai.complete({ prompt: 'Hello!' });
```

### Gemini only

```js
const ai = new AISync({ gemini: process.env.GEMINI_API_KEY });
const res = await ai.complete({ prompt: 'Hello!' });
```

### Override per-provider default model

```js
const ai = new AISync({
  openai: process.env.OPENAI_API_KEY,
  anthropic: process.env.ANTHROPIC_API_KEY,
  defaults: {
    openai: 'gpt-4o-mini',
    anthropic: 'claude-3-haiku'
  }
});
```

### Custom retries

```js
const ai = new AISync({
  openai: process.env.OPENAI_API_KEY,
  retries: 5
});
```

## Streaming

Use `stream()` to receive text deltas as they arrive:

```js
const { AISync } = require('aisync');

const ai = new AISync({
  openai: process.env.OPENAI_API_KEY,
  anthropic: process.env.ANTHROPIC_API_KEY,
  gemini: process.env.GEMINI_API_KEY
});

const result = await ai.stream(
  { prompt: 'Write me a short story about a curious robot.' },
  (chunk) => process.stdout.write(chunk)
);

console.log('\n---');
console.log('Provider:', result.provider);
console.log('Tokens:', result.tokens);
console.log('Cost: $' + result.cost.toFixed(6));
```

Notes:
- Works with all three providers. The SDKs' distinct streaming formats are normalized — your callback always receives plain text deltas.
- **Fallback and retry apply only before the first chunk is emitted.** Once any text has been delivered, errors are terminal (re-emitting duplicate chunks from a second provider would corrupt the output).
- The returned object is the same standardized shape as `complete()`: `{ text, provider, model, cost, tokens, latency, raw }`.

## Cost limit protection

Stop the session from overspending by setting `maxCostPerCall` and/or `maxCostPerSession`:

```js
const { AISync, CostLimitError } = require('aisync');

const ai = new AISync({
  openai: process.env.OPENAI_API_KEY,
  maxCostPerCall: 0.05,     // $0.05 per call
  maxCostPerSession: 1.00   // $1.00 total across the session
});

try {
  await ai.complete({ prompt: 'some prompt', maxTokens: 2000 });
} catch (err) {
  if (err instanceof CostLimitError) {
    console.error(`Blocked by ${err.type} limit. current=$${err.currentCost} limit=$${err.limit}`);
  }
}
```

- **`maxCostPerSession`** — checked before each call. If the cumulative total is already ≥ the limit, the call is refused.
- **`maxCostPerCall`** — estimated from the prompt length (~4 chars/token) plus your `maxTokens` value; if the estimate exceeds the limit, the call is refused.

`CostLimitError` fields: `type` (`"call"` or `"session"`), `currentCost`, `limit`, and `estimated` (for call-type errors).

Check status at any time:

```js
const status = ai.getCostLimitStatus();
// {
//   session: { limit: 1, current: 0.12, remaining: 0.88, usagePct: 0.12, exceeded: false },
//   call:    { limit: 0.05 }
// }
```

Health-check calls are not subject to cost limits (so you can probe at the limit).

## Health check

Probe every configured provider in parallel with a minimal request:

```js
const status = await ai.healthCheck();
// {
//   openai:    { ok: true,  latency: 182 },
//   anthropic: { ok: false, latency: 103, error: 'rate limit exceeded' },
//   gemini:    { ok: true,  latency: 267 }
// }
```

- Never throws — failed providers appear with `ok: false` and a captured `error` message.
- Each provider has a bounded timeout (default 10s; override with `ai.healthCheck({ timeoutMs: 2000 })`).
- Uses a small prompt (`"ping"`, `maxTokens: 5`) so probes stay cheap.

## Development

```bash
npm install
npm test                # run jest
npm run test:coverage   # run with coverage report
npm start               # run examples/basic-usage.js
```

## License

MIT
