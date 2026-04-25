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
import { getAccountByName } from './accounts.js';
import { computeStats, renderRegionGrid, computeHireProposal, workload } from './stats.js';
import { renderDiffBanner, renderSETable } from './table-view.js';
import { initMap, updateRegionShading, renderRoleMarkers, enterStateEditMode, exitStateEditMode, invalidateMapSize, reloadMapScope } from './map-view.js';
import { initTheme } from './theme.js';
import { exportXLS } from './export-xls.js';
import { roleLabel } from './config.js';
import { geocodeCities } from './geocode.js';

// ── Expose globals required by dynamically-generated inline onclick/oninput HTML ──
// (region/team helpers are exposed by config.js; personnel helpers by config.js)
window.removeSE        = removeSE;
window.reassignAccount = reassignAccount;

// ── Notes modal ────────────────────────────────────────────────────────────────────────────────
// _notesTarget = { kind: 'account'|'person', key: accountName | personId }
let _notesTarget = null;

function _esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Turn any http(s) URLs in the notes text into clickable anchors, preserving the rest as escaped text.
function _linkify(text) {
  const urlRe = /(https?:\/\/[^\s<>"')]+)/g;
  let result = '';
  let lastIdx = 0;
  let match;
  while ((match = urlRe.exec(text)) !== null) {
    result += _esc(text.slice(lastIdx, match.index));
    const url = match[0];
    result += `<a href="${_esc(url)}" target="_blank" rel="noopener noreferrer">${_esc(url)}</a>`;
    lastIdx = match.index + url.length;
  }
  result += _esc(text.slice(lastIdx));
  return result;
}

function closeNotesModal() {
  document.getElementById('notesOverlay').style.display = 'none';
  _notesTarget = null;
}

function _resolveNotesTarget() {
  if (!_notesTarget) return { title: '', notes: '', editTab: null };
  if (_notesTarget.kind === 'account') {
    const acct = getAccountByName(_notesTarget.key);
    return { title: _notesTarget.key, notes: acct?.notes || '', editTab: 'accounts' };
  }
  if (_notesTarget.kind === 'person') {
    const p = PEOPLE.find(pp => pp.id === _notesTarget.key);
    const label = p ? `${p.name}${p.role ? ' · ' + p.role : ''}` : 'Person';
    return { title: label, notes: p?.notes || '', editTab: 'people' };
  }
  return { title: '', notes: '', editTab: null };
}

function _showNotesModal() {
  const { title, notes } = _resolveNotesTarget();
  document.getElementById('notesAccountName').textContent = title;
  const body = document.getElementById('notesBody');
  body.innerHTML = notes
    ? _linkify(notes)
    : '<span class="notes-empty">No notes yet.</span>';
  document.getElementById('notesOverlay').style.display = 'flex';
}

window.openNotesModal = (accountName) => {
  _notesTarget = { kind: 'account', key: accountName };
  _showNotesModal();
};

window.openPersonNotesModal = (personId) => {
  _notesTarget = { kind: 'person', key: personId };
  _showNotesModal();
};

document.getElementById('btnCloseNotes').addEventListener('click', closeNotesModal);
document.getElementById('btnDoneNotes').addEventListener('click', closeNotesModal);
document.getElementById('notesOverlay').addEventListener('click', e => {
  if (e.target.id === 'notesOverlay') closeNotesModal();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('notesOverlay').style.display === 'flex') {
    closeNotesModal();
  }
});
document.getElementById('btnCopyNotes').addEventListener('click', async () => {
  const { notes } = _resolveNotesTarget();
  if (!notes) return;
  try {
    await navigator.clipboard.writeText(notes);
    const btn = document.getElementById('btnCopyNotes');
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = orig; }, 1200);
  } catch {}
});
document.getElementById('btnEditNotes').addEventListener('click', () => {
  const { editTab } = _resolveNotesTarget();
  closeNotesModal();
  openManageData(() => render());
  if (editTab && typeof window.mdSwitchTab === 'function') window.mdSwitchTab(editTab);
});

