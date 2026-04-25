import { DATA, state } from './data.js';
import { propagatePeopleEditsToWorkingData } from './roster.js';

const LS_KEY = 'se-planner-accounts';
let _nextId = 1;

function genId() {
  return 'a-' + String(_nextId++).padStart(3, '0');
}

// Mutable exported array — all modules share this same reference.
export const ACCOUNTS = [];

function buildAccountsFromData(data) {
  const seen = new Set();
  const result = [];
  data.forEach(row => {
    if (!row.account || seen.has(row.account)) return;
    seen.add(row.account);
    result.push({
      id:          genId(),
      name:        row.account,
      segment:     row.segment    || '',
      region:      row.ae_region  || '',
      ae:          row.ae         || '',
      se:          row.se         || '',
      notes:       row.notes       || '',
      quota:       0,
      quotaPeriod: 'annual',
      active:      true,
    });
  });
  return result;
}

export function loadAccounts() {
  try {
    const s = localStorage.getItem(LS_KEY);
    if (s) {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed) && parsed.length > 0) {
        parsed.forEach(a => {
          const num = parseInt((a.id || '').replace('a-', ''), 10);
          if (!isNaN(num) && num >= _nextId) _nextId = num + 1;
        });
        ACCOUNTS.length = 0;
        ACCOUNTS.push(...parsed);
        _ensureWorkingDataMatchesAccounts();
        return;
      }
    }
  } catch(e) { /* ignore corrupt storage */ }

  // First boot: derive from static DATA
  const built = buildAccountsFromData(DATA);
  ACCOUNTS.length = 0;
  ACCOUNTS.push(...built);
  saveAccounts();
}

/**
 * After ACCOUNTS is loaded from storage, make sure state.workingData reflects every persisted
 * account. workingData itself is not persisted (it bootstraps from the static DATA constant),
 * so any user-added accounts beyond the sample need a corresponding row inserted here or they
 * become invisible to the map / sidebar / exports after a refresh.
 */
function _ensureWorkingDataMatchesAccounts() {
  const wdAccountSet = new Set(state.workingData.map(r => r.account));
  ACCOUNTS.forEach(a => {
    if (wdAccountSet.has(a.name)) {
      // Account already has at least one workingData row — propagate any persisted field deltas
      // (region/ae/se/segment) so the row reflects what the Accounts tab currently says.
      state.workingData.forEach(r => {
        if (r.account !== a.name) return;
        if (a.region  !== undefined) r.ae_region = a.region  || r.ae_region || '';
        if (a.segment !== undefined) r.segment   = a.segment || r.segment   || '';
        if (a.ae      !== undefined) r.ae        = a.ae      || r.ae        || '';
        if (a.se      !== undefined) r.se        = a.se      || r.se        || '';
      });
      return;
    }
    // New (post-bootstrap) account that has no workingData row — create one.
    state.workingData.push({
      segment: a.segment || '',
      avp: '', rvp: '', rvp_city: '',
      rd: '', rd_city: '',
      ae: a.ae || '', ae_city: '',
      ae_region: a.region || '',
      account: a.name,
      se: a.se || '', se_leader: '', home_city: ''
    });
  });
  // Also drop workingData rows whose account is no longer in ACCOUNTS (covers in-app deletions
  // that happened before this boot). Mutate the array in place so other modules that already
  // hold a reference to state.workingData see the same array.
  const validAccountNames = new Set(ACCOUNTS.map(a => a.name));
  for (let i = state.workingData.length - 1; i >= 0; i--) {
    if (!validAccountNames.has(state.workingData[i].account)) {
      state.workingData.splice(i, 1);
    }
  }
  // Re-apply persisted PEOPLE city/region to any newly-added rows so people propagation
  // doesn't get lost when accounts come in after PEOPLE bootstrap.
  try { propagatePeopleEditsToWorkingData(); } catch {}
}

export function saveAccounts() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(ACCOUNTS)); } catch(e) {}
}

// ── Lookups ───────────────────────────────────────────────────────────────────

export function getAccount(id) {
  return ACCOUNTS.find(a => a.id === id) || null;
}

export function getAccountByName(name) {
  return ACCOUNTS.find(a => a.name === name) || null;
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export function updateAccountName(id, newName) {
  const account = getAccount(id);
  if (!account || account.name === newName) return;
  const oldName = account.name;
  account.name = newName;
  const propagate = rows => rows.forEach(r => { if (r.account === oldName) r.account = newName; });
  propagate(state.workingData);
  if (state.scenarioB) propagate(state.scenarioB);
  saveAccounts();
}

/** Update segment/region/ae/se/notes/quota/quotaPeriod/active */
export function updateAccountField(id, field, value) {
  const account = getAccount(id);
  if (!account) return;
  account[field] = value;
  // Propagate fields that live in DATA rows
  if (['segment', 'ae', 'se', 'region'].includes(field)) {
    const propagate = rows => rows.forEach(r => {
      if (r.account !== account.name) return;
      if (field === 'segment')     r.segment   = value;
      else if (field === 'ae')     r.ae        = value;
      else if (field === 'se')     r.se        = value;
      else if (field === 'region') r.ae_region = value;
    });
    propagate(state.workingData);
    if (state.scenarioB) propagate(state.scenarioB);
  }
  saveAccounts();
}

export function addAccount({ name, segment, region, ae, se, notes, quota, quotaPeriod }) {
  if (!name) return null;
  const id = genId();
  const account = {
    id, name,
    segment:     segment     || '',
    region:      region      || '',
    ae:          ae          || '',
    se:          se          || '',
    notes:       notes       || '',
    quota:       quota       || 0,
    quotaPeriod: quotaPeriod || 'annual',
    active:      true,
  };
  ACCOUNTS.push(account);
  // Add a corresponding DATA row so the map/table picks it up
  state.workingData.push({
    segment: account.segment, avp: '', rvp: '', rvp_city: '',
    rd: '', rd_city: '', ae: account.ae, ae_city: '',
    ae_region: account.region, account: account.name,
    se: account.se, se_leader: '', home_city: '',
  });
  saveAccounts();
  return account;
}

export function removeAccount(id) {
  const idx = ACCOUNTS.findIndex(a => a.id === id);
  if (idx === -1) return;
  const { name } = ACCOUNTS[idx];
  const removeRows = rows => {
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i].account === name) rows.splice(i, 1);
    }
  };
  removeRows(state.workingData);
  if (state.scenarioB) removeRows(state.scenarioB);
  ACCOUNTS.splice(idx, 1);
  saveAccounts();
}

export function countAccountDependencies(account) {
  return state.workingData.filter(r => r.account === account.name).length;
}

// Bootstrap on first import
loadAccounts();
