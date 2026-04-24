import {
  PEOPLE, addPerson, removePerson,
  updatePersonName, updatePersonCity, updatePersonRegion, updatePersonActive,
  updatePersonField, savePeople, getPerson, countDependencies, ORPHAN_VALUE
} from './roster.js';
import {
  ACCOUNTS, addAccount, removeAccount,
  updateAccountName, updateAccountField, countAccountDependencies, getAccount
} from './accounts.js';
import { CONFIG } from './config.js';
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
  document.getElementById('manageDataBody').innerHTML =
    _activeTab === 'people' ? _renderPeopleTable() : _renderAccountsTable();
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

// ── Window-exposed handlers ───────────────────────────────────────────────────

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