// ── Local state ───────────────────────────────────────────────────────────────
let selectedRegion = null;
let geocache = {};
// Visible map layers — persisted to localStorage so the selection survives reloads.
const LAYERS_STORAGE_KEY = 'secp:visibleLayers';
let visibleLayers;
try {
  const stored = JSON.parse(localStorage.getItem(LAYERS_STORAGE_KEY) || 'null');
  visibleLayers = Array.isArray(stored) ? new Set(stored) : new Set(['SE', 'AE']);
} catch {
  visibleLayers = new Set(['SE', 'AE']);
}
function _persistLayers() {
  try { localStorage.setItem(LAYERS_STORAGE_KEY, JSON.stringify([...visibleLayers])); } catch {}
}

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
  // When viewing the proposed scenario, surface wizard TBHs even if empty (so the user sees the headcount ask).
  const extraForView = (state.viewMode === 'proposed' && state.scenarioBAddedSEs)
    ? state.scenarioBAddedSEs
    : (state.rebalanceMode ? state.addedSEs : []);
  const seList  = computeStats(data, extraForView);
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
  document.dispatchEvent(new CustomEvent('regions-rendered'));

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

    renderDiffBanner(state.viewMode, state.scenarioB, getDiff, state.scenarioBNarrative || '');
    const sourceAdded = state.viewMode === 'proposed' ? (state.scenarioBAddedSEs || []) : state.addedSEs;
    const proposedSet = new Set(sourceAdded.filter(s => s.proposedByWizard).map(s => s.se));
    // Update column headers to reflect current role labels
    const hSe = document.getElementById('hdr-seName');
    const hLd = document.getElementById('hdr-seLeader');
    if (hSe) hSe.textContent = `${roleLabel('se')} Name`;
    if (hLd) hLd.textContent = roleLabel('seLeader');
    renderSETable(filteredList, data, seNames, state.rebalanceMode, state.viewMode, changedSet, proposedSet);
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
  // Update only the title text inside the menu item (preserve icon/desc structure)
  const titleEl = btn ? btn.querySelector('.menu-item-title') : null;
  if (titleEl) {
    titleEl.textContent = state.rebalanceMode ? 'Exit Edit Alignments' : 'Edit Alignments';
  } else if (btn) {
    btn.textContent = state.rebalanceMode ? 'Exit Edit Mode' : 'Edit Alignments';
  }
  if (btn) btn.classList.toggle('menu-item-active', state.rebalanceMode);
  document.getElementById('rebalanceBanner').style.display = state.rebalanceMode ? 'flex' : 'none';
  document.querySelector('.app-body').classList.toggle('rebalance-active', state.rebalanceMode);
  if (!state.rebalanceMode) hideAddSEForm();
  syncProposedRevertBtn();
  render();
}

let regionEditMode = false;
function toggleRegionEdit() {
  regionEditMode = !regionEditMode;
  const btn = document.getElementById('btnEditRegions');
  const titleEl = btn ? btn.querySelector('.menu-item-title') : null;
  if (titleEl) {
    titleEl.textContent = regionEditMode ? 'Done Editing Regions' : 'Edit Map Regions';
  } else if (btn) {
    btn.textContent = regionEditMode ? 'Done Editing Regions' : 'Edit Map Regions';
  }
  if (btn) btn.classList.toggle('menu-item-active', regionEditMode);

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
  // Clear the inline width so the .map-collapsed CSS rule (width:100%) can take effect.
  // The user's preferred width is still in localStorage; we restore it on expandMap.
  const panel = document.getElementById('rightPanel');
  if (panel) panel.style.width = '';
  document.getElementById('btnCollapseMap').style.display = 'none';
  document.getElementById('btnExpandMap').style.display = 'flex';
}

