import { initFirebase, signInWithGoogle, signOutUser, onAuthChanged, trackSearch, trackCompare } from './firebase.js';
import {
    processForecast,
    scoreWeather,
    escapeHtml,
    getTravelAdviceErrorMessage,
    parseTravelAdvice,
    travelAdviceCacheKey
} from './weather-utils.mjs';

// ─── State Management ────────────────────────────────────────────────
// Holds the current application state to persist data across re-renders
const state = {
    currentCity: '',     // Name of the currently displayed city
    weatherData: null,   // Raw weather data object from OpenWeather API
    units: 'metric',     // 'metric' for Celsius, 'imperial' for Fahrenheit (default: metric)
    user: null,          // Current logged-in user object (null if guest)
    lastAdviceData: null,
    lastAdviceAqi: 0
};

// ─── Service Worker Registration ─────────────────────────────────────
// Registers a service worker to enable PWA features like offline capability and caching
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => { }) // Registration successful
            .catch(err => console.log('SW failed', err));
    });
}

// ─── UI References ───────────────────────────────────────────────────
// Cache DOM elements to avoid repeated queries and improve performance
const ui = {
    cityInput: document.getElementById('cityInput'),
    suggestions: document.getElementById('suggestions'),
    locateBtn: document.getElementById('locateBtn'),
    result: document.getElementById('result'),
    quality: document.getElementById('quality'),
    advice: document.getElementById('advice'),
    aqi: document.getElementById('aqi'),
    alerts: document.getElementById('alerts'),
    summary: document.getElementById('summary'),
    places: document.getElementById('places'),
    planner: document.getElementById('planner'),
    mainDivider: document.getElementById('mainDivider'),
    placesDivider: document.getElementById('placesDivider'),
    plannerSection: document.getElementById('plannerSection'),
    placesSection: document.getElementById('placesSection'),
    advisorSection: document.getElementById('advisorSection'),
    advisorDivider: document.getElementById('advisorDivider'),
    travelAdvisor: document.getElementById('travelAdvisor'),
};

// ─── Event Listeners ─────────────────────────────────────────────────
// Initialize app logic once the DOM is fully loaded
document.addEventListener('DOMContentLoaded', async () => {
    // Initialize Firebase Services (Auth, Analytics)
    await initFirebase();
    setupAuth();
    bindQuickCityButtons();

    // Search Input & Autosuggest Logic
    let debounceTimer; // Timer to prevent excessive API calls while typing
    if (ui.cityInput) {
        ui.cityInput.addEventListener('input', (e) => {
            const val = e.target.value.trim();
            clearTimeout(debounceTimer);

            // Hide suggestions if input is too short
            if (val.length < 3) {
                if (ui.suggestions) ui.suggestions.classList.add('hidden');
                return;
            }

            // Fetch suggestions after 300ms pause in typing
            debounceTimer = setTimeout(() => fetchSuggestions(val), 300);
        });

        // Trigger search on 'Enter' key press
        ui.cityInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                if (ui.suggestions) ui.suggestions.classList.add('hidden');
                getWeather(ui.cityInput.value);
            }
        });
    }

    // Global Click Listener: Closes dropdowns when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.search-wrapper') && ui.suggestions) {
            ui.suggestions.classList.add('hidden');
        }
        // Close user dropdown when clicking outside
        if (!e.target.closest('.user-profile')) {
            const dropdown = document.getElementById('userDropdown');
            if (dropdown) dropdown.classList.add('hidden');
        }
    });

    // Geolocation: Auto-detect user's location
    if (ui.locateBtn) {
        ui.locateBtn.addEventListener('click', () => {
            if (navigator.geolocation) {
                setLoading(true);
                navigator.geolocation.getCurrentPosition(
                    (pos) => getWeatherByCoords(pos.coords.latitude, pos.coords.longitude),
                    (err) => {
                        setLoading(false);
                        showError("Location access denied.");
                    }
                );
            } else {
                showError("Geolocation not supported.");
            }
        });
    }
});

