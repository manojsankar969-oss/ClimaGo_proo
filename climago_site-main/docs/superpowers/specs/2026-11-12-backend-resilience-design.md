# Backend Resilience Design

## Goal

Make Climago API inputs and provider failures predictable and safe without changing successful response shapes or adding dependencies.

## Scope

- Validate inputs for every API route before calling an upstream provider.
- Require exactly one valid city or coordinate pair for current weather; enforce coordinate bounds, bounded strings, numeric weather values, and valid nested comparison data.
- Apply a finite timeout to OpenWeather, Gemini, and Overpass requests.
- Normalize application errors as JSON, distinguish invalid input (400), missing provider configuration (503), upstream failure (502), and timeout (504), and avoid exposing provider keys or raw upstream error bodies.
- Keep current success payloads, Firebase configuration behavior, and the in-memory AI cache unchanged.
- Add focused route tests for validation, successful response compatibility, upstream failures, and timeouts using mocked network calls.

## Design and error handling

Keep the Express app importable for tests and centralize provider-fetch behavior and safe error mapping in small server helpers. Route handlers will validate values before constructing provider URLs. Provider response status may be used for diagnostics, but public errors will be bounded and non-sensitive. A JSON error middleware will cover malformed/oversized request bodies and unknown API routes without changing static page handling.

Do not add rate-limiting dependencies in this pass: deployment topology and client identity are not specified. Existing AI response caching remains the quota-control mechanism for now.

## Verification

Use Node's built-in test runner. Tests must prove invalid requests do not make provider calls, timeouts terminate promptly, error responses do not leak credentials or raw provider payloads, and valid successful responses retain their existing structures. Run the focused tests, the complete `npm test` command, and a local server smoke test.

## Out of scope

- MCP implementation or shared-service extraction.
- New external dependencies, deployment-specific rate limiting, and frontend redesign.
- Changes to successful API response contracts.
