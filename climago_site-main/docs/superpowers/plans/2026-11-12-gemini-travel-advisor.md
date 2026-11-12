# Gemini Travel Advisor Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing Gemini Travel Advisor use current weather reliably, return actionable structured advice, and report provider failures safely without changing the user-facing success contract.

**Architecture:** Keep `POST /api/travel-advice`, Gemini `generateContent`, and `{ advice: string }`. Tighten server request/authentication, weather-sensitive cache keys, safe provider status handling and redacted diagnostics; make the existing frontend parser, loading/error/retry path resilient. Use Node’s existing test runner and injected provider responses; do not make a live request using `.env`.

**Tech Stack:** Node.js, Express, dotenv, native fetch, vanilla JavaScript modules, `node:test`.

---

## Files and responsibilities

- Modify `server.js`: Gemini authentication/request, travel prompt, provider status/logging, and server-side cache key.
- Modify `server.test.js`: route contract, complete prompt data, cache behavior, safe provider error statuses, timeout, and missing-key coverage.
- Modify `weather-utils.mjs`: pure travel-advice parser and user-safe status-to-message mapping.
- Modify `weather-utils.test.mjs`: parser and error-message regression tests.
- Modify `script.js`: cache key, optional element guards, response validation, loading/error/retry, and rendering via the pure parser.
- Modify `README.md`: exact startup, environment variable names, local request example, and test command.

Do not edit `.env`, expose any credential, add dependencies, change weather routes, or redesign the UI. The workspace has no Git metadata, so do not attempt commits.

### Task 1: Prove and fix the Gemini travel request contract

**Files:**
- Modify: `server.test.js`
- Modify: `server.js`

- [ ] **Step 1: Add a failing request-contract test**

Add a test for `/api/travel-advice` using a `fetchImpl` spy that captures the URL and options and returns this successful Gemini response:

```js
jsonResponse({
  candidates: [{ content: { parts: [{ text: 'PLACES:\n1. Red Fort - Historic Mughal fort' }] } }]
})
```

Post:

```js
{
  city: 'Delhi',
  temp: 25,
  humidity: 45,
  wind: 2,
  condition: 'clear sky',
  airQuality: 3
}
```

Assert HTTP 200 and `{ advice: 'PLACES:\n1. Red Fort - Historic Mughal fort' }`; assert the model URL is `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent`, the API key is not in the URL, the `x-goog-api-key` request header equals the injected test key, and the JSON prompt includes city, temperature, humidity, wind, condition, and AQI. Assert the prompt requests five must-visit places, two nearby destinations, and all five existing labels.

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `node --test --test-name-pattern="travel-advice sends complete weather context" server.test.js`

Expected: FAIL because the current implementation puts the API key in the URL and omits humidity and wind from the prompt.

- [ ] **Step 3: Implement the complete private Gemini request**

In `callGemini`, keep the model and `generateContent` URL but remove the `key` query parameter and set:

```js
headers: {
  'Content-Type': 'application/json',
  'x-goog-api-key': GOOGLE_API_KEY
}
```

In the travel-advice prompt include the already-validated values:

```text
City: ${city}
Temperature: ${temp}°C
Humidity: ${humidity}%
Wind speed: ${wind} m/s
Weather conditions: ${condition}
Air Quality Index: ${airQuality === 0 ? 'Unavailable' : `${aqiLabel} (index ${airQuality})`}
```

Keep the response shape `{ advice: text }` and request these exact plain-text labels with concise list entries:

```text
PLACES:
1. [Place Name] - [Description]
2. [Place Name] - [Description]
3. [Place Name] - [Description]
4. [Place Name] - [Description]
5. [Place Name] - [Description]
NEARBY:
1. [Destination] - [Description]
2. [Destination] - [Description]
WEAR: [Weather-based clothing advice]
EAT: [Local food to try]
ALERT: [Weather/AQI precaution or None]
```

Do not log the key, request URL query values, prompt, or provider response body.

- [ ] **Step 4: Run the focused contract test**

Run: `node --test --test-name-pattern="travel-advice sends complete weather context" server.test.js`

Expected: PASS with the existing `{ advice }` success contract intact.

### Task 2: Normalize provider failures, add safe diagnostics, and avoid stale server cache entries

**Files:**
- Modify: `server.test.js`
- Modify: `server.js`

- [ ] **Step 1: Add failing tests for provider outcomes and cache keys**

