import { DATA, state, getRoster } from './data.js';
import {
  CONFIG, saveConfig, renderSettings, switchSettingsTab,
  addRegion, addTeam
} from './config.js';
import {
  PEOPLE, getPerson, addPerson,
  updatePersonName, updatePersonCity, updatePersonRegion, updatePersonActive
} from './roster.js';
import { openManageData } from './manage-data.js';
import { computeStats, renderRegionGrid } from './stats.js';
import { renderDiffBanner, renderSETable } from './table-view.js';
import { initMap, updateRegionShading, renderRoleMarkers, enterStateEditMode, exitStateEditMode, invalidateMapSize } from './map-view.js';
import { geocodeCities } from './geocode.js';

// ── Expose globals required by dynamically-generated inline onclick/oninput HTML ──
// (region/team helpers are exposed by config.js; personnel helpers by config.js)
window.removeSE        = removeSE;
window.reassignAccount = reassignAccount;

// ── Local state ───────────────────────────────────────────────────────────────
let selectedRegion = null;
let geocache = {};
let visibleLayers = new Set(['SE', 'AE']); // SE + AE on by default

function refreshMarkers() {
  const data = (state.viewMode === 'proposed' && state.scenarioB) ? state.scenarioB : state.workingData;
  const roster = getRoster(data, state.rebalanceMode ? state.addedSEs : []);
  // Filter out inactive people from the map
  const inactiveNames = new Set(PEOPLE.filter(p => p.active === false).map(p => p.name));
  const filteredRoster = roster.filter(r => !inactiveNames.has(r.name));
  renderRoleMarkers(filteredRoster, geocache, visibleLayers, state.rebalanceMode);
}

// ── Main render ──────────────────────────────────────────────────────────────────
function render() {
  const data    = (state.viewMode === 'proposed' && state.scenarioB) ? state.scenarioB : state.workingData;
  const seList  = computeStats(data, state.rebalanceMode ? state.addedSEs : []);
  const active  = seList.filter(s => !s.isTBH && !s.isUnassigned);
  const allAEs  = new Set(data.map(r => r.ae));
  const seNames = [...new Set([
    ...state.workingData.filter(r => !r.se.startsWith('TBH') && r.se !== 'UNASSIGNED').map(r => r.se),
    ...state.addedSEs.map(s => s.se)
  ])].sort();

  // Sidebar stats (org-wide)
  document.getElementById('statSEs').textContent   = active.length;
  document.getElementById('statAEs').textContent   = allAEs.size;
  document.getElementById('statRatio').textContent = active.length ? `1:${(allAEs.size / active.length).toFixed(1)}` : '-';

  // Sidebar region summary cards
  renderRegionGrid(CONFIG.regions, seList, data);

  // Map shading + role markers
  updateRegionShading(data);
  refreshMarkers();

  // Add SE bar (only in right panel when rebalance mode + region selected)
  document.getElementById('addSEBar').style.display =
    (state.rebalanceMode && selectedRegion) ? 'block' : 'none';

  // Right panel table (region-filtered)
  if (selectedRegion) {
    const filteredList = seList.filter(s => s.ae_region === selectedRegion);
    const changedSet   = state.viewMode === 'proposed' ? state.scenarioBChanged : state.changedAccounts;

    document.getElementById('assignTitle').textContent =
      state.rebalanceMode ? 'SE Assignments - Editing' : 'SE Assignments';

    renderDiffBanner(state.viewMode, state.scenarioB, getDiff);
    renderSETable(filteredList, data, seNames, state.rebalanceMode, state.viewMode, changedSet);
  } else {
    document.getElementById('seTableBody').innerHTML = '';
    document.getElementById('diffBanner').style.display = 'none';
  }

  syncScenarioControls();
}

