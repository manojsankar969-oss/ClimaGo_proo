# Backend Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Validate all Climago API inputs and return bounded, consistent JSON errors for configuration, provider failures, and timeouts while preserving successful response payloads.

**Architecture:** Refactor the Express setup into `createApp(options)` so tests can inject API keys, a provider fetch function, and timeout duration without opening a listener or changing process environment. Share strict validators and a timeout-aware provider JSON fetcher across route handlers; map invalid input to 400, missing configuration to 503, provider failures to 502, and provider timeouts to 504. Keep the existing `{ error: string }` error envelope and successful response shapes.

**Tech Stack:** Node.js 18+, Express 4, Node built-in `node:test`, native `fetch`.

---

### Task 1: Make API construction injectable and add route-test helpers

**Files:**
- Modify: `server.js`
- Create: `server.test.js`
- Modify: `package.json`

- [x] **Step 1: Add a failing test that starts an app with injected credentials and fetch**

Create `server.test.js` with helpers that start an Express app on an ephemeral port and close it after each test:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createApp } = require('./server');

async function startApp(options = {}) {
  const server = createApp(options).listen(0);
  await once(server, 'listening');
  const { port } = server.address();
  return {
    server,
    request: (path, init) => fetch(`http://127.0.0.1:${port}${path}`, init)
  };
}

