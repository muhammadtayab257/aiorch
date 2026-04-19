# Contributing to aiorch

Thanks for your interest — `aiorch` welcomes contributions of all sizes, from typo fixes to new providers.

## Quick start

```bash
git clone https://github.com/muhammadtayab257/aiorch.git
cd aiorch
npm install
npm test                 # 115 tests should pass
npm run test:coverage    # optional — see coverage report
npm run build:types      # regenerate TypeScript declarations
```

## Before you open a PR

1. **Open an issue first** for anything non-trivial — it's faster than rewriting a PR that went in the wrong direction.
2. **Keep changes focused.** One PR = one concern (one bug fix, one feature, one refactor). If you're tempted to bundle unrelated cleanup, split it.
3. **Write tests.** Every existing module has a test file in [`tests/`](tests/). New code should land with tests that exercise both the happy path and at least one failure case. External SDKs should be mocked (see [`tests/providers.openai.test.js`](tests/providers.openai.test.js) for the pattern).
4. **Don't add comments that explain *what* the code does** — well-named identifiers handle that. Only comment the *why* when it's non-obvious (a workaround, a subtle constraint).
5. **Run `npm test` before pushing.** Also run `npm run build:types` if your change touched JSDoc — the `.d.ts` files are generated from it.

## Code style

- **Async/await** — no raw promises, no callbacks (except the stream chunk callback, which is a deliberate API).
- **Functions ≤ 50 lines.** If a function grows past that, split it.
- **JSDoc every public function** — parameters, types, `@returns`. These drive our TypeScript declarations; incomplete JSDoc = incomplete types for users.
- **`'use strict';`** at the top of every `.js` file.
- **CommonJS (`require` / `module.exports`)** — not ES modules. Don't convert; the tests and build assume CommonJS.
- **No new dependencies without discussion.** Runtime deps add weight for every user; think twice before pulling one in.
- **Errors at boundaries only.** Trust internal callers; validate at the public entry point (see [`src/utils/validator.js`](src/utils/validator.js)).

## Commit messages

Short, imperative subject lines (≤ 72 chars). Use these prefixes when they fit:

- `feat:` — new user-facing feature
- `fix:` — bug fix
- `chore:` — tooling, build, dependencies
- `docs:` — README, CHANGELOG, inline docs
- `test:` — tests only, no behavior change
- `refactor:` — internal cleanup, no behavior change

Examples:
- `feat: add timeoutMs option to complete() and stream()`
- `fix: strip trailing newline from Anthropic message_delta`
- `docs: document maxCostPerSession concurrency caveat`

## What we'd love help with

High-leverage areas where contributions are especially welcome:

- **New providers** — Cohere, Mistral, Groq, xAI/Grok, DeepSeek, local Ollama
- **`timeoutMs` option on `complete()` and `stream()`** — currently an upstream hang will hang your call forever. Only `healthCheck()` has a timeout.
- **Real-SDK contract tests behind a `TEST_LIVE=1` flag** — would catch SDK endpoint changes (e.g., Gemini 1.5 → 2.0 deprecation).
- **Concurrency correctness on cost limits** — today, two parallel `complete()` calls can both pass `maxCostPerSession` check and exceed the limit.
- **Prompt caching** — Anthropic and OpenAI both support it now; huge cost savings if we expose it.
- **Tool/function calling** — normalized across providers.
- **Embeddings API** — `ai.embed(text)` across providers.
- **Structured output (JSON mode) normalization** across providers.

Open an issue first so we can discuss design before you dive in.

## Adding a new provider

1. Copy one of [`src/providers/openai.js`](src/providers/openai.js), `anthropic.js`, or `gemini.js` as a starting template.
2. Implement `complete(options)` and `stream(options, onChunk)` with the same normalized return shape:
   ```js
   { text, model, tokens: { input, output }, raw }
   ```
3. Translate provider-specific errors to `ProviderError` (see [`src/core/router.js`](src/core/router.js)) with correct `retryable` flags for 429 / 5xx / network errors.
4. Add pricing entries to [`src/utils/cost.js`](src/utils/cost.js) for each supported model.
5. Wire it into [`src/index.js`](src/index.js) — add to `SUPPORTED_PROVIDERS` and the provider factory map.
6. Add a test file mirroring [`tests/providers.openai.test.js`](tests/providers.openai.test.js) structure. Mock the SDK client; don't hit the real API.
7. Document the new provider in the README.

## Reporting bugs

Open an issue using the [bug report template](.github/ISSUE_TEMPLATE/bug_report.md). Include:

- Node version and OS
- Minimum reproduction (a ~10 line snippet that shows the bug)
- What you expected vs. what happened
- Full error message + stack trace if any

## Requesting features

Use the [feature request template](.github/ISSUE_TEMPLATE/feature_request.md). Focus on the *problem* you're trying to solve, not the *solution* — we might find a cleaner API once we understand the use case.

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By participating, you agree to uphold it. In short: be kind, assume good intent, welcome newcomers.

## License

By contributing, you agree that your contributions will be licensed under the MIT License (same as the rest of the project — see [`LICENSE`](LICENSE)).
