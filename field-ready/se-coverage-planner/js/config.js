import { PEOPLE, getPerson, countDependencies, removePerson, ORPHAN_VALUE } from './roster.js';
import { REGION_STATES as DEFAULT_REGION_STATES } from './data.js';

const DEFAULT_CONFIG = {
  regions: [
    {name:'West',    color:'#6366f1'},
    {name:'Central', color:'#22c55e'},
    {name:'East',    color:'#f59e0b'}
  ],
  teams: [
    {name:'Majors',    leader:'Mike Torres'},
    {name:'Key',       leader:'Lisa Park'},
    {name:'Strategic', leader:'Dan Cross'}
  ],
  regionStates: null,  // lazily initialized from DEFAULT_REGION_STATES
  quotas: {
    levels: { account: false, ae: false, se: false },
    buffer: 0.20,
    displayPeriod: 'annual'
  }
};

export function loadConfig() {
  try {
    const s = localStorage.getItem('se-planner-config');
    return s ? JSON.parse(s) : JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  } catch(e) { return JSON.parse(JSON.stringify(DEFAULT_CONFIG)); }
}

export function saveConfig() {
  localStorage.setItem('se-planner-config', JSON.stringify(CONFIG));
}

export let CONFIG = loadConfig();

// Ensure regionStates exists (backfill for existing users who have older config in localStorage)
if (!CONFIG.regionStates) {
  CONFIG.regionStates = JSON.parse(JSON.stringify(DEFAULT_REGION_STATES));
  saveConfig();
}

// Ensure quotas config exists (backfill for existing users)
if (!CONFIG.quotas) {
  CONFIG.quotas = { levels: { account: false, ae: false, se: false }, buffer: 0.20, displayPeriod: 'annual' };
  saveConfig();
}
if (!CONFIG.quotas.levels) {
  CONFIG.quotas.levels = { account: false, ae: false, se: false };
  saveConfig();
}

// ── State ↔ region mapping helpers ─────────────────────────────────────────────

export function getRegionForState(stateName) {
  for (const [regionId, stateList] of Object.entries(CONFIG.regionStates)) {
    if (stateList.includes(stateName)) return regionId;
  }
  return null;
}

export function assignStateToRegion(stateName, regionId) {
  // Remove state from any existing region
  Object.keys(CONFIG.regionStates).forEach(r => {
    CONFIG.regionStates[r] = CONFIG.regionStates[r].filter(s => s !== stateName);
  });
  // Assign to new region (null = unassign)
  if (regionId && CONFIG.regionStates[regionId]) {
    CONFIG.regionStates[regionId].push(stateName);
  } else if (regionId) {
    CONFIG.regionStates[regionId] = [stateName];
  }
  saveConfig();
}

