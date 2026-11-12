# Climago MCP Integration Proposal

## Current status

Climago does **not** currently have an MCP server, MCP SDK dependency, or MCP client configuration. This file proposes a possible integration; it is not an implemented server or a ready-to-paste client configuration.

## What MCP would add

The Model Context Protocol (MCP) is a standard way for an AI application (the MCP host) to discover and call capabilities exposed by a separate server. In a Climago integration, an MCP client could request weather or travel context through explicit tools rather than scraping the web UI.

MCP does not provide weather data or remove the need for provider credentials. Climago's server would still call OpenWeather, Overpass, and, only for an explicitly AI-powered feature, Gemini.

## Recommended first version

Start with a separate, local **stdio** MCP server. The MCP client launches the server process and exchanges protocol messages over standard input/output. This avoids exposing a new network service for a local developer integration.

Keep the MCP server separate from the browser app and expose only narrow read-oriented tools. Reuse shared, testable provider/domain services where possible. `server.js` currently starts listening as a side effect and contains route logic, so a future implementation should extract reusable service functions before importing them from an MCP entry point; it should not start a second Express listener.

The proposed tools are:

| Tool | Purpose | Inputs | Result |
|---|---|---|---|
| `get_current_weather` | Retrieve current conditions for a city or coordinates | Exactly one of a bounded `city` string or finite `latitude` and `longitude` | City, conditions, temperature, humidity, wind, pressure, and observation metadata |
| `get_forecast` | Retrieve forecast data for a city | Bounded `city` string | Forecast periods with timestamps, temperatures, conditions, and precipitation probability |
| `compare_cities` | Compare current weather for two cities | Bounded `city_a` and `city_b` strings | Two normalized weather records and comparable metrics; no AI verdict unless a separate opt-in capability is added |
| `get_nearby_places` | Find nearby attractions for a location | Finite `latitude` and `longitude`, optional bounded radius within a server-defined maximum | A limited list of named places, categories, and distances |

Expose structured, compact results and clear descriptions. Do not expose a generic `fetch_url`, arbitrary prompt, shell, or filesystem tool. Do not add write or account-management tools in the first version.

## Data flow and configuration

```text
MCP host/client
      | stdio protocol
      v
Climago MCP server
      | validated, bounded provider requests
      +--> OpenWeather
      +--> Overpass
      +--> Gemini only if a future opt-in AI tool is approved
```

The MCP process should read its provider credentials from its own server-side environment, for example `OPENWEATHER_API_KEY`. Gemini credentials are not needed for the four proposed read-only tools. Never return credentials in tool results, error text, logs, or client configuration. Firebase browser configuration is unrelated to these server-to-server weather tools.

Each tool should validate argument types, required fields, string lengths, coordinate ranges, and any radius bounds before making an upstream request. Use upstream timeouts and request limits. Treat all provider text as untrusted data and return plain structured values rather than executable markup.

## Error behavior

Return actionable, non-sensitive errors for:

- Missing server configuration.
- Invalid tool arguments.
- Unknown cities or empty place results.
- Provider rate limits, timeouts, and upstream failures.

Do not silently substitute plausible weather values when an upstream request fails. Do not expose upstream credentials or raw responses that contain sensitive metadata. Reserve stdout for MCP protocol messages; send diagnostics to stderr.

## Implementation and verification stages

1. **Stabilize shared services:** extract provider/domain functions from `server.js`; cover them with tests independent of the Express listener.
2. **Implement MCP tool contracts:** add the MCP SDK and a separate stdio entry point; define input schemas and structured outputs for the four tools.
3. **Test boundaries:** cover valid and invalid arguments, missing credentials, provider success/failure/timeout, and confirm secrets are absent from outputs and logs.
4. **Smoke test a local client:** document launch configuration for the chosen MCP host only after its exact client and transport settings are selected.
5. **Keep the web app independent:** verify `npm start`, current web routes, and existing browser flows continue to work with MCP absent.

## Deliberate non-goals

- This proposal does not add an MCP dependency, source file, server process, or client configuration.
- No cloud-hosted or remote MCP transport is proposed for the first version.
- No write tools, Firebase authentication bridge, arbitrary API proxy, or automatic Gemini invocation is included.
- A client configuration should be written only after selecting the MCP host and confirming its current configuration format.
