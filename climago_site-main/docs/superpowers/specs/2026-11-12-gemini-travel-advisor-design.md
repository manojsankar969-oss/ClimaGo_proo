# Gemini Travel Advisor Reliability Design

## Context

Climago uses Google Gemini through the Express server. The project already loads `GOOGLE_API_KEY` from its root `.env`, excludes `.env` in `.gitignore`, and exposes `POST /api/travel-advice` with an `{ advice }` success response. The frontend parses labeled plain text (`PLACES`, `NEARBY`, `WEAR`, `EAT`, and `ALERT`). Google’s current model documentation lists the configured `gemini-3.8-flash` model as stable, so changing providers or model identifiers is not justified by the available evidence.

The configured key cannot be confirmed as valid without sending it to the external provider. Validation will therefore use injected provider responses and will not make requests with the live key.

## Goals

- Preserve Gemini, the existing endpoint and successful response shape, and the current UI design.
- Ensure the prompt uses city, temperature, humidity, wind speed, weather conditions, and AQI.
- Avoid serving stale advice when weather conditions change.
- Return safe, useful HTTP errors for missing configuration, quota/rate limits, provider authentication failures, other provider errors, and timeouts.
- Add backend diagnostics without logging key values or raw upstream response bodies.
- Keep loading, error, retry, and successful rendering stable if optional DOM elements are missing or an API response is malformed/empty.
- Add automated tests for successful advice generation and the relevant failure cases.

## Design

The backend will continue to validate the existing request fields and call Gemini using the existing `generateContent` integration. The prompt will explicitly incorporate the full validated weather payload and request the exact labeled format consumed by the frontend. The response remains `{ advice: string }`.

The backend cache key will include the normalized city and weather inputs. The frontend cache will use the same relevant weather values rather than city alone, so a repeat search with changed conditions does not reuse obsolete recommendations. Existing cache behavior for unchanged inputs remains.

Provider response statuses will be captured internally and logged with request start, key configured/not configured (boolean only), response status, success, and safe failure category. Public error responses will contain stable generic messages, never provider response bodies or credentials. Rate limits will remain distinguishable as HTTP 429; missing configuration as 503; timeouts as 504; and invalid credentials or other upstream failures as a safe provider error. Network failures will be normalized consistently. Gemini will have a 30-second default timeout so a valid generation is not cut off by the existing 9-second timeout for other providers; tests may inject short timeout values. Existing frontend error guidance will map these safe statuses without displaying upstream details.

Frontend integration will preserve its current loading UI and parser. Optional advisor DOM references will be checked before access. HTTP and JSON parsing failures, absent or whitespace-only advice, and malformed payloads will enter the retryable error state. Retry will repeat the last request using its saved weather inputs. Rendering will reject empty results as an error rather than showing a success-shaped empty card.

## Testing

Use the existing Node test runner and injected `fetchImpl` to verify:

- Valid requests send every weather input to Gemini and return the existing `{ advice }` shape.
- Invalid/missing configuration makes no provider request.
- Quota, authentication, other provider errors, malformed success payloads, and network/timeouts return safe status/message combinations without leaking upstream details or API keys.
- Changed weather inputs do not hit an old cache entry; identical inputs can reuse a cached response.
- Frontend error-message mapping and parsing/render handling cover empty/malformed responses and retry behavior where practical with the repository’s existing test setup.

Run the full `npm test` suite and JavaScript syntax checks. No live Gemini request will be made; live key validity, account quota, and provider-side behavior cannot be confirmed without using the user’s secret.

## Scope and compatibility

Only the travel-advisor integration and its focused tests/documentation are in scope. Weather endpoints, provider selection, visual design, and unrelated application behavior remain unchanged. The `.env` file and its values will not be edited or printed; the existing variable name remains `GOOGLE_API_KEY`.
