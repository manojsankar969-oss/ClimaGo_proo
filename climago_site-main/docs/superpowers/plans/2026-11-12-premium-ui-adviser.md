# Climago Premium UI and AI Adviser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the main weather dashboard and city-comparison page in the approved Field Journal visual direction, and make AI adviser errors understandable and actionable.

**Architecture:** Keep the existing static HTML/CSS/ES-module frontend, Express API, data fetching, and successful response contracts. Establish a shared evergreen-and-ivory design system in `style.css`, reuse it on `compare.html` through `compare.css`, retain existing DOM IDs and API/data flow, and extract the adviser error-message mapping into a small tested utility.

**Tech Stack:** HTML, CSS, browser JavaScript ES modules, Node.js built-in test runner, Express, service worker, integrated browser.

---

## File map

- `weather-utils.mjs`: Add a pure helper that maps safe API/network failure details to user-facing AI adviser guidance.
- `weather-utils.test.mjs`: Test the adviser error mapping with missing configuration, provider failure, and network failure inputs.
- `script.js`: Import the tested adviser helper, preserve the current request/cache/retry behavior, and render accessible branded loading/error/success states.
- `index.html`: Preserve existing IDs and content sections while polishing page metadata, viewport behavior, and dashboard navigation semantics.
- `style.css`: Replace the dark glass-and-gold tokens and component surfaces with the approved Field Journal theme; define shared responsive and focus styles.
- `compare.html`: Preserve comparison controls and result IDs while aligning metadata and accessible layout with the dashboard.
- `compare.css`: Restyle the comparison form, weather cards, metric comparisons, and verdict using the shared theme.
- `compare.js`: Change only render-state classes/semantics needed to align comparison and AI verdict presentation; preserve comparison logic and API contracts.
- `sw.js`: Bump the cache version and precache the redesigned pages and their local module/style dependencies so clients do not remain on old assets.

## Task 1: Make AI adviser failures actionable

**Files:**
- Modify: `weather-utils.mjs`
- Modify: `weather-utils.test.mjs`
- Modify: `script.js`

- [ ] **Step 1: Add failing tests for the safe error-message mapping**

Add these cases to `weather-utils.test.mjs`, importing `getTravelAdviceErrorMessage` from `./weather-utils.mjs`:

```js
test('explains how to configure a missing AI adviser key', () => {
  const message = getTravelAdviceErrorMessage(503, 'AI API key is not configured');
  assert.match(message, /GOOGLE_API_KEY/);
  assert.match(message, /restart/i);
});

test('gives retry guidance for provider failures without exposing upstream details', () => {
  for (const status of [429, 502, 504]) {
    const message = getTravelAdviceErrorMessage(status, 'AI provider request failed');
    assert.match(message, /temporarily unavailable|request limit/i);
    assert.doesNotMatch(message, /provider request failed/i);
  }
});

test('gives connection guidance for errors without an HTTP status', () => {
  const message = getTravelAdviceErrorMessage(undefined, 'fetch failed');
  assert.match(message, /connection/i);
});
```

- [ ] **Step 2: Run the focused utility test and confirm it fails**

Run: `node --test weather-utils.test.mjs`
Expected: FAIL because `getTravelAdviceErrorMessage` is not exported yet.

- [ ] **Step 3: Implement the pure mapping helper**

Add to `weather-utils.mjs`:

```js
export function getTravelAdviceErrorMessage(status, errorMessage = '') {
  if (status === 503 && /AI API key is not configured/i.test(errorMessage)) {
    return 'AI travel advice is not configured. Add GOOGLE_API_KEY to the project .env file and restart the server.';
  }
  if ([429, 502, 504].includes(status)) {
    return 'The AI travel service is temporarily unavailable or has reached a request limit. Please try again later.';
  }
  if (Number.isInteger(status)) {
    return 'The AI travel service encountered an error. Please try again shortly.';
  }
  return 'Could not connect to the AI travel service. Check your connection and try again.';
}
```

- [ ] **Step 4: Run the focused utility test and confirm it passes**

Run: `node --test weather-utils.test.mjs`
Expected: All utility tests pass.

- [ ] **Step 5: Connect the mapping to the adviser request and error UI**

