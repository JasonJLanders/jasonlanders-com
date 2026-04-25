import {
  PEOPLE, addPerson, removePerson,
  updatePersonName, updatePersonCity, updatePersonRegion, updatePersonActive,
  updatePersonField, savePeople, getPerson, countDependencies, ORPHAN_VALUE
} from './roster.js';
import {
  ACCOUNTS, addAccount, removeAccount,
  updateAccountName, updateAccountField, countAccountDependencies, getAccount
} from './accounts.js';
import { CONFIG, saveConfig } from './config.js';
import { convertFromAnnual, formatCompact, computeAEQuota, computeSEQuota } from './quotas.js';
import { state } from './data.js';

// ── State ─────────────────────────────────────────────────────────────────────

let _activeTab = 'people';
let _onClose   = null;

// ── Public API ────────────────────────────────────────────────────────────────

export function openManageData(onClose) {
  _onClose   = onClose;
  _activeTab = 'people';
  document.getElementById('manageDataView').style.display = '';
  _syncTabs();
  _renderBody();
}

export function closeManageData() {
  document.getElementById('manageDataView').style.display = 'none';
  if (_onClose) _onClose();
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function _syncTabs() {
  document.querySelectorAll('.md-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === _activeTab)
  );
}

function _renderBody() {
  const body = document.getElementById('manageDataBody');
  switch (_activeTab) {
    case 'people':   body.innerHTML = _renderPeopleTable();   break;
    case 'accounts': body.innerHTML = _renderAccountsTable(); break;
    case 'regions':  body.innerHTML = _renderRegionsTable();  break;
    case 'teams':    body.innerHTML = _renderTeamsTable();    break;
    default:         body.innerHTML = '';
  }
}

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/** Format an annual quota value into the current display period. */
function _fmtQ(annual) {
  const period = CONFIG.quotas?.displayPeriod || 'annual';
  const val    = convertFromAnnual(annual, period);
  let s = formatCompact(val);
  if (period === 'monthly')   s += '/mo';
  if (period === 'quarterly') s += '/qtr';
  return s;
}

function _quotaShowPeople()   { const l = CONFIG.quotas?.levels || {}; return l.ae || l.se; }
function _quotaShowAccounts() { return !!(CONFIG.quotas?.levels?.account); }

// ── Option builders ───────────────────────────────────────────────────────────

const ROLE_OPTS = ['SE','AE','RD','RVP','SELeader'];
const ROLE_LBL  = { SE:'SE', AE:'AE', RD:'RD', RVP:'RVP', SELeader:'SE Leader' };

function _roleOpts(sel) {
  return ROLE_OPTS.map(r =>
    `<option value="${r}"${r===sel?' selected':''}>${ROLE_LBL[r]}</option>`
  ).join('');
}
function _regionOpts(sel) {
  return CONFIG.regions.map(r =>
    `<option value="${esc(r.name)}"${r.name===sel?' selected':''}>${esc(r.name)}</option>`
  ).join('');
}
function _segOpts(sel) {
  return CONFIG.teams.map(t =>
    `<option value="${esc(t.name)}"${t.name===sel?' selected':''}>${esc(t.name)}</option>`
  ).join('');
}
function _aeOpts(sel) {
  return PEOPLE.filter(p => p.role==='AE' && p.active!==false).map(p =>
    `<option value="${esc(p.name)}"${p.name===sel?' selected':''}>${esc(p.name)}</option>`
  ).join('');
}
function _seOpts(sel) {
  return PEOPLE.filter(p => p.role==='SE' && p.active!==false).map(p =>
    `<option value="${esc(p.name)}"${p.name===sel?' selected':''}>${esc(p.name)}</option>`
  ).join('');
}
function _perOpts(sel) {
  return ['monthly','quarterly','annual'].map(v =>
    `<option value="${v}"${v===(sel||'annual')?' selected':''}>${v.charAt(0).toUpperCase()+v.slice(1)}</option>`
  ).join('');
}

// ── People table ──────────────────────────────────────────────────────────────

function _renderPeopleTable() {
  const showQ = _quotaShowPeople();
  const levels = CONFIG.quotas?.levels || {};

  const hdrQ = showQ
    ? `<th>Quota</th><th>Period</th><th class="quota-computed-hdr">Computed</th>`
    : '';

  const rows = PEOPLE.map(p => {
    const isQuotaRole = p.role === 'AE' || p.role === 'SE';
    const showQCell   = showQ && isQuotaRole;

    let computedQ = '';
    if (showQCell) {
      if (p.role === 'AE' && levels.account) {
        computedQ = _fmtQ(computeAEQuota(p.name, state.workingData));
      } else if (p.role === 'SE' && (levels.account || levels.ae)) {
        computedQ = _fmtQ(computeSEQuota(p.name, state.workingData));
      } else {
        computedQ = '—';
      }
    }

    const qCells = showQ ? `
      <td>${showQCell ? `<input type="number" class="dt-input dt-num" value="${p.quota||0}" min="0"
        onblur="mdSavePersonQuota('${p.id}',this.value)"
        onkeydown="mdDtKeydown(event,this)">` : ''}</td>
      <td>${showQCell ? `<select class="dt-select" onchange="mdSavePersonPeriod('${p.id}',this.value)">${_perOpts(p.quotaPeriod)}</select>` : ''}</td>
      <td class="quota-computed">${computedQ}</td>` : '';

    const inactiveCls = p.active === false ? ' dt-row-inactive' : '';
    const depCount    = countDependencies(p);

    return `<tr class="dt-row${inactiveCls}" data-entity-id="${p.id}">
      <td><input type="text" class="dt-input" value="${esc(p.name)}"
        onblur="mdSavePersonName('${p.id}',this.value)"
        onkeydown="mdDtKeydown(event,this)"></td>
      <td><select class="dt-select" onchange="mdSavePersonRole('${p.id}',this.value)">${_roleOpts(p.role)}</select></td>
      <td><input type="text" class="dt-input" value="${esc(p.city||'')}"
        onblur="mdSavePersonCity('${p.id}',this.value)"
        onkeydown="mdDtKeydown(event,this)"></td>
      <td><select class="dt-select" onchange="mdSavePersonRegion('${p.id}',this.value)">${_regionOpts(p.region)}</select></td>
      <td><input type="text" class="dt-input dt-notes" value="${esc(p.notes||'')}"
        placeholder="Notes, links, context…"
        onblur="mdSavePersonNotes('${p.id}',this.value)"
        onkeydown="mdDtKeydown(event,this)"></td>
      ${qCells}
      <td class="dt-center"><input type="checkbox" ${p.active!==false?'checked':''}
        onchange="mdSavePersonActive('${p.id}',this.checked)"></td>
      <td class="dt-actions"><button class="dt-remove-btn" title="Remove (${depCount} row${depCount!==1?'s':''})"
        onclick="mdRemovePerson('${p.id}')">&#x2715;</button></td>
    </tr>`;
  }).join('');

  return `<table class="data-table">
    <thead><tr>
      <th>Name</th><th>Role</th><th>City</th><th>Region</th><th>Notes</th>
      ${hdrQ}
      <th>Active</th>
      <th class="dt-actions">
        <button class="btn btn-ghost" style="font-size:11px;padding:3px 10px"
          onclick="mdAddPerson()">+ Add Person</button>
      </th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

// ── Accounts table ────────────────────────────────────────────────────────────

function _renderAccountsTable() {
  const showQ = _quotaShowAccounts();
  const hdrQ  = showQ ? `<th>Quota</th><th>Period</th>` : '';

  const rows = ACCOUNTS.map(a => {
    const qCells = showQ ? `
      <td><input type="number" class="dt-input dt-num" value="${a.quota||0}" min="0"
        onblur="mdSaveAccountQuota('${a.id}',this.value)"
        onkeydown="mdDtKeydown(event,this)"></td>
      <td><select class="dt-select" onchange="mdSaveAccountField('${a.id}','quotaPeriod',this.value)">${_perOpts(a.quotaPeriod)}</select></td>` : '';

    const depCount    = countAccountDependencies(a);
    const inactiveCls = a.active === false ? ' dt-row-inactive' : '';

    return `<tr class="dt-row${inactiveCls}" data-entity-id="${a.id}">
      <td><input type="text" class="dt-input" value="${esc(a.name)}"
        onblur="mdSaveAccountName('${a.id}',this.value)"
        onkeydown="mdDtKeydown(event,this)"></td>
      <td><select class="dt-select" onchange="mdSaveAccountField('${a.id}','segment',this.value)">${_segOpts(a.segment)}</select></td>
      <td><select class="dt-select" onchange="mdSaveAccountField('${a.id}','region',this.value)">${_regionOpts(a.region)}</select></td>
      <td><select class="dt-select" onchange="mdSaveAccountField('${a.id}','ae',this.value)">
        <option value="">—</option>${_aeOpts(a.ae)}</select></td>
      <td><select class="dt-select" onchange="mdSaveAccountField('${a.id}','se',this.value)">
        <option value="">—</option>${_seOpts(a.se)}</select></td>
      <td><input type="text" class="dt-input dt-notes" value="${esc(a.notes||'')}"
        placeholder="Notes, SFDC link, context…"
        onblur="mdSaveAccountField('${a.id}','notes',this.value)"
        onkeydown="mdDtKeydown(event,this)"></td>
      ${qCells}
      <td class="dt-center"><input type="checkbox" ${a.active!==false?'checked':''}
        onchange="mdSaveAccountField('${a.id}','active',this.checked)"></td>
      <td class="dt-actions"><button class="dt-remove-btn" title="Remove account (${depCount} row${depCount!==1?'s':''})"
        onclick="mdRemoveAccount('${a.id}')">&#x2715;</button></td>
    </tr>`;
  }).join('');

  return `<table class="data-table">
    <thead><tr>
      <th>Name</th><th>Segment</th><th>Region</th><th>AE</th><th>SE</th><th>Notes</th>
      ${hdrQ}
      <th>Active</th>
      <th class="dt-actions">
        <button class="btn btn-ghost" style="font-size:11px;padding:3px 10px"
          onclick="mdAddAccount()">+ Add Account</button>
      </th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

// ── Regions table ─────────────────────────────────────────────────────────────────────────────

// Format a list of namespaced featureIds as a readable comma-separated summary.
// e.g. ['state:Georgia','country:Germany'] -> 'Georgia (State), Germany (Country)'
function _formatFeatureList(list) {
  if (!list || !list.length) return '<span style="color:var(--muted);font-style:italic">No features assigned</span>';
  const parts = list.map(featureId => {
    if (typeof featureId !== 'string') return '';
    const idx = featureId.indexOf(':');
    if (idx === -1) return esc(featureId);
    const kind = featureId.slice(0, idx);
    const name = featureId.slice(idx + 1);
    const suffix = kind === 'country' ? ' (Country)' : ' (State)';
    return esc(name) + suffix;
  });
  return parts.join(', ');
}

function _renderRegionsTable() {
  const regions = CONFIG.regions || [];
  const regionFeatures = CONFIG.regionFeatures || {};

  const rows = regions.map((r, i) => {
    const features = regionFeatures[r.name] || regionFeatures[r.id] || [];
    const count = features.length;
    return `<tr class="dt-row" data-entity-id="region-${i}">
      <td style="width:48px">
        <input type="color" value="${esc(r.color)}" class="dt-color"
          oninput="mdUpdateRegionColor(${i}, this.value)"
          onchange="mdUpdateRegionColor(${i}, this.value)" />
      </td>
      <td><input type="text" class="dt-input" value="${esc(r.name)}"
        onblur="mdUpdateRegionName(${i}, this.value)"
        onkeydown="mdDtKeydown(event,this)"></td>
      <td class="region-features-cell">${_formatFeatureList(features)}</td>
      <td class="dt-center" style="white-space:nowrap">
        <span class="badge badge-muted">${count}</span>
      </td>
      <td class="dt-actions"><button class="dt-remove-btn" title="Remove region"
        onclick="mdRemoveRegion(${i})">&#x2715;</button></td>
    </tr>`;
  }).join('');

  return `<table class="data-table">
    <thead><tr>
      <th>Color</th>
      <th>Name</th>
      <th>Assigned features (read-only)</th>
      <th class="dt-center">Count</th>
      <th class="dt-actions">
        <button class="btn btn-ghost" style="font-size:11px;padding:3px 10px"
          onclick="mdAddRegion()">+ Add Region</button>
      </th>
    </tr></thead>
    <tbody>${rows || '<tr><td colspan="5" style="padding:16px;color:var(--muted);font-size:12px">No regions defined.</td></tr>'}</tbody>
  </table>
  <div style="font-size:11px;color:var(--muted);margin:12px 20px;padding:10px 12px;background:var(--surface2);border-radius:8px;border:1px solid var(--border);line-height:1.6">
    To change which states or countries belong to a region, close this panel and use <strong style="color:var(--text)">Edit Map Regions</strong> in the toolbar — click any state or country on the map to assign it.
  </div>`;
}

// ── Teams table ─────────────────────────────────────────────────────────────────────────────

function _renderTeamsTable() {
  const teams = CONFIG.teams || [];
  const rows = teams.map((t, i) => {
    const teamAccounts = ACCOUNTS.filter(a => a.segment === t.name);
    const count = teamAccounts.length;

    // Expand-row payload: read-only list of accounts + their AE/SE owners
    const acctList = teamAccounts.length
      ? teamAccounts.map(a => {
          const aeStr = a.ae  ? esc(a.ae)  : '<span style="color:var(--muted)">—</span>';
          const seStr = a.se  ? esc(a.se)  : '<span style="color:var(--muted)">—</span>';
          const regStr = a.region ? esc(a.region) : '<span style="color:var(--muted)">—</span>';
          return `<div class="team-expand-row">
            <span class="team-expand-acct">${esc(a.name)}</span>
            <span class="team-expand-meta">${regStr}</span>
            <span class="team-expand-meta">AE: ${aeStr}</span>
            <span class="team-expand-meta">SE: ${seStr}</span>
          </div>`;
        }).join('')
      : '<div style="color:var(--muted);font-size:12px;padding:4px 0">No accounts reference this team.</div>';

    return `<tr class="dt-row md-team-row" data-entity-id="team-${i}" data-team-index="${i}"
        onclick="mdToggleTeamExpand(event, ${i})">
      <td style="width:18px;cursor:pointer"><span class="chevron" id="team-chev-${i}">&#9654;</span></td>
      <td><input type="text" class="dt-input" value="${esc(t.name)}"
        onblur="mdUpdateTeamName(${i}, this.value)"
        onkeydown="mdDtKeydown(event,this)"
        onclick="event.stopPropagation()"></td>
      <td><input type="text" class="dt-input" value="${esc(t.leader || '')}"
        placeholder="Optional SE Leader"
        onblur="mdUpdateTeamLeader(${i}, this.value)"
        onkeydown="mdDtKeydown(event,this)"
        onclick="event.stopPropagation()"></td>
      <td class="dt-center"><span class="badge badge-muted">${count}</span></td>
      <td class="dt-actions"><button class="dt-remove-btn" title="Remove team"
        onclick="event.stopPropagation();mdRemoveTeam(${i})">&#x2715;</button></td>
    </tr>
    <tr class="team-expand" id="team-exp-${i}" style="display:none">
      <td></td>
      <td colspan="4" class="team-expand-cell">
        <div class="team-expand-title">Accounts in this team (${count})</div>
        ${acctList}
      </td>
    </tr>`;
  }).join('');

  return `<table class="data-table">
    <thead><tr>
      <th style="width:18px"></th>
      <th>Team Name (= Segment)</th>
      <th>SE Leader (optional)</th>
      <th class="dt-center">Accounts</th>
      <th class="dt-actions">
        <button class="btn btn-ghost" style="font-size:11px;padding:3px 10px"
          onclick="mdAddTeam()">+ Add Team</button>
      </th>
    </tr></thead>
    <tbody>${rows || '<tr><td colspan="5" style="padding:16px;color:var(--muted);font-size:12px">No teams defined.</td></tr>'}</tbody>
  </table>`;
}

// ── Window-exposed handlers ─────────────────────────────────────────────────────────────────────

window.mdSwitchTab = tab => {
  _activeTab = tab;
  _syncTabs();
  _renderBody();
};

window.mdCloseView = () => closeManageData();

window.mdDtKeydown = (e, el) => { if (e.key === 'Enter') el.blur(); };

// Scroll to newly added row, flash it, select the name input for immediate editing.
function _highlightRow(entityId) {
  if (!entityId) return;
  requestAnimationFrame(() => {
    const row = document.querySelector(`.data-table tr[data-entity-id="${entityId}"]`);
    if (!row) return;
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    row.classList.remove('dt-row-new');
    // Force reflow so the animation restarts if user spam-clicks Add
    void row.offsetWidth;
    row.classList.add('dt-row-new');
    const firstInput = row.querySelector('input[type="text"]');
    if (firstInput) { firstInput.focus(); firstInput.select(); }
  });
}

// People
window.mdAddPerson = () => {
  const defaultRegion = CONFIG.regions[0]?.name || '';
  const created = addPerson({ name: 'New Person', role: 'SE', city: '', region: defaultRegion });
  _renderBody();
  _highlightRow(created?.id);
};

window.mdRemovePerson = id => {
  const p = getPerson(id);
  if (!p) return;
  const count  = countDependencies(p);
  const orphan = ORPHAN_VALUE[p.role] || 'UNASSIGNED';
  const msg = count > 0
    ? `${p.name} is referenced in ${count} row(s).\nRemove anyway? Those rows will be marked "${orphan}".`
    : `Remove ${p.name}?`;
  if (!confirm(msg)) return;
  removePerson(id);
  _renderBody();
};

window.mdSavePersonName   = (id, val) => { val = val.trim(); if (val) updatePersonName(id, val); };
window.mdSavePersonCity   = (id, val) => updatePersonCity(id, val.trim());
window.mdSavePersonRegion = (id, val) => updatePersonRegion(id, val);
window.mdSavePersonActive = (id, chk) => updatePersonActive(id, chk);

window.mdSavePersonRole = (id, val) => {
  updatePersonField(id, 'role', val);
  _renderBody(); // quota columns may change
};

window.mdSavePersonQuota = (id, val) => {
  const p = getPerson(id);
  if (!p) return;
  p.quota = parseFloat(val) || 0;
  savePeople();
};

window.mdSavePersonPeriod = (id, val) => {
  updatePersonField(id, 'quotaPeriod', val);
};

window.mdSavePersonNotes = (id, val) => {
  updatePersonField(id, 'notes', val);
};

// Accounts
window.mdAddAccount = () => {
  const created = addAccount({
    name: 'New Account',
    segment:     CONFIG.teams[0]?.name   || '',
    region:      CONFIG.regions[0]?.name || '',
    ae: '', se: '', notes: '', quota: 0, quotaPeriod: 'annual'
  });
  _renderBody();
  _highlightRow(created?.id);
};

window.mdRemoveAccount = id => {
  const a = getAccount(id);
  if (!a) return;
  const count = countAccountDependencies(a);
  const msg = count > 0
    ? `"${a.name}" is referenced in ${count} data row(s).\nRemove anyway? Those rows will be deleted from the working dataset.`
    : `Remove account "${a.name}"?`;
  if (!confirm(msg)) return;
  removeAccount(id);
  _renderBody();
};

window.mdSaveAccountName = (id, val) => {
  val = val.trim();
  if (val) updateAccountName(id, val);
};

window.mdSaveAccountField = (id, field, val) => {
  updateAccountField(id, field, val);
};

window.mdSaveAccountQuota = (id, val) => {
  updateAccountField(id, 'quota', parseFloat(val) || 0);
};

// Regions
function _notifyRegionsChanged() {
  // Tell app.js to re-render the main view (region cards, map shading, etc.)
  document.dispatchEvent(new CustomEvent('regions-changed'));
}

window.mdAddRegion = () => {
  if (!CONFIG.regions) CONFIG.regions = [];
  CONFIG.regions.push({ name: 'New Region', color: '#a855f7' });
  saveConfig();
  _notifyRegionsChanged();
  _renderBody();
  // Highlight + focus the new row
  requestAnimationFrame(() => {
    const rows = document.querySelectorAll('.data-table tr[data-entity-id^="region-"]');
    const last = rows[rows.length - 1];
    if (last) {
      last.scrollIntoView({ behavior: 'smooth', block: 'center' });
      last.classList.add('dt-row-new');
      const nameInput = last.querySelectorAll('input[type="text"]')[0];
      if (nameInput) { nameInput.focus(); nameInput.select(); }
    }
  });
};

window.mdRemoveRegion = i => {
  const r = CONFIG.regions[i];
  if (!r) return;
  const features = (CONFIG.regionFeatures || {})[r.name] || [];
  const extra = features.length
    ? `\n\n${features.length} feature${features.length !== 1 ? 's' : ''} assigned to this region will become unassigned.`
    : '';
  if (!confirm(`Remove region "${r.name}"?${extra}`)) return;
  // Drop assignments for this region
  if (CONFIG.regionFeatures && CONFIG.regionFeatures[r.name]) {
    delete CONFIG.regionFeatures[r.name];
  }
  CONFIG.regions.splice(i, 1);
  saveConfig();
  _notifyRegionsChanged();
  _renderBody();
};

window.mdUpdateRegionName = (i, val) => {
  const newName = val.trim();
  const r = CONFIG.regions[i];
  if (!r || !newName || r.name === newName) { _renderBody(); return; }
  const oldName = r.name;
  r.name = newName;
  // Re-key regionFeatures so assignments follow the rename
  if (CONFIG.regionFeatures && CONFIG.regionFeatures[oldName]) {
    CONFIG.regionFeatures[newName] = CONFIG.regionFeatures[oldName];
    delete CONFIG.regionFeatures[oldName];
  }
  saveConfig();
  _notifyRegionsChanged();
  _renderBody();
};

window.mdUpdateRegionColor = (i, val) => {
  const r = CONFIG.regions[i];
  if (!r) return;
  r.color = val;
  saveConfig();
  _notifyRegionsChanged();
};

// Teams
function _notifyTeamsChanged() {
  document.dispatchEvent(new CustomEvent('teams-changed'));
}

window.mdAddTeam = () => {
  if (!CONFIG.teams) CONFIG.teams = [];
  CONFIG.teams.push({ name: 'New Team', leader: '' });
  saveConfig();
  _notifyTeamsChanged();
  _renderBody();
  requestAnimationFrame(() => {
    const rows = document.querySelectorAll('.data-table tr[data-entity-id^="team-"]');
    const last = rows[rows.length - 1];
    if (last) {
      last.scrollIntoView({ behavior: 'smooth', block: 'center' });
      last.classList.add('dt-row-new');
      const nameInput = last.querySelector('input[type="text"]');
      if (nameInput) { nameInput.focus(); nameInput.select(); }
    }
  });
};

window.mdRemoveTeam = i => {
  const t = CONFIG.teams[i];
  if (!t) return;
  const count = ACCOUNTS.filter(a => a.segment === t.name).length;
  const extra = count ? `\n\n${count} account${count !== 1 ? 's' : ''} currently reference this segment.` : '';
  if (!confirm(`Remove team "${t.name}"?${extra}`)) return;
  CONFIG.teams.splice(i, 1);
  saveConfig();
  _notifyTeamsChanged();
  _renderBody();
};

window.mdUpdateTeamName = (i, val) => {
  const newName = val.trim();
  const t = CONFIG.teams[i];
  if (!t || !newName || t.name === newName) { _renderBody(); return; }
  const oldName = t.name;
  t.name = newName;
  // Propagate rename to accounts + data rows that referenced this team as their segment
  ACCOUNTS.forEach(a => { if (a.segment === oldName) a.segment = newName; });
  const propagate = rows => rows.forEach(r => { if (r.segment === oldName) r.segment = newName; });
  propagate(state.workingData);
  if (state.scenarioB) propagate(state.scenarioB);
  saveConfig();
  _notifyTeamsChanged();
  _renderBody();
};

window.mdUpdateTeamLeader = (i, val) => {
  const t = CONFIG.teams[i];
  if (!t) return;
  t.leader = val.trim();
  saveConfig();
  _notifyTeamsChanged();
};

window.mdToggleTeamExpand = (e, i) => {
  // Don't toggle when clicking inside an input, button, or anything explicitly stopped
  if (e && e.target && (e.target.closest('input,button,.dt-remove-btn'))) return;
  const expRow = document.getElementById('team-exp-' + i);
  const chev   = document.getElementById('team-chev-' + i);
  if (!expRow) return;
  const isOpen = expRow.style.display !== 'none';
  expRow.style.display = isOpen ? 'none' : '';
  if (chev) chev.classList.toggle('open', !isOpen);
};