function expandMap() {
  document.querySelector('.app-body').classList.remove('map-collapsed');
  // Restore the user's preferred panel width (or default).
  _applyRightPanelWidth(_loadRightPanelWidth());
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
  state.lastProposalNarrative = '';
  // Also clear any saved scenario — a fully-reset working set has nothing to compare against.
  _clearSavedScenario();
  hideAddSEForm();
  syncProposedRevertBtn();
  render();
}

function _clearSavedScenario() {
  state.scenarioB = null;
  state.scenarioBChanged = new Set();
  state.scenarioBAddedSEs = null;
  state.scenarioBNarrative = '';
  state.viewMode = 'current';
  document.getElementById('viewToggleWrap').style.display = 'none';
  document.getElementById('btnViewCurrent').classList.add('active');
  document.getElementById('btnViewProposed').classList.remove('active');
}

function saveScenario() {
  state.scenarioB         = state.workingData.map(r => ({...r}));
  state.scenarioBChanged  = new Set(state.changedAccounts);
  state.scenarioBAddedSEs = state.addedSEs.map(s => ({ ...s }));
  state.scenarioBNarrative = state.lastProposalNarrative || '';
  document.getElementById('viewToggleWrap').style.display = 'block';
  setViewMode('proposed');
}

// ── Propose Hires wizard (Capacity & Hires: Push 2) ───────────────────────────────────────

let _currentProposal = null;

function openProposeHiresModal() {
  if (!state.rebalanceMode) {
    alert('Enter Edit Alignments mode first.');
    return;
  }
  // Compute proposal from the current working data + any wizard TBHs already in state.addedSEs
  // Excluding wizard-proposed TBHs from the proposal calc so we don't pile up hires on top of hires.
  const dataView = state.workingData;
  const seList   = computeStats(dataView, []); // no added SEs for the calc
  const proposal = computeHireProposal(seList);

  const body = document.getElementById('proposeBody');
  if (!proposal.totalHires) {
    body.innerHTML = `<div style="padding:4px 0">
      <div style="font-size:14px;font-weight:700;color:var(--green);margin-bottom:8px">\u2713 No hires needed</div>
      <div style="color:var(--muted);font-size:13px">Every active SE is already at or below the Healthy threshold based on your current <strong style="color:var(--text)">Workload</strong> settings.</div>
    </div>`;
    document.getElementById('btnConfirmPropose').style.display = 'none';
  } else {
    document.getElementById('btnConfirmPropose').style.display = '';
    const groupHtml = proposal.groups.map(g => {
      const relievedSEs = g.fromSEs.map(f =>
        `<li><strong>${_esc(f.se)}</strong>: ${f.before.accounts} \u2192 ${f.after.accounts} accounts</li>`
      ).join('');
      return `<div class="propose-group">
        <div class="propose-group-title">${_esc(g.region)} \u00b7 ${_esc(g.segment)}</div>
        <div class="propose-group-hires"><strong>+${g.hiresNeeded}</strong> new SE${g.hiresNeeded !== 1 ? 's' : ''}</div>
        <ul class="propose-relief">${relievedSEs || '<li style="color:var(--muted)">(no relief)</li>'}</ul>
      </div>`;
    }).join('');
    body.innerHTML = `
      <div style="font-size:14px;font-weight:700;color:var(--strong);margin-bottom:12px">
        Proposing <span style="color:var(--accent)">${proposal.totalHires}</span> new SE${proposal.totalHires !== 1 ? 's' : ''}
      </div>
      <div style="color:var(--muted);font-size:12px;margin-bottom:14px;line-height:1.6">
        Based on your current <strong style="color:var(--text)">Workload</strong> thresholds. Accounts will be reassigned from overloaded SEs to new TBHs within the same region and segment. You can adjust assignments after adding.
      </div>
      ${groupHtml}
    `;
  }

  _currentProposal = proposal;
  document.getElementById('proposeHiresOverlay').style.display = 'flex';
}