In `script.js`, import `getTravelAdviceErrorMessage` from `./weather-utils.mjs`. When a parsed response has no `advice`, attach `res.status` to the thrown `Error`. In the catch block, display `getTravelAdviceErrorMessage(e.status, e.message)` in the adviser error card, add `role="alert"` to the error container, and retain the existing retry button behavior. Do not include raw provider response text in the UI.

- [ ] **Step 6: Run the full test suite and syntax check**

Run: `npm test`
Expected: All tests pass, including the new error mapping tests.

Run: `node --check script.js`
Expected: Exit code 0.

## Task 2: Establish the shared Field Journal design system

**Files:**
- Modify: `style.css`
- Modify: `index.html`
- Modify: `compare.html`

- [ ] **Step 1: Set the shared palette and typography tokens**

Replace the existing dark palette in `style.css` with a single light Field Journal palette and shared tokens. Use these initial values:

```css
:root {
    color-scheme: light;
    --bg-color: #f3efe6;
    --card-bg: #fbf9f4;
    --card-border: #e4dfd4;
    --text-primary: #173c32;
    --text-secondary: #65756b;
    --accent: #52775b;
    --accent-hover: #3f624a;
    --danger: #a64e43;
    --success: #477354;
    --font-heading: 'Playfair Display', Georgia, serif;
    --font-body: 'Inter', Arial, sans-serif;
    --transition: cubic-bezier(0.2, 0.7, 0.2, 1);
}
```

Replace dark/transparent glass surfaces, text, borders, hover states, focus rings, badges, bars, and floating controls in `style.css` with opaque ivory/white surfaces and natural green accents. Remove obsolete glass blur and dark-only color declarations rather than leaving competing theme rules.

- [ ] **Step 2: Improve shared page metadata and viewport behavior**

In both `index.html` and `compare.html`, change the viewport meta tag to:

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
```

Set the theme color to the Field Journal page background (`#f3efe6`). Keep existing stylesheet/module links and DOM IDs. In `index.html`, make the header layout accommodate a visible, keyboard-operable comparison link without removing the existing floating compare control.

- [ ] **Step 3: Add shared responsive, focus, and reduced-motion rules**

Update the existing breakpoints in `style.css` so the header, search row, weather display, cards, planner, and destinations adapt to mobile without horizontal overflow. Add visible `:focus-visible` styles for links, buttons, and inputs, and disable nonessential animations under `prefers-reduced-motion: reduce`.

- [ ] **Step 4: Review the shared styles at desktop and mobile widths**

Run the app locally and inspect the main and comparison page shells at wide desktop and 375px mobile widths. Expected: ivory background and evergreen typography on both pages, usable controls, readable labels, no horizontal overflow, and visible keyboard focus.

## Task 3: Refine the main dashboard hierarchy and rendered content

**Files:**
- Modify: `index.html`
- Modify: `script.js`
- Modify: `style.css`

- [ ] **Step 1: Preserve all existing dashboard mount points**

Keep the IDs used by `script.js`: `cityInput`, `suggestions`, `locateBtn`, `result`, `quality`, `advice`, `aqi`, `alerts`, `summary`, `planner`, `places`, `advisorSection`, and `travelAdvisor`, as well as their current sections and loading flow. Do not duplicate these IDs.

- [ ] **Step 2: Reshape the primary weather card into an editorial hero**

Update `renderWeather` in `script.js` so the rendered card groups city/country and condition text together, gives the temperature and icon a clear visual focal point, and presents feels-like, humidity, wind, and pressure values as consistent metric tiles. Use semantic headings and retain `escapeHtml` for API-provided city/country/description values.

- [ ] **Step 3: Align the supplementary dashboard cards**

Update the rules for `.grid-layout`, `.grid-item`, `.card-glass`, `.section-label`, `.summary-section`, `.planner-section`, `.planner-grid`, `.places-grid`, and `.advisor-section` in `style.css` so existing quality, advice, air-quality, UV, alert, summary, planner, places, and adviser output use the same visual system. Preserve their current data and section visibility behavior.

Replace hard-coded cyan/yellow/orange AQI and UV colors in `renderExtras` in `script.js` with named theme classes or CSS custom properties, retaining distinct safe/notice/danger semantics without relying on color alone.