// ─── Authentication Setup ────────────────────────────────────────────
// Handles Google Sign-In, Sign-Out, and displaying user profile
function setupAuth() {
    const signInBtn = document.getElementById('signInBtn');
    const signOutBtn = document.getElementById('signOutBtn');
    const avatarBtn = document.getElementById('avatarBtn');

    if (signInBtn) {
        signInBtn.addEventListener('click', async () => {
            signInBtn.disabled = true;
            signInBtn.querySelector('span').textContent = 'Signing in...';
            try {
                await signInWithGoogle();
            } catch (e) {
                console.error('Sign-in failed:', e);
            } finally {
                signInBtn.disabled = false;
                signInBtn.querySelector('span').textContent = 'Sign In';
            }
        });
    }

    if (signOutBtn) {
        signOutBtn.addEventListener('click', async () => {
            await signOutUser();
            const dropdown = document.getElementById('userDropdown');
            if (dropdown) dropdown.classList.add('hidden');
        });
    }

    if (avatarBtn) {
        avatarBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const dropdown = document.getElementById('userDropdown');
            if (dropdown) dropdown.classList.toggle('hidden');
        });
    }

    // Listen for auth state changes from Firebase
    onAuthChanged((user) => {
        state.user = user;
        updateAuthUI(user);
    });
}

// Update UI based on auth state (Show Avatar vs Sign In Button)
function updateAuthUI(user) {
    const signInBtn = document.getElementById('signInBtn');
    const userProfile = document.getElementById('userProfile');
    const userAvatar = document.getElementById('userAvatar');
    const userName = document.getElementById('userName');
    const userEmail = document.getElementById('userEmail');

    if (user) {
        // User is Signed In
        if (signInBtn) signInBtn.classList.add('hidden');
        if (userProfile) userProfile.classList.remove('hidden');
        if (userAvatar) userAvatar.src = user.photoURL || '';
        if (userName) userName.textContent = user.displayName || 'User';
        if (userEmail) userEmail.textContent = user.email || '';
    } else {
        // User is Signed Out
        if (signInBtn) signInBtn.classList.remove('hidden');
        if (userProfile) userProfile.classList.add('hidden');
    }
}

// ─── Autosuggest Logic ───────────────────────────────────────────────
// Fetches city predictions from the backend as the user types
async function fetchSuggestions(query) {
    try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        const data = await res.json();

        if (data && data.length > 0) {
            renderSuggestions(data);
        } else {
            ui.suggestions.classList.add('hidden');
        }
    } catch (e) {
        console.error(e);
    }
}

// Renders the list of city suggestions
function renderSuggestions(list) {
    if (!ui.suggestions) return;
    const html = list.map(item => {
        const name = String(item.name ?? '');
        const meta = `${item.state ? item.state + ', ' : ''}${item.country ?? ''}`;
        return `
            <button type="button" class="suggestion-item" data-city="${escapeHtml(name)}" data-lat="${Number(item.lat)}" data-lon="${Number(item.lon)}">
                <span>${escapeHtml(name)}</span>
                <span class="country-code">${escapeHtml(meta)}</span>
            </button>
        `;
    }).join('');

    ui.suggestions.innerHTML = html;
    ui.suggestions.querySelectorAll('.suggestion-item').forEach((btn) => {
        btn.addEventListener('click', () => {
            const name = btn.dataset.city || '';
            const lat = Number(btn.dataset.lat);
            const lon = Number(btn.dataset.lon);
            if (name && Number.isFinite(lat) && Number.isFinite(lon)) {
                selectCity(name, lat, lon);
            }
        });
    });
    ui.suggestions.classList.remove('hidden');
}

