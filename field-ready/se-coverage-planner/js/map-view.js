import { REGIONS, BENCH } from './data.js';
import { US_STATES } from './us-states.js';
import { regionHealth } from './stats.js';
import { CONFIG, assignStateToRegion, getRegionForState } from './config.js';
import { seIcon, aeIcon, rdIcon, rvpIcon, seLeaderIcon } from './markers.js';

// Always read the current state mapping from config (which is mutable + persisted)
function currentRegionStates() {
  return CONFIG.regionStates || {};
}

/* global L */

let map = null;
const regionLayers = {};    // regionId → L.geoJSON layer (combined shape)
const regionStyles = {};    // regionId → last-committed non-hover style
let roleMarkerLayer = null; // L.layerGroup holding all role markers
let stateEditLayer = null;  // L.layerGroup of individual state polygons for edit mode
let regionLabelMarkers = []; // tooltip markers for region labels
let editMode = false;

// Health = BORDER color only (fill comes from region's configured color)
const HEALTH_STROKE = {
  healthy:    '#22c55e',   // green
  stretched:  '#eab308',   // amber
  overloaded: '#ef4444'    // red
};
const HEALTH_WEIGHT = {
  healthy:    2,
  stretched:  3,
  overloaded: 4
};

// Nicer default palette for regions (muted, distinct, map-friendly)
const DEFAULT_REGION_COLORS = [
  '#7c6bf2',  // indigo
  '#14b8a6',  // teal
  '#ec4899',  // pink
  '#f97316',  // orange
  '#06b6d4',  // cyan
  '#a78bfa',  // lavender
  '#84cc16',  // lime
  '#f43f5e'   // rose
];

function regionBaseColor(regionId) {
  // Prefer user's CONFIG choice; fall back to default palette by index
  const cfg = CONFIG.regions.find(r => r.name === regionId || r.id === regionId);
  if (cfg && cfg.color) return cfg.color;
  const idx = REGIONS.findIndex(r => r.id === regionId);
  return DEFAULT_REGION_COLORS[idx % DEFAULT_REGION_COLORS.length];
}

function hexToRgba(hex, alpha) {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Fallback home city when an SE is drag-moved to a new region
const REGION_CENTROIDS = {
  West:    'San Francisco, CA',
  Central: 'Chicago, IL',
  East:    'New York, NY'
};

// ── Geo helpers ───────────────────────────────────────────────────────────────

function stateFeatureCollection(stateNames) {
  const nameSet = new Set(stateNames);
  return {
    type: 'FeatureCollection',
    features: US_STATES.features.filter(f => nameSet.has(f.properties.name))
  };
}

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

// ── Point-in-polygon (ray-casting) ────────────────────────────────────────────
// GeoJSON coords are [longitude, latitude].

function raycast(lat, lng, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]; // [lon, lat]
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
  const regionStates = currentRegionStates();
  for (const [regionId, stateNames] of Object.entries(regionStates)) {
    const nameSet = new Set(stateNames);
    const hit = US_STATES.features
      .filter(f => nameSet.has(f.properties.name))
      .some(f => pointInFeature(lat, lng, f));
    if (hit) return regionId;
  }
  return null;
}

// ── Init ──────────────────────────────────────────────────────────────────────

export function initMap(containerId) {
  map = L.map(containerId, { zoomControl: false }).setView([39.5, -98.35], 4);
  L.control.zoom({ position: 'topright' }).addTo(map);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);

  renderRegionShapes();

  roleMarkerLayer = L.layerGroup().addTo(map);
}

// Tell Leaflet the container size changed (e.g. after a sidebar resize/collapse).
export function invalidateMapSize() {
  if (map) map.invalidateSize();
}