// ── Region panel open/close ───────────────────────────────────────────────────────
function openRegion(regionId) {
  selectedRegion = regionId;
  document.getElementById('rightPanelTitle').textContent = `${regionId} - SE Assignments`;
  document.getElementById('rightPanel').classList.add('open');
  document.getElementById('mapHint').classList.add('hidden');
  document.getElementById('btnCollapseMap').style.display = 'flex';
  render();
}

function closePanel() {
  selectedRegion = null;
  document.getElementById('rightPanel').classList.remove('open');
  document.getElementById('mapHint').classList.remove('hidden');
  document.getElementById('btnCollapseMap').style.display = 'none';
  if (document.querySelector('.app-body').classList.contains('map-collapsed')) {
    expandMap();
  }
  if (!state.rebalanceMode) hideAddSEForm();
  render();
}

// ── Diff ─────────────────────────────────────────────────────────────────────
function getDiff() {
  const origMap = Object.fromEntries(computeStats(DATA).map(s => [s.se, s]));
  const newMap  = Object.fromEntries(computeStats(state.scenarioB).map(s => [s.se, s]));
  const allSEs  = [...new Set([...Object.keys(origMap), ...Object.keys(newMap)])];
  return allSEs.reduce((acc, se) => {
    const origAccts = new Set(origMap[se] ? origMap[se].accounts.keys() : []);
    const newAccts  = new Set(newMap[se]  ? newMap[se].accounts.keys()  : []);
    const gained = [...newAccts].filter(a => !origAccts.has(a));
    const lost   = [...origAccts].filter(a => !newAccts.has(a));
    if (gained.length || lost.length) acc.push({ se, gained, lost });
    return acc;
  }, []);
}

// ── Rebalance actions ─────────────────────────────────────────────────────────
function reassignAccount(account, newSE) {
  let newLeader = '';
  const ref = state.workingData.find(r => r.se === newSE);
  if (ref) { newLeader = ref.se_leader; }
  else { const added = state.addedSEs.find(s => s.se === newSE); if (added) newLeader = added.se_leader; }
  state.workingData.forEach(r => { if (r.account === account) { r.se = newSE; r.se_leader = newLeader; } });
  const orig = DATA.find(r => r.account === account);
  if (orig && orig.se === newSE) state.changedAccounts.delete(account);
  else state.changedAccounts.add(account);
  render();
}

function removeSE(seName) {
  state.workingData.forEach(r => {
    if (r.se === seName) { state.changedAccounts.add(r.account); r.se = 'UNASSIGNED'; r.se_leader = ''; }
  });
  state.addedSEs = state.addedSEs.filter(s => s.se !== seName);
  render();
}

function toggleRebalance() {
  state.rebalanceMode = !state.rebalanceMode;
  const btn = document.getElementById('btnRebalance');
  btn.textContent = state.rebalanceMode ? 'Exit Edit Mode' : 'Edit Alignments Mode';
  btn.className   = state.rebalanceMode ? 'btn btn-amber sidebar-btn' : 'btn btn-ghost sidebar-btn';
  document.getElementById('rebalanceBanner').style.display = state.rebalanceMode ? 'flex' : 'none';
  document.querySelector('.app-body').classList.toggle('rebalance-active', state.rebalanceMode);
  if (!state.rebalanceMode) hideAddSEForm();
  render();
}

let regionEditMode = false;
function toggleRegionEdit() {
  regionEditMode = !regionEditMode;
  const btn = document.getElementById('btnEditRegions');
  btn.textContent = regionEditMode ? 'Done Editing Regions' : 'Edit Map Regions';
  btn.className   = regionEditMode ? 'btn btn-amber sidebar-btn' : 'btn btn-ghost sidebar-btn';

  if (regionEditMode) {
    if (selectedRegion) closePanel();
    enterStateEditMode();
  } else {
    exitStateEditMode();
    render();
  }
}

function collapseMap() {
  document.querySelector('.app-body').classList.add('map-collapsed');
  document.getElementById('btnCollapseMap').style.display = 'none';
  document.getElementById('btnExpandMap').style.display = 'flex';
}