function bindQuickCityButtons() {
    document.querySelectorAll('.city-pill').forEach((button) => {
        const city = button.dataset.city || button.textContent.trim();
        button.addEventListener('click', () => handleQuickSearch(city));
    });
}

function handleQuickSearch(city) {
    const cityName = String(city || '').trim();
    if (!cityName) return;
    if (ui.cityInput) ui.cityInput.value = cityName;
    getWeather(cityName);
}

// Handles city selection from the dropdown
function selectCity(name, lat, lon) {
    if (ui.cityInput) ui.cityInput.value = name;
    if (ui.suggestions) ui.suggestions.classList.add('hidden');
    getWeatherByCoords(lat, lon); // Fetch weather for selected coordinates
}

// ─── Weather Data Fetching ───────────────────────────────────────────

// Fetches weather by City Name
async function getWeather(cityName) {
    if (!cityName) return;
    setLoading(true);
    resetUI();
    trackSearch(cityName); // Analytics Event
    try {
        const data = await fetchAPI(`/api/weather?city=${encodeURIComponent(cityName)}`);
        await processWeatherData(data);
    } catch (err) {
        showError(err.message || "Unable to fetch weather data.");
        setLoading(false);
    }
}

// Fetches weather by Geographic Coordinates (Lat/Lon)
async function getWeatherByCoords(lat, lon) {
    setLoading(true);
    resetUI();
    try {
        const data = await fetchAPI(`/api/weather?lat=${lat}&lon=${lon}`);
        await processWeatherData(data);
    } catch (err) {
        showError(err.message || "Unable to fetch weather data.");
        setLoading(false);
    }
}

// Orchestrator: Processes raw weather data and triggers secondary fetches
async function processWeatherData(data) {
    state.weatherData = data;
    state.currentCity = data.name;

    renderWeather(data); // Render Main Weather Card

    try {
        // Parallel data fetching for performance
        // Fetches AQI, AI Summary, and UV Index simultaneously
        const [aqiData, summaryText, uvData] = await Promise.all([
            fetchAQI(data.coord.lat, data.coord.lon),
            getSummary(data),
            fetchUV(data.coord.lat, data.coord.lon)
        ]);

        renderExtras(data, aqiData, summaryText, uvData); // Render additional cards

        // Reveal hidden UI sections
        ui.mainDivider.classList.remove('hidden');
        ui.plannerSection.classList.remove('hidden');
        ui.placesDivider.classList.remove('hidden');
        ui.placesSection.classList.remove('hidden');

        // Extract key metrics for insights
        const aqiVal = (aqiData && aqiData.list) ? aqiData.list[0].main.aqi : 0;
        const uvVal = (uvData && uvData.current) ? uvData.current.uvi : ((uvData && uvData.value) ? uvData.value : 0);

        // Trigger Planner, Curated Places, and AI Travel Advisor
        showPlanner();
        fetchPlaces(data, aqiVal, uvVal);
        fetchTravelAdvice(data, aqiVal); // Fetches structured AI advice

    } catch (e) {
        console.error('Error fetching extras', e);
    } finally {
        setLoading(false); // Hide loading state
    }
}

// ─── Curated Places & Gear ──────────────────────────────────────────

// Fetches nearby attractions and gear suggestions
async function fetchPlaces(data, aqiVal, uvVal) {
    ui.places.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:2rem;">Curating local gems & essentials...</div>';

    try {
        const res = await fetch('/api/places', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                city: data.name,
                lat: data.coord.lat,
                lon: data.coord.lon,
                temp: Math.round(data.main.temp),
                condition: data.weather[0].description,
                aqi: aqiVal || 2,
                uv: uvVal || 0
            })
        });

        const result = await res.json();

        // Render Local Attractions Grid
        if (result.places && result.places.length > 0) {
            renderPlaces(result.places);
        } else {
            ui.places.innerHTML = '<div style="text-align:center;opacity:0.6;">No specific places found.</div>';
        }

        // Render Recommended Gear (e.g., Umbrella, Sunscreen)
        if (result.gear && result.gear.length > 0) {
            renderGear(result.gear);
        }

    } catch (e) {
        console.error(e);
        ui.places.innerHTML = '<div style="text-align:center;opacity:0.6;">Unable to curate local insights.</div>';
    }
}

