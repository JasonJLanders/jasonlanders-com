/**
 * CSV import + sample template generation.
 *
 * Flow: user opens modal -> sees format spec -> downloads template OR drops/picks a file
 *      -> parser validates rows -> shows preview (counts + warnings) -> user confirms
 *      -> applyImport replaces ACCOUNTS, PEOPLE, and workingData; persists to localStorage.
 *
 * Replace-all semantics by design: imports seed a workspace, they don't augment one.
 * Unknown regions/segments are skipped with a warning so typos don't silently create config.
 */

import { state } from './data.js';
import { CONFIG, saveConfig } from './config.js';
import { ACCOUNTS, saveAccounts } from './accounts.js';
import { PEOPLE, savePeople } from './roster.js';

// ── Column schema ────────────────────────────────────────────────────────────

// Order = column order in the template. Required columns marked with required:true.
export const COLUMNS = [
  { key: 'account',              required: true,  label: 'account',              desc: 'Unique account name' },
  { key: 'segment',              required: true,  label: 'segment',              desc: 'Must match a configured segment name' },
  { key: 'region',               required: true,  label: 'region',               desc: 'Must match a configured region name' },
  { key: 'ae',                   required: true,  label: 'ae',                   desc: 'AE (Account Executive) full name' },
  { key: 'se',                   required: true,  label: 'se',                   desc: 'SE (Sales Engineer) full name' },
  { key: 'avp',                  required: false, label: 'avp',                  desc: 'AVP full name' },
  { key: 'avp_city',             required: false, label: 'avp_city',             desc: '"City, ST" or "City, Country"' },
  { key: 'rvp',                  required: false, label: 'rvp',                  desc: 'RVP full name' },
  { key: 'rvp_city',             required: false, label: 'rvp_city',             desc: '' },
  { key: 'rd',                   required: false, label: 'rd',                   desc: 'RD full name' },
  { key: 'rd_city',              required: false, label: 'rd_city',              desc: '' },
  { key: 'ae_city',              required: false, label: 'ae_city',              desc: 'AE home city' },
  { key: 'se_home_city',         required: false, label: 'se_home_city',         desc: 'SE home city (geocoded for map markers)' },
  { key: 'se_leader',            required: false, label: 'se_leader',            desc: 'SE Leader full name' },
  { key: 'se_leader_city',       required: false, label: 'se_leader_city',       desc: '' },
  { key: 'account_quota',        required: false, label: 'account_quota',        desc: 'Numeric (e.g. 4000000 = $4M)' },
  { key: 'account_quota_period', required: false, label: 'account_quota_period', desc: '"annual" | "quarterly" | "monthly"' },
  { key: 'account_active',       required: false, label: 'account_active',       desc: '"true" or "false" (default true)' }
];

// ── Template generator ───────────────────────────────────────────────────────

/** Build a sample CSV including header + one example row drawn from the user's first region/segment. */
export function generateTemplateCSV() {
  const headers = COLUMNS.map(c => c.label);

  const exampleRegion  = (CONFIG.regions || [])[0]?.name  || 'West';
  const exampleSegment = (CONFIG.teams   || [])[0]?.name  || 'Majors';

  const exampleRow = {
    account:              'Acme Corp',
    segment:              exampleSegment,
    region:               exampleRegion,
    ae:                   'Alex Burke / Pacific NW',
    se:                   'Sara Chen',
    avp:                  'Jennifer Ray',
    avp_city:             'San Francisco, CA',
    rvp:                  'Tom Walsh',
    rvp_city:             'San Francisco, CA',
    rd:                   'Amy Grant',
    rd_city:              'San Francisco, CA',
    ae_city:              'Seattle, WA',
    se_home_city:         'San Francisco, CA',
    se_leader:            'Mike Torres',
    se_leader_city:       'San Francisco, CA',
    account_quota:        '4000000',
    account_quota_period: 'annual',
    account_active:       'true'
  };
  const row = headers.map(h => _csvEscape(exampleRow[h] || ''));

  return headers.join(',') + '\n' + row.join(',') + '\n';
}