function expandMap() {
  document.querySelector('.app-body').classList.remove('map-collapsed');
  document.getElementById('btnCollapseMap').style.display = selectedRegion ? 'flex' : 'none';
  document.getElementById('btnExpandMap').style.display = 'none';
  setTimeout(() => { window.dispatchEvent(new Event('resize')); }, 50);
}

function syncScenarioControls() {
  document.getElementById('scenarioControls').style.display =
    state.changedAccounts.size > 0 ? 'flex' : 'none';
}

function resetChanges() {
  state.workingData = DATA.map(r => ({...r}));
  state.changedAccounts.clear();
  state.addedSEs = [];
  hideAddSEForm();
  render();
}

function saveScenario() {
  state.scenarioB        = state.workingData.map(r => ({...r}));
  state.scenarioBChanged = new Set(state.changedAccounts);
  document.getElementById('viewToggleWrap').style.display = 'block';
  setViewMode('proposed');
}

function setViewMode(mode) {
  state.viewMode = mode;
  document.getElementById('btnViewCurrent').classList.toggle('active',  mode === 'current');
  document.getElementById('btnViewProposed').classList.toggle('active', mode === 'proposed');
  render();
}

// ── Add SE form ───────────────────────────────────────────────────────────────
function showAddSEForm() {
  const teams   = CONFIG.teams;
  const regions = CONFIG.regions;
  const leaders = [...new Set(teams.map(t => t.leader).filter(Boolean))];

  document.getElementById('newSESegment').innerHTML =
    teams.map(t => `<option value="${t.name}">${t.name}</option>`).join('') ||
    '<option value="">-</option>';
  document.getElementById('newSERegion').innerHTML =
    regions.map(r => `<option value="${r.name}">${r.name}</option>`).join('') ||
    '<option value="">-</option>';
  document.getElementById('newSELeader').innerHTML =
    (leaders.length
      ? leaders.map(l => `<option value="${l}">${l}</option>`)
      : ['<option value="">- none configured -</option>']
    ).join('');

  document.getElementById('addSEForm').style.display = 'block';
  document.getElementById('btnAddSE').style.display  = 'none';
}