// Renders the essential gear list into the UI
function renderGear(gear) {
    const html = gear.map(g => `
        <li style="margin-bottom: 8px; display: flex; align-items: flex-start; gap: 8px;">
            <span style="color:var(--accent)">•</span>
            <div>
                <strong>${escapeHtml(g.item)}</strong>
                <div style="font-size: 0.85rem; opacity: 0.7;">${escapeHtml(g.reason)}</div>
            </div>
        </li>
    `).join('');

    ui.advice.innerHTML = `
        <div class="card-glass">
            <span class="section-label">Smart Essentials</span>
            <ul style="padding-left: 0; list-style: none; margin: 0; font-size: 0.95rem; line-height: 1.5;">
                ${html}
            </ul>
        </div>
    `;
    ui.advice.classList.remove('hidden');
}

// Helper to handle generic API fetch with error throwing
async function fetchAPI(endpoint) {
    const res = await fetch(endpoint);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || data.message || 'API Error');
    return data;
}

// ─── UI Rendering Logic ──────────────────────────────────────────────

// Renders the primary weather card (Temp, Conditions, Details)
function renderWeather(data) {
    const iconUrl = `https://openweathermap.org/img/wn/${data.weather[0].icon}@4x.png`;

    ui.result.innerHTML = `
        <div class="main-card">
            <div class="weather-overview">
                <div class="weather-intro">
                    <span class="weather-kicker">Current conditions</span>
                    <h2 class="city-name">${escapeHtml(data.name)}, ${escapeHtml(data.sys.country)}</h2>
                    <div class="weather-desc">${escapeHtml(capitalize(data.weather[0].description))}</div>
                </div>
                <div class="weather-current">
                    <img src="${iconUrl}" alt="" class="weather-icon-large" />
                    <div class="weather-temp">${Math.round(data.main.temp)}°</div>
                </div>
            </div>

            <div class="weather-details" role="group" aria-label="Current weather details">
                <div class="detail-item">
                    <span class="detail-label">Feels Like</span>
                    <span class="detail-value">${Math.round(data.main.feels_like)}°</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Humidity</span>
                    <span class="detail-value">${data.main.humidity}%</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Wind</span>
                    <span class="detail-value">${data.wind.speed} m/s</span>
                </div>
                 <div class="detail-item">
                    <span class="detail-label">Pressure</span>
                    <span class="detail-value">${data.main.pressure} hPa</span>
                </div>
            </div>
        </div>
    `;
}