Add a provider-outcome test that separately injects a 429 response and a 403 invalid-key response, each with a body containing `private upstream detail`. Require status 429 for rate limiting, a safe 502 for provider authentication failure, JSON `{ error: string }` responses, and no response containing the private body or `google-test-key`. Add cases for a rejected fetch (502), missing Google key (503 without a fetch call), and a stalled fetch with a short `timeoutMs` (504). Add a delayed AI response test using `timeoutMs: 20` and `aiTimeoutMs: 80`; a response arriving after 35 ms must succeed, proving Gemini’s timeout is independent. Inject a test logger and assert the emitted event data records request start, configured/not-configured state, upstream status, and success/failure category without including the key, prompt, or provider body.

Add a cache test making two requests for identical Delhi weather and one request for Delhi with changed temperature, humidity, wind, condition, or AQI. Assert identical inputs reuse the first generated advice and changed inputs call Gemini again. Use distinct returned advice strings so each response can be checked.

- [ ] **Step 2: Run focused tests and confirm the failures**

Run: `node --test --test-name-pattern="travel-advice (maps provider failures safely|caches by weather inputs)" server.test.js`

Expected: FAIL because all non-success provider statuses currently collapse to 502 and the cache key contains only the city.

- [ ] **Step 3: Map Gemini failures to safe statuses and log redacted diagnostics**

Preserve the provider’s HTTP status inside a `ProviderError` without retaining its body. In the shared provider fetch helper, map AI upstream 429 to 429, map other AI non-success statuses to 502, preserve existing status behavior for non-AI providers, and keep timeout at 504. Use a 30-second default for AI requests while retaining the existing 9-second default elsewhere; support `aiTimeoutMs` for tests and keep an injected `timeoutMs` applicable to all providers when explicitly supplied. Missing `GOOGLE_API_KEY` remains 503. Allow `createApp` to receive an optional `logger` (default `console`) so tests can capture the logs. Log only provider name, request start, key-configured boolean, HTTP status, safe failure category, and successful generation. Do not log request data, key values, URL, or raw provider errors.

Ensure response errors remain stable `{ error: string }` JSON; don't return provider bodies. Update the travel-advice cache key to include city (case-insensitive), temperature, humidity, wind, normalized condition, and AQI.

- [ ] **Step 4: Run focused provider and cache tests**

Run: `node --test --test-name-pattern="travel-advice (maps provider failures safely|caches by weather inputs)" server.test.js`

Expected: PASS for 429, safe authentication/other upstream failure, 503 missing key, 502 network failure, 504 timeout, redaction, and cache invalidation when weather changes.

### Task 3: Make travel-advice parsing and safe user messaging testable

**Files:**
- Modify: `weather-utils.test.mjs`
- Modify: `weather-utils.mjs`

- [ ] **Step 1: Add failing utility tests for labelled advice parsing**

Import a new `parseTravelAdvice` helper and test a sample with all five labels:

```text
PLACES:
1. Red Fort - Historic Mughal fort
NEARBY:
1. Qutub Minar - Medieval tower
WEAR: Light layers
EAT: Try chole bhature
ALERT: Carry water in the heat
```

Assert that parsed output has `places` and `nearby` arrays of `{ name, desc }` items and trimmed `wear`, `eat`, and `alert` strings. Also assert empty, whitespace-only, and non-string values return no advice sections. Add/adjust user-safe error mapping tests for 429, 502, 503, and 504 without echoing provider error text.

- [ ] **Step 2: Run utility tests and confirm the parser test fails**

Run: `node --test weather-utils.test.mjs`

Expected: FAIL because `parseTravelAdvice` is not exported.

- [ ] **Step 3: Implement a pure parser and safe status guidance**

Export `parseTravelAdvice(text)` from `weather-utils.mjs`. It must reject non-string and whitespace-only input by returning `null`, parse section labels case-insensitively, preserve multiple lines within a section, parse numbered `name - description` entries, and return:

```js
{
  places: [{ name: 'Red Fort', desc: 'Historic Mughal fort' }],
  nearby: [{ name: 'Qutub Minar', desc: 'Medieval tower' }],
  wear: 'Light layers',
  eat: 'Try chole bhature',
  alert: 'Carry water in the heat'
}
```

Return `null` if no supported non-empty section was found. Extend `getTravelAdviceErrorMessage` so quota (`429`) and provider/network/timeouts display retry guidance; missing config (`503` and the existing safe message) explains `GOOGLE_API_KEY`; other HTTP failures remain generic. Never include the raw error message in user-facing text.