function hideAddSEForm() {
  const form = document.getElementById('addSEForm');
  const btn  = document.getElementById('btnAddSE');
  if (form) form.style.display = 'none';
  if (btn)  btn.style.display  = 'block';
  ['newSEName', 'newSECity'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
}

function submitAddSE() {
  const name      = document.getElementById('newSEName').value.trim();
  const home_city = document.getElementById('newSECity').value.trim();
  const segment   = document.getElementById('newSESegment').value;
  const region    = document.getElementById('newSERegion').value;
  const leader    = document.getElementById('newSELeader').value;
  if (!name) { alert('Name is required'); return; }
  if (state.addedSEs.find(s => s.se === name) || state.workingData.find(r => r.se === name)) {
    alert('An SE with this name already exists'); return;
  }
  state.addedSEs.push({ se: name, segment, ae_region: region, se_leader: leader, home_city });
  hideAddSEForm();
  render();
}

// ── Settings panel ────────────────────────────────────────────────────────────
function openSettings() {
  renderSettings();
  // Always reset to first tab when re-opening
  switchSettingsTab('regions');
  document.getElementById('settingsOverlay').style.display = 'flex';
}

function closeSettings() {
  document.getElementById('settingsOverlay').style.display = 'none';
  saveConfig();
  render();
}

function importData() { alert('Import Data - coming in Run C'); }
function exportCSV()  { alert('Export CSV - coming in Run C'); }

// ── Person edit / add modal ───────────────────────────────────────────────────

const ROLE_DISPLAY = {
  SE: 'SE', AE: 'AE', RD: 'RD', RVP: 'RVP', SELeader: 'SE Leader'
};

let _peMode     = null; // 'edit' | 'add'
let _pePersonId = null;
let _peRole     = null;

function pePopulateRegions(selectedRegion) {
  document.getElementById('peRegion').innerHTML =
    CONFIG.regions.map(r =>
      `<option value="${r.name}"${r.name === selectedRegion ? ' selected' : ''}>${r.name}</option>`
    ).join('') || '<option value="">- no regions -</option>';
}

function openPersonEditModal(id) {
  const person = getPerson(id);
  if (!person) return;
  _peMode     = 'edit';
  _pePersonId = id;
  _peRole     = person.role;

  document.getElementById('peTitle').textContent   = `Edit ${ROLE_DISPLAY[person.role] || person.role}`;
  document.getElementById('peName').value          = person.name;
  document.getElementById('peCity').value          = person.city || '';
  document.getElementById('peActive').checked      = person.active !== false;
  pePopulateRegions(person.region);

  document.getElementById('personEditOverlay').style.display = 'flex';
  document.getElementById('peName').focus();
}

function openPersonAddModal(role) {
  _peMode     = 'add';
  _pePersonId = null;
  _peRole     = role;

  document.getElementById('peTitle').textContent = `Add ${ROLE_DISPLAY[role] || role}`;
  document.getElementById('peName').value        = '';
  document.getElementById('peCity').value        = '';
  document.getElementById('peActive').checked    = true;
  pePopulateRegions('');

  document.getElementById('personEditOverlay').style.display = 'flex';
  document.getElementById('peName').focus();
}

function closePersonModal() {
  document.getElementById('personEditOverlay').style.display = 'none';
  _peMode = _pePersonId = _peRole = null;
}

async function savePersonModal() {
  const name   = document.getElementById('peName').value.trim();
  const city   = document.getElementById('peCity').value.trim();
  const region = document.getElementById('peRegion').value;
  const active = document.getElementById('peActive').checked;

  if (!name) { alert('Name is required'); return; }

  if (_peMode === 'add') {
    addPerson({ name, role: _peRole, city, region });
    if (city) await geocodeNewCity(city);
  } else {
    const person = getPerson(_pePersonId);
    if (person) {
      if (name   !== person.name)           updatePersonName(_pePersonId, name);
      if (city   !== (person.city || ''))   { updatePersonCity(_pePersonId, city); if (city) await geocodeNewCity(city); }
      if (region !== person.region)         updatePersonRegion(_pePersonId, region);
      if (active !== (person.active !== false)) updatePersonActive(_pePersonId, active);
    }
  }

  closePersonModal();
  render();
}

/** Geocode a single new city and merge the result into geocache. */
async function geocodeNewCity(city) {
  try {
    const result = await geocodeCities([city]);
    Object.assign(geocache, result);
  } catch { /* non-fatal */ }
}

// ── Event wiring ──────────────────────────────────────────────────────────────
document.getElementById('btnManageData').addEventListener('click', () => openManageData(() => render()));
document.getElementById('btnRebalance').addEventListener('click', toggleRebalance);
document.getElementById('btnExitRebalance').addEventListener('click', toggleRebalance);
document.getElementById('btnEditRegions').addEventListener('click', toggleRegionEdit);
document.getElementById('btnCollapseMap').addEventListener('click', collapseMap);
document.getElementById('btnExpandMap').addEventListener('click', expandMap);
document.getElementById('btnAddSE').addEventListener('click', showAddSEForm);
document.getElementById('btnSubmitAddSE').addEventListener('click', submitAddSE);
document.getElementById('btnCancelAddSE').addEventListener('click', hideAddSEForm);
document.getElementById('btnSettings').addEventListener('click', openSettings);
document.getElementById('btnImport').addEventListener('click', importData);
document.getElementById('btnExport').addEventListener('click', exportCSV);
document.getElementById('btnViewCurrent').addEventListener('click',  () => setViewMode('current'));
document.getElementById('btnViewProposed').addEventListener('click', () => setViewMode('proposed'));
document.getElementById('btnResetChanges').addEventListener('click', resetChanges);
document.getElementById('btnSaveScenario').addEventListener('click', saveScenario);
document.getElementById('btnCloseSettings').addEventListener('click', closeSettings);
document.getElementById('btnClosePanel').addEventListener('click', closePanel);
document.getElementById('settingsOverlay').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeSettings();
});
document.getElementById('btnAddRegion').addEventListener('click', addRegion);
document.getElementById('btnAddTeam').addEventListener('click', addTeam);