// Renders supplementary cards: Comfort Score, Advice, AQI, UV, Alerts, Summary
function renderExtras(data, aqiData, summaryText, uvData) {
    const qualityScore = scoreWeather(data); // Compute legacy comfort score

    // 1. Comfort Score Card
    ui.quality.innerHTML = `
        <div class="card-glass">
            <span class="section-label">Comfort Score</span>
            <div style="font-size: 2rem; font-weight: 600; color: var(--accent);">${qualityScore.toFixed(1)}<span style="font-size:1rem;color:var(--text-secondary)">/10</span></div>
            <div class="comfort-bars" id="comfortBars"></div>
        </div>
    `;
    ui.quality.classList.remove('hidden');
    renderComfortBars(data);

    // 2. Advice Card (Initially populated, potentially overridden by 'renderGear')
    const adviceList = generateAdvice(data, qualityScore);
    ui.advice.innerHTML = `
        <div class="card-glass">
            <span class="section-label">Advice</span>
            <ul style="padding-left: 1rem; margin: 0; font-size: 0.95rem; line-height: 1.6;">
                ${adviceList.map(a => `<li>${a}</li>`).join('')}
            </ul>
        </div>
    `;
    ui.advice.classList.remove('hidden');

    // 3. Air Quality (AQI) Card
    let aqiVal = 0;
    if (aqiData && aqiData.list) {
        const aqi = aqiData.list[0].main.aqi;
        aqiVal = aqi;
        const map = { 1: 'Good', 2: 'Fair', 3: 'Moderate', 4: 'Poor', 5: 'Very Poor' };
        const statusClass = {
            1: 'status-good',
            2: 'status-fair',
            3: 'status-moderate',
            4: 'status-poor',
            5: 'status-very-poor'
        }[aqi] || 'status-unknown';

        ui.aqi.innerHTML = `
            <div class="card-glass">
                <span class="section-label">Air Quality</span>
                <div class="metric-status ${statusClass}">${map[aqi]}</div>
                <div class="metric-caption">Index: ${aqi}</div>
            </div>
        `;
        ui.aqi.classList.remove('hidden');
    }

    // 4. UV Index (Appended to AQI container)
    if (uvData && (uvData.current || uvData.value)) {
        const uvi = uvData.current ? uvData.current.uvi : (uvData.value || 0);
        const uvClass = uvi > 7 ? 'uv-high' : uvi > 5 ? 'uv-elevated' : uvi > 2 ? 'uv-moderate' : 'uv-low';

        ui.aqi.innerHTML += `
            <div class="card-glass uv-card">
                <span class="section-label">UV Index</span>
                <div class="metric-status ${uvClass}">${Math.round(uvi)}</div>
                <div class="metric-caption">${getUVDesc(uvi)}</div>
            </div>
        `;
    }

    // 5. Smart Alerts (Conditional)
    const alerts = getSmartAlerts(data, aqiData, qualityScore);
    if (alerts.length > 0) {
        ui.alerts.innerHTML = `
            <div class="card-glass weather-alert-card">
                <span class="section-label">Alerts</span>
                <ul class="weather-alert-list">${alerts.map(a => `<li>${a}</li>`).join('')}</ul>
            </div>
        `;
        ui.alerts.classList.remove('hidden');
    } else {
        ui.alerts.classList.add('hidden');
    }

    // 6. AI Insight Summary
    ui.summary.innerHTML = `
        <div class="card-glass" style="border-color: var(--accent);">
            <span class="section-label">Insight</span>
            <p style="margin: 0; font-size: 1.1rem; line-height: 1.6; font-family: var(--font-heading);">${summaryText}</p>
        </div>
    `;
    ui.summary.classList.remove('hidden');
}

// Visualizes Temp/Hum/Wind as horizontal bars
function renderComfortBars(data) {
    const bars = document.getElementById('comfortBars');
    if (!bars) return;

    const normalize = (val, max) => Math.min(100, Math.max(0, (val / max) * 100));
    const content = [
        { label: 'Temp', val: normalize(data.main.temp, 40) },
        { label: 'Hum', val: data.main.humidity },
        { label: 'Wind', val: normalize(data.wind.speed, 20) }
    ];

    bars.innerHTML = content.map(item => `
        <div class="comfort-bar">
            <div class="comfort-bar-track">
                <div class="comfort-bar-fill" style="width:${item.val}%"></div>
            </div>
            <div class="comfort-bar-label">${item.label}</div>
        </div>
    `).join('');
}

// ─── Daily Planner ───────────────────────────────────────────────────

