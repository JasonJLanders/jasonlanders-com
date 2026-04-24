import { DATA, state } from './data.js';

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