/** Trigger a browser download of the sample CSV. */
export function downloadTemplate() {
  const csv = generateTemplateCSV();
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'SE-Coverage-template.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── CSV parser (RFC 4180 minimal compliance) ─────────────────────────────────

/**
 * Parse CSV text into an array of header-keyed objects. Handles quoted fields,
 * escaped quotes ("" -> "), and commas/newlines inside quoted fields. Strips BOM.
 */
export function parseCSV(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else {
        field += c;
      }
    } else {
      if (c === '"') { inQuotes = true; }
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\r') { /* skip */ }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else { field += c; }
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }

  // Drop trailing empty lines
  while (rows.length && rows[rows.length - 1].every(s => !s.trim())) rows.pop();
  if (!rows.length) return { headers: [], records: [] };

  const headers = rows[0].map(h => h.trim().toLowerCase());
  const records = rows.slice(1).map(r => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (r[i] != null ? r[i] : '').trim(); });
    return obj;
  });
  return { headers, records };
}

function _csvEscape(v) {
  v = String(v == null ? '' : v);
  if (/[",\n\r]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
  return v;
}

// ── Validation ───────────────────────────────────────────────────────────────

/**
 * Validate parsed records. Returns { valid: [...rows], skipped: [{rowIdx, reason}], warnings: [...] }
 * - rowIdx is 1-based to match what the user sees in their spreadsheet (1 = first data row, header excluded)
 */
export function validateRecords(headers, records) {
  const valid = [];
  const skipped = [];
  const warnings = [];

  // Check required headers up front
  const required = COLUMNS.filter(c => c.required).map(c => c.key);
  const missingHeaders = required.filter(k => !headers.includes(k));
  if (missingHeaders.length) {
    return {
      valid: [], skipped: [], warnings: [],
      headerError: `Missing required columns: ${missingHeaders.join(', ')}. Download the template for the correct format.`
    };
  }

  const regionNames  = new Set((CONFIG.regions || []).map(r => r.name));
  const segmentNames = new Set((CONFIG.teams   || []).map(t => t.name));

  // Track person name -> first city seen so we can warn on conflicts
  const personFirstCity = {};
  // Track account names so we can flag duplicates
  const accountSeen = new Set();

  records.forEach((rec, i) => {
    const rowIdx = i + 1; // 1-based data-row index

    // Required-field guard
    if (!rec.account)  return skipped.push({ rowIdx, reason: 'missing account name' });
    if (!rec.segment)  return skipped.push({ rowIdx, reason: `account "${rec.account}" missing segment` });
    if (!rec.region)   return skipped.push({ rowIdx, reason: `account "${rec.account}" missing region` });
    if (!rec.ae)       return skipped.push({ rowIdx, reason: `account "${rec.account}" missing AE` });
    if (!rec.se)       return skipped.push({ rowIdx, reason: `account "${rec.account}" missing SE` });

    // Region / segment validity
    if (!regionNames.has(rec.region))   return skipped.push({ rowIdx, reason: `region "${rec.region}" is not configured (configure it in Manage Data \u2192 Regions)` });
    if (!segmentNames.has(rec.segment)) return skipped.push({ rowIdx, reason: `segment "${rec.segment}" is not configured (configure it in Manage Data \u2192 Segments)` });

    // Duplicate account name
    if (accountSeen.has(rec.account)) {
      return skipped.push({ rowIdx, reason: `duplicate account name "${rec.account}" (already on a previous row)` });
    }
    accountSeen.add(rec.account);

    // City conflicts (warn but accept)
    [['ae', 'ae_city'], ['se', 'se_home_city'], ['rd', 'rd_city'], ['rvp', 'rvp_city'], ['avp', 'avp_city'], ['se_leader', 'se_leader_city']].forEach(([nameKey, cityKey]) => {
      const name = rec[nameKey];
      const city = rec[cityKey];
      if (!name || !city) return;
      if (personFirstCity[name] && personFirstCity[name] !== city) {
        warnings.push(`Row ${rowIdx}: ${name} listed in "${city}" but earlier rows said "${personFirstCity[name]}"; keeping the first city.`);
      } else if (!personFirstCity[name]) {
        personFirstCity[name] = city;
      }
    });

    // Quota validation (lenient: malformed quota becomes 0 with warning)
    if (rec.account_quota && isNaN(parseFloat(rec.account_quota))) {
      warnings.push(`Row ${rowIdx}: account_quota "${rec.account_quota}" isn't a number; treating as 0.`);
      rec.account_quota = '0';
    }
    if (rec.account_quota_period && !['annual','quarterly','monthly'].includes(rec.account_quota_period.toLowerCase())) {
      warnings.push(`Row ${rowIdx}: account_quota_period "${rec.account_quota_period}" is invalid; treating as "annual".`);
      rec.account_quota_period = 'annual';
    }

    valid.push(rec);
  });

  return { valid, skipped, warnings };
}

// ── Apply (replace ACCOUNTS / PEOPLE / workingData) ──────────────────────────

/**
 * Replace all account-grain data with the imported records.
 * Mutates state.workingData in place so existing references stay valid.
 *
 * @param {Array} records - validated records to import
 * @param {Object} [opts]
 * @param {boolean} [opts.replaceConfig=false] - when true, also prune any CONFIG.regions /
 *   CONFIG.teams that aren't referenced by any imported row. Region geo assignments are
 *   preserved for any region that survives. Removed regions also drop their feature mapping.
 */
export function applyImport(records, opts = {}) {
  const replaceConfig = !!opts.replaceConfig;
  // Reset core stores
  ACCOUNTS.length = 0;
  PEOPLE.length   = 0;
  state.workingData.length = 0;
  // Wipe scenario data since it referenced the old workingData rows
  state.scenarioB = null;
  state.scenarioBChanged = new Set();
  state.scenarioBAddedSEs = null;
  state.scenarioBNarrative = '';
  state.changedAccounts = new Set();
  state.addedSEs = [];
  state.lastProposalNarrative = '';

  // Track unique people across roles so PEOPLE has one entry per (name, role).
  const peopleSeen = {}; // key = role + '|' + name

  function ensurePerson(name, role, city, region) {
    if (!name) return;
    if (name.startsWith('TBH') || name.startsWith('UNASSIGNED')) return;
    const key = role + '|' + name;
    if (peopleSeen[key]) return;
    peopleSeen[key] = true;
    PEOPLE.push({
      id: 'p-' + (PEOPLE.length + 1),
      name, role,
      city:   city   || '',
      region: region || '',
      notes:  '',
      active: true
    });
  }

  records.forEach((r, idx) => {
    const accountId = 'a-' + (idx + 1);
    const quota = r.account_quota ? parseFloat(r.account_quota) : 0;
    const quotaPeriod = (r.account_quota_period || 'annual').toLowerCase();
    const active = r.account_active ? r.account_active.toLowerCase() !== 'false' : true;

    ACCOUNTS.push({
      id: accountId,
      name:        r.account,
      segment:     r.segment,
      region:      r.region,
      ae:          r.ae,
      se:          r.se,
      notes:       '',
      quota:       isNaN(quota) ? 0 : quota,
      quotaPeriod,
      active
    });

    state.workingData.push({
      segment:        r.segment,
      avp:            r.avp || '',
      avp_city:       r.avp_city || '',
      rvp:            r.rvp || '',
      rvp_city:       r.rvp_city || '',
      rd:             r.rd  || '',
      rd_city:        r.rd_city || '',
      ae:             r.ae,
      ae_city:        r.ae_city || '',
      ae_region:      r.region,
      account:        r.account,
      se:             r.se,
      se_leader:      r.se_leader || '',
      se_leader_city: r.se_leader_city || '',
      home_city:      r.se_home_city || ''
    });

    ensurePerson(r.se,        'SE',       r.se_home_city,    r.region);
    ensurePerson(r.ae,        'AE',       r.ae_city,         r.region);
    ensurePerson(r.rd,        'RD',       r.rd_city,         r.region);
    ensurePerson(r.rvp,       'RVP',      r.rvp_city,        r.region);
    ensurePerson(r.avp,       'AVP',      r.avp_city,        r.region);
    ensurePerson(r.se_leader, 'SELeader', r.se_leader_city,  r.region);
  });

  if (replaceConfig) {
    // Prune CONFIG.regions / CONFIG.teams to only those referenced by an imported record.
    const usedRegions  = new Set(records.map(r => r.region));
    const usedSegments = new Set(records.map(r => r.segment));
    if (Array.isArray(CONFIG.regions)) {
      CONFIG.regions = CONFIG.regions.filter(r => usedRegions.has(r.name));
    }
    if (Array.isArray(CONFIG.teams)) {
      CONFIG.teams = CONFIG.teams.filter(t => usedSegments.has(t.name));
    }
    // Also drop feature-region mappings for regions that no longer exist.
    if (CONFIG.regionFeatures && typeof CONFIG.regionFeatures === 'object') {
      Object.keys(CONFIG.regionFeatures).forEach(rid => {
        if (!usedRegions.has(rid)) delete CONFIG.regionFeatures[rid];
      });
    }
  }

  saveAccounts();
  savePeople();
  saveConfig();
}
