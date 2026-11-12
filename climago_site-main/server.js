// ─── Environment Setup ──────────────────────────────────────────────
// Load environment variables from .env file for secure API key management
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');

const DEFAULT_TIMEOUT_MS = 9000;
const DEFAULT_AI_TIMEOUT_MS = 30000;

class ValidationError extends Error {}

class ProviderError extends Error {
 constructor(status, provider) {
   super(`${provider} provider request failed`);
   this.status = status;
 }
}

function sanitizeString(value, fieldName, maxLength = 200, required = false) {
 if (value === undefined || value === null) {
   if (required) throw new ValidationError(`${fieldName} is required`);
   return '';
 }
 if (typeof value !== 'string') throw new ValidationError(`${fieldName} must be a string`);
 const text = value.trim();
 if (!text && required) throw new ValidationError(`${fieldName} is required`);
 if (!text) return '';
 if (text.length > maxLength) {
   throw new ValidationError(`${fieldName} is too long`);
  }
 return text;
}

function parseCoordinate(value, fieldName, min, max) {
 if (typeof value !== 'string' && typeof value !== 'number') {
   throw new ValidationError(`${fieldName} must be a finite number between ${min} and ${max}`);
 }
 if (typeof value === 'string' && !/^-?(?:\d+\.?\d*|\.\d+)$/.test(value.trim())) {
   throw new ValidationError(`${fieldName} must be a finite number between ${min} and ${max}`);
 }
 const num = Number(value);
 if (!Number.isFinite(num) || num < min || num > max) {
   throw new ValidationError(`${fieldName} must be a finite number between ${min} and ${max}`);
 }
 return num;
}

function parseNumber(value, fieldName, { min = -Infinity, max = Infinity, required = true } = {}) {
 if (value === undefined && !required) return null;
 if (typeof value !== 'number') {
   throw new ValidationError(`${fieldName} must be numeric`);
 }
 const number = value;
 if (!Number.isFinite(number) || number < min || number > max) {
   throw new ValidationError(`${fieldName} must be between ${min} and ${max}`);
 }
 return number;
}

function requireBody(req) {
 if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
   throw new ValidationError('JSON object body required');
 }
 return req.body;
}

function sendRouteError(res, error, provider) {
 if (error instanceof ValidationError) {
   return res.status(400).json({ error: error.message });
 }
 if (error instanceof ProviderError) {
   return res.status(error.status).json({ error: error.message });
 }
 if (error && error.status === 503) {
   return res.status(503).json({ error: error.message });
 }
 console.error(`${provider || 'API'} request failed`);
 return res.status(500).json({ error: 'Internal server error' });
}

function asyncRoute(provider, handler) {
 return async (req, res) => {
   try {
     await handler(req, res);
   } catch (error) {
     sendRouteError(res, error, provider);
   }
 };
}

