import { DATA, state } from './data.js';

const LS_KEY = 'se-planner-people';
let _nextId = 1;

function genId() {
  return 'p-' + String(_nextId++).padStart(3, '0');
}

// Mutable exported array — all modules that import PEOPLE share this same reference.
// Never reassign it; only mutate in-place so references stay valid.
export const PEOPLE = [];

// Maps role → which DATA fields hold the name / city / region for that role.
// AVP rows may span multiple regions; the regionField is treated as 'home region' for AVP
// (their actual scope is derived by aggregating account rows that reference them).
export const ROLE_FIELDS = {
  SE:       { nameField: 'se',        cityField: 'home_city',      regionField: 'ae_region' },
  AE:       { nameField: 'ae',        cityField: 'ae_city',        regionField: 'ae_region' },
  RD:       { nameField: 'rd',        cityField: 'rd_city',        regionField: 'ae_region' },
  RVP:      { nameField: 'rvp',       cityField: 'rvp_city',       regionField: 'ae_region' },
  AVP:      { nameField: 'avp',       cityField: 'avp_city',       regionField: 'ae_region' },
  SELeader: { nameField: 'se_leader', cityField: 'se_leader_city', regionField: 'ae_region' },
};

// Sentinel value written to data rows when their person is removed
export const ORPHAN_VALUE = {
  SE:       'UNASSIGNED',
  AE:       'UNASSIGNED - AE',
  RD:       'UNASSIGNED - RD',
  RVP:      'UNASSIGNED - RVP',
  AVP:      'UNASSIGNED - AVP',
  SELeader: 'UNASSIGNED - LEADER',
};

// ── Bootstrap ─────────────────────────────────────────────────────────────────

/**
 * Scan DATA for unique (name, role) pairs and build a PEOPLE snapshot.
 * TBH / UNASSIGNED* entries are intentionally excluded.
 */
export function buildPeopleFromData(data) {
  const people = [];
  const seen   = {};

  function add(name, role, city, region) {
    if (!name) return;
    if (name.startsWith('TBH') || name.startsWith('UNASSIGNED')) return;
    const key = role + '|' + name;
    if (seen[key]) return;
    seen[key] = true;
    people.push({ id: genId(), name, role, city: city || '', region: region || '', notes: '', active: true });
  }

  data.forEach(row => {
    add(row.se,        'SE',       row.home_city,      row.ae_region);
    add(row.ae,        'AE',       row.ae_city,        row.ae_region);
    add(row.rd,        'RD',       row.rd_city,        row.ae_region);
    add(row.rvp,       'RVP',      row.rvp_city,       row.ae_region);
    add(row.avp,       'AVP',      row.avp_city,       row.ae_region);
    add(row.se_leader, 'SELeader', row.se_leader_city, row.ae_region);
  });
  return people;
}

export function loadPeople() {
  try {
    const s = localStorage.getItem(LS_KEY);
    if (s) {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed) && parsed.length > 0) {
        // Advance the id counter past any existing ids
        parsed.forEach(p => {
          const num = parseInt((p.id || '').replace('p-', ''), 10);
          if (!isNaN(num) && num >= _nextId) _nextId = num + 1;
        });
        PEOPLE.length = 0;
        PEOPLE.push(...parsed);
        propagatePeopleEditsToWorkingData();
        return;
      }
    }
  } catch(e) { /* ignore corrupt storage */ }

  // First boot: derive roster from static DATA
  const built = buildPeopleFromData(DATA);
  PEOPLE.length = 0;
  PEOPLE.push(...built);
  savePeople();
}

/**
 * After PEOPLE is loaded from storage, re-apply each person's persisted city/region back to
 * matching workingData rows. workingData itself is bootstrapped fresh from the static DATA
 * constant on every load, so any city/region edits the user made via Manage Data -> People
 * would otherwise be lost on refresh.
 *
 * Exported because accounts.js needs to call this again after it adds new workingData rows
 * for user-added accounts (those new rows wouldn't yet have the persisted person fields applied).
 */
export function propagatePeopleEditsToWorkingData() {
  PEOPLE.forEach(p => {
    const fields = ROLE_FIELDS[p.role];
    if (!fields) return;
    const { nameField, cityField } = fields;
    state.workingData.forEach(r => {
      if (r[nameField] !== p.name) return;
      if (p.city)   r[cityField] = p.city;
      if (p.region) r.ae_region  = p.region;
    });
  });
}

export function savePeople() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(PEOPLE));
  } catch(e) { /* storage full — silently ignore */ }
}

// ── Lookups ────────────────────────────────────────────────────────────────────

export function getPerson(id) {
  return PEOPLE.find(p => p.id === id) || null;
}

export function getPersonByName(name, role) {
  return PEOPLE.find(p => p.name === name && p.role === role) || null;
}