test('createApp serves Firebase configuration without listening on import', async (t) => {
  const app = await startApp({ env: { FIREBASE_PROJECT_ID: 'test-project' } });
  t.after(() => new Promise((resolve, reject) => app.server.close((err) => err ? reject(err) : resolve())));
  const response = await app.request('/api/firebase-config');
  assert.equal(response.status, 200);
  assert.equal((await response.json()).projectId, 'test-project');
});
```

- [x] **Step 2: Run the test and confirm it fails because `createApp` is not exported**

Run: `node --test server.test.js`
Expected: FAIL because `createApp` is not a function.

- [x] **Step 3: Refactor the listener setup into `createApp(options)`**

Move Express app and route registration inside `createApp`. Resolve injected `weatherApiKey`, `googleApiKey`, `fetchImpl`, `timeoutMs`, and optional Firebase `env` from the passed options; default them to `process.env`, native `fetch`, and the default timeout. Keep `app.listen` guarded by `if (require.main === module)`. Export `createApp` and retain `app` export only if existing callers need it. Update `npm test` to run `node --test`.

- [x] **Step 4: Run the test and verify the app factory passes**

Run: `node --test server.test.js`
Expected: PASS with one test.

### Task 2: Validate all route inputs before provider calls

**Files:**
- Modify: `server.js`
- Test: `server.test.js`

- [x] **Step 1: Add tests proving invalid inputs return 400 without provider calls**

Inject a fetch spy that increments a call counter and returns a dummy successful response. Add assertions for:

```js
const invalidPaths = [
  '/api/weather',
  '/api/weather?city=Delhi&lat=28.6&lon=77.2',
  '/api/weather?lat=91&lon=77',
  '/api/weather?lat=28.6',
  '/api/forecast',
  '/api/aqi?lat=0&lon=181',
  '/api/search?q=%20',
  '/api/uv?lat=NaN&lon=77'
];
```

For each GET path, require status 400 and a JSON object with a string `error`; after the whole loop assert the injected provider call count is zero. Add POST checks for missing/oversized `/ai` prompt, missing travel-advice weather values, malformed comparison city objects, and missing places coordinates.

- [x] **Step 2: Run the focused tests and confirm validation cases fail**

Run: `node --test server.test.js`
Expected: FAIL on at least the missing city/coordinate exclusivity and incomplete nested POST data.

- [x] **Step 3: Tighten validators and use them in each route**

Use validators that reject non-string text instead of coercing arbitrary objects, trim strings, and enforce documented maximum lengths. Coordinates must be numeric, finite, and within latitude `[-90, 90]` and longitude `[-180, 180]`. `/api/weather` must accept a city alone or both coordinates, never a mixture or a partial pair. Bound `city` and search `q` to 80 characters, AI prompt to 2,000, condition strings to 120, and required city strings to 80. Validate travel advice numeric temperature, humidity `[0,100]`, non-negative wind, and AQI `[0,5]` (0 means unavailable, as sent by the client). Validate both comparison objects' names, condition, numeric weather values, humidity, wind, and AQI. Validate places input coordinates as a complete valid pair and numeric temperature/UV values where supplied. Route validation errors must be returned as `{ error: message }` with status 400.

- [x] **Step 4: Run the focused validation tests**

Run: `node --test server.test.js`
Expected: PASS; invalid route inputs make zero provider calls.

### Task 3: Standardize provider timeouts and safe failures

**Files:**
- Modify: `server.js`
- Test: `server.test.js`

- [x] **Step 1: Add tests for upstream errors, non-JSON responses, and timeouts**

Test a provider response with status 429 and a body containing a fake secret; expect 502 and an error response that contains neither the body nor secret. Test a non-JSON 500 response similarly. Test timeout by injecting a fetch implementation that rejects with `AbortError` when its provided signal aborts; set a small timeout and expect status 504, JSON error, and completion within a bounded test duration.

- [x] **Step 2: Run tests and confirm provider failures are not yet normalized**

Run: `node --test server.test.js`
Expected: FAIL because raw upstream errors/statuses or route-specific catch statuses are still returned.

- [x] **Step 3: Centralize timeout fetch and error mapping**

Implement a provider request helper that creates an `AbortController`, aborts after `timeoutMs`, and races the fetch against a timeout rejection so an injected or stalled fetch cannot hold a response indefinitely. Parse JSON only when the response content type is JSON; otherwise read bounded text only for internal diagnosis and never include raw text in the client response. Convert provider non-2xx responses and invalid JSON into a safe provider error. Use a typed/internal error carrying status 502 or 504. Route handlers return only a stable `{ error: 'Weather provider request failed' }`, `{ error: 'AI provider request failed' }`, or `{ error: 'Places provider request failed' }` message, as appropriate; missing provider keys return 503 with feature-specific messages.

- [x] **Step 4: Use the provider helper for every external request**

Replace direct calls in weather, forecast, AQI, search, UV, Gemini, and Overpass routes. Ensure OpenWeather and Gemini keys remain server-side and are never included in the error body. Retain the successful upstream JSON or existing route-specific result shape exactly.

- [x] **Step 5: Run the timeout and upstream-failure tests**

Run: `node --test server.test.js`
Expected: PASS; provider errors return 502, timeouts return 504, and neither response contains raw provider content.

### Task 4: Normalize Express parser and unknown API errors; verify response compatibility

**Files:**
- Modify: `server.js`
- Test: `server.test.js`
- Modify: `README.md`
- Modify: `PROJECT_OVERVIEW.md`

- [x] **Step 1: Add malformed/oversized JSON and unknown API route tests**

Send malformed JSON and a JSON body larger than the configured 1 MB limit to an API POST route. Verify both responses are JSON with a string `error` and status 400 or 413 respectively. Request an unknown `/api/...` route and require a JSON 404 response.

- [x] **Step 2: Add tests for missing provider keys and valid success shapes**

Without a weather key, request `/api/weather?city=Delhi` and assert 503 without calling the provider. With a key, inject a successful weather JSON response and assert `/api/weather` returns status 200 and the response JSON unchanged. Add one valid `/api/places` test verifying `{ places, gear }` remains the response shape.

- [x] **Step 3: Add JSON error middleware and API fallback**

Keep the JSON body parser limit at 1 MB. Add error middleware that maps malformed JSON to 400, oversized bodies to 413, and unexpected internal errors to a generic JSON 500. Add a JSON 404 for unknown `/api` endpoints after known routes, without changing static page or `/compare` behavior.

- [x] **Step 4: Run all tests and syntax validation**

Run: `npm test`
Expected: all route and utility tests pass.

Run: `node --check server.js`
Expected: exit code 0.

- [x] **Step 5: Update setup/API docs**

Document that API request errors use `{ "error": "..." }`, invalid input is 400, missing configuration is 503, provider failure is 502, timeout is 504, and malformed/oversized JSON is 400/413. State that success response shapes are unchanged. Keep current environment variable names and configuration instructions aligned in `README.md` and `PROJECT_OVERVIEW.md`.

### Task 5: Run final application smoke checks

**Files:**
- Verify: `server.js`, `package.json`, `README.md`, `PROJECT_OVERVIEW.md`

- [x] **Step 1: Run the complete test suite**

Run: `npm test`
Expected: all tests pass, zero failures.

- [x] **Step 2: Start the server on a non-default available port**

In PowerShell, run `$env:PORT='3001'; npm start` from the project directory.
Expected: startup message confirms `http://localhost:3001`.

- [x] **Step 3: Smoke-check static and API responses**

Request `/`, `/compare`, and `/api/weather` without configured keys. Expected: main HTML 200, comparison HTML 200, weather endpoint JSON 503. Stop only the server process started for this test.

- [x] **Step 4: Review the final diff**

Confirm no `.env` values or fake API keys were added, all provider calls use the bounded helper, and successful endpoint response shapes remain unchanged. This workspace has no Git repository, so do not run commit commands; provide the changed-file and test summary instead.
