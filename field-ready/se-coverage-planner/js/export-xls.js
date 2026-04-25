/**
 * XLS export mirroring Jason's "Named SE Alignments & Org" workbook format.
 *
 * Strategy:
 *   - One sheet per configured team (CONFIG.teams), filtered by segment === team.name.
 *   - Account-grain rows. Vertical merges on AVP / RVP / RD / AE / SE Leader.
 *   - Region-color base fill on leadership columns, tinted by segment:
 *       Majors-equivalent (first team in CONFIG.teams) = darker
 *       Key-equivalent (others)                        = lighter
 *     Actually we tint per-team using its index: team 0 = darkest, team N-1 = lightest.
 *   - Vertical text rotation + center alignment in the merged cells.
 *   - Plus an "SE Roster Summary" sheet and an "Org Chart" sheet.
 *
 * Built on xlsx-js-style (loaded via CDN as window.XLSX).
 */

import { state } from './data.js';
import { CONFIG } from './config.js';
import { PEOPLE } from './roster.js';

// ── Color helpers ────────────────────────────────────────────────────────────

function _hexToRgb(hex) {
  const h = (hex || '').replace('#', '').trim();
  if (h.length !== 6) return { r: 100, g: 100, b: 100 };
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16)
  };
}
function _rgbToHex(r, g, b) {
  const c = n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return c(r) + c(g) + c(b);
}
function _rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;
  if (max === min) { h = s = 0; }
  else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return { h, s, l };
}
function _hslToRgb(h, s, l) {
  let r, g, b;
  if (s === 0) { r = g = b = l; }
  else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  return { r: r * 255, g: g * 255, b: b * 255 };
}

/** Adjust the lightness of a hex color by `delta` (e.g. -0.20 = 20% darker). */
function _shiftLightness(hex, delta) {
  const { r, g, b } = _hexToRgb(hex);
  const { h, s, l } = _rgbToHsl(r, g, b);
  const nl = Math.max(0, Math.min(1, l + delta));
  const out = _hslToRgb(h, s, nl);
  return _rgbToHex(out.r, out.g, out.b);
}

/** Pick a contrasting text color (white or near-black) for a given fill hex. */
function _contrastText(hex) {
  const { r, g, b } = _hexToRgb(hex);
  // Relative luminance per WCAG
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.55 ? '1F1733' : 'FFFFFF';
}

/**
 * Compute the leadership-column fill for a row given its region and team index.
 * teamIndex 0 = darkest (Majors-equivalent), increasing = lighter.
 */
function _leadershipFill(regionName, teamIndex, totalTeams) {
  const region = (CONFIG.regions || []).find(r => r.name === regionName);
  const base = region ? region.color : '#6b6584';
  // Map team index linearly across [-0.20, +0.30] so first team is darker, last is lightest.
  // For 1 team: 0 (no shift). For 2 teams: -0.20 and +0.20. For 3+: spread.
  let delta = 0;
  if (totalTeams > 1) {
    const t = teamIndex / (totalTeams - 1);  // 0..1
    delta = -0.20 + t * 0.50;                // -0.20..+0.30
  }
  return _shiftLightness(base, delta);
}

// ── Sheet builders ───────────────────────────────────────────────────────────

const LEAD_COLS = ['AVP', 'RVP', 'RD', 'AE', 'Account', 'SE', 'SE Leader'];
const MERGE_COL_INDEXES = [0, 1, 2, 3, 6]; // AVP, RVP, RD, AE, SE Leader