export function resetStateMappingToDefault() {
  CONFIG.regionStates = JSON.parse(JSON.stringify(DEFAULT_REGION_STATES));
  saveConfig();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Regions & Teams sections ───────────────────────────────────────────────────

export function renderSettings() {
  document.getElementById('regionsList').innerHTML = CONFIG.regions.map((r, i) => `
    <div class="settings-row">
      <input type="color" value="${r.color}" oninput="updateRegionColor(${i}, this.value)" />
      <input type="text" class="add-se-input" value="${esc(r.name)}" oninput="updateRegionName(${i}, this.value)" style="flex:1" />
      <button class="del-btn" onclick="deleteRegion(${i})">&#x2715;</button>
    </div>`).join('');

  document.getElementById('teamsList').innerHTML = CONFIG.teams.map((t, i) => `
    <div class="settings-row">
      <input type="text" class="add-se-input" value="${esc(t.name)}" oninput="updateTeamName(${i}, this.value)" style="flex:1" />
      <input type="text" class="add-se-input" value="${esc(t.leader||'')}" oninput="updateTeamLeader(${i}, this.value)" style="flex:1" placeholder="Optional" />
      <button class="del-btn" onclick="deleteTeam(${i})">&#x2715;</button>
    </div>`).join('');
}

export function updateRegionColor(i, val) { CONFIG.regions[i].color  = val; }
export function updateRegionName(i, val)  { CONFIG.regions[i].name   = val; }
export function updateTeamName(i, val)    { CONFIG.teams[i].name     = val; }
export function updateTeamLeader(i, val)  { CONFIG.teams[i].leader   = val; }

export function addRegion()     { CONFIG.regions.push({name:'New Region', color:'#a855f7'}); renderSettings(); }
export function deleteRegion(i) { CONFIG.regions.splice(i, 1); renderSettings(); }
export function addTeam()       { CONFIG.teams.push({name:'New Team', leader:''}); renderSettings(); }
export function deleteTeam(i)   { CONFIG.teams.splice(i, 1); renderSettings(); }

// ── Personnel section ─────────────────────────────────────────────────────────

const ROLE_GROUPS = [
  { key: 'SE',       label: 'SEs',         addLabel: 'SE'        },
  { key: 'AE',       label: 'AEs',         addLabel: 'AE'        },
  { key: 'RD',       label: 'RDs',         addLabel: 'RD'        },
  { key: 'RVP',      label: 'RVPs',        addLabel: 'RVP'       },
  { key: 'SELeader', label: 'SE Leaders',  addLabel: 'SE Leader' },
];

export function renderPersonnelSettings() {
  const container = document.getElementById('personnelList');
  if (!container) return;

  container.innerHTML = ROLE_GROUPS.map(({ key, label, addLabel }) => {
    const people = PEOPLE.filter(p => p.role === key);

    const rows = people.length
      ? people.map(p => {
          const count = countDependencies(p);
          const inactiveCls = p.active === false ? ' personnel-inactive' : '';
          return `<div class="personnel-row${inactiveCls}">
            <div class="personnel-info">
              <span class="personnel-name">${esc(p.name)}</span>
              <span class="personnel-city">${esc(p.city || '—')}</span>
              <span class="badge badge-muted">${count} row${count !== 1 ? 's' : ''}</span>
              ${p.active === false ? '<span class="badge badge-muted">Inactive</span>' : ''}
            </div>
            <div class="personnel-actions">
              <button class="btn btn-ghost" style="font-size:11px;padding:4px 10px" onclick="openPersonEdit('${p.id}')">Edit</button>
              <button class="del-btn" onclick="removePersonSetting('${p.id}')">&#x2715;</button>
            </div>
          </div>`;
        }).join('')
      : '<div style="color:var(--muted);font-size:12px;padding:4px 0 8px">None configured</div>';

    return `<div class="settings-section personnel-group">
      <div class="section-title">${esc(label)} (${people.length})</div>
      ${rows}
      <button class="btn btn-ghost" style="margin-top:8px;font-size:11px"
        onclick="openPersonAdd('${key}')">+ Add ${esc(addLabel)}</button>
    </div>`;
  }).join('');
}

// ── Quotas section ────────────────────────────────────────────────────────────

export function renderQuotasSettings() {
  const q = CONFIG.quotas;
  const elAccount = document.getElementById('quotaLevelAccount');
  const elAE      = document.getElementById('quotaLevelAE');
  const elSE      = document.getElementById('quotaLevelSE');
  const elBuf     = document.getElementById('quotaBuffer');
  const elPer     = document.getElementById('quotaDisplayPeriod');
  if (!elAccount) return;
  elAccount.checked = q.levels.account;
  elAE.checked      = q.levels.ae;
  elSE.checked      = q.levels.se;
  elBuf.value       = Math.round((q.buffer ?? 0.20) * 100);
  elPer.value       = q.displayPeriod || 'annual';
}

// ── Tab switching ─────────────────────────────────────────────────────────────

export function switchSettingsTab(tab) {
  document.querySelectorAll('.settings-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  document.querySelectorAll('.settings-tab-panel').forEach(panel => {
    panel.style.display = panel.id === 'settings-tab-' + tab ? '' : 'none';
  });
  if (tab === 'personnel') renderPersonnelSettings();
  if (tab === 'quotas')    renderQuotasSettings();
}

// ── Window-exposed functions (called from dynamically-generated HTML) ─────────

window.updateRegionColor  = updateRegionColor;
window.updateRegionName   = updateRegionName;
window.updateTeamName     = updateTeamName;
window.updateTeamLeader   = updateTeamLeader;
window.deleteRegion       = deleteRegion;
window.deleteTeam         = deleteTeam;
window.switchSettingsTab  = switchSettingsTab;

// Dispatches event → app.js opens the person edit modal
window.openPersonEdit = id => {
  document.dispatchEvent(new CustomEvent('open-person-edit', { detail: { id } }));
};

// Dispatches event → app.js opens the person add modal (role pre-selected)
window.openPersonAdd = role => {
  document.dispatchEvent(new CustomEvent('open-person-add', { detail: { role } }));
};

// Quota level/buffer/period updates
window.updateQuotaLevel = (level, checked) => {
  CONFIG.quotas.levels[level] = checked;
  saveConfig();
};
window.updateQuotaBuffer = val => {
  const parsed = parseFloat(val);
  CONFIG.quotas.buffer = isNaN(parsed) ? 0.20 : Math.max(0, Math.min(1, parsed / 100));
  saveConfig();
};
window.updateQuotaDisplayPeriod = val => {
  CONFIG.quotas.displayPeriod = val;
  saveConfig();
};

// Confirm → removePerson → re-render settings list + notify app
window.removePersonSetting = id => {
  const person = getPerson(id);
  if (!person) return;
  const count = countDependencies(person);
  const orphanLabel = ORPHAN_VALUE[person.role] || 'UNASSIGNED';
  const msg = count > 0
    ? `${person.name} is referenced in ${count} row(s).\n\nRemove anyway? Those rows will be marked "${orphanLabel}".`
    : `Remove ${person.name} from the roster?`;
  if (!confirm(msg)) return;
  removePerson(id);
  renderPersonnelSettings();
  document.dispatchEvent(new CustomEvent('personnel-changed'));
};