function closeProposeHiresModal() {
  document.getElementById('proposeHiresOverlay').style.display = 'none';
  _currentProposal = null;
}

function applyProposal() {
  if (!_currentProposal || !_currentProposal.totalHires) { closeProposeHiresModal(); return; }

  // 1) Create wizard-proposed TBHs in state.addedSEs (marked proposedByWizard:true)
  _currentProposal.groups.forEach(g => {
    g.tbhLabels.forEach(label => {
      // Derive a plausible leader from one of the relieved SEs in this group (for context)
      const existingRow = state.workingData.find(r =>
        r.ae_region === g.region && r.segment === g.segment && r.se_leader
      );
      const leader = existingRow ? existingRow.se_leader : '';
      if (state.addedSEs.find(s => s.se === label)) return; // shouldn't collide, but guard
      state.addedSEs.push({
        se: label,
        segment: g.segment,
        ae_region: g.region,
        se_leader: leader,
        home_city: '',
        proposedByWizard: true
      });
    });
  });

  // 2) Apply all account moves: mutate state.workingData rows so r.se points at the new TBH.
  const moveCount = _currentProposal.groups.reduce((n, g) => n + g.moves.length, 0);
  _currentProposal.groups.forEach(g => {
    g.moves.forEach(mv => {
      state.workingData.forEach(r => {
        if (r.account === mv.account && r.se === mv.from) {
          r.se = mv.to;
          r.se_leader = ''; // TBH has no real leader yet
          state.changedAccounts.add(r.account);
        }
      });
    });
  });

  // 3) Save a narrative summary so Save as Scenario can display it
  state.lastProposalNarrative = _buildProposalNarrative(_currentProposal, moveCount);

  closeProposeHiresModal();
  render();
  syncProposedRevertBtn();
}

function _buildProposalNarrative(proposal, moveCount) {
  if (!proposal || !proposal.totalHires) return '';
  const byRegion = {};
  proposal.groups.forEach(g => {
    if (!byRegion[g.region]) byRegion[g.region] = { total: 0, segments: [] };
    byRegion[g.region].total += g.hiresNeeded;
    byRegion[g.region].segments.push(`${g.hiresNeeded} ${g.segment}`);
  });
  const regionBits = Object.entries(byRegion)
    .map(([region, info]) => `${region} +${info.total} (${info.segments.join(', ')})`)
    .join('; ');
  return `Proposed ${proposal.totalHires} hire${proposal.totalHires !== 1 ? 's' : ''} to reduce overload: ${regionBits}. Reassigned ${moveCount} account${moveCount !== 1 ? 's' : ''} to the new TBHs within the same region + segment.`;
}

function revertProposedHires() {
  const wizardTBHs = new Set(state.addedSEs.filter(s => s.proposedByWizard).map(s => s.se));
  if (!wizardTBHs.size) return;
  if (!confirm(`Revert ${wizardTBHs.size} proposed hire${wizardTBHs.size !== 1 ? 's' : ''} and move the reassigned accounts back to their previous SEs?`)) return;

  // Pull DATA rows for comparison so we can restore the original SE for each account that was moved to a wizard TBH.
  const originalBySe = {};
  DATA.forEach(r => { if (r.account && r.se) originalBySe[r.account] = { se: r.se, se_leader: r.se_leader }; });

  state.workingData.forEach(r => {
    if (wizardTBHs.has(r.se)) {
      const orig = originalBySe[r.account];
      if (orig) {
        r.se = orig.se;
        r.se_leader = orig.se_leader || '';
      }
      // Leave r in changedAccounts so scenarioB diff math stays consistent; user can Reset Changes to fully clear.
    }
  });
  state.addedSEs = state.addedSEs.filter(s => !s.proposedByWizard);
  state.lastProposalNarrative = '';
  // Re-derive changedAccounts from a true diff between workingData and DATA so reverted accounts aren't flagged.
  _rebuildChangedAccountsFromDiff();
  // If nothing actually differs anymore, drop the saved scenario so the Proposed toggle disappears.
  if (!state.changedAccounts.size && !state.addedSEs.length) {
    _clearSavedScenario();
  }
  render();
  syncProposedRevertBtn();
}

