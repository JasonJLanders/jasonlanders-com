import { REGIONS, BENCH } from './data.js';
import { US_STATES } from './us-states.js';
import { regionHealth } from './stats.js';
import { CONFIG, assignFeatureToRegion, getRegionForFeature } from './config.js';
import { seIcon, aeIcon, rdIcon, rvpIcon, seLeaderIcon } from './markers.js';

// Always read current feature mapping from config
function currentRegionFeatures() {
  return CONFIG.regionFeatures || {};
}

/* global L */

let map = null;
let tileLayer = null;        // current Leaflet tileLayer; rebuilt on theme change
const regionLayers = {};     // regionId → L.geoJSON layer (combined shape)
const regionStyles = {};     // regionId → last-committed non-hover style
let roleMarkerLayer = null;  // L.layerGroup holding all role markers
let featureEditLayer = null; // L.layerGroup of individual polygons for edit mode
let regionLabelMarkers = []; // tooltip markers for region labels
let editMode = false;

const TILES = {
  dark:  { url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
           attribution: '&copy; OpenStreetMap &copy; CARTO',
           subdomains: 'abcd', maxZoom: 19 },
  light: { url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
           attribution: '&copy; OpenStreetMap &copy; CARTO',
           subdomains: 'abcd', maxZoom: 19 }
};

