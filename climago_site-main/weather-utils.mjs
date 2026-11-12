export function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

export function parseTravelAdvice(text) {
  if (typeof text !== 'string' || !text.trim()) return null;

  const sections = {};
  let currentKey = '';

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const sectionMatch = trimmed.match(/^(PLACES|NEARBY|WEAR|EAT|ALERT)\s*:\s*(.*)/i);
    if (sectionMatch) {
      currentKey = sectionMatch[1].toUpperCase();
      sections[currentKey] = sectionMatch[2] ? [sectionMatch[2]] : [];
    } else if (currentKey) {
      sections[currentKey].push(trimmed);
    }
  }

  function parsePlaces(lines = []) {
    return lines.map((line) => {
      const match = line.match(/^\d+\.\s*(.+?)\s*[-–]\s*(.+)$/);
      if (match) {
        return {
          name: match[1].replace(/[*]/g, '').trim(),
          desc: match[2].replace(/[*]/g, '').trim()
        };
      }

      const name = line.replace(/^\d+\.\s*/, '').replace(/[*]/g, '').trim();
      return name ? { name, desc: '' } : null;
    }).filter(Boolean);
  }

  const places = parsePlaces(sections.PLACES);
  const nearby = parsePlaces(sections.NEARBY);
  const wear = (sections.WEAR || []).join(' ').replace(/[*]/g, '').trim();
  const eat = (sections.EAT || []).join(' ').replace(/[*]/g, '').trim();
  const alert = (sections.ALERT || []).join(' ').replace(/[*]/g, '').trim();

  if (!places.length && !nearby.length && !wear && !eat && !alert) return null;
  return { places, nearby, wear, eat, alert };
}

export function travelAdviceCacheKey(data, aqi) {
  return JSON.stringify([
    String(data?.name ?? '').trim().toLowerCase(),
    Math.round(Number(data?.main?.temp)),
    data?.main?.humidity,
    data?.wind?.speed,
    String(data?.weather?.[0]?.description ?? '').trim().toLowerCase(),
    Number(aqi) || 0
  ]);
}

export function getTravelAdviceErrorMessage(status, errorMessage = '') {
  if (status === 503 && /AI API key is not configured/i.test(errorMessage)) {
    return 'AI travel advice is not configured. Add GOOGLE_API_KEY to the project .env file and restart the server.';
  }
  if (status === 502) {
    return 'The AI provider could not complete the request. Check GOOGLE_API_KEY and model access, then try again later.';
  }
  if ([429, 504].includes(status)) {
    return 'The AI travel service is temporarily unavailable or has reached a request limit. Please try again later.';
  }
  if (Number.isInteger(status)) {
    return 'The AI travel service encountered an error. Please try again shortly.';
  }
  return 'Could not connect to the AI travel service. Check your connection and try again.';
}

export function scoreWeather(data) {
  let score = 5;
  const temp = data.main.temp;
  const hum = data.main.humidity;

  if (temp >= 18 && temp <= 26) score += 3;
  else if (temp >= 10 && temp < 18) score += 1;
  else if (temp > 26 && temp <= 32) score += 1;

  if (hum >= 30 && hum <= 60) score += 2;
  if (temp > 35 || temp < 0) score -= 3;
  if (hum > 80) score -= 1;
  if (data.weather[0].main.match(/Rain|Snow|Thunder/)) score -= 2;

  return Math.min(10, Math.max(0, score));
}

function getSlotName(localHour) {
  if (localHour >= 6 && localHour < 12) return 'Morning';
  if (localHour >= 12 && localHour < 17) return 'Afternoon';
  if (localHour >= 17 && localHour < 21) return 'Evening';
  return 'Night';
}

export function processForecast(forecast) {
  const slots = { Morning: null, Afternoon: null, Evening: null, Night: null };
  const timezoneOffset = Number.isFinite(forecast?.city?.timezone) ? Number(forecast.city.timezone) : 0;
  const nowMs = Date.now() + (timezoneOffset * 1000);
  const targetDate = new Date(nowMs).toISOString().slice(0, 10);
  const dayItems = (forecast?.list || []).filter((item) => {
    const localDate = new Date((Number(item.dt) + timezoneOffset) * 1000);
    return localDate.toISOString().slice(0, 10) === targetDate;
  });

  if (!dayItems.length) return slots;

  for (const item of dayItems) {
    const localHour = new Date((Number(item.dt) + timezoneOffset) * 1000).getUTCHours();
    const slot = getSlotName(localHour);
    if (!slots[slot]) {
      slots[slot] = {
        temp: item.main.temp,
        desc: item.weather[0].description,
        icon: item.weather[0].icon,
        pop: item.pop,
        suggestion: getSlotSuggestion(item.main.temp, item.pop, item.weather[0].main)
      };
    }
  }

  for (const slot of Object.keys(slots)) {
    if (!slots[slot]) {
      const fallback = dayItems.find((item) => getSlotName(new Date((Number(item.dt) + timezoneOffset) * 1000).getUTCHours()) === slot) || dayItems[0];
      if (fallback) {
        slots[slot] = {
          temp: fallback.main.temp,
          desc: fallback.weather[0].description,
          icon: fallback.weather[0].icon,
          pop: fallback.pop,
          suggestion: getSlotSuggestion(fallback.main.temp, fallback.pop, fallback.weather[0].main)
        };
      }
    }
  }

  return slots;
}

function getSlotSuggestion(temp, pop, main) {
  if (pop > 0.5 || /rain|snow/i.test(main)) return 'Expect precipitation, stay dry.';
  if (temp > 30) return 'Heat warning, stay cool.';
  if (temp < 10) return 'Bundle up.';
  return 'Conditions look good.';
}
