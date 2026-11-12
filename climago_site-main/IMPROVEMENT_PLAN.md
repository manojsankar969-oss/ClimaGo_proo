# Climago Improvement Plan

## Objective

Improve correctness and reliability first, then harden provider/API handling, and finally establish repeatable tests and maintainable delivery practices. This is an implementation roadmap. Status notes below reflect the current workspace.

## Priority summary

| Priority | Focus | Outcome |
|---|---|---|
| P0 | Frontend correctness and graceful degradation | Core search, quick-city selection, forecast, and retry flows behave consistently |
| P1 | Backend validation, secrets, and upstream resilience | Invalid requests fail clearly; provider failures and sensitive configuration are handled deliberately |
| P2 | Tests, accessibility, and browser behavior | Key flows are verifiable and usable with keyboard, assistive technology, and small screens |
| P3 | Maintainability and operations | Clear service boundaries, deployable configuration, and useful operational signals |

---

## Phase 0 — Correctness and reliability

### 0.1 Make quick-city search and retry independent of error paths

- **Priority:** P0
- **Files:** `script.js`, `index.html`
- **Current observation:** The adviser request stores its latest weather payload and AQI in application state; both the inline error button and `retryTravelAdvice` reuse that state. Adviser errors no longer prevent quick-city search, and the optional divider is guarded before use.
- **Implementation:** Move UI event wiring and global handlers out of request error handling. Prefer attaching event listeners in `script.js` rather than inline HTML handlers. Store the last advice request data deliberately, or replace the retry mechanism with a button handler that closes over the relevant state.
- **Acceptance criteria:** Every quick-city button searches successfully before and after an AI response; AI failure does not alter search availability; retry repeats the most recent request with the current city and air-quality value.
- **Verification:** Test a quick search with Gemini configured and unavailable; test a city search followed by the advisor retry action.

### 0.2 Use the forecast location's time and date

- **Priority:** P0
- **Files:** `script.js`
- **Current observation:** `processForecast` reads forecast timestamps with the browser's local `getHours()` and uses `getUTCDate()` without filtering the forecast list to the target local date. It reads `forecast.city.timezone` but does not apply it.
- **Implementation:** Convert timestamps using the forecast city's UTC offset, choose a documented target day, and then select the nearest available forecast item per day-part.
- **Acceptance criteria:** Day-part cards correspond to the displayed city's local day and local time slots, including near-midnight UTC boundaries and locations in different time zones.
- **Verification:** Add deterministic tests for known UTC timestamps and positive/negative offsets; check a forecast that crosses a local date boundary.

### 0.3 Isolate optional data failures

- **Priority:** P0
- **Files:** `script.js`
- **Current observation:** The main rendering flow requests AQI, summary, and UV together, and subsequent requests provide planner, places, and AI advice. Optional provider failure should not make core current-weather data unusable.
- **Implementation:** Define which sections are optional, render explicit section-level unavailable states, and preserve the current weather card if forecast, places, AQI, UV, or AI is unavailable.
- **Acceptance criteria:** Current weather remains visible when each optional service fails independently; users can distinguish unavailable data from an empty result.
- **Verification:** Exercise success and failure for each secondary endpoint and confirm the page remains interactive.

### 0.4 Make client rendering safe for external and generated text

- **Priority:** P0
- **Files:** `script.js`, `compare.js`
- **Current observation:** Several renderers interpolate city/provider/AI text into `innerHTML`.
- **Implementation:** Treat upstream and generated text as untrusted. Build DOM nodes and assign untrusted strings through `textContent`, or use a reviewed escaping helper for text-only template positions. Avoid accepting markup from AI output.
- **Acceptance criteria:** Names and descriptions containing HTML-like input display as text and do not create executable markup.
- **Verification:** Add renderer tests with angle brackets, quotes, and script-like strings for city names, place text, and AI responses.

---

## Phase 1 — Backend validation and provider resilience

### 1.1 Validate requests before contacting providers

- **Priority:** P1
- **Files:** `server.js`
- **Status:** Implemented with route tests for invalid input and provider-call suppression.
- **Implementation:** Validate required fields and types on every route; require finite latitude/longitude within valid ranges; bound city/query and prompt lengths; validate nested comparison objects and numeric weather values; configure an appropriate JSON request-body limit.
- **Acceptance criteria:** Invalid or incomplete inputs return consistent 4xx JSON errors and make no upstream request. Valid city and coordinate queries continue to work.
- **Verification:** Add route tests for missing, malformed, out-of-range, and valid inputs, including both city and coordinate weather searches.

### 1.2 Standardize upstream errors and timeouts

- **Priority:** P1
- **Files:** `server.js`, `script.js`, `compare.js`
- **Status:** Implemented for OpenWeather, Gemini, and Overpass requests; tests cover provider errors, timeouts, and safe responses.
- **Implementation:** Apply request timeouts to OpenWeather, Gemini, and Overpass calls; preserve useful upstream status context without returning secrets; use a consistent API error shape; handle non-JSON and non-success upstream responses explicitly.
- **Acceptance criteria:** Provider timeouts and non-2xx responses produce a bounded response time and a clear, non-secret error; successful response shapes remain documented.
- **Verification:** Stub provider responses for success, timeout, invalid JSON, and rate-limit/server errors.

### 1.3 Protect quota-consuming routes and configuration