- [ ] **Step 4: Run utility tests**

Run: `node --test weather-utils.test.mjs`

Expected: PASS, including existing weather utility tests.

### Task 4: Harden frontend loading, response handling, retries, and cache behavior

**Files:**
- Modify: `script.js`
- Modify: `weather-utils.mjs`
- Test: `weather-utils.test.mjs`

- [ ] **Step 1: Add failing tests for frontend cache identity**

Add a pure `travelAdviceCacheKey(data, aqi)` helper and test that identical city/weather/AQI values produce the same key while changing any of temperature, humidity, wind, condition, or AQI changes the key. Test city names case-insensitively. Keep the existing parser tests for empty and malformed advice in Task 3.

- [ ] **Step 2: Update frontend request state and cache key**

Implement `travelAdviceCacheKey(data, aqi)` in `weather-utils.mjs`, then import it and `parseTravelAdvice` in `script.js`. Build the frontend cache key from normalized city plus `temp`, `humidity`, `wind`, normalized condition, and AQI, matching the backend’s weather-sensitive behavior. Store the last request data in existing state fields (`state.lastAdviceData`, `state.lastAdviceAqi`) rather than relying on `window._lastAdviceData` and `window._lastAdviceAqi`. Keep retry behavior using those saved request fields.

- [ ] **Step 3: Guard optional elements and make all failure cases retryable**

Before starting the request, require `advisorSection` and `travelAdvisor`; only access `advisorDivider` when it exists. Show the existing loading animation. Parse the response safely: handle invalid JSON, non-2xx responses, non-object bodies, missing `advice`, non-string `advice`, and whitespace-only advice. For a nominally successful but unusable response, treat it as a 502 service error. Do not cache failures or empty responses.

Render the catch state through one helper that escapes any displayed text, keeps the retry button, uses `role="alert"`, and attaches retry to the saved request. Ensure retry remains available for transport, provider, and malformed-response failures.

- [ ] **Step 4: Use the tested parser for rendering**

Replace inline section parsing in `renderTravelAdvice` with `parseTravelAdvice(text)`. Return `false` for `null` parsed results, and have the request handler convert that to the retryable error path. For valid parsed data, preserve the current classes, visual layout, HTML escaping, and icons. Do not insert model output as raw HTML.

- [ ] **Step 5: Check frontend syntax and run focused tests**

Run:

```powershell
node --check script.js
node --test weather-utils.test.mjs server.test.js
```

Expected: syntax check succeeds and all focused tests pass.

### Task 5: Document exact local configuration and validation commands

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document current key names and startup**

Keep the existing installation instructions and document that `GOOGLE_API_KEY` is a backend-only secret in the project-root `.env`; do not include a real key. Document:

```powershell
npm install
npm start
```

- [ ] **Step 2: Add a safe local endpoint example and test commands**

Document this PowerShell request for `http://localhost:3000`:

```powershell
$body = @{
  city = 'Delhi'
  temp = 25
  humidity = 45
  wind = 2
  condition = 'clear sky'
  airQuality = 3
} | ConvertTo-Json

Invoke-RestMethod -Uri 'http://localhost:3000/api/travel-advice' `
  -Method Post `
  -ContentType 'application/json' `
  -Body $body
```

Also document `npm test` and clarify that the automated provider tests use injected responses; using the endpoint above contacts Gemini and requires an authorized key/quota.

- [ ] **Step 3: Run the complete verification suite**

Run from the project directory:

```powershell
npm test
node --check server.js
node --check script.js
```

Expected: all tests pass, both syntax checks exit successfully, and no real provider call is made by the test suite.

## Completion checklist

- The route remains `POST /api/travel-advice` with successful `{ advice }` response shape.
- The prompt includes city, temperature, humidity, wind, condition, and AQI and requests the parser’s five labels.
- Gemini credentials stay server-side and are absent from URLs, logs, frontend code, and error responses.
- Missing key, 429, invalid provider credentials/other provider error, network failure, and timeout are covered by automated tests.
- Changed weather inputs generate fresh advice; identical inputs may use the cache.
- Empty or malformed output enters the retryable error state; valid output renders escaped text with the current UI.
- No live request uses the `.env` key, no dependencies are added, and unrelated weather functionality is unchanged.
