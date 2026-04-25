// v2 = global geocoding (was US-only). Bumping the key force-refreshes prior null entries
// for international cities that previously failed to geocode under the US-only constraint.
const CACHE_KEY = 'se-planner-geocache-v2';

function loadCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); }
  catch { return {}; }
}

function saveCache(cache) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch { /* storage full */ }
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Geocode an array of city strings.
 * Returns { 'City, ST': { lat, lng } | null, ... }
 * Checks localStorage cache first; falls back to Nominatim for misses (1 req/sec).
 */
export async function geocodeCities(cities) {
  const cache = loadCache();
  const unique = [...new Set(cities)].filter(Boolean);
  const missing = unique.filter(c => !(c in cache));
  const hits = unique.length - missing.length;
  console.log(`[geocode] ${hits} cache hits, ${missing.length} misses (${unique.length} total cities)`);

  for (let i = 0; i < missing.length; i++) {
    const city = missing[i];
    if (i > 0) await delay(1100); // Nominatim rate limit: 1 req/sec
    try {
      // No country restriction — supports global cities (was previously locked to US-only).
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city)}&format=json&limit=1`;
      const res = await fetch(url, {
        headers: { 'Accept': 'application/json' }
      });
      if (!res.ok) { cache[city] = null; continue; }
      const results = await res.json();
      if (results.length) {
        cache[city] = { lat: parseFloat(results[0].lat), lng: parseFloat(results[0].lon) };
      } else {
        cache[city] = null;
      }
    } catch {
      cache[city] = null;
    }
  }

  saveCache(cache);
  return cache;
}