// Generates a day narrative (Morning, Afternoon, Evening) based on forecast
async function showPlanner() {
    ui.planner.innerHTML = '<div style="grid-column: 1/-1; text-align:center; padding: 2rem;">Generating narrative...</div>';

    try {
        const forecast = await fetchAPI(`/api/forecast?city=${encodeURIComponent(state.currentCity)}`);

        const slots = processForecast(forecast);
        const html = Object.entries(slots).map(([time, data]) => {
            if (!data) return '';
            return `
                <div class="planner-slot">
                    <span class="slot-time">${time}</span>
                    <div style="display:flex; align-items:center; gap:10px; margin-bottom: 8px;">
                         <img src="https://openweathermap.org/img/wn/${data.icon}.png" width="30" height="30" />
                         <span style="font-size: 1.2rem;">${Math.round(data.temp)}°</span>
                    </div>
                    <div style="font-size: 0.9rem; opacity: 0.8; margin-bottom: 8px;">${capitalize(data.desc)}</div>
                    <div style="font-size: 0.85rem; color: var(--accent); font-style: italic;">${data.suggestion}</div>
                </div>
            `;
        }).join('');

        ui.planner.innerHTML = html || '<div style="text-align:center;">No forecast data available for today.</div>';
    } catch (e) {
        ui.planner.innerHTML = '<div style="color:var(--danger)">Unable to load planner.</div>';
    }
}

// ─── Places Rendering ────────────────────────────────────────────────

function renderPlaces(list) {
    ui.places.innerHTML = list.map(p => `
        <div class="place-card">
            <div class="place-content">
                <span class="place-badge ${p.type && p.type.toLowerCase() === 'outdoor' ? 'badge-outdoor' : 'badge-indoor'}">${escapeHtml(p.type || 'Visit')}</span>
                <h4 class="place-name">${escapeHtml(p.name)}</h4>
                <p class="place-desc">${escapeHtml(p.desc)}</p>
                 ${p.dist ? `<div style="font-size:0.8rem; margin-top:5px; opacity:0.5; text-align:right;">~${escapeHtml(p.dist)} km away</div>` : ''}
            </div>
        </div>
    `).join('');
}

// ─── Utility Functions ───────────────────────────────────────────────

async function fetchAQI(lat, lon) {
    try { return await fetchAPI(`/api/aqi?lat=${lat}&lon=${lon}`); }
    catch { return null; }
}

async function fetchUV(lat, lon) {
    try { return await fetchAPI(`/api/uv?lat=${lat}&lon=${lon}`); }
    catch { return null; }
}

function getUVDesc(uvi) {
    if (uvi <= 2) return "Low";
    if (uvi <= 5) return "Moderate";
    if (uvi <= 7) return "High";
    return "Very High";
}

// Generates AI Summary using dedicated endpoint
async function getSummary(data) {
    try {
        const prompt = `Summarize current weather for ${data.name}: ${Math.round(data.main.temp)}°C, ${data.weather[0].description}, humidity ${data.main.humidity}%. Short elegant summary.`;
        const res = await fetch('/ai', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt })
        });
        const j = await res.json();
        if (j.reply && !j.reply.includes('error')) return j.reply;
        throw new Error('AI fail');
    } catch {
        return `Current conditions in ${data.name} are ${data.weather[0].description} with a temperature of ${Math.round(data.main.temp)}°C.`;
    }
}

function setLoading(loading) {
    if (loading) {
        ui.result.innerHTML = '<div class="main-card" style="text-align:center; padding:4rem;"><div style="font-size:1.5rem; opacity:0.7">Analyzing atmosphere...</div></div>';
    }
}

function resetUI() {
    ui.quality.classList.add('hidden');
    ui.advice.classList.add('hidden');
    ui.aqi.classList.add('hidden');
    ui.alerts.classList.add('hidden');
    ui.summary.classList.add('hidden');
    ui.plannerSection.classList.add('hidden');
    ui.placesSection.classList.add('hidden');
    ui.mainDivider.classList.add('hidden');
    ui.placesDivider.classList.add('hidden');
    if (ui.advisorSection) ui.advisorSection.classList.add('hidden');
    if (ui.advisorDivider) ui.advisorDivider.classList.add('hidden');
}

