import test from 'node:test';
import assert from 'node:assert/strict';

import {
  escapeHtml,
  getTravelAdviceErrorMessage,
  parseTravelAdvice,
  processForecast,
  scoreWeather,
  travelAdviceCacheKey
} from './weather-utils.mjs';

test('parses all labelled travel-advice sections', () => {
  const parsed = parseTravelAdvice(`PLACES:
1. Red Fort - Historic Mughal fort
2. India Gate - War memorial and city landmark
NEARBY:
1. Qutub Minar - Medieval tower
WEAR: Light layers
EAT: Try chole bhature
ALERT: Carry water in the heat`);

  assert.deepEqual(parsed, {
    places: [
      { name: 'Red Fort', desc: 'Historic Mughal fort' },
      { name: 'India Gate', desc: 'War memorial and city landmark' }
    ],
    nearby: [{ name: 'Qutub Minar', desc: 'Medieval tower' }],
    wear: 'Light layers',
    eat: 'Try chole bhature',
    alert: 'Carry water in the heat'
  });
});

test('rejects empty or unsupported travel-advice responses', () => {
  assert.equal(parseTravelAdvice(''), null);
  assert.equal(parseTravelAdvice(' \n  '), null);
  assert.equal(parseTravelAdvice(null), null);
  assert.equal(parseTravelAdvice('A sunny day is expected.'), null);
});

test('travel-advice cache key changes with weather inputs but not city casing', () => {
  const weather = {
    name: 'Delhi',
    main: { temp: 25, humidity: 45 },
    wind: { speed: 2 },
    weather: [{ description: 'clear sky' }]
  };
  const key = travelAdviceCacheKey(weather, 3);

  assert.equal(travelAdviceCacheKey({ ...weather, name: 'delhi' }, 3), key);
  assert.notEqual(travelAdviceCacheKey({ ...weather, name: 'Mumbai' }, 3), key);
  assert.equal(travelAdviceCacheKey({ ...weather, main: { ...weather.main, temp: 25.4 } }, 3), key);
  assert.notEqual(travelAdviceCacheKey({ ...weather, main: { ...weather.main, temp: 26 } }, 3), key);
  assert.notEqual(travelAdviceCacheKey({ ...weather, main: { ...weather.main, humidity: 80 } }, 3), key);
  assert.notEqual(travelAdviceCacheKey({ ...weather, wind: { speed: 5 } }, 3), key);
  assert.notEqual(travelAdviceCacheKey({ ...weather, weather: [{ description: 'rain' }] }, 3), key);
  assert.notEqual(travelAdviceCacheKey(weather, 4), key);
});

test('explains how to configure a missing AI adviser key', () => {
  const message = getTravelAdviceErrorMessage(503, 'AI API key is not configured');
  assert.match(message, /GOOGLE_API_KEY/);
  assert.match(message, /restart/i);
});

test('gives retry guidance for quota and timeout failures', () => {
  for (const status of [429, 504]) {
    const message = getTravelAdviceErrorMessage(status, 'AI provider request failed');
    assert.match(message, /temporarily unavailable|request limit/i);
    assert.doesNotMatch(message, /provider request failed/i);
  }
});

test('gives safe key and model guidance for upstream provider failures', () => {
  const message = getTravelAdviceErrorMessage(502, 'private provider detail');
  assert.match(message, /GOOGLE_API_KEY/);
  assert.match(message, /model access/i);
  assert.doesNotMatch(message, /private provider detail/i);
});

test('gives a generic service message for other HTTP errors', () => {
  const message = getTravelAdviceErrorMessage(500, 'private upstream error');
  assert.match(message, /service encountered an error/i);
  assert.doesNotMatch(message, /private upstream error/i);
});

test('gives connection guidance for errors without an HTTP status', () => {
  const message = getTravelAdviceErrorMessage(undefined, 'fetch failed');
  assert.match(message, /connection/i);
});

test('escapeHtml escapes untrusted text', () => {
  assert.equal(
    escapeHtml('<script>alert("x") & <b>bold</b>'),
    '&lt;script&gt;alert(&quot;x&quot;) &amp; &lt;b&gt;bold&lt;/b&gt;'
  );
});

test('processForecast selects the correct local day-part for the forecast city', () => {
  const now = Math.floor(Date.now() / 1000);
  const timezone = 0;
  const currentHour = new Date(now * 1000).getUTCHours();

  const morningDt = now - (currentHour - 8) * 3600;
  const afternoonDt = now - (currentHour - 14) * 3600;
  const eveningDt = now - (currentHour - 18) * 3600;
  const nightDt = now - (currentHour - 23) * 3600;

  const forecast = {
    city: { timezone },
    list: [
      {
        dt: morningDt,
        main: { temp: 18 },
        weather: [{ description: 'clear sky', icon: '01d', main: 'Clear' }],
        pop: 0.1
      },
      {
        dt: afternoonDt,
        main: { temp: 29 },
        weather: [{ description: 'sunny', icon: '01d', main: 'Clear' }],
        pop: 0.2
      },
      {
        dt: eveningDt,
        main: { temp: 22 },
        weather: [{ description: 'cloudy', icon: '03d', main: 'Clouds' }],
        pop: 0.35
      },
      {
        dt: nightDt,
        main: { temp: 20 },
        weather: [{ description: 'night sky', icon: '01n', main: 'Clear' }],
        pop: 0.05
      }
    ]
  };

  const slots = processForecast(forecast);
  assert.equal(slots.Morning.temp, 18);
  assert.equal(slots.Afternoon.temp, 29);
  assert.equal(slots.Evening.temp, 22);
  assert.equal(slots.Night.temp, 20);
});

test('scoreWeather produces stable comfort scores', () => {
  const good = { main: { temp: 24, humidity: 45 }, weather: [{ main: 'Clear' }] };
  const harsh = { main: { temp: 38, humidity: 90 }, weather: [{ main: 'Rain' }] };

  assert.ok(scoreWeather(good) > 7);
  assert.ok(scoreWeather(harsh) < 4);
});