function _buildTeamSheet(teamName, teamIndex, totalTeams, data) {
  const rows = data
    .filter(r => r.segment === teamName)
    .slice()
    .sort((a, b) => {
      // Sort hierarchy so identical leadership values are adjacent.
      const k = (r) => [r.avp || '', r.rvp || '', r.rd || '', r.ae || '', r.account || ''].join('\u0000');
      return k(a).localeCompare(k(b));
    });

  if (!rows.length) return null; // skip empty team

  // Build AOA: header + data rows.
  const aoa = [LEAD_COLS];
  rows.forEach(r => {
    aoa.push([
      r.avp || '',
      r.rvp || '',
      r.rd || '',
      r.ae || '',
      r.account || '',
      r.se || '',
      r.se_leader || ''
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Column widths
  ws['!cols'] = [
    { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 22 },
    { wch: 26 }, { wch: 18 }, { wch: 18 }
  ];

  // Build merges for the leadership columns.
  const merges = [];
  MERGE_COL_INDEXES.forEach(col => {
    let runStart = 1; // skip header row
    let runVal = aoa[1] ? aoa[1][col] : '';
    for (let r = 2; r <= aoa.length; r++) {
      const val = r < aoa.length ? aoa[r][col] : null;
      const sameRun = (r < aoa.length) && val === runVal && val !== '';
      if (!sameRun) {
        if (r - 1 > runStart && runVal) {
          merges.push({ s: { r: runStart, c: col }, e: { r: r - 1, c: col } });
        }
        runStart = r;
        runVal = val;
      }
    }
  });
  ws['!merges'] = merges;

  // Header row styling
  for (let c = 0; c < LEAD_COLS.length; c++) {
    const addr = XLSX.utils.encode_cell({ r: 0, c });
    if (!ws[addr]) ws[addr] = { t: 's', v: LEAD_COLS[c] };
    ws[addr].s = {
      font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 11 },
      fill: { patternType: 'solid', fgColor: { rgb: '1F1733' } },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
      border: _border('FFFFFF')
    };
  }

  // Style each row.
  // Determine a per-row region by looking at the source row's ae_region.
  for (let r = 1; r < aoa.length; r++) {
    const sourceRow = rows[r - 1];
    const fillHex = _leadershipFill(sourceRow.ae_region, teamIndex, totalTeams);
    const textHex = _contrastText(fillHex);

    for (let c = 0; c < LEAD_COLS.length; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      if (!ws[addr]) ws[addr] = { t: 's', v: '' };

      const isLeadershipCol = MERGE_COL_INDEXES.includes(c);

      if (isLeadershipCol) {
        ws[addr].s = {
          font: { bold: true, color: { rgb: textHex }, sz: 11 },
          fill: { patternType: 'solid', fgColor: { rgb: fillHex } },
          alignment: {
            horizontal: 'center',
            vertical: 'center',
            wrapText: true,
            textRotation: 90
          },
          border: _border('FFFFFF')
        };
      } else {
        // Account / SE columns: plain horizontal text
        ws[addr].s = {
          font: { sz: 11, color: { rgb: '1F1733' } },
          alignment: { horizontal: 'left', vertical: 'center', wrapText: true },
          border: _border('D9D3E6')
        };
      }
    }
  }

  // Set row heights to be tall enough that rotated text reads well.
  ws['!rows'] = [{ hpt: 22 }]; // header
  for (let r = 1; r < aoa.length; r++) ws['!rows'].push({ hpt: 22 });

  return ws;
}

function _border(hex) {
  return {
    top:    { style: 'thin', color: { rgb: hex } },
    bottom: { style: 'thin', color: { rgb: hex } },
    left:   { style: 'thin', color: { rgb: hex } },
    right:  { style: 'thin', color: { rgb: hex } }
  };
}

// ── SE Roster Summary sheet ──────────────────────────────────────────────────

function _buildRosterSheet(data) {
  const teams = (CONFIG.teams || []).map(t => t.name);
  const regions = (CONFIG.regions || []).map(r => r.name);
  if (!teams.length || !regions.length) return null;

  // For each (team, region) cell: list SE Leaders + their SE direct reports who serve that team+region.
  // SE -> team comes from the data (their majority-segment); region from the data too.
  const aoa = [];

  // Header: "Team / Region", then one column per region
  aoa.push(['Team \\ Region', ...regions]);

  const seByTeamRegion = {};
  data.forEach(r => {
    if (!r.se || r.se.startsWith('TBH') || r.se === 'UNASSIGNED') return;
    const key = `${r.segment}::${r.ae_region}`;
    if (!seByTeamRegion[key]) seByTeamRegion[key] = new Map();
    if (!seByTeamRegion[key].has(r.se)) {
      seByTeamRegion[key].set(r.se, r.se_leader || '');
    }
  });

  teams.forEach(team => {
    const row = [team];
    regions.forEach(region => {
      const key = `${team}::${region}`;
      const map = seByTeamRegion[key];
      if (!map || !map.size) { row.push(''); return; }
      // Group SEs by leader for this cell
      const byLeader = {};
      [...map.entries()].forEach(([se, leader]) => {
        const k = leader || '(no leader)';
        if (!byLeader[k]) byLeader[k] = [];
        byLeader[k].push(se);
      });
      const lines = [];
      Object.entries(byLeader).forEach(([leader, ses]) => {
        lines.push(`${leader} (Lead)`);
        ses.forEach(se => lines.push(`  - ${se}`));
        lines.push('');
      });
      row.push(lines.join('\n').trim());
    });
    aoa.push(row);
  });

  // Footer totals
  aoa.push([]);
  teams.forEach(team => {
    const totalSEs = new Set();
    data.forEach(r => {
      if (r.segment === team && r.se && !r.se.startsWith('TBH') && r.se !== 'UNASSIGNED') totalSEs.add(r.se);
    });
    aoa.push([`Total ${team} SEs`, totalSEs.size, ...new Array(regions.length - 1).fill('')]);
  });
  const totalAllSEs = new Set();
  data.forEach(r => {
    if (r.se && !r.se.startsWith('TBH') && r.se !== 'UNASSIGNED') totalAllSEs.add(r.se);
  });
  aoa.push([`Total SEs (all teams)`, totalAllSEs.size, ...new Array(regions.length - 1).fill('')]);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 18 }, ...regions.map(() => ({ wch: 32 }))];

  // Style header
  for (let c = 0; c <= regions.length; c++) {
    const addr = XLSX.utils.encode_cell({ r: 0, c });
    if (!ws[addr]) ws[addr] = { t: 's', v: '' };
    ws[addr].s = {
      font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 11 },
      fill: { patternType: 'solid', fgColor: { rgb: '1F1733' } },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: _border('FFFFFF')
    };
  }

  // Style team-row label column with team-tinted fill (matching the data sheets)
  teams.forEach((team, ti) => {
    // Use a neutral region ('') so we just shift a generic gray; or pick the first region's color
    const baseRegion = regions[0];
    const fillHex = _leadershipFill(baseRegion, ti, teams.length);
    const textHex = _contrastText(fillHex);
    const addr = XLSX.utils.encode_cell({ r: ti + 1, c: 0 });
    if (ws[addr]) {
      ws[addr].s = {
        font: { bold: true, color: { rgb: textHex }, sz: 12 },
        fill: { patternType: 'solid', fgColor: { rgb: fillHex } },
        alignment: { horizontal: 'center', vertical: 'center' },
        border: _border('FFFFFF')
      };
    }
    // Cells in this row: wrap-text alignment so the multiline content renders.
    for (let c = 1; c <= regions.length; c++) {
      const a2 = XLSX.utils.encode_cell({ r: ti + 1, c });
      if (ws[a2]) {
        ws[a2].s = {
          font: { sz: 10, color: { rgb: '1F1733' } },
          alignment: { horizontal: 'left', vertical: 'top', wrapText: true },
          border: _border('D9D3E6')
        };
      }
    }
  });

  // Tall rows for the team rows so wrapped content fits
  ws['!rows'] = [{ hpt: 20 }];
  teams.forEach(() => ws['!rows'].push({ hpt: 110 }));

  return ws;
}