function createApp(options = {}) {
  const env = options.env || process.env;
  const GOOGLE_API_KEY = options.googleApiKey ?? env.GOOGLE_API_KEY;
  const WEATHER_API_KEY = options.weatherApiKey ?? env.OPENWEATHER_API_KEY;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const logger = options.logger || console;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const aiTimeoutMs = options.aiTimeoutMs ??
    (options.timeoutMs === undefined ? DEFAULT_AI_TIMEOUT_MS : timeoutMs);
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(express.static(path.join(__dirname)));

  async function fetchJsonWithTimeout(url, requestOptions = {}, provider = 'Weather') {
    const requestTimeoutMs = provider === 'AI' ? aiTimeoutMs : timeoutMs;
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        if (provider === 'AI') {
          logger.error('AI provider request failed', { category: 'timeout' });
        }
        reject(new ProviderError(504, provider));
      }, requestTimeoutMs);
    });
    const request = (async () => {
      let response;
      try {
        response = await fetchImpl(url, { ...requestOptions, signal: controller.signal });
      } catch (error) {
        if (error && error.name === 'AbortError') {
          if (provider === 'AI') {
            logger.error('AI provider request failed', { category: 'timeout' });
          }
          throw new ProviderError(504, provider);
        }
        if (provider === 'AI') {
          logger.error('AI provider request failed', { category: 'network' });
        }
        throw new ProviderError(502, provider);
      }
      if (provider === 'AI') {
        logger.info('AI provider response status', { status: response.status });
      }
      if (!response.ok) {
        const status = provider === 'AI' && response.status === 429 ? 429 : 502;
        if (provider === 'AI') {
          logger.error('AI provider request failed', {
            category: status === 429 ? 'rate_limit' : 'provider_error',
            status: response.status
          });
        }
        throw new ProviderError(status, provider);
      }
      try {
        return await response.json();
      } catch {
        if (provider === 'AI') {
          logger.error('AI provider request failed', { category: 'invalid_json' });
        }
        throw new ProviderError(502, provider);
      }
    })();
    try {
      return await Promise.race([request, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  app.get('/api/firebase-config', (req, res) => {
    res.json({
      apiKey: env.FIREBASE_API_KEY,
      authDomain: env.FIREBASE_AUTH_DOMAIN,
      projectId: env.FIREBASE_PROJECT_ID,
      storageBucket: env.FIREBASE_STORAGE_BUCKET,
      messagingSenderId: env.FIREBASE_MESSAGING_SENDER_ID,
      appId: env.FIREBASE_APP_ID,
      measurementId: env.FIREBASE_MEASUREMENT_ID
    });
  });

  app.get('/api/weather', asyncRoute('Weather', async (req, res) => {
    const cityProvided = req.query.city !== undefined;
    const coordinatesProvided = req.query.lat !== undefined || req.query.lon !== undefined;
    if (cityProvided && coordinatesProvided) {
      throw new ValidationError('Provide a city or coordinates, not both');
    }

    let url;
    if (cityProvided) {
      const city = sanitizeString(req.query.city, 'City', 80, true);
      url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&units=metric&appid=${WEATHER_API_KEY}`;
    } else if (req.query.lat !== undefined && req.query.lon !== undefined) {
      const lat = parseCoordinate(req.query.lat, 'Latitude', -90, 90);
      const lon = parseCoordinate(req.query.lon, 'Longitude', -180, 180);
      url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=metric&appid=${WEATHER_API_KEY}`;
    } else {
      throw new ValidationError('Provide a city or both coordinates');
    }

    if (!WEATHER_API_KEY) return res.status(503).json({ error: 'Weather API key is not configured' });
    res.json(await fetchJsonWithTimeout(url, {}, 'Weather'));
  }));

  app.get('/api/forecast', asyncRoute('Weather', async (req, res) => {
    const city = sanitizeString(req.query.city, 'City', 80, true);
    if (!WEATHER_API_KEY) return res.status(503).json({ error: 'Weather API key is not configured' });
    const url = `https://api.openweathermap.org/data/2.5/forecast?q=${encodeURIComponent(city)}&units=metric&appid=${WEATHER_API_KEY}`;
    res.json(await fetchJsonWithTimeout(url, {}, 'Weather'));
  }));

  app.get('/api/aqi', asyncRoute('Weather', async (req, res) => {
    const lat = parseCoordinate(req.query.lat, 'Latitude', -90, 90);
    const lon = parseCoordinate(req.query.lon, 'Longitude', -180, 180);
    if (!WEATHER_API_KEY) return res.status(503).json({ error: 'Weather API key is not configured' });
    const url = `https://api.openweathermap.org/data/2.5/air_pollution?lat=${lat}&lon=${lon}&appid=${WEATHER_API_KEY}`;
    res.json(await fetchJsonWithTimeout(url, {}, 'Weather'));
  }));

  app.get('/api/search', asyncRoute('Weather', async (req, res) => {
    const query = sanitizeString(req.query.q, 'Query', 80, true);
    if (!WEATHER_API_KEY) return res.status(503).json({ error: 'Weather API key is not configured' });
    const url = `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(query)}&limit=5&appid=${WEATHER_API_KEY}`;
    res.json(await fetchJsonWithTimeout(url, {}, 'Weather'));
  }));

  app.get('/api/uv', asyncRoute('Weather', async (req, res) => {
    const lat = parseCoordinate(req.query.lat, 'Latitude', -90, 90);
    const lon = parseCoordinate(req.query.lon, 'Longitude', -180, 180);
    if (!WEATHER_API_KEY) return res.status(503).json({ error: 'Weather API key is not configured' });
    const url = `https://api.openweathermap.org/data/2.5/onecall?lat=${lat}&lon=${lon}&exclude=minutely,hourly,daily,alerts&units=metric&appid=${WEATHER_API_KEY}`;
    res.json(await fetchJsonWithTimeout(url, {}, 'Weather'));
  }));

  // ─── Overpass API Helper (Tourism Data) ──────────────────────────────
  // Fetches nearby tourist attractions (museums, parks, castles) using OpenStreetMap data via Overpass API
  async function fetchAttributes(lat, lon) {
    // Query looks for nodes/ways tagged with tourism, historic, or leisure within 10km
    const query = `
      [out:json][timeout:25];
      (
        node["tourism"~"attraction|museum|viewpoint|gallery|theme_park|zoo"](around:10000,${lat},${lon});
        way["tourism"~"attraction|museum|viewpoint|gallery|theme_park|zoo"](around:10000,${lat},${lon});
        node["historic"~"monument|castle|ruins"](around:10000,${lat},${lon});
        way["historic"~"monument|castle|ruins"](around:10000,${lat},${lon});
        node["leisure"="park"](around:10000,${lat},${lon});
      );
      out center 15;
      `;

    const data = await fetchJsonWithTimeout('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: query
    }, 'Places');
    if (!data || !Array.isArray(data.elements)) throw new ProviderError(502, 'Places');
    if (data.elements.some(el => !el || typeof el !== 'object' || Array.isArray(el))) {
      throw new ProviderError(502, 'Places');
    }

    return data.elements.map(el => {
      const t = el.tags && typeof el.tags === 'object' ? el.tags : {};
      const name = (typeof t.name === 'string' && t.name) ||
        (typeof t.description === 'string' && t.description) ||
        'Unknown Landmark';
      const typeRaw = [t.tourism, t.historic, t.leisure].find(value => typeof value === 'string') || 'attraction';

      let type = 'outdoor';
      if (typeRaw.includes('museum') || typeRaw.includes('gallery') || typeRaw.includes('theatre')) type = 'indoor';

      const pLat = el.lat ?? (el.center && el.center.lat);
      const pLon = el.lon ?? (el.center && el.center.lon);

      let dist = 0;
      if (Number.isFinite(pLat) && Number.isFinite(pLon)) {
        dist = getDistanceFromLatLonInKm(lat, lon, pLat, pLon);
      }

      return {
        name: name,
        type: type,
        desc: capitalize(typeRaw.replace(/_/g, ' ')),
        dist: dist ? dist.toFixed(1) : null
      };
    }).filter(p => p.name !== 'Unknown Landmark').slice(0, 6);
  }

  // ─── Helper: Haversine Distance Calculation ──────────────────────────
  function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
    const R = 6371; // Radius of the earth in km
    const dLat = deg2rad(lat2 - lat1);
    const dLon = deg2rad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2)
      ;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const d = R * c; // Distance in km
    return d;
  }

  function deg2rad(deg) {
    return deg * (Math.PI / 180)
  }

  function capitalize(s) {
    if (!s) return '';
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // ─── AI Integration (Gemini 3.8 Flash) ───────────────────────────────

  // Helper to call Google Gemini API
  async function callGemini(prompt) {
    const apiKeyConfigured = Boolean(GOOGLE_API_KEY && !GOOGLE_API_KEY.startsWith('PLACEHOLDER'));
    logger.info('AI provider request started', {
      apiKeyConfigured
    });
    if (!apiKeyConfigured) {
      logger.error('AI provider request failed', { category: 'missing_configuration' });
      const error = new Error('AI API key is not configured');
      error.status = 503;
      throw error;
    }

    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent';
    const data = await fetchJsonWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': GOOGLE_API_KEY
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    }, 'AI');

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== 'string' || !text.trim()) {
      logger.error('AI provider request failed', { category: 'empty_response' });
      throw new ProviderError(502, 'AI');
    }
    logger.info('AI provider response generated');
    return text;
  }

  app.post('/ai', asyncRoute('AI', async (req, res) => {
    const prompt = sanitizeString(req.body && req.body.prompt, 'Prompt', 2000, true);
    res.json({ reply: await callGemini(prompt) });
  }));

  // ─── AI Response Cache (In-Memory) ───────────────────────────────────
  // Caches AI responses for 15 minutes to save API quota and speed up repeated requests
  const aiCache = new Map();
  const CACHE_TTL = 15 * 60 * 1000; // 15 minutes in milliseconds

  function getCached(key) {
    const entry = aiCache.get(key);
    if (!entry) return null;
    // Expire cache if older than TTL
    if (Date.now() - entry.ts > CACHE_TTL) {
      aiCache.delete(key);
      return null;
    }
    return entry.data;
  }

  function setCache(key, data) {
    aiCache.set(key, { data, ts: Date.now() });
  }

  // ─── AI Travel Advisor Endpoint ──────────────────────────────────────
  // Generates a structured travel guide based on current weather
  app.post('/api/travel-advice', asyncRoute('AI', async (req, res) => {
    const payload = requireBody(req);
    const city = sanitizeString(payload.city, 'City', 80, true);
    const condition = sanitizeString(payload.condition, 'Condition', 120, true);
    const temp = parseNumber(payload.temp, 'Temperature');
    const humidity = parseNumber(payload.humidity, 'Humidity', { min: 0, max: 100 });
    const wind = parseNumber(payload.wind, 'Wind speed', { min: 0 });
    const airQuality = parseNumber(payload.airQuality, 'Air quality', { min: 0, max: 5 });

    const cacheKey = JSON.stringify([
      'travel',
      city.toLowerCase(),
      temp,
      humidity,
      wind,
      condition.toLowerCase(),
      airQuality
    ]);
    const cached = getCached(cacheKey);
    if (cached) return res.json({ advice: cached });

    const aqiMap = { 1: 'Good', 2: 'Fair', 3: 'Moderate', 4: 'Poor', 5: 'Very Poor' };
    const aqiLabel = aqiMap[airQuality] || 'Unknown';

    const prompt = `Create a concise, accurate travel guide for ${city} using these current conditions:
Temperature: ${temp}°C
Humidity: ${humidity}%
Wind speed: ${wind} m/s
Weather conditions: ${condition}
Air Quality Index: ${airQuality === 0 ? 'Unavailable' : `${aqiLabel} (index ${airQuality})`}

Use exactly these plain-text sections and formats:
PLACES:
1. [Must-visit attraction] - [Short reason to visit]
2. [Must-visit attraction] - [Short reason to visit]
3. [Must-visit attraction] - [Short reason to visit]
4. [Must-visit attraction] - [Short reason to visit]
5. [Must-visit attraction] - [Short reason to visit]
NEARBY:
1. [Nearby destination] - [Distance and short description]
2. [Nearby destination] - [Distance and short description]
WEAR: [Clothing recommendation based on temperature, humidity, wind, and conditions]
EAT: [A local dish and where to try it]
ALERT: [A practical weather or air-quality precaution, or None]

Keep descriptions brief, use numbered lists for PLACES and NEARBY, and do not use markdown or asterisks.`;

    const text = await callGemini(prompt);
    setCache(cacheKey, text);
    res.json({ advice: text });
  }));

  // ─── AI Compare Verdict Endpoint ─────────────────────────────────────
  // Compares two cities and renders a verdict
  app.post('/api/compare-verdict', asyncRoute('AI', async (req, res) => {
    const payload = requireBody(req);
    const cityA = payload.cityA;
    const cityB = payload.cityB;
    if (!cityA || typeof cityA !== 'object' || Array.isArray(cityA) ||
        !cityB || typeof cityB !== 'object' || Array.isArray(cityB)) {
      throw new ValidationError('Both city objects are required');
    }

    function validateCity(city, label) {
      return {
        name: sanitizeString(city.name, `${label} name`, 80, true),
        temp: parseNumber(city.temp, `${label} temperature`),
        humidity: parseNumber(city.humidity, `${label} humidity`, { min: 0, max: 100 }),
        wind: parseNumber(city.wind, `${label} wind speed`, { min: 0 }),
        condition: sanitizeString(city.condition, `${label} condition`, 120, true),
        aqi: parseNumber(city.aqi, `${label} air quality`, { min: 0, max: 5 })
      };
    }

    const safeCityA = validateCity(cityA, 'City A');
    const safeCityB = validateCity(cityB, 'City B');
    const cityAName = safeCityA.name;
    const cityBName = safeCityB.name;

    const cacheKey = `compare_${cityAName.toLowerCase()}_${cityBName.toLowerCase()}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json({ verdict: cached });

    const aqiMap = { 1: 'Good', 2: 'Fair', 3: 'Moderate', 4: 'Poor', 5: 'Very Poor' };

    const prompt = `You are a travel decision assistant. Compare the following two cities based on weather, comfort, air quality, and travel suitability. Then clearly recommend which city is better to visit today and why.

  City A: ${cityAName}
  - Temperature: ${safeCityA.temp}°C, Humidity: ${safeCityA.humidity}%, Wind: ${safeCityA.wind} m/s
  - Condition: ${safeCityA.condition}
  - Air Quality: ${aqiMap[safeCityA.aqi] || 'Unknown'} (Index: ${safeCityA.aqi || 'N/A'})

  City B: ${cityBName}
  - Temperature: ${safeCityB.temp}°C, Humidity: ${safeCityB.humidity}%, Wind: ${safeCityB.wind} m/s
  - Condition: ${safeCityB.condition}
  - Air Quality: ${aqiMap[safeCityB.aqi] || 'Unknown'} (Index: ${safeCityB.aqi || 'N/A'})

  Provide:
  1. Short comparison summary (2-3 sentences)
  2. Winner city for travel today
  3. One-line reason why

  Format your response as:
  COMPARISON: [your comparison summary]
  WINNER: [city name]
  REASON: [one-line reason]`;

    const text = await callGemini(prompt);
    setCache(cacheKey, text);
    res.json({ verdict: text });
  }));

  // ─── Curated Places & Essentials Endpoint ────────────────────────────
  // Combines Overpass API data (attractions) with rule-based gear recommendations
  app.post('/api/places', asyncRoute('Places', async (req, res) => {
    const payload = requireBody(req);
    const city = sanitizeString(payload.city, 'City', 80);
    const condition = sanitizeString(payload.condition, 'Condition', 120, true);
    const lat = parseCoordinate(payload.lat, 'Latitude', -90, 90);
    const lon = parseCoordinate(payload.lon, 'Longitude', -180, 180);
    const temp = parseNumber(payload.temp, 'Temperature');
    const uv = parseNumber(payload.uv, 'UV index', { min: 0, required: false }) ?? 0;
    parseNumber(payload.aqi, 'Air quality', { min: 0, max: 5, required: false });
    if (!city) throw new ValidationError('City is required');

    const places = await fetchAttributes(lat, lon);

    const gear = [];

    if (Number.isFinite(uv) && uv > 5) {
      gear.push({ item: 'Sunscreen', reason: 'High UV index' });
      gear.push({ item: 'Hat/Sunglasses', reason: 'Sun protection' });
    }

    const cond = condition.toLowerCase();
    if (cond.includes('rain') || cond.includes('drizzle') || cond.includes('thunder')) {
      gear.push({ item: 'Umbrella', reason: 'Rain expected' });
    }
    if (cond.includes('snow')) {
      gear.push({ item: 'Boots', reason: 'Snowy conditions' });
    }

    if (Number.isFinite(temp) && temp < 15) gear.push({ item: 'Coat/Jacket', reason: 'Chilly temperatures' });
    else if (Number.isFinite(temp) && temp > 30) gear.push({ item: 'Water Bottle', reason: 'Stay hydrated in heat' });

    if (gear.length === 0) gear.push({ item: 'Comfortable Shoes', reason: 'Good for walking' });

    res.json({ places, gear });
  }));

  // ─── Compare Page Route ──────────────────────────────────────────────
  // Serves the dedicated comparison HTML page
  app.get('/compare', (req, res) => {
    res.sendFile(path.join(__dirname, 'compare.html'));
  });

  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'API endpoint not found' });
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error && error.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Request body must be valid JSON' });
    }
    if (error && error.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Request body is too large' });
    }
    console.error('Request processing failed');
    return res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

const app = createApp();
const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`Climago server running on http://localhost:${PORT}`));
}

module.exports = { app, createApp };