function _currentTheme() {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

function _themeStrokeColor() {
  // Region boundary stroke color when editing region mapping. White on dark, near-black on light.
  return _currentTheme() === 'light' ? '#1f1733' : '#ffffff';
}

function _applyTileTheme() {
  if (!map) return;
  if (tileLayer) { map.removeLayer(tileLayer); tileLayer = null; }
  const cfg = TILES[_currentTheme()];
  tileLayer = L.tileLayer(cfg.url, { attribution: cfg.attribution, subdomains: cfg.subdomains, maxZoom: cfg.maxZoom });
  tileLayer.addTo(map);
}

// Cached world countries features (populated on first use)
let _worldFeaturesCache = null;

// Health = BORDER color only (fill comes from region's configured color)
const HEALTH_STROKE = { healthy: '#22c55e', stretched: '#eab308', overloaded: '#ef4444' };
const HEALTH_WEIGHT = { healthy: 2, stretched: 3, overloaded: 4 };

const DEFAULT_REGION_COLORS = ['#7c6bf2','#14b8a6','#ec4899','#f97316','#06b6d4','#a78bfa','#84cc16','#f43f5e'];

// Map center/zoom per scope
const SCOPE_VIEWS = {
  us:     { center: [39.5, -98.35], zoom: 4 },
  world:  { center: [20, 10],       zoom: 2 },
  hybrid: { center: [25, -30],      zoom: 3 }
};

function regionBaseColor(regionId) {
  const cfg = CONFIG.regions.find(r => r.name === regionId || r.id === regionId);
  if (cfg && cfg.color) return cfg.color;
  const idx = REGIONS.findIndex(r => r.id === regionId);
  return DEFAULT_REGION_COLORS[idx % DEFAULT_REGION_COLORS.length];
}

const REGION_CENTROIDS = {
  West:    'San Francisco, CA',
  Central: 'Chicago, IL',
  East:    'New York, NY'
};

// ── Geo helpers ───────────────────────────────────────────────────────────────

function featureCollectionCenter(fc) {
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  fc.features.forEach(f => {
    flatCoords(f.geometry).forEach(([lng, lat]) => {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    });
  });
  return [(minLat + maxLat) / 2, (minLng + maxLng) / 2];
}

function flatCoords(geometry) {
  const out = [];
  function walk(arr, depth) {
    if (depth === 0) { out.push(arr); return; }
    arr.forEach(a => walk(a, depth - 1));
  }
  const d = geometry.type === 'Polygon' ? 1 : geometry.type === 'MultiPolygon' ? 2 : 0;
  walk(geometry.coordinates, d);
  return out;
}

// ── World countries loader (dynamic import, cached) ───────────────────────────

async function loadWorldFeatures() {
  if (_worldFeaturesCache) return _worldFeaturesCache;
  const mod = await import('./world-countries.js');
  _worldFeaturesCache = mod.WORLD_COUNTRIES.features;
  return _worldFeaturesCache;
}

// Returns the bare display name for a world-countries feature
function worldFeatureName(f) {
  return f.properties.ADMIN || f.properties.NAME || '';
}

// Build a namespaced featureId so US Georgia and country Georgia don't collide.
function makeFeatureId(kind, name) {
  return kind + ':' + name;
}

// Parse a namespaced featureId into { kind, name }. Falls back to legacy bare names as state.
function parseFeatureId(featureId) {
  if (typeof featureId !== 'string') return { kind: 'state', name: '' };
  const idx = featureId.indexOf(':');
  if (idx === -1) return { kind: 'state', name: featureId };
  return { kind: featureId.slice(0, idx), name: featureId.slice(idx + 1) };
}

// Human-readable label for a featureId (used in popup titles + tooltips).
// Adds a kind suffix only in scopes where the kind is otherwise ambiguous (hybrid).
function featureLabel(featureId, scope) {
  const { kind, name } = parseFeatureId(featureId);
  if (scope === 'hybrid') {
    return kind === 'country' ? `${name} (Country)` : `${name} (State)`;
  }
  return name;
}

// ── getMapFeatures — unified feature set based on scope ───────────────────────
//
// Returns a Promise<FeatureCollection> with each feature having a normalized
// `featureId` property for region-assignment lookups.

async function getMapFeatures(scope) {
  if (scope === 'us') {
    return {
      type: 'FeatureCollection',
      features: US_STATES.features.map(f => ({
        ...f,
        properties: { ...f.properties, featureId: makeFeatureId('state', f.properties.name) }
      }))
    };
  }

  const worldFeatures = await loadWorldFeatures();

  if (scope === 'world') {
    return {
      type: 'FeatureCollection',
      features: worldFeatures.map(f => ({
        ...f,
        properties: { ...f.properties, featureId: makeFeatureId('country', worldFeatureName(f)) }
      }))
    };
  }

  // hybrid: world countries except US + all US states
  const nonUsWorld = worldFeatures
    .filter(f => worldFeatureName(f) !== 'United States of America')
    .map(f => ({
      ...f,
      properties: { ...f.properties, featureId: makeFeatureId('country', worldFeatureName(f)) }
    }));

  const usStates = US_STATES.features.map(f => ({
    ...f,
    properties: { ...f.properties, featureId: makeFeatureId('state', f.properties.name) }
  }));

  return {
    type: 'FeatureCollection',
    features: [...nonUsWorld, ...usStates]
  };
}

// ── Feature collection by name set ───────────────────────────────────────────

function subsetByNames(features, nameSet) {
  return {
    type: 'FeatureCollection',
    features: features.filter(f => nameSet.has(f.properties.featureId))
  };
}

// ── Point-in-polygon (ray-casting) ───────────────────────────────────────────

function raycast(lat, lng, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) &&
        lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInFeature(lat, lng, feature) {
  const { type, coordinates } = feature.geometry;
  if (type === 'Polygon')      return raycast(lat, lng, coordinates[0]);
  if (type === 'MultiPolygon') return coordinates.some(poly => raycast(lat, lng, poly[0]));
  return false;
}

function getRegionForPoint(lat, lng) {
  const regionFeatures = currentRegionFeatures();
  for (const [regionId, names] of Object.entries(regionFeatures)) {
    const nameSet = new Set(names);
    const hit = US_STATES.features
      .filter(f => nameSet.has(makeFeatureId('state', f.properties.name)) || nameSet.has(f.properties.name))
      .some(f => pointInFeature(lat, lng, f));
    if (hit) return regionId;
  }
  return null;
}

// ── Init ──────────────────────────────────────────────────────────────────────

const MAP_VIEW_STORAGE_KEY = 'secp:mapView';

/** Persist current map center+zoom + active scope (saved view is only used for that scope). */
function _saveMapView() {
  if (!map) return;
  try {
    const c = map.getCenter();
    const payload = {
      scope: CONFIG.mapScope || 'us',
      lat: c.lat,
      lng: c.lng,
      zoom: map.getZoom()
    };
    localStorage.setItem(MAP_VIEW_STORAGE_KEY, JSON.stringify(payload));
  } catch {}
}

/** Read saved view; only return it if scope matches and shape is valid. */
function _loadMapView(currentScope) {
  try {
    const raw = localStorage.getItem(MAP_VIEW_STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (!v || v.scope !== currentScope) return null;
    if (typeof v.lat !== 'number' || typeof v.lng !== 'number' || typeof v.zoom !== 'number') return null;
    return v;
  } catch {
    return null;
  }
}

export function initMap(containerId) {
  const scope = CONFIG.mapScope || 'us';
  const view  = SCOPE_VIEWS[scope] || SCOPE_VIEWS.us;
  const saved = _loadMapView(scope);

  const initialCenter = saved ? [saved.lat, saved.lng] : view.center;
  const initialZoom   = saved ? saved.zoom            : view.zoom;

  map = L.map(containerId, { zoomControl: false }).setView(initialCenter, initialZoom);
  L.control.zoom({ position: 'topright' }).addTo(map);

  _applyTileTheme();

  renderRegionShapes();

  roleMarkerLayer = L.layerGroup().addTo(map);

  // Persist on user pan/zoom (moveend covers both).
  map.on('moveend', _saveMapView);

  // React to theme changes: swap tiles + redraw edit-mode strokes if active.
  document.addEventListener('theme-changed', () => {
    _applyTileTheme();
    if (editMode && featureEditLayer) {
      featureEditLayer.eachLayer(l => {
        try { l.setStyle({ color: _themeStrokeColor() }); } catch {}
      });
    }
  });
}

// Tell Leaflet the container size changed (e.g. after a sidebar resize/collapse).
export function invalidateMapSize() {
  if (map) map.invalidateSize();
}

// ── renderRegionShapes (async) ────────────────────────────────────────────────

async function renderRegionShapes() {
  // Tear down existing region layers + labels
  Object.values(regionLayers).forEach(l => map.removeLayer(l));
  Object.keys(regionLayers).forEach(k => delete regionLayers[k]);
  regionLabelMarkers.forEach(l => map.removeLayer(l));
  regionLabelMarkers = [];

  const scope = CONFIG.mapScope || 'us';
  const allFeatures = (await getMapFeatures(scope)).features;
  const regionFeatures = currentRegionFeatures();

  REGIONS.forEach(region => {
    const names = regionFeatures[region.id] || [];
    const nameSet = new Set(names);
    const fc = subsetByNames(allFeatures, nameSet);
    if (!fc.features.length) return;

    const base = regionBaseColor(region.id);
    const initialStyle = {
      color:       HEALTH_STROKE.healthy,
      weight:      HEALTH_WEIGHT.healthy,
      fillColor:   base,
      fillOpacity: 0.22
    };
    const layer = L.geoJSON(fc, { style: initialStyle }).addTo(map);
    regionStyles[region.id] = initialStyle;

    const center = featureCollectionCenter(fc);
    if (isFinite(center[0])) {
      const tip = L.tooltip({ permanent: true, direction: 'center', className: 'region-label' })
        .setContent(region.name)
        .setLatLng(center)
        .addTo(map);
      regionLabelMarkers.push(tip);
    }

    layer.on('click', () => {
      document.dispatchEvent(new CustomEvent('region-selected', { detail: { regionId: region.id } }));
    });
    layer.on('mouseover', () => {
      const base = regionStyles[region.id];
      layer.setStyle({ weight: base.weight + 1, fillOpacity: 0.32 });
    });
    layer.on('mouseout', () => {
      const base = regionStyles[region.id];
      layer.setStyle(base);
    });

    regionLayers[region.id] = layer;
  });
}

// ── Reload map scope (called when user changes scope in settings) ─────────────

export async function reloadMapScope() {
  if (!map) return;

  // Scope change invalidates the saved view; clear it so the new scope's default is used.
  try { localStorage.removeItem(MAP_VIEW_STORAGE_KEY); } catch {}

  // Fly to new scope center/zoom
  const scope = CONFIG.mapScope || 'us';
  const view = SCOPE_VIEWS[scope] || SCOPE_VIEWS.us;
  map.flyTo(view.center, view.zoom, { duration: 1.2 });

  // Re-render shapes (layers are torn down and rebuilt)
  await renderRegionShapes();

  // Re-add role markers if not in edit mode
  if (!editMode && roleMarkerLayer) roleMarkerLayer.addTo(map);
}

// ── Feature edit layer ────────────────────────────────────────────────────────

async function renderFeatureEditLayer() {
  if (featureEditLayer) {
    map.removeLayer(featureEditLayer);
    featureEditLayer = null;
  }
  featureEditLayer = L.layerGroup().addTo(map);

  const scope = CONFIG.mapScope || 'us';
  const allFeatures = (await getMapFeatures(scope)).features;

  allFeatures.forEach(feature => {
    const featureId = feature.properties.featureId;
    const assignedRegion = getRegionForFeature(featureId);
    const fillColor = assignedRegion ? regionBaseColor(assignedRegion) : '#4b5563';

    const fLayer = L.geoJSON(feature, {
      style: {
        color:       _themeStrokeColor(),
        weight:      1,
        fillColor,
        fillOpacity: assignedRegion ? 0.45 : 0.2
      }
    }).addTo(featureEditLayer);

    const labelText = featureLabel(featureId, scope);
    fLayer.bindTooltip(
      `<strong>${labelText}</strong><br>${assignedRegion ? `Assigned: ${assignedRegion}` : '<em>Unassigned</em>'}<br><span style="color:var(--accent)">Click to change region</span>`,
      { direction: 'top' }
    );

    fLayer.on('mouseover', () => fLayer.setStyle({ weight: 2, fillOpacity: 0.65 }));
    fLayer.on('mouseout',  () => fLayer.setStyle({ weight: 1, fillOpacity: assignedRegion ? 0.45 : 0.2 }));

    fLayer.on('click', (e) => {
      showFeatureAssignPopup(e.latlng, featureId);
    });
  });
}

function showFeatureAssignPopup(latlng, featureId) {
  const currentRegion = getRegionForFeature(featureId);
  const regionList = (CONFIG.regions && CONFIG.regions.length) ? CONFIG.regions : REGIONS;
  const scope = CONFIG.mapScope || 'us';
  const titleText = featureLabel(featureId, scope);

  // Filter input for orgs with many regions
  const filterInput = regionList.length > 8
    ? `<input id="regionFilterInput" class="add-se-input" placeholder="Filter regions..." style="width:100%;margin-bottom:6px;font-size:11px"
        oninput="filterRegionButtons(this.value)" />`
    : '';

  const buttons = regionList.map(r => {
    const regionId = r.name || r.id;
    const isCurrent = regionId === currentRegion;
    return `<button class="state-assign-btn${isCurrent ? ' current' : ''}" data-region="${regionId}">${regionId}${isCurrent ? ' ✓' : ''}</button>`;
  }).join('');

  const html = `
    <div class="state-assign-popup">
      <div class="state-assign-title">${titleText}</div>
      ${filterInput}
      <div class="state-assign-buttons" id="featureAssignBtns">
        ${buttons}
        <button class="state-assign-btn unassign" data-region="">Unassign</button>
      </div>
    </div>
  `;

  const popup = L.popup({ className: 'state-assign-leaflet-popup', closeButton: true })
    .setLatLng(latlng)
    .setContent(html)
    .openOn(map);

  setTimeout(() => {
    document.querySelectorAll('.state-assign-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const regionId = btn.dataset.region || null;
        assignFeatureToRegion(featureId, regionId);
        map.closePopup();
        renderFeatureEditLayer();
      });
    });
  }, 0);
}