- [ ] **Step 4: Check the dashboard render at desktop and mobile sizes**

Search a city using mocked local API responses or an existing safe local fixture; do not make a live Gemini request. Expected: the current-weather hero and all available supplementary sections render, the comparison link remains discoverable, and content fits a 375px viewport without horizontal scrolling.

## Task 4: Restyle city comparison without changing comparison behavior

**Files:**
- Modify: `compare.css`
- Modify: `compare.js`
- Modify: `compare.html`

- [ ] **Step 1: Apply shared Field Journal surfaces and controls**

Restyle `.back-link`, `.compare-search-section`, `.compare-input-group`, `.compare-vs`, `.compare-action-btn`, `.compare-error`, `.compare-weather-card`, `.compare-details-grid`, `.stats-card`, `.stat-bar`, `.stats-legend`, `.verdict-section`, `.verdict-card`, and winner details in `compare.css` using the shared variables from `style.css`. Remove purple, cyan, dark-glass, and gold literals from comparison-only styling.

- [ ] **Step 2: Keep comparison outputs semantic and accessible**

In `compare.js`, retain `runComparison`, API calls, score calculation, and the existing IDs. Ensure generated city cards and comparison rows use semantic heading/label structure, visible state labels where color currently carries meaning, and the shared card classes. Replace inline cyan/yellow/red/purple colors used for scores, AQI, and winner bars with theme classes or CSS custom properties. Keep escaped API-provided strings escaped.

- [ ] **Step 3: Align the compare page content and mobile arrangement**

Update `compare.html` only as needed to group the page title, city inputs, results, and AI verdict coherently. Preserve `cityA`, `cityB`, `compareBtn`, `compareError`, `compareResults`, `cardA`, `cardB`, `statsComparison`, and `verdictContent`. Ensure the city cards stack on narrow viewports while their labels still clearly identify each city.

- [ ] **Step 4: Verify comparison behavior and presentation**

With mocked weather/AQI/verdict responses, compare two cities at desktop and 375px widths. Expected: both city cards, comparative metrics, and AI verdict remain available; blank-city and API errors remain visible; the compare button returns to its enabled state; no horizontal overflow occurs.

## Task 5: Refresh cached assets and run final verification

**Files:**
- Modify: `sw.js`
- Verify: `server.test.js`, `weather-utils.test.mjs`, `index.html`, `compare.html`, `style.css`, `compare.css`, `script.js`, `compare.js`

- [ ] **Step 1: Invalidate the previous service-worker cache**

Change `CACHE_NAME` from `climego-v2` to `climego-v3`. Include both HTML pages, both CSS files, both page scripts, `weather-utils.mjs`, `firebase.js`, the manifest, and existing icons in `urlsToCache`. Keep API requests network-only and keep the existing asset stale-while-revalidate strategy.

- [ ] **Step 2: Run all automated tests and JavaScript syntax checks**

Run: `npm test`
Expected: All server and utility tests pass.

Run: `node --check server.js; node --check script.js; node --check compare.js; node --check weather-utils.mjs`
Expected: Each command exits with code 0.

- [ ] **Step 3: Verify browser states and the service-worker refresh**

Use the integrated browser at `http://localhost:3000/` and `http://localhost:3000/compare` with local/mocked API responses. Verify the initial empty states, a successful weather render, the missing-key adviser message, provider/network adviser errors, retry, and successful advice rendering. Check wide desktop and 375px mobile widths, keyboard focus, and reduced-motion behavior. Confirm activation of `climego-v3` removes `climego-v2` and the refreshed pages load the new CSS/JavaScript.

Expected: all original features remain usable, the approved palette and hierarchy are consistent on both pages, adviser failures communicate the next action without exposing provider details, and no console errors or horizontal overflow appear.

## Plan self-review

- Spec coverage: Task 1 covers safe adviser configuration/provider/network messaging and retry; Tasks 2-4 cover the approved shared style, dashboard, comparison page, responsive behavior, accessibility, and preserved API/data behavior; Task 5 covers cached asset refresh and full validation.
- Scope: one cohesive frontend redesign plus the related adviser error presentation; no provider replacement, new backend service, or comparison logic rewrite.
- Repository constraint: this workspace is not a Git repository, so this plan intentionally contains no worktree or commit commands.