// ── Org Chart sheet ──────────────────────────────────────────────────────────

function _buildOrgChartSheet() {
  // Top-of-org: anyone with a top-level role. Use the first SE Leader's leader if known, else show the
  // SE leaders themselves as the top.
  const seLeaders = (PEOPLE || []).filter(p => p.role === 'SELeader' && p.active !== false);
  if (!seLeaders.length) return null;

  // Determine top-of-org if there's a single "head" — fall back to first leader's name.
  const topLabel = 'SE Organization';

  const aoa = [];
  aoa.push([topLabel, ...new Array(seLeaders.length - 1).fill('')]);
  aoa.push([]); // spacer

  // Header row of leader names
  aoa.push(seLeaders.map(l => l.name));

  // Determine each leader's region (mode of their direct reports' regions or use leader.region)
  const leaderRegions = seLeaders.map(l => l.region || '');

  // Find each leader's SE direct reports by inspecting the data: any SE whose se_leader matches the leader.
  // We have to derive this from `state.workingData` rows since the SE -> se_leader mapping lives there.
  const data = (state.viewMode === 'proposed' && state.scenarioB) ? state.scenarioB : state.workingData;
  const reportsByLeader = seLeaders.map(l => {
    const seSet = new Set();
    data.forEach(r => {
      if (r.se_leader === l.name && r.se && !r.se.startsWith('TBH') && r.se !== 'UNASSIGNED') {
        seSet.add(r.se);
      }
    });
    return [...seSet].sort();
  });
  const maxReports = Math.max(0, ...reportsByLeader.map(r => r.length));

  for (let i = 0; i < maxReports; i++) {
    const row = reportsByLeader.map(reports => reports[i] || '');
    aoa.push(row);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = seLeaders.map(() => ({ wch: 22 }));

  // Top label merged across all columns
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: Math.max(0, seLeaders.length - 1) } }
  ];

  // Style top label
  const topAddr = XLSX.utils.encode_cell({ r: 0, c: 0 });
  if (ws[topAddr]) {
    ws[topAddr].s = {
      font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 14 },
      fill: { patternType: 'solid', fgColor: { rgb: '1F1733' } },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: _border('FFFFFF')
    };
  }

  // Style leader name row (row 2)
  seLeaders.forEach((l, c) => {
    const region = leaderRegions[c];
    const fillHex = _leadershipFill(region, 0, 1); // single team -> base region color
    const textHex = _contrastText(fillHex);
    const addr = XLSX.utils.encode_cell({ r: 2, c });
    if (ws[addr]) {
      ws[addr].s = {
        font: { bold: true, color: { rgb: textHex }, sz: 12 },
        fill: { patternType: 'solid', fgColor: { rgb: fillHex } },
        alignment: { horizontal: 'center', vertical: 'center' },
        border: _border('FFFFFF')
      };
    }
    // Style report rows under this leader
    for (let i = 0; i < maxReports; i++) {
      const a2 = XLSX.utils.encode_cell({ r: 3 + i, c });
      if (ws[a2]) {
        // Only apply fill/border to non-empty cells
        const hasContent = ws[a2].v && String(ws[a2].v).trim().length > 0;
        ws[a2].s = {
          font: { sz: 11, color: { rgb: '1F1733' } },
          alignment: { horizontal: 'center', vertical: 'center' },
          border: hasContent ? _border('D9D3E6') : undefined,
          fill: hasContent
            ? { patternType: 'solid', fgColor: { rgb: _shiftLightness('#' + fillHex, 0.35).toUpperCase() } }
            : undefined
        };
      }
    }
  });

  // Set row heights
  ws['!rows'] = [{ hpt: 26 }, { hpt: 8 }, { hpt: 22 }];
  for (let i = 0; i < maxReports; i++) ws['!rows'].push({ hpt: 20 });

  return ws;
}