// Exposed globally for inline oninput in popup
window.filterRegionButtons = (query) => {
  const q = query.toLowerCase();
  document.querySelectorAll('#featureAssignBtns .state-assign-btn').forEach(btn => {
    const text = btn.textContent.toLowerCase();
    btn.style.display = (!q || text.includes(q)) ? '' : 'none';
  });
};

// ── Enter / exit feature edit mode ────────────────────────────────────────────

export function enterFeatureEditMode() {
  if (editMode) return;
  editMode = true;
  Object.values(regionLayers).forEach(l => map.removeLayer(l));
  regionLabelMarkers.forEach(l => map.removeLayer(l));
  if (roleMarkerLayer) map.removeLayer(roleMarkerLayer);
  renderFeatureEditLayer();
}

export function exitFeatureEditMode() {
  if (!editMode) return;
  editMode = false;
  if (featureEditLayer) { map.removeLayer(featureEditLayer); featureEditLayer = null; }
  renderRegionShapes();
  if (roleMarkerLayer) roleMarkerLayer.addTo(map);
}

// Backward-compat aliases used by app.js
export const enterStateEditMode = enterFeatureEditMode;
export const exitStateEditMode  = exitFeatureEditMode;

// ── Region shading ────────────────────────────────────────────────────────────

export function updateRegionShading(workingData) {
  if (!map) return;
  REGIONS.forEach(region => {
    const layer = regionLayers[region.id];
    if (!layer) return;
    const health = regionHealth(region.id, workingData);
    const base = regionBaseColor(region.id);
    const newStyle = {
      color:       HEALTH_STROKE[health],
      weight:      HEALTH_WEIGHT[health],
      fillColor:   base,
      fillOpacity: 0.22
    };
    regionStyles[region.id] = newStyle;
    layer.setStyle(newStyle);
  });
}

