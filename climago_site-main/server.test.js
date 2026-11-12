const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('./server');

test('loads the project .env when started from another working directory', () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'climago-project-'));
  const launchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'climago-launch-'));
  try {
    const serverPath = path.join(projectDir, 'server.js');
    fs.copyFileSync(path.join(__dirname, 'server.js'), serverPath);
    fs.writeFileSync(path.join(projectDir, '.env'), 'GOOGLE_API_KEY=test-key\n');

    const childEnv = { ...process.env, NODE_PATH: path.join(__dirname, 'node_modules') };
    delete childEnv.GOOGLE_API_KEY;
    const output = childProcess.execFileSync(process.execPath, [
      '-e',
      `require(${JSON.stringify(serverPath)}); process.stdout.write(process.env.GOOGLE_API_KEY || '')`
    ], { cwd: launchDir, env: childEnv, encoding: 'utf8' });

    assert.equal(output, 'test-key');
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(launchDir, { recursive: true, force: true });
  }
});

async function startApp(options = {}) {
  const server = createApp(options).listen(0);
  await once(server, 'listening');
  const { port } = server.address();
  return {
    server,
    request: (requestPath, init) => fetch(`http://127.0.0.1:${port}${requestPath}`, init)
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function postJson(app, path, body) {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
}

test('createApp serves Firebase configuration without listening on import', async (t) => {
  const app = await startApp({ env: { FIREBASE_PROJECT_ID: 'test-project' } });
  t.after(() => new Promise((resolve, reject) => {
    app.server.close((err) => err ? reject(err) : resolve());
  }));

  const response = await app.request('/api/firebase-config');
  assert.equal(response.status, 200);
  assert.equal((await response.json()).projectId, 'test-project');
});

test('invalid API inputs are rejected before contacting providers', async (t) => {
  let providerCalls = 0;
  const app = await startApp({
    weatherApiKey: 'weather-test-key',
    googleApiKey: 'google-test-key',
    fetchImpl: async () => {
      providerCalls += 1;
      return jsonResponse({});
    }
  });
  t.after(() => new Promise((resolve, reject) => {
    app.server.close((err) => err ? reject(err) : resolve());
  }));

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

  for (const path of invalidPaths) {
    const response = await app.request(path);
    assert.equal(response.status, 400, `${path} should be rejected`);
    assert.equal(typeof (await response.json()).error, 'string');
  }

  const invalidPosts = [
    ['/ai', {}],
    ['/ai', { prompt: 'x'.repeat(2001) }],
    ['/api/travel-advice', { city: 'Delhi' }],
    ['/api/travel-advice', {
      city: 'Delhi', temp: '25', humidity: 45, wind: 2, condition: 'clear', airQuality: 0
    }],
    ['/api/compare-verdict', { cityA: { name: 'Delhi' }, cityB: { name: 'Mumbai' } }],
    ['/api/places', { city: 'Delhi', temp: 25, condition: 'clear' }],
    ['/api/places', {
      city: 'Delhi', lat: 28.6, lon: 77.2, temp: 25, condition: 'clear', aqi: 0, uv: ''
    }]
  ];

  for (const [path, body] of invalidPosts) {
    const response = await postJson(app, path, body);
    assert.equal(response.status, 400, `${path} should be rejected`);
    assert.equal(typeof (await response.json()).error, 'string');
  }
  assert.equal(providerCalls, 0);
});

test('weather route reports missing configuration and preserves successful provider data', async (t) => {
  const missingKeyApp = await startApp({ weatherApiKey: '' });
  t.after(() => new Promise((resolve, reject) => {
    missingKeyApp.server.close((err) => err ? reject(err) : resolve());
  }));
  const missingKeyResponse = await missingKeyApp.request('/api/weather?city=Delhi');
  assert.equal(missingKeyResponse.status, 503);
  assert.equal(typeof (await missingKeyResponse.json()).error, 'string');

  const weatherData = { name: 'Delhi', main: { temp: 28 }, weather: [{ main: 'Clouds' }] };
  const app = await startApp({
    weatherApiKey: 'weather-test-key',
    fetchImpl: async () => jsonResponse(weatherData)
  });
  t.after(() => new Promise((resolve, reject) => {
    app.server.close((err) => err ? reject(err) : resolve());
  }));
  const response = await app.request('/api/weather?city=Delhi');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), weatherData);
});