function showError(msg) {
    ui.result.innerHTML = `<div class="main-card" style="border-color:var(--danger); text-align:center;"><h3 style="color:var(--danger)">Error</h3><p>${escapeHtml(msg)}</p></div>`;
}

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// ─── Smart Alerts & Rule-Based Logic ─────────────────────────────────

function getSmartAlerts(data, aqiData, score) {
    const alerts = [];
    const temp = data.main.temp;
    const hum = data.main.humidity;
    const wind = data.wind.speed;
    const condition = data.weather[0].main;

    if (temp > 40) alerts.push('Extreme heat warning — stay indoors and hydrate.');
    else if (temp > 35) alerts.push('High heat advisory — avoid prolonged sun exposure.');
    if (temp < -5) alerts.push('Severe cold warning — frostbite risk.');
    else if (temp < 5) alerts.push('Cold advisory — dress warmly.');
    if (wind > 15) alerts.push('Strong wind advisory — secure loose objects.');
    if (hum > 85) alerts.push('Very high humidity — may feel uncomfortable.');
    if (/Thunder/i.test(condition)) alerts.push('Thunderstorm warning — stay indoors.');
    if (/Snow/i.test(condition)) alerts.push('Snowfall — drive cautiously.');
    if (/Rain/i.test(condition) && wind > 10) alerts.push('Heavy rain with wind — carry sturdy umbrella.');

    if (aqiData && aqiData.list) {
        const aqi = aqiData.list[0].main.aqi;
        if (aqi >= 4) alerts.push('Air quality is poor — wear a mask outdoors.');
        if (aqi >= 5) alerts.push('Hazardous air quality — avoid all outdoor activities.');
    }

    if (score < 3) alerts.push('Overall conditions are challenging — plan accordingly.');
    return alerts;
}

// ─── AI Travel Advisor ───────────────────────────────────────────────
const adviceCache = new Map();

// Fetches AI-generated travel advice with fallback logic
async function fetchTravelAdvice(data, aqiVal) {
    if (!ui.advisorSection || !ui.travelAdvisor) return;

    state.lastAdviceData = data;
    state.lastAdviceAqi = Number(aqiVal) || 0;

    // Show section with loading state
    if (ui.advisorDivider) ui.advisorDivider.classList.remove('hidden');
    ui.advisorSection.classList.remove('hidden');
    ui.travelAdvisor.innerHTML = `
        <div class="advisor-loading">
            <div class="pulse-dot"></div>
            <span>Consulting AI travel advisor...</span>
        </div>
    `;

    // Check client-side cache first
    const cacheKey = travelAdviceCacheKey(data, state.lastAdviceAqi);
    if (adviceCache.has(cacheKey)) {
        renderTravelAdvice(adviceCache.get(cacheKey));
        return;
    }

    try {
        const res = await fetch('/api/travel-advice', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                city: data.name,
                temp: Math.round(data.main.temp),
                humidity: data.main.humidity,
                wind: data.wind.speed,
                condition: data.weather[0].description,
                airQuality: state.lastAdviceAqi
            })
        });

        let result;
        try {
            result = await res.json();
        } catch {
            const error = new Error('Invalid AI response');
            error.status = res.ok ? 502 : res.status;
            throw error;
        }

        if (!res.ok) {
            const error = new Error(typeof result?.error === 'string' ? result.error : '');
            error.status = res.status;
            throw error;
        }

        if (!result || typeof result !== 'object' ||
            typeof result.advice !== 'string' || !result.advice.trim()) {
            const error = new Error('No advice returned');
            error.status = 502;
            throw error;
        }

        if (!renderTravelAdvice(result.advice)) {
            const error = new Error('No usable advice returned');
            error.status = 502;
            throw error;
        }
        adviceCache.set(cacheKey, result.advice);
    } catch (e) {
        console.error('Travel advice error:', e);
        renderTravelAdviceError(e);
    }
}