- **Priority:** P1
- **Files:** `server.js`, `README.md`, `.gitignore`
- **Implementation:** Keep OpenWeather and Gemini credentials exclusively on the server; verify Firebase's intended client configuration and domain restrictions; add appropriate rate limits or caching for AI endpoints; avoid logging prompts, tokens, or secrets. Document all supported environment variables in one authoritative place.
- **Acceptance criteria:** No provider secret appears in frontend files or API responses; AI calls are bounded; missing configuration produces a clear feature-specific error.
- **Verification:** Search built assets/source for secret values using test placeholders; test missing-key and rate-limit behavior; check that Firebase config contains only intended public client values.

### 1.4 Reconcile docs and dependency metadata

- **Priority:** P1
- **Files:** `README.md`, `requirements.txt`, `package.json`
- **Implementation:** Keep the Gemini model name, optional integrations, runtime requirements, and environment variable names consistent. Decide whether to remove or clearly label the Node-inappropriate `requirements.txt` in a separate reviewed change.
- **Acceptance criteria:** Setup instructions match the server's actual variables and dependencies; no Python package installation is implied for this Node.js project.
- **Verification:** Follow the written setup from a clean Node.js environment and confirm the documented command starts the server.

---

## Phase 2 — Tests, accessibility, and client behavior

### 2.1 Establish a focused test suite

- **Priority:** P2
- **Files:** `package.json`, new test files for server routes and browser utilities
- **Status:** Core suite established with Node's built-in test runner; route contracts, forecast utilities, scoring, and escaping are covered.
- **Dependencies:** Complete request validation and identify testable pure functions.
- **Implementation:** Add tests for route input/output contracts, forecast-time conversion, comfort scoring, and rendering of untrusted text. Prefer Node's built-in test runner for server and pure JavaScript tests unless browser behavior requires a browser test runner.
- **Acceptance criteria:** A documented test command runs deterministically without live provider credentials; key success and failure paths have coverage.
- **Verification:** Run the test command on a clean install with no `.env` file and confirm provider calls are mocked.

### 2.2 Improve keyboard and assistive-technology support

- **Priority:** P2
- **Files:** `index.html`, `compare.html`, `script.js`, `compare.js`, `style.css`, `compare.css`
- **Implementation:** Replace inline handlers with event listeners; expose autocomplete options with appropriate labels/roles and keyboard selection; maintain focus and `aria-expanded` state for menus; provide visible focus styles; remove viewport settings that prevent pinch zoom; respect reduced-motion preferences.
- **Acceptance criteria:** Search, suggestions, authentication menu, comparison, and retry actions work without a mouse; status/error updates are announced; browser zoom remains available.
- **Verification:** Perform keyboard-only checks and automated accessibility checks on both pages at desktop and mobile widths.

### 2.3 Improve PWA caching behavior

- **Priority:** P2
- **Files:** `sw.js`, `manifest.json`, `index.html`, `compare.html`
- **Implementation:** Define which pages/assets should work offline; cache only safe same-origin static resources; avoid caching personalized or API responses unintentionally; handle failed network requests and cache cleanup deliberately.
- **Acceptance criteria:** The documented offline experience matches actual behavior, and stale caches do not break deployments.
- **Verification:** Test install, update, offline navigation, and API failure in browser developer tools.

---

## Phase 3 — Maintainability and operations

### 3.1 Separate backend routes from provider/domain services

- **Priority:** P3
- **Files:** `server.js`, new server modules, `package.json`
- **Dependencies:** Route contracts and tests from Phases 1–2.
- **Implementation:** Extract provider clients and domain functions from the large server entrypoint behind explicit interfaces; keep route handlers focused on validation, calling services, and returning responses.
- **Acceptance criteria:** Provider logic can be tested without starting the listener; existing route contracts remain unchanged unless separately versioned.
- **Verification:** Run unit and route tests and perform a local smoke test of each documented endpoint.

### 3.2 Add operational readiness

- **Priority:** P3
- **Files:** `server.js`, deployment documentation, `package.json`
- **Implementation:** Add structured, redacted error logging, a health/readiness endpoint, graceful shutdown, and deployment instructions for environment configuration and provider limits.
- **Acceptance criteria:** Operators can distinguish configuration errors from provider outages without exposing secrets or user data.
- **Verification:** Check health behavior during startup and missing configuration; inspect logs for redaction under simulated errors.

### 3.3 Evaluate MCP integration separately

- **Priority:** P3
- **Files:** See [MCP_INTEGRATION.md](./MCP_INTEGRATION.md)
- **Dependencies:** Stable, testable provider/domain services from Phase 3.1.
- **Implementation:** Review the MCP proposal and only then implement a separate local stdio server with narrowly scoped read-only tools.
- **Acceptance criteria:** No MCP tool exposes credentials or arbitrary URL access; tool inputs/outputs and errors are covered by contract tests; the existing web app continues to run independently.
- **Verification:** Run MCP protocol/tool tests and a local client smoke test without weakening server-side validation.

## Completion criteria

- P0 behavior has automated regression tests and manual user-flow verification.
- Provider failures are bounded, consistently reported, and do not remove core weather functionality.
- No secrets are exposed to browser code, logs, or tool responses.
- README setup and documented routes match the actual implementation.
- Accessibility, PWA behavior, and any MCP integration have explicit acceptance checks before release.