// ── Public entry point ───────────────────────────────────────────────────────

export function exportXLS() {
  if (typeof XLSX === 'undefined') {
    alert('Spreadsheet library is still loading. Try again in a moment.');
    return;
  }

  // Use the proposed view if a scenario is saved AND the user is currently looking at it,
  // otherwise use the live working data.
  const data = (state.viewMode === 'proposed' && state.scenarioB) ? state.scenarioB : state.workingData;
  const teams = CONFIG.teams || [];

  const wb = XLSX.utils.book_new();

  let teamSheetCount = 0;
  teams.forEach((team, idx) => {
    const ws = _buildTeamSheet(team.name, idx, teams.length, data);
    if (ws) {
      XLSX.utils.book_append_sheet(wb, ws, _safeSheetName(team.name));
      teamSheetCount++;
    }
  });

  // SE Roster Summary
  const rosterWs = _buildRosterSheet(data);
  if (rosterWs) XLSX.utils.book_append_sheet(wb, rosterWs, 'SE Roster Summary');

  // Org Chart
  const orgWs = _buildOrgChartSheet();
  if (orgWs) XLSX.utils.book_append_sheet(wb, orgWs, 'Org Chart');

  if (!wb.SheetNames.length) {
    alert('No data to export. Add accounts and teams first.');
    return;
  }

  const filename = `SE-Coverage-${new Date().toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(wb, filename, { cellStyles: true });
}

function _safeSheetName(name) {
  // Excel: sheet names <= 31 chars, no [ ] : * ? / \ chars
  return String(name || 'Sheet')
    .replace(/[\[\]:\*\?\/\\]/g, ' ')
    .slice(0, 31)
    .trim() || 'Sheet';
}