// ── SE workload color ─────────────────────────────────────────────────────────

function seColor(person) {
  const { aeCount, segment } = person.relatedStats;
  const b = BENCH[segment] || BENCH.Key;
  if (aeCount <= b.healthy)   return '#22c55e';
  if (aeCount <= b.stretched) return '#eab308';
  return '#ef4444';
}

// ── Tooltip HTML per role ─────────────────────────────────────────────────────

function tooltipFor(person) {
  const { name, role, city, region, relatedStats: rs } = person;
  const loc = city || region;
  const b = `<strong>${name}</strong>`;
  const muted = s => `<span style="color:var(--muted);font-size:10px">${s}</span>`;
  if (role === 'SE')       return `${b}<br>${loc}<br>Accounts: ${rs.accountCount} &nbsp;|&nbsp; AEs: ${rs.aeCount}`;
  if (role === 'AE')       return `${b}<br>${loc}<br>Accounts: ${rs.accountCount}`;
  if (role === 'RD')       return `${b} ${muted('RD')}<br>${loc}<br>AEs: ${rs.aeCount}`;
  if (role === 'RVP')      return `${b} ${muted('RVP')}<br>${loc}<br>RDs: ${rs.rdCount}`;
  if (role === 'SELeader') return `${b} ${muted('SE Leader')}<br>${loc}<br>SEs: ${rs.seCount}`;
  return b;
}