function renderTravelAdviceError(error) {
    if (!ui.travelAdvisor) return;
    const message = getTravelAdviceErrorMessage(error?.status, error?.message);
    ui.travelAdvisor.innerHTML = `
            <div class="card-glass" role="alert" style="text-align:center; padding: 2rem;">
                <p style="margin-bottom: 1rem; color: var(--text-secondary);">⚠️ AI travel advisor couldn't load right now.</p>
                <p style="font-size: 0.85rem; opacity:0.6; margin-bottom: 1.2rem;">${escapeHtml(message)}</p>
                <button type="button" class="secondary-btn retry-advice-btn" style="margin: 0 auto;">
                    🔄 Retry
                </button>
            </div>
        `;
    const retryBtn = ui.travelAdvisor.querySelector('.retry-advice-btn');
    if (retryBtn) retryBtn.addEventListener('click', retryLastTravelAdvice);
}

function retryLastTravelAdvice() {
    if (state.lastAdviceData) {
        fetchTravelAdvice(state.lastAdviceData, state.lastAdviceAqi);
    }
}

// Renders the structured plain-text advice into styled HTML cards
function renderTravelAdvice(text) {
    if (!ui.travelAdvisor) return false;
    const parsed = parseTravelAdvice(text);
    if (!parsed) return false;
    const { places, nearby, wear, eat, alert } = parsed;

    let html = '';

    if (places.length > 0) {
        html += `<div class="advisor-places-header">
            <span class="advisor-icon">📍</span>
            <span>Must-Visit Places</span>
        </div>
        <div class="advisor-places-grid">
            ${places.map((p, i) => `
                <div class="place-card card-glass" style="animation-delay: ${i * 0.1}s">
                    <div class="place-rank">${i + 1}</div>
                    <div class="place-info">
                        <div class="place-name">${escapeHtml(p.name)}</div>
                        ${p.desc ? `<div class="place-desc">${escapeHtml(p.desc)}</div>` : ''}
                    </div>
                </div>
            `).join('')}
        </div>`;
    }

    if (nearby.length > 0) {
        html += `<div class="advisor-places-header nearby-header">
            <span class="advisor-icon">🌍</span>
            <span>Nearby Escapes</span>
        </div>
        <div class="advisor-nearby-grid">
            ${nearby.map(p => `
                <div class="nearby-card card-glass">
                    <div class="nearby-name">${escapeHtml(p.name)}</div>
                    ${p.desc ? `<div class="nearby-desc">${escapeHtml(p.desc)}</div>` : ''}
                </div>
            `).join('')}
        </div>`;
    }

    const tips = [];
    if (wear) tips.push({ icon: '🧥', text: wear });
    if (eat) tips.push({ icon: '🍽️', text: eat });
    if (alert && alert.toLowerCase() !== 'none' && alert.toLowerCase() !== 'none.') {
        tips.push({ icon: '⚠️', text: alert });
    }

    if (tips.length > 0) {
        html += `<div class="advisor-tips-strip">
            ${tips.map(t => `
                <div class="tip-chip card-glass">
                    <span class="tip-icon">${t.icon}</span>
                    <span class="tip-text">${escapeHtml(t.text)}</span>
                </div>
            `).join('')}
        </div>`;
    }

    if (!html) return false;
    ui.travelAdvisor.innerHTML = html;
    return true;
}

function generateAdvice(data, score) {
    const arr = [];
    if (data.main.temp > 28) arr.push("Light clothing recommended.");
    if (data.main.temp < 10) arr.push("Coat required.");
    if (score > 8) arr.push("Perfect weather for outdoor plans.");
    return arr.length ? arr : ["Enjoy your day."];
}

// Expose functions to global scope for HTML onclick access
window.selectCity = selectCity;
window.showPlanner = showPlanner;
window.handleQuickSearch = handleQuickSearch;
window.getWeather = getWeather;
window.retryTravelAdvice = function () {
    retryLastTravelAdvice();
};