function _rebuildChangedAccountsFromDiff() {
  const origBySe = {};
  DATA.forEach(r => { if (r.account) origBySe[r.account] = r.se; });
  state.changedAccounts.clear();
  state.workingData.forEach(r => {
    if (r.account && origBySe[r.account] !== undefined && origBySe[r.account] !== r.se) {
      state.changedAccounts.add(r.account);
    }
  });
}

function syncProposedRevertBtn() {
  const btn = document.getElementById('btnRevertProposed');
  if (!btn) return;
  const hasWizardTBHs = state.addedSEs.some(s => s.proposedByWizard);
  btn.style.display = (state.rebalanceMode && hasWizardTBHs) ? '' : 'none';
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
  switchSettingsTab('map');
  document.getElementById('settingsOverlay').style.display = 'flex';
}

function closeSettings() {
  document.getElementById('settingsOverlay').style.display = 'none';
  saveConfig();
  render();
}

function importData() { alert('Import Data - coming in Run C'); }
function doExport() { exportXLS(); }

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
document.getElementById('btnExport').addEventListener('click', doExport);
document.getElementById('btnViewCurrent').addEventListener('click',  () => setViewMode('current'));
document.getElementById('btnViewProposed').addEventListener('click', () => setViewMode('proposed'));
document.getElementById('btnResetChanges').addEventListener('click', resetChanges);
document.getElementById('btnSaveScenario').addEventListener('click', saveScenario);

// Propose Hires modal + revert button
document.getElementById('btnProposeHires').addEventListener('click', openProposeHiresModal);
document.getElementById('btnRevertProposed').addEventListener('click', revertProposedHires);
document.getElementById('btnClosePropose').addEventListener('click', closeProposeHiresModal);
document.getElementById('btnCancelPropose').addEventListener('click', closeProposeHiresModal);
document.getElementById('btnConfirmPropose').addEventListener('click', applyProposal);
document.getElementById('proposeHiresOverlay').addEventListener('click', e => {
  if (e.target.id === 'proposeHiresOverlay') closeProposeHiresModal();
});
document.getElementById('btnCloseSettings').addEventListener('click', closeSettings);
document.getElementById('btnClosePanel').addEventListener('click', closePanel);
document.getElementById('settingsOverlay').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeSettings();
});
// btnAddRegion / btnAddTeam were removed from Settings; regions/teams now live in Manage Data.
// Keep these guarded in case a legacy layout is ever reintroduced.
const _btnAddRegion = document.getElementById('btnAddRegion');
if (_btnAddRegion) _btnAddRegion.addEventListener('click', addRegion);
const _btnAddTeam = document.getElementById('btnAddTeam');
if (_btnAddTeam) _btnAddTeam.addEventListener('click', addTeam);