// Person modal buttons
document.getElementById('btnClosePerson').addEventListener('click', closePersonModal);
document.getElementById('btnPeCancel').addEventListener('click', closePersonModal);
document.getElementById('btnPeSave').addEventListener('click', savePersonModal);
document.getElementById('personEditOverlay').addEventListener('click', e => {
  if (e.target === e.currentTarget) closePersonModal();
});
// Allow Enter key to save in text inputs
document.getElementById('personEditOverlay').addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') {
    savePersonModal();
  }
  if (e.key === 'Escape') closePersonModal();
});

// Layer toggle checkboxes
document.querySelectorAll('.layer-toggles input[data-role]').forEach(cb => {
  cb.addEventListener('change', () => {
    if (cb.checked) visibleLayers.add(cb.dataset.role);
    else visibleLayers.delete(cb.dataset.role);
    refreshMarkers();
  });
});

// Map region-selected event
document.addEventListener('region-selected', e => openRegion(e.detail.regionId));

// SE marker click - scroll + highlight the SE's row in the right panel
document.addEventListener('se-highlight', e => {
  const { seName } = e.detail;

  // Open the correct region panel if it isn't already
  const data = (state.viewMode === 'proposed' && state.scenarioB) ? state.scenarioB : state.workingData;
  const seRecord = data.find(r => r.se === seName);
  if (seRecord && selectedRegion !== seRecord.ae_region) {
    openRegion(seRecord.ae_region);
  }

  requestAnimationFrame(() => {
    let row = null;
    for (const r of document.querySelectorAll('#seTableBody .se-row')) {
      if (r.dataset.sename === seName) { row = r; break; }
    }
    if (!row) return;

    // Expand the row if it's collapsed
    if (!row.classList.contains('open')) {
      row.classList.add('open');
      const expandInner = row.nextElementSibling?.querySelector('.expand-inner');
      if (expandInner) expandInner.classList.add('open');
    }

    // Scroll into view
    row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    // Restart pulse animation (handle rapid re-clicks cleanly)
    row.classList.remove('highlight');
    void row.offsetWidth; // force reflow so the animation restarts
    row.classList.add('highlight');
    setTimeout(() => row.classList.remove('highlight'), 2000);
  });
});

// SE drag-to-region reassignment
document.addEventListener('se-region-move', e => {
  const { seName, newRegion, newCity } = e.detail;
  state.workingData.forEach(r => {
    if (r.se === seName) {
      r.ae_region = newRegion;
      r.home_city = newCity;
      state.changedAccounts.add(r.account);
    }
  });
  render();
});

// Person edit modal - dispatched from config.js (settings) or table-view.js (AE click)
document.addEventListener('open-person-edit', e => openPersonEditModal(e.detail.id));
document.addEventListener('open-person-add',  e => openPersonAddModal(e.detail.role));
document.addEventListener('edit-person',      e => openPersonEditModal(e.detail.personId));

// Personnel CRUD completed in config.js - refresh main view
document.addEventListener('personnel-changed', () => render());

// ── Boot ──────────────────────────────────────────────────────────────────────
// ── Sidebar resize / collapse ────────────────────────────────────────────────
const SIDEBAR_KEY = 'se-planner-sidebar';
const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 520;
const SIDEBAR_DEFAULT = 320;