// ── Role markers ──────────────────────────────────────────────────────────────

export function renderRoleMarkers(roster, geocache, visibleLayers, rebalanceMode) {
  if (!map || !roleMarkerLayer) return;
  roleMarkerLayer.clearLayers();

  roster.forEach(person => {
    if (!visibleLayers.has(person.role)) return;
    const city = person.city;
    if (!city) return;
    const coords = geocache[city];
    if (!coords) return;

    const isDraggable = person.role === 'SE' && rebalanceMode;
    let icon;
    switch (person.role) {
      case 'SE':       icon = seIcon(seColor(person), rebalanceMode); break;
      case 'AE':       icon = aeIcon();       break;
      case 'RD':       icon = rdIcon();       break;
      case 'RVP':      icon = rvpIcon();      break;
      case 'SELeader': icon = seLeaderIcon(); break;
      default: return;
    }

    const marker = L.marker([coords.lat, coords.lng], { icon, draggable: isDraggable });

    marker.bindTooltip(tooltipFor(person), {
      className: 'se-marker-tooltip',
      direction: 'top',
      offset: [0, -10]
    });

    marker.on('click', () => {
      document.dispatchEvent(new CustomEvent('region-selected', { detail: { regionId: person.region } }));
      if (person.role === 'SE') {
        document.dispatchEvent(new CustomEvent('se-highlight', { detail: { seName: person.name } }));
      }
    });

    if (isDraggable) {
      const originalLatLng = [coords.lat, coords.lng];
      marker.on('dragend', e => {
        const { lat, lng } = e.target.getLatLng();
        const newRegion = getRegionForPoint(lat, lng);
        if (!newRegion || newRegion === person.region) {
          e.target.setLatLng(originalLatLng);
          return;
        }
        const newCity = REGION_CENTROIDS[newRegion] || person.city;
        // eslint-disable-next-line no-alert
        const ok = confirm(
          `Move ${person.name} to ${newRegion} region?\n\nAll their accounts will be reassigned — you can set new SEs in the panel.`
        );
        if (!ok) {
          e.target.setLatLng(originalLatLng);
          return;
        }
        document.dispatchEvent(new CustomEvent('se-region-move', {
          detail: { seName: person.name, newRegion, newCity }
        }));
      });
    }

    roleMarkerLayer.addLayer(marker);
  });
}

// Backward-compat shim
export { renderRoleMarkers as renderSEMarkers };