test('provider failures return safe JSON without exposing upstream details', async (t) => {
  const app = await startApp({
    weatherApiKey: 'weather-test-key',
    fetchImpl: async () => jsonResponse({ error: 'private upstream token' }, 429)
  });
  t.after(() => new Promise((resolve, reject) => {
    app.server.close((err) => err ? reject(err) : resolve());
  }));

  const response = await app.request('/api/weather?city=Delhi');
  const body = await response.text();
  assert.equal(response.status, 502);
  assert.match(response.headers.get('content-type'), /application\/json/);
  assert.doesNotMatch(body, /private upstream token|weather-test-key/);
  assert.equal(typeof JSON.parse(body).error, 'string');
});

test('non-JSON provider errors are normalized without returning their bodies', async (t) => {
  const app = await startApp({
    weatherApiKey: 'weather-test-key',
    fetchImpl: async () => new Response('private provider response', {
      status: 500,
      headers: { 'content-type': 'text/plain' }
    })
  });
  t.after(() => new Promise((resolve, reject) => {
    app.server.close((err) => err ? reject(err) : resolve());
  }));

  const response = await app.request('/api/forecast?city=Delhi');
  const body = await response.text();
  assert.equal(response.status, 502);
  assert.doesNotMatch(body, /private provider response|weather-test-key/);
});

test('provider timeout returns 504 even if fetch ignores abort', async (t) => {
  const app = await startApp({
    weatherApiKey: 'weather-test-key',
    timeoutMs: 20,
    fetchImpl: () => new Promise(() => {})
  });
  t.after(() => new Promise((resolve, reject) => {
    app.server.close((err) => err ? reject(err) : resolve());
  }));

  const startedAt = Date.now();
  const response = await app.request('/api/weather?city=Delhi');
  assert.equal(response.status, 504);
  assert.equal(typeof (await response.json()).error, 'string');
  assert.ok(Date.now() - startedAt < 1000);
});

test('malformed, oversized, and unknown API requests return JSON errors', async (t) => {
  const app = await startApp();
  t.after(() => new Promise((resolve, reject) => {
    app.server.close((err) => err ? reject(err) : resolve());
  }));

  const malformed = await app.request('/ai', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{'
  });
  assert.equal(malformed.status, 400);
  assert.equal(typeof (await malformed.json()).error, 'string');

  const oversized = await app.request('/ai', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: 'x'.repeat(1024 * 1024) })
  });
  assert.equal(oversized.status, 413);
  assert.equal(typeof (await oversized.json()).error, 'string');

  const missingRoute = await app.request('/api/not-a-route');
  assert.equal(missingRoute.status, 404);
  assert.equal(typeof (await missingRoute.json()).error, 'string');
});

