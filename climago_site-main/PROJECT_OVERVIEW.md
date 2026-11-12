# Climago Project Overview

## What is Climago?

Climago is a browser-based weather and travel companion. It presents current weather for a searched or geolocated city, adds practical environmental and travel context, and lets users compare conditions in two cities. Its visual design uses a dark, glass-like interface with gold accents.

The project is a small full-stack web application: a static HTML/CSS/JavaScript frontend calls a Node.js/Express backend, which proxies requests to weather, mapping, and AI providers. The app can run without Firebase or Gemini features when those integrations are not configured, but current weather and several related features need an OpenWeather API key.

## Features

- Search by city, use browser geolocation, or select a suggested city.
- View current conditions, a rule-based comfort score, advice, air quality, UV index, and weather alerts.
- See a day-part forecast narrative, nearby attractions, and weather-based gear recommendations.
- Request an AI weather summary and AI travel advice.
- Compare two cities' weather and air quality, with an optional AI-generated verdict.
- Sign in with Google through Firebase Authentication when Firebase is configured.
- Install the main weather page as a PWA; a service worker caches selected static assets.

AI, mapping, weather, geolocation, authentication, and analytics features depend on their providers, credentials, browser permissions, or network availability. Firebase sign-in is optional; the application does not implement a user profile database.

## Architecture and data flow

```text
index.html / compare.html
        |
        +-- script.js / compare.js -- browser fetch() --> server.js (Express)
        |                                                    |
        |                                                    +--> OpenWeather APIs
        |                                                    +--> Google Gemini API
        |                                                    +--> Overpass API
        |
        +-- firebase.js -------------------------------> Firebase Web SDK
        |
        +-- sw.js (main-page static-asset caching)
```

- `index.html`, `style.css`, and `script.js` implement the main weather page.
- `compare.html`, `compare.css`, and `compare.js` implement the city comparison page.
- `firebase.js` loads the Firebase browser SDK, requests Firebase configuration from the backend, and handles Google sign-in and analytics.
- `server.js` serves the static frontend and provides the application API routes. It keeps OpenWeather and Gemini keys on the server.
- Overpass is called by the backend to find nearby attractions from OpenStreetMap data. Gear recommendations are rule-based.
- `manifest.json` describes the installable app. `sw.js` caches a subset of main-page assets and fetches API requests from the network.

The main weather flow is: search or geolocation -> `/api/weather` -> render current conditions -> request AQI, UV, and summary -> request forecast, places, and travel advice. The comparison flow requests current conditions and AQI for both cities, renders metrics, then requests an AI verdict.

## API routes

| Method and path | Purpose | Important inputs |
|---|---|---|
| `GET /api/firebase-config` | Supplies Firebase Web SDK configuration | None |
| `GET /api/weather` | Current weather | `city` or both `lat` and `lon` |
| `GET /api/forecast` | Five-day forecast used by the planner | `city` |
| `GET /api/aqi` | Air-quality data | `lat`, `lon` |
| `GET /api/search` | City autocomplete/geocoding | `q` |
| `GET /api/uv` | UV data through OpenWeather One Call | `lat`, `lon` |
| `POST /ai` | Gemini-generated weather summary | JSON `prompt` |
| `POST /api/travel-advice` | Gemini travel guide | City and weather fields |
| `POST /api/compare-verdict` | Gemini comparison verdict | `cityA` and `cityB` objects |
| `POST /api/places` | Nearby Overpass attractions and rule-based gear | City/weather fields and coordinates |
| `GET /compare` | Serves the comparison page | None |

These are routes implemented in the current `server.js`; they are not a versioned public API contract. Provider availability, upstream quotas, and credentials affect the response.

API errors return JSON in the form `{ "error": "..." }`. Invalid inputs return `400`, missing provider configuration returns `503`, AI quota limits return `429`, other upstream failures return `502`, and provider timeouts return `504`. Malformed or oversized JSON bodies return `400` or `413`; successful response shapes are unchanged.

## Run locally

### Requirements

- Node.js 18 or newer (the server uses the built-in `fetch` API).
- An OpenWeather API key for weather, forecast, geocoding, AQI, and UV requests.
- A Google Gemini API key for AI summaries, travel advice, and comparison verdicts.
- Optional Firebase project settings for Google sign-in and analytics.

### Install and start

From the project directory:

```powershell
npm install
```

Fill in the included `.env` file in the project directory:

```dotenv
OPENWEATHER_API_KEY=your_openweather_key
GOOGLE_API_KEY=your_gemini_key
PORT=3000

# Optional Firebase Web SDK settings:
FIREBASE_API_KEY=your_firebase_web_api_key
FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
FIREBASE_PROJECT_ID=your_project_id
FIREBASE_STORAGE_BUCKET=your_project.firebasestorage.app
FIREBASE_MESSAGING_SENDER_ID=your_sender_id
FIREBASE_APP_ID=your_app_id
FIREBASE_MEASUREMENT_ID=your_measurement_id
```

Then start the Express server:

```powershell
npm start
```

Open `http://localhost:3000`. `PORT` is optional and defaults to `3000`. `.env` is listed in `.gitignore`; do not commit real credentials. Firebase Web SDK settings are delivered to the browser and are public client configuration, not substitutes for server-side secrets or Firebase security rules.

## Project files

| File | Responsibility |
|---|---|
| `index.html` | Main page structure |
| `script.js` | Search, weather requests, rendering, planner, places, AI advice |
| `style.css` | Main page styles and responsive layout |
| `compare.html` | City comparison page structure |
| `compare.js` | Comparison requests, metrics, and verdict rendering |
| `compare.css` | Comparison page styles |
| `firebase.js` | Firebase initialization, authentication, and analytics |
| `server.js` | Express static hosting and external API proxy routes |
| `manifest.json`, `sw.js` | PWA metadata and service-worker asset caching |
| `package.json` | Node.js dependencies and `npm start` / `npm test` scripts |

`requirements.txt` is informational but redundant for this Node.js application; runtime dependencies are declared in `package.json`.

## Current caveats

- The service worker's precache list omits some resources used by the app, including the comparison page and Firebase module; offline support is therefore limited.
- `requirements.txt` is informational and is not used by npm.

The [improvement plan](./IMPROVEMENT_PLAN.md) describes additional potential work; it is a roadmap, not a status report.

## More documentation

- [Improvement plan](./IMPROVEMENT_PLAN.md)
- [MCP integration proposal](./MCP_INTEGRATION.md)