function loadSidebarState() {
  try { return JSON.parse(localStorage.getItem(SIDEBAR_KEY) || '{}'); } catch { return {}; }
}
function saveSidebarState(s) {
  try { localStorage.setItem(SIDEBAR_KEY, JSON.stringify(s)); } catch {}
}

function applySidebarState() {
  const sidebar = document.getElementById('sidebar');
  const expandBtn = document.getElementById('btnSidebarExpand');
  const collapseBtn = document.getElementById('btnSidebarCollapse');
  if (!sidebar) return;
  const s = loadSidebarState();
  const width = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, s.width || SIDEBAR_DEFAULT));
  sidebar.style.width = width + 'px';
  if (s.collapsed) {
    sidebar.classList.add('collapsed');
    if (expandBtn) expandBtn.style.display = 'flex';
    if (collapseBtn) collapseBtn.style.display = 'none';
  } else {
    sidebar.classList.remove('collapsed');
    if (expandBtn) expandBtn.style.display = 'none';
    if (collapseBtn) collapseBtn.style.display = 'flex';
  }
  invalidateMapSize();
}

function setSidebarCollapsed(collapsed) {
  const s = loadSidebarState();
  s.collapsed = !!collapsed;
  saveSidebarState(s);
  applySidebarState();
}

function setSidebarWidth(width) {
  const w = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, width));
  const s = loadSidebarState();
  s.width = w;
  s.collapsed = false;
  saveSidebarState(s);
  const sidebar = document.getElementById('sidebar');
  if (sidebar) {
    sidebar.classList.remove('collapsed');
    sidebar.style.width = w + 'px';
  }
}

function initSidebarControls() {
  const sidebar = document.getElementById('sidebar');
  const resizer = document.getElementById('sidebarResizer');
  const collapseBtn = document.getElementById('btnSidebarCollapse');
  const expandBtn = document.getElementById('btnSidebarExpand');
  if (!sidebar || !resizer) return;

  applySidebarState();

  if (collapseBtn) collapseBtn.addEventListener('click', () => setSidebarCollapsed(true));
  if (expandBtn) expandBtn.addEventListener('click', () => setSidebarCollapsed(false));

  // Drag-to-resize
  let dragging = false;
  let rafId = null;
  resizer.addEventListener('mousedown', e => {
    e.preventDefault();
    dragging = true;
    sidebar.classList.add('resizing');
    document.body.style.cursor = 'col-resize';
  });
  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    const rect = sidebar.getBoundingClientRect();
    const newWidth = e.clientX - rect.left;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      if (newWidth < SIDEBAR_MIN - 40) {
        // Drag well under minimum collapses the sidebar
        setSidebarCollapsed(true);
        dragging = false;
        sidebar.classList.remove('resizing');
        document.body.style.cursor = '';
      } else {
        setSidebarWidth(newWidth);
      }
    });
  });
  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    sidebar.classList.remove('resizing');
    document.body.style.cursor = '';
    invalidateMapSize();
  });

  // Double-click the resizer to toggle collapsed
  resizer.addEventListener('dblclick', () => {
    const isCollapsed = sidebar.classList.contains('collapsed');
    setSidebarCollapsed(!isCollapsed);
  });
}

initMap('map');
initSidebarControls();
render();

// Async geocoding - collect all role cities then render markers
(async () => {
  const mapHint = document.getElementById('mapHint');
  if (mapHint) mapHint.textContent = 'Geocoding locations...';

  const cityFields = ['home_city', 'ae_city', 'rd_city', 'rvp_city', 'se_leader_city'];
  const cities = [...new Set(
    DATA.flatMap(r => cityFields.map(f => r[f]).filter(Boolean))
  )];

  try {
    geocache = await geocodeCities(cities);
  } catch {
    geocache = {};
  }

  if (mapHint && !mapHint.classList.contains('hidden')) {
    mapHint.textContent = 'Click a region to view SE assignments';
  }
  refreshMarkers();
})();