// Map scope change — reload map, close settings so user sees the new view
document.addEventListener('map-scope-changed', async () => {
  await reloadMapScope();
  closeSettings();
});

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
document.querySelectorAll('#layerToggles input[data-role]').forEach(cb => {
  // Restore persisted state on load
  cb.checked = visibleLayers.has(cb.dataset.role);
  cb.addEventListener('change', () => {
    if (cb.checked) visibleLayers.add(cb.dataset.role);
    else visibleLayers.delete(cb.dataset.role);
    _persistLayers();
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

// Regions/Teams CRUD completed in manage-data.js - refresh main view + map
document.addEventListener('regions-changed', () => render());
document.addEventListener('teams-changed',   () => render());

// Workload rubric changed in settings - recompute badges everywhere
document.addEventListener('workload-changed', () => render());

// Quota tracking config changed - re-render to show/hide quota column + recompute attainment
document.addEventListener('quota-changed', () => render());

// Role labels changed - re-render the SE table and re-open Manage Data if it's open
document.addEventListener('role-labels-changed', () => render());

// Theme changed - re-render so markers (and any inline-styled elements that snapshot CSS values) refresh.
document.addEventListener('theme-changed', () => render());

// ── Boot ──────────────────────────────────────────────────────────────────────
// ── Sidebar resize / collapse ────────────────────────────────────────────────
const SIDEBAR_KEY = 'se-planner-sidebar';
const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 520;
const SIDEBAR_DEFAULT = 320;

// Right panel resize state (persisted under secp:rightPanelWidth)
const RIGHT_PANEL_KEY = 'secp:rightPanelWidth';
const RIGHT_PANEL_MIN = 480;
const RIGHT_PANEL_MAX = 1400;
const RIGHT_PANEL_DEFAULT = 760;

function _loadRightPanelWidth() {
  try {
    const v = parseInt(localStorage.getItem(RIGHT_PANEL_KEY), 10);
    if (isNaN(v)) return RIGHT_PANEL_DEFAULT;
    return Math.max(RIGHT_PANEL_MIN, Math.min(RIGHT_PANEL_MAX, v));
  } catch { return RIGHT_PANEL_DEFAULT; }
}
function _saveRightPanelWidth(w) {
  try { localStorage.setItem(RIGHT_PANEL_KEY, String(w)); } catch {}
}
function _applyRightPanelWidth(w) {
  const panel = document.getElementById('rightPanel');
  if (!panel) return;
  panel.style.width = w + 'px';
}

// ── Edit dropdown menu ────────────────────────────────────────────────────────────────────────
function initEditMenu() {
  const wrap = document.getElementById('editMenuWrap');
  const btn  = document.getElementById('btnEditMenu');
  const menu = document.getElementById('editMenu');
  if (!wrap || !btn || !menu) return;

  function close() {
    wrap.classList.remove('open');
    btn.setAttribute('aria-expanded', 'false');
  }
  function toggle() {
    const isOpen = wrap.classList.toggle('open');
    btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  }

  btn.addEventListener('click', e => { e.stopPropagation(); toggle(); });
  // Close on item click (the item handlers run their own action separately)
  menu.querySelectorAll('.menu-item').forEach(item => {
    item.addEventListener('click', () => setTimeout(close, 0));
  });
  // Click outside closes
  document.addEventListener('click', e => {
    if (!wrap.contains(e.target)) close();
  });
  // Escape closes
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') close();
  });
}

// ── Region card collapse ─────────────────────────────────────────────────────────────────────
const REGION_COLLAPSE_KEY = 'secp:regionsCollapsed';
let _regionsAllCollapsed = false;
try { _regionsAllCollapsed = localStorage.getItem(REGION_COLLAPSE_KEY) === '1'; } catch {}

function initRegionCardCollapse() {
  const allBtn = document.getElementById('btnCollapseAllRegions');
  if (allBtn) {
    _syncCollapseAllBtn();
    allBtn.addEventListener('click', () => {
      _regionsAllCollapsed = !_regionsAllCollapsed;
      try { localStorage.setItem(REGION_COLLAPSE_KEY, _regionsAllCollapsed ? '1' : '0'); } catch {}
      _syncCollapseAllBtn();
      _applyRegionsCollapseState();
    });
  }
  // Per-card click: toggle individual collapse on header click
  document.getElementById('regionGrid').addEventListener('click', e => {
    const header = e.target.closest('.region-header');
    if (!header) return;
    const card = header.closest('.region-card');
    if (card) card.classList.toggle('collapsed');
  });
}
function _syncCollapseAllBtn() {
  const btn = document.getElementById('btnCollapseAllRegions');
  if (!btn) return;
  btn.setAttribute('aria-pressed', _regionsAllCollapsed ? 'true' : 'false');
  btn.title = _regionsAllCollapsed ? 'Expand all regions' : 'Collapse all regions';
}
function _applyRegionsCollapseState() {
  document.querySelectorAll('#regionGrid .region-card').forEach(card => {
    card.classList.toggle('collapsed', _regionsAllCollapsed);
  });
}
// Re-apply collapse state after each region grid render.
document.addEventListener('regions-rendered', _applyRegionsCollapseState);

function initRightPanelResize() {
  const panel = document.getElementById('rightPanel');
  const resizer = document.getElementById('rightPanelResizer');
  if (!panel || !resizer) return;

  // Restore persisted width
  _applyRightPanelWidth(_loadRightPanelWidth());

  let dragging = false;
  let rafId = null;

  resizer.addEventListener('mousedown', e => {
    e.preventDefault();
    dragging = true;
    panel.classList.add('resizing');
    document.body.style.cursor = 'col-resize';
  });
  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    // Panel is anchored to the right; width = (viewport right edge) - (mouse x)
    const newWidth = window.innerWidth - e.clientX;
    const clamped = Math.max(RIGHT_PANEL_MIN, Math.min(RIGHT_PANEL_MAX, newWidth));
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      _applyRightPanelWidth(clamped);
      invalidateMapSize();
    });
  });
  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    panel.classList.remove('resizing');
    document.body.style.cursor = '';
    const finalWidth = parseInt(panel.style.width, 10);
    if (!isNaN(finalWidth)) _saveRightPanelWidth(finalWidth);
    invalidateMapSize();
  });
}