// Draws (or redraws) region polygons as combined state shapes.
// Called on init and after state mapping edits.
function renderRegionShapes() {
  // Tear down any existing region layers + labels
  Object.values(regionLayers).forEach(l => map.removeLayer(l));
  Object.keys(regionLayers).forEach(k => delete regionLayers[k]);
  regionLabelMarkers.forEach(l => map.removeLayer(l));
  regionLabelMarkers = [];

  const regionStates = currentRegionStates();

  REGIONS.forEach(region => {
    const fc = stateFeatureCollection(regionStates[region.id] || []);
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
    // Hover pulse: slightly thicker border, stronger fill
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

// Render individual state polygons for edit mode.
function renderStateEditLayer() {
  if (stateEditLayer) {
    map.removeLayer(stateEditLayer);
    stateEditLayer = null;
  }
  stateEditLayer = L.layerGroup().addTo(map);

  US_STATES.features.forEach(feature => {
    const stateName = feature.properties.name;
    const assignedRegion = getRegionForState(stateName);
    const fillColor = assignedRegion ? regionBaseColor(assignedRegion) : '#4b5563';

    const stateLayer = L.geoJSON(feature, {
      style: {
        color:       '#fff',
        weight:      1,
        fillColor,
        fillOpacity: assignedRegion ? 0.45 : 0.2
      }
    }).addTo(stateEditLayer);

    stateLayer.bindTooltip(
      `<strong>${stateName}</strong><br>${assignedRegion ? `Assigned: ${assignedRegion}` : '<em>Unassigned</em>'}<br><span style="color:#a78bfa">Click to change region</span>`,
      { direction: 'top' }
    );

    stateLayer.on('mouseover', () => stateLayer.setStyle({ weight: 2, fillOpacity: 0.65 }));
    stateLayer.on('mouseout',  () => stateLayer.setStyle({ weight: 1, fillOpacity: assignedRegion ? 0.45 : 0.2 }));

    stateLayer.on('click', (e) => {
      showStateAssignPopup(e.latlng, stateName);
    });
  });
}

function showStateAssignPopup(latlng, stateName) {
  const currentRegion = getRegionForState(stateName);
  // Use user-configured regions (includes any custom-added ones), fall back to defaults
  const regionList = (CONFIG.regions && CONFIG.regions.length) ? CONFIG.regions : REGIONS;
  const buttons = regionList.map(r => {
    const regionId = r.name || r.id;
    const isCurrent = regionId === currentRegion;
    return `<button class="state-assign-btn${isCurrent ? ' current' : ''}" data-region="${regionId}">${regionId}${isCurrent ? ' ✓' : ''}</button>`;
  }).join('');

  const html = `
    <div class="state-assign-popup">
      <div class="state-assign-title">${stateName}</div>
      <div class="state-assign-buttons">
        ${buttons}
        <button class="state-assign-btn unassign" data-region="">Unassign</button>
      </div>
    </div>
  `;

  const popup = L.popup({ className: 'state-assign-leaflet-popup', closeButton: true })
    .setLatLng(latlng)
    .setContent(html)
    .openOn(map);

  // Wire up buttons after the popup renders
  setTimeout(() => {
    document.querySelectorAll('.state-assign-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const regionId = btn.dataset.region || null;
        assignStateToRegion(stateName, regionId);
        map.closePopup();
        renderStateEditLayer();  // re-render with new color
      });
    });
  }, 0);
}

export function enterStateEditMode() {
  if (editMode) return;
  editMode = true;

  // Hide combined region shapes + labels + markers
  Object.values(regionLayers).forEach(l => map.removeLayer(l));
  regionLabelMarkers.forEach(l => map.removeLayer(l));
  if (roleMarkerLayer) map.removeLayer(roleMarkerLayer);

  renderStateEditLayer();
}

export function exitStateEditMode() {
  if (!editMode) return;
  editMode = false;

  if (stateEditLayer) {
    map.removeLayer(stateEditLayer);
    stateEditLayer = null;
  }

  renderRegionShapes();
  if (roleMarkerLayer) roleMarkerLayer.addTo(map);
}

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
  switch (role) {
    case 'SE':
      return `<strong>${name}</strong><br>${loc}<br>Accounts: ${rs.accountCount} &nbsp;|&nbsp; AEs: ${rs.aeCount}`;
    case 'AE':
      return `<strong>${name}</strong><br>${loc}<br>Accounts: ${rs.accountCount}`;
    case 'RD':
      return `<strong>${name}</strong> <span style="color:var(--muted);font-size:10px">RD</span><br>${loc}<br>AEs: ${rs.aeCount}`;
    case 'RVP':
      return `<strong>${name}</strong> <span style="color:var(--muted);font-size:10px">RVP</span><br>${loc}<br>RDs: ${rs.rdCount}`;
    case 'SELeader':
      return `<strong>${name}</strong> <span style="color:var(--muted);font-size:10px">SE Leader</span><br>${loc}<br>SEs: ${rs.seCount}`;
    default:
      return `<strong>${name}</strong>`;
  }
}

// ── Role markers ──────────────────────────────────────────────────────────────

/**
 * Render markers for all roles.
 * @param {Array}  roster        - from getRoster()
 * @param {Object} geocache      - { 'City, ST': { lat, lng } | null }
 * @param {Set}    visibleLayers - Set of role strings to show
 * @param {boolean} rebalanceMode - if true, SE markers become draggable
 */
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

// ── Backwards-compat shim (used nowhere after Run 3, kept so old imports don't crash) ──
export { renderRoleMarkers as renderSEMarkers };