// ── Mutations ─────────────────────────────────────────────────────────────────

/**
 * Rename a person in PEOPLE and propagate to every matching field in
 * state.workingData, state.scenarioB, and state.addedSEs.
 */
export function updatePersonName(id, newName) {
  const person = getPerson(id);
  if (!person) return;
  const oldName = person.name;
  if (oldName === newName) return;
  const { nameField } = ROLE_FIELDS[person.role] || {};
  if (!nameField) return;

  person.name = newName;

  const propagate = rows => rows.forEach(r => {
    if (r[nameField] === oldName) r[nameField] = newName;
  });
  propagate(state.workingData);
  if (state.scenarioB) propagate(state.scenarioB);
  if (person.role === 'SE') {
    state.addedSEs.forEach(s => { if (s.se === oldName) s.se = newName; });
  }
  savePeople();
}

/**
 * Update a person's home city in PEOPLE and propagate to data rows.
 * Callers are responsible for re-geocoding the new city afterwards.
 */
export function updatePersonCity(id, newCity) {
  const person = getPerson(id);
  if (!person) return;
  const { nameField, cityField } = ROLE_FIELDS[person.role] || {};
  if (!nameField) return;

  person.city = newCity;
  const propagate = rows => rows.forEach(r => {
    if (r[nameField] === person.name) r[cityField] = newCity;
  });
  propagate(state.workingData);
  if (state.scenarioB) propagate(state.scenarioB);
  savePeople();
}

/**
 * Update a person's region and propagate to data rows.
 *
 * For roles that drive the AE region (SE, AE, RD, RVP, AVP, SE Leader), this updates
 * r.ae_region on every workingData row referencing this person. That makes the
 * left-sidebar region cards count the person correctly and the map markers fall under
 * the right region's color band.
 */
export function updatePersonRegion(id, newRegion) {
  const person = getPerson(id);
  if (!person) return;
  person.region = newRegion;
  const { nameField } = ROLE_FIELDS[person.role] || {};
  if (nameField && newRegion) {
    const propagate = rows => rows.forEach(r => {
      if (r[nameField] === person.name) r.ae_region = newRegion;
    });
    propagate(state.workingData);
    if (state.scenarioB) propagate(state.scenarioB);
  }
  savePeople();
}

/** Toggle a person's active flag (inactive → hidden from map, greyed in settings). */
export function updatePersonActive(id, active) {
  const person = getPerson(id);
  if (!person) return;
  person.active = active;
  savePeople();
}

/**
 * Update any field on a person record that does NOT cascade to DATA rows
 * (e.g. quota, quotaPeriod, role). For name/city/region use the specific helpers.
 */
export function updatePersonField(id, field, value) {
  const person = getPerson(id);
  if (!person) return;
  person[field] = value;
  savePeople();
}

/** Add a brand-new person to PEOPLE. Returns the created record. */
export function addPerson({ name, role, city, region, notes }) {
  if (!name || !role) return null;
  const id     = genId();
  const person = { id, name, role, city: city || '', region: region || '', notes: notes || '', active: true };
  PEOPLE.push(person);
  savePeople();
  return person;
}

/**
 * Remove a person from PEOPLE and orphan all their data-row references:
 *   SE removed      → se = 'UNASSIGNED'
 *   AE removed      → ae = 'UNASSIGNED - AE'
 *   RD removed      → rd = 'UNASSIGNED - RD'
 *   RVP removed     → rvp = 'UNASSIGNED - RVP'
 *   SELeader removed → se_leader = 'UNASSIGNED - LEADER'
 */
export function removePerson(id) {
  const idx = PEOPLE.findIndex(p => p.id === id);
  if (idx === -1) return;
  const person   = PEOPLE[idx];
  const { nameField } = ROLE_FIELDS[person.role] || {};
  const orphan   = ORPHAN_VALUE[person.role];

  if (nameField && orphan) {
    const orphanRows = rows => rows.forEach(r => {
      if (r[nameField] !== person.name) return;
      r[nameField] = orphan;
      if (person.role === 'SE') {
        r.se_leader = '';
        state.changedAccounts.add(r.account);
      }
    });
    orphanRows(state.workingData);
    if (state.scenarioB) orphanRows(state.scenarioB);
    if (person.role === 'SE') {
      state.addedSEs = state.addedSEs.filter(s => s.se !== person.name);
    }
  }

  PEOPLE.splice(idx, 1);
  savePeople();
}

/**
 * Count how many working-data rows reference this person.
 * Used to show the dependency warning in the remove-confirmation dialog.
 */
export function countDependencies(person) {
  const { nameField } = ROLE_FIELDS[person.role] || {};
  if (!nameField) return 0;
  return state.workingData.filter(r => r[nameField] === person.name).length;
}

// Bootstrap immediately on first import
loadPeople();