function loadSidebarState() {
  try { return JSON.parse(localStorage.getItem(SIDEBAR_KEY) || '{}'); } catch { return {}; }
}
function saveSidebarState(s) {
  try { localStorage.setItem(SIDEBAR_KEY, JSON.stringify(s)); } catch {}
}

// Repeatedly invalidate map size during the sidebar CSS width transition
// so Leaflet tiles reflow smoothly instead of exposing dead space.
function invalidateMapSizeDuringTransition() {
  invalidateMapSize();
  const start = performance.now();
  const duration = 220; // slightly longer than the 0.18s CSS transition
  function tick(now) {
    invalidateMapSize();
    if (now - start < duration) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function applySidebarState() {
  const sidebar = document.getElementById('sidebar');
  const expandBtn = document.getElementById('btnSidebarExpand');
  const collapseBtn = document.getElementById('btnSidebarCollapse');
  if (!sidebar) return;
  const s = loadSidebarState();
  const width = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, s.width || SIDEBAR_DEFAULT));
  sidebar.style.width = width + 'px';
  // Track current sidebar width as a CSS variable so the collapse button can ride the right edge.
  document.documentElement.style.setProperty('--sidebar-w', (s.collapsed ? 0 : width) + 'px');
  if (s.collapsed) {
    sidebar.classList.add('collapsed');
    if (expandBtn) expandBtn.style.display = 'flex';
    if (collapseBtn) collapseBtn.style.display = 'none';
  } else {
    sidebar.classList.remove('collapsed');
    if (expandBtn) expandBtn.style.display = 'none';
    if (collapseBtn) collapseBtn.style.display = 'flex';
  }
  invalidateMapSizeDuringTransition();
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
  document.documentElement.style.setProperty('--sidebar-w', w + 'px');
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

  // Also invalidate on every drag tick so map tiles reflow while resizing
  const origHandler = document.onmousemove;
  document.addEventListener('mousemove', () => { if (dragging) invalidateMapSize(); });

  // Double-click the resizer to toggle collapsed
  resizer.addEventListener('dblclick', () => {
    const isCollapsed = sidebar.classList.contains('collapsed');
    setSidebarCollapsed(!isCollapsed);
  });
}

initTheme();
initMap('map');
initSidebarControls();
initRightPanelResize();
initEditMenu();
initRegionCardCollapse();
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