test('places route preserves its response shape', async (t) => {
  const app = await startApp({
    weatherApiKey: 'weather-test-key',
    timeoutMs: 20,
    fetchImpl: async () => jsonResponse({ elements: [] })
  });
  t.after(() => new Promise((resolve, reject) => {
    app.server.close((err) => err ? reject(err) : resolve());
  }));

  const response = await postJson(app, '/api/places', {
    city: 'Delhi',
    lat: 28.6,
    lon: 77.2,
    temp: 25,
    condition: 'clear',
    aqi: 0,
    uv: 0
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.ok(Array.isArray(result.places));
  assert.ok(Array.isArray(result.gear));
});

test('Overpass timeout is surfaced instead of returning empty places', async (t) => {
  const app = await startApp({
    weatherApiKey: 'weather-test-key',
    timeoutMs: 20,
    fetchImpl: () => new Promise(() => {})
  });
  t.after(() => new Promise((resolve, reject) => {
    app.server.close((err) => err ? reject(err) : resolve());
  }));

  const response = await postJson(app, '/api/places', {
    city: 'Delhi',
    lat: 28.6,
    lon: 77.2,
    temp: 25,
    condition: 'clear',
    aqi: 0,
    uv: 0
  });
  assert.equal(response.status, 504);
  assert.equal(typeof (await response.json()).error, 'string');
});

test('malformed Overpass elements return a provider error instead of an internal error', async (t) => {
  const app = await startApp({
    weatherApiKey: 'weather-test-key',
    fetchImpl: async () => jsonResponse({ elements: [null] })
  });
  t.after(() => new Promise((resolve, reject) => {
    app.server.close((err) => err ? reject(err) : resolve());
  }));

  const response = await postJson(app, '/api/places', {
    city: 'Delhi',
    lat: 28.6,
    lon: 77.2,
    temp: 25,
    condition: 'clear',
    aqi: 0,
    uv: 0
  });
  assert.equal(response.status, 502);
  assert.equal(typeof (await response.json()).error, 'string');
});

test('Gemini requests use the timeout helper and return the existing summary shape', async (t) => {
  let providerCalls = 0;
  let providerUrl;
  const app = await startApp({
    googleApiKey: 'google-test-key',
    fetchImpl: async (url, options) => {
      providerCalls += 1;
      providerUrl = url;
      assert.match(url, /generativelanguage\.googleapis\.com/);
      assert.ok(options.signal instanceof AbortSignal);
      return jsonResponse({ candidates: [{ content: { parts: [{ text: 'A clear day.' }] } }] });
    }
  });
  t.after(() => new Promise((resolve, reject) => {
    app.server.close((err) => err ? reject(err) : resolve());
  }));

  const response = await postJson(app, '/ai', { prompt: 'Summarize weather.' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { reply: 'A clear day.' });
  assert.equal(providerCalls, 1);
  assert.match(providerUrl, /\/models\/gemini-3\.8-flash:generateContent/);
});

test('AI routes report missing configuration without contacting providers', async (t) => {
  let providerCalls = 0;
  const app = await startApp({
    googleApiKey: '',
    fetchImpl: async () => {
      providerCalls += 1;
      return jsonResponse({});
    }
  });
  t.after(() => new Promise((resolve, reject) => {
    app.server.close((err) => err ? reject(err) : resolve());
  }));

  const response = await postJson(app, '/ai', { prompt: 'Summarize weather.' });
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /AI API key/);
  assert.equal(providerCalls, 0);
});

test('AI placeholder keys are logged as unconfigured', async (t) => {
  const logs = [];
  const app = await startApp({
    googleApiKey: 'PLACEHOLDER_ADD_KEY',
    logger: {
      info: (...args) => logs.push(args),
      error: (...args) => logs.push(args)
    },
    fetchImpl: async () => {
      throw new Error('Provider must not be called for a placeholder key');
    }
  });
  t.after(() => new Promise((resolve, reject) => {
    app.server.close((err) => err ? reject(err) : resolve());
  }));

  const response = await postJson(app, '/api/travel-advice', {
    city: 'Delhi',
    temp: 25,
    humidity: 45,
    wind: 2,
    condition: 'clear sky',
    airQuality: 3
  });

  assert.equal(response.status, 503);
  assert.ok(logs.some(([, details]) => details?.apiKeyConfigured === false));
});

test('malformed Gemini success payload returns a provider error', async (t) => {
  const app = await startApp({
    googleApiKey: 'google-test-key',
    fetchImpl: async () => jsonResponse(null)
  });
  t.after(() => new Promise((resolve, reject) => {
    app.server.close((err) => err ? reject(err) : resolve());
  }));

  const response = await postJson(app, '/ai', { prompt: 'Summarize weather.' });
  assert.equal(response.status, 502);
  assert.equal(typeof (await response.json()).error, 'string');
});

test('travel-advice accepts unavailable AQI and keeps its response contract', async (t) => {
  const app = await startApp({
    googleApiKey: 'google-test-key',
    fetchImpl: async () => jsonResponse({
      candidates: [{ content: { parts: [{ text: 'WEAR: Light layers' }] } }]
    })
  });
  t.after(() => new Promise((resolve, reject) => {
    app.server.close((err) => err ? reject(err) : resolve());
  }));

  const response = await postJson(app, '/api/travel-advice', {
    city: 'Delhi',
    temp: 25,
    humidity: 45,
    wind: 2,
    condition: 'clear sky',
    airQuality: 0
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { advice: 'WEAR: Light layers' });
});

test('travel-advice sends complete weather context to Gemini', async (t) => {
  let providerUrl;
  let providerOptions;
  const app = await startApp({
    googleApiKey: 'google-test-key',
    fetchImpl: async (url, options) => {
      providerUrl = url;
      providerOptions = options;
      return jsonResponse({
        candidates: [{ content: { parts: [{ text: 'PLACES:\n1. Red Fort - Historic Mughal fort' }] } }]
      });
    }
  });
  t.after(() => new Promise((resolve, reject) => {
    app.server.close((err) => err ? reject(err) : resolve());
  }));

  const response = await postJson(app, '/api/travel-advice', {
    city: 'Delhi',
    temp: 25,
    humidity: 45,
    wind: 2,
    condition: 'clear sky',
    airQuality: 3
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    advice: 'PLACES:\n1. Red Fort - Historic Mughal fort'
  });
  assert.match(providerUrl, /\/v1beta\/models\/gemini-3\.8-flash:generateContent$/);
  assert.doesNotMatch(providerUrl, /google-test-key/);
  assert.equal(providerOptions.headers['x-goog-api-key'], 'google-test-key');

  const prompt = JSON.parse(providerOptions.body).contents[0].parts[0].text;
  for (const value of ['Delhi', '25°C', '45%', '2 m/s', 'clear sky', 'Moderate (index 3)']) {
    assert.ok(prompt.includes(value), `prompt should include ${value}`);
  }
  for (const section of ['PLACES:', 'NEARBY:', 'WEAR:', 'EAT:', 'ALERT:']) {
    assert.ok(prompt.includes(section), `prompt should request ${section}`);
  }
  assert.match(prompt, /five|5/i);
  assert.match(prompt, /two|2/i);
});

test('travel-advice maps provider failures safely and logs no sensitive data', async (t) => {
  const logs = [];
  const app = await startApp({
    googleApiKey: 'google-test-key',
    logger: {
      info: (...args) => logs.push(args),
      error: (...args) => logs.push(args)
    },
    fetchImpl: async () => jsonResponse({ error: 'private upstream detail' }, 429)
  });
  t.after(() => new Promise((resolve, reject) => {
    app.server.close((err) => err ? reject(err) : resolve());
  }));

  const response = await postJson(app, '/api/travel-advice', {
    city: 'Delhi',
    temp: 25,
    humidity: 45,
    wind: 2,
    condition: 'clear sky',
    airQuality: 3
  });

  const body = await response.text();
  assert.equal(response.status, 429);
  assert.doesNotMatch(body, /private upstream detail|google-test-key/);
  assert.match(body, /AI provider request failed/);
  const serializedLogs = JSON.stringify(logs);
  assert.match(serializedLogs, /request started/i);
  assert.match(serializedLogs, /apiKeyConfigured.{0,10}true/i);
  assert.match(serializedLogs, /429/);
  assert.doesNotMatch(serializedLogs, /private upstream detail|google-test-key|clear sky/);
});

test('travel-advice reports missing keys, rejected credentials, network failures, and timeouts', async (t) => {
  let providerCalls = 0;
  const missingKeyApp = await startApp({
    googleApiKey: '',
    fetchImpl: async () => {
      providerCalls += 1;
      return jsonResponse({});
    }
  });
  t.after(() => new Promise((resolve, reject) => {
    missingKeyApp.server.close((err) => err ? reject(err) : resolve());
  }));
  const payload = {
    city: 'Delhi',
    temp: 25,
    humidity: 45,
    wind: 2,
    condition: 'clear sky',
    airQuality: 3
  };
  const missingResponse = await postJson(missingKeyApp, '/api/travel-advice', payload);
  assert.equal(missingResponse.status, 503);
  assert.match((await missingResponse.json()).error, /AI API key is not configured/);
  assert.equal(providerCalls, 0);

  const rejectedKeyApp = await startApp({
    googleApiKey: 'google-test-key',
    fetchImpl: async () => jsonResponse({ error: 'private invalid key response' }, 403)
  });
  t.after(() => new Promise((resolve, reject) => {
    rejectedKeyApp.server.close((err) => err ? reject(err) : resolve());
  }));
  const rejectedResponse = await postJson(rejectedKeyApp, '/api/travel-advice', payload);
  const rejectedBody = await rejectedResponse.text();
  assert.equal(rejectedResponse.status, 502);
  assert.doesNotMatch(rejectedBody, /private invalid key response|google-test-key/);

  const networkApp = await startApp({
    googleApiKey: 'google-test-key',
    fetchImpl: async () => {
      throw new Error('private network detail');
    }
  });
  t.after(() => new Promise((resolve, reject) => {
    networkApp.server.close((err) => err ? reject(err) : resolve());
  }));
  const networkResponse = await postJson(networkApp, '/api/travel-advice', payload);
  const networkBody = await networkResponse.text();
  assert.equal(networkResponse.status, 502);
  assert.doesNotMatch(networkBody, /private network detail|google-test-key/);

  const timeoutApp = await startApp({
    googleApiKey: 'google-test-key',
    timeoutMs: 20,
    fetchImpl: () => new Promise(() => {})
  });
  t.after(() => new Promise((resolve, reject) => {
    timeoutApp.server.close((err) => err ? reject(err) : resolve());
  }));
  const timeoutResponse = await postJson(timeoutApp, '/api/travel-advice', payload);
  assert.equal(timeoutResponse.status, 504);
  assert.equal(typeof (await timeoutResponse.json()).error, 'string');
});

test('Gemini requests use an independent timeout from other providers', async (t) => {
  const app = await startApp({
    googleApiKey: 'google-test-key',
    timeoutMs: 20,
    aiTimeoutMs: 80,
    fetchImpl: async () => {
      await new Promise((resolve) => setTimeout(resolve, 35));
      return jsonResponse({
        candidates: [{ content: { parts: [{ text: 'A clear day.' }] } }]
      });
    }
  });
  t.after(() => new Promise((resolve, reject) => {
    app.server.close((err) => err ? reject(err) : resolve());
  }));

  const response = await postJson(app, '/ai', { prompt: 'Summarize weather.' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { reply: 'A clear day.' });
});

test('travel-advice cache distinguishes weather inputs', async (t) => {
  let providerCalls = 0;
  const app = await startApp({
    googleApiKey: 'google-test-key',
    fetchImpl: async () => {
      providerCalls += 1;
      return jsonResponse({
        candidates: [{ content: { parts: [{ text: `WEAR: Recommendation ${providerCalls}` }] } }]
      });
    }
  });
  t.after(() => new Promise((resolve, reject) => {
    app.server.close((err) => err ? reject(err) : resolve());
  }));

  const baseWeather = {
    city: 'Delhi',
    temp: 25,
    humidity: 45,
    wind: 2,
    condition: 'clear sky',
    airQuality: 3
  };
  const first = await postJson(app, '/api/travel-advice', baseWeather);
  const repeated = await postJson(app, '/api/travel-advice', { ...baseWeather, city: 'delhi' });
  const changes = [
    { city: 'Mumbai' },
    { temp: 26 },
    { humidity: 80 },
    { wind: 5 },
    { condition: 'heavy rain' },
    { airQuality: 5 }
  ];
  const changedResponses = [];
  for (const change of changes) {
    changedResponses.push(await postJson(app, '/api/travel-advice', { ...baseWeather, ...change }));
  }

  assert.deepEqual(await first.json(), { advice: 'WEAR: Recommendation 1' });
  assert.deepEqual(await repeated.json(), { advice: 'WEAR: Recommendation 1' });
  for (const [index, response] of changedResponses.entries()) {
    assert.deepEqual(await response.json(), { advice: `WEAR: Recommendation ${index + 2}` });
  }
  assert.equal(providerCalls, changes.length + 1);
});
