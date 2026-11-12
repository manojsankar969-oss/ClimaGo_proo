# Climago Premium UI and AI Adviser Design

## Context

Climago is a static HTML/CSS/JavaScript weather application served by Express. The main dashboard and city-comparison page currently use a dark glass-and-gold theme, and the dashboard's layout is constrained to a narrow container. Both pages already provide weather and travel-planning features that must remain functional.

The AI travel adviser reports a missing API key when the server is launched with a working directory outside the project. The server previously relied on dotenv's default working-directory-relative `.env` lookup. The server now loads `.env` from its own project directory, with a regression test covering launch from another working directory.

## Goals

- Give the main weather dashboard and city-comparison page a cohesive, professional premium visual system based on the approved **Field Journal** direction.
- Improve information hierarchy, responsive layout, readability, and consistency without removing existing user-facing features.
- Make AI adviser loading and error states clear and actionable while retaining the current backend and successful response behavior.
- Preserve existing weather, search, location, comparison, sign-in, forecast, planner, curated destinations, and AI integrations.

## Approved visual direction

Use the Field Journal treatment: warm ivory surfaces, evergreen text and accents, restrained natural colors, editorial typography, subtle borders, and generous but efficient spacing. Replace the existing dark glass-and-gold visual treatment rather than layering a second theme on top of it. Keep contrast and text legibility appropriate across responsive sizes.

## Main dashboard

- Expand the narrow content layout into a responsive dashboard with clear page-level hierarchy.
- Keep the Climago identity, sign-in/profile controls, city search and suggestions, location action, and quick-city shortcuts.
- Give current conditions a prominent hero area, with key weather measurements and air-quality/alert details presented as coordinated cards.
- Present the existing daily narrative/planner, forecast, curated destinations, and AI travel adviser as visually distinct sections using a shared card and heading system.
- Keep the comparison action discoverable and usable on both desktop and mobile.
- Preserve the current data requests, rendering behavior, and interactions except for explicit improvements to adviser messaging.

## City comparison

- Apply the same palette, typography, spacing, surfaces, focus states, and responsive behavior as the main dashboard.
- Keep the two-city inputs, compare action, weather cards, statistics comparison, and AI travel verdict.
- Preserve existing comparison calculations, API contracts, and result/error behavior.
- Ensure paired city content remains easy to compare on wide screens and stacks cleanly on narrow screens.

## AI adviser behavior

- Preserve the existing adviser request endpoint, payload, response format, cache, and retry action.
- Retain a visible loading state while the request is in progress.
- Distinguish a missing server configuration from provider availability/quota failures and generic network errors using safe, user-facing guidance.
- Never display or log API key values in the browser; do not expose upstream provider response details.
- Keep retry available for recoverable failures and avoid implying that a failed request succeeded.
- The `.env` lookup fix is included as a prerequisite already implemented and tested; this UI project does not change provider choice or require a live API call.

## Responsive and accessibility requirements

- Support narrow mobile widths without horizontal scrolling or obscured controls.
- Maintain readable text and sufficient foreground/background contrast.
- Preserve semantic headings, labels, accessible names, keyboard-operable controls, and visible focus indicators.
- Honor reduced-motion preferences for decorative transitions.

## Out of scope

- Replacing weather or AI providers, changing API response contracts, or adding new backend services.
- Adding new dashboard features or removing existing ones.
- Reworking authentication, forecast calculations, weather scoring, or comparison logic.
- Testing with the user's live provider credentials or making quota-consuming provider calls.

## Validation

- Run the existing automated test suite and add focused tests for any changed adviser error handling or behavior.
- Check syntax for changed JavaScript.
- Verify the main and comparison pages at desktop and mobile viewport sizes, including search/navigation, rendering of existing sections, and adviser loading/error/retry states.
- Ensure service-worker caching does not prevent updated HTML/CSS/JavaScript from appearing after deployment.
