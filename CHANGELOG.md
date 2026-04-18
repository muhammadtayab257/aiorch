# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-04-18

### Added
- Initial release.
- Unified `AIOrch` interface over OpenAI, Anthropic, and Google Gemini.
- Automatic provider fallback via configurable `fallbackOrder`.
- Retry with exponential backoff (1s / 2s / 4s) on rate limits, 5xx, and network errors.
- **Streaming** — `ai.stream(options, onChunk)` delivers text deltas from all three providers through a single callback. Retries apply only before the first chunk; fallback applies only while no chunks have been emitted.
- **Cost tracking** — per-call USD cost plus cumulative `getTotalCost()` and `getCallCount()`.
- **Cost limit protection** — `maxCostPerCall` and `maxCostPerSession` config options. Pre-call enforcement throws `CostLimitError` (with `type`, `currentCost`, `limit`, and `estimated` fields) before any provider is contacted. `ai.getCostLimitStatus()` for observability.
- **Health check** — `ai.healthCheck()` probes every configured provider in parallel and returns a status map `{ ok, latency, error? }`. Never throws. Bounded per-provider timeout (default 10s).
- Structured JSON logging with pluggable sink; prompt content is never logged.
- Input validation at every entry point with descriptive `ValidationError`s.
- Standardized provider error type `ProviderError` and aggregate `AllProvidersFailedError`.
- Jest test suite covering every module with external SDKs mocked.
