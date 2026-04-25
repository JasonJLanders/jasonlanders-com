import { BENCH } from './data.js';
import { CONFIG } from './config.js';

/**
 * Resolve active workload thresholds for a given segment name.
 * Falls back to CONFIG.workload.thresholds.default, then to legacy BENCH if nothing is configured.
 */
function _thresholdsFor(segment) {
  const wl = CONFIG.workload || {};
  const t  = wl.thresholds || {};
  const seg = t[segment] || t.default;
  if (seg && seg.accounts && seg.aes) return seg;
  // Legacy fallback: BENCH had only AE thresholds; synthesize accounts thresholds as 2x
  const b = BENCH[segment] || BENCH.Key;
  return {
    accounts: { healthy: b.healthy * 2, stretched: b.stretched * 2 },
    aes:      { healthy: b.healthy,     stretched: b.stretched     }
  };
}

/**
 * Classify an SE across enabled dimensions and return the worst label hit.
 * Also returns a reasons list so UI can explain why.
 */
export function classifyWorkload(se) {
  const dims = (CONFIG.workload && CONFIG.workload.dimensions) || { accounts: true, aes: true };
  const t    = _thresholdsFor(se.segment);
  const checks = [];
  if (dims.accounts) checks.push({ key: 'accounts', label: 'Accounts', value: se.accountCount, th: t.accounts });
  if (dims.aes)      checks.push({ key: 'aes',      label: 'AEs',      value: se.aeCount,      th: t.aes });

  if (!checks.length) {
    return { label: 'Healthy', cls: 'badge-green', reasons: ['No dimensions enabled'] };
  }

  let worst = 'healthy';
  const reasons = [];
  checks.forEach(c => {
    if (c.value > c.th.stretched) {
      worst = 'overloaded';
      reasons.push(`${c.value} ${c.label} > ${c.th.stretched} (overloaded)`);
    } else if (c.value > c.th.healthy) {
      if (worst !== 'overloaded') worst = 'stretched';
      reasons.push(`${c.value} ${c.label} > ${c.th.healthy} (stretched)`);
    } else {
      reasons.push(`${c.value} ${c.label} ≤ ${c.th.healthy} (healthy)`);
    }
  });

  const map = {
    healthy:    { label: 'Healthy',    cls: 'badge-green'  },
    stretched:  { label: 'Stretched',  cls: 'badge-yellow' },
    overloaded: { label: 'Overloaded', cls: 'badge-red'    }
  };
  return { ...map[worst], reasons };
}

export function regionHealth(regionId, workingData) {
  const rows = workingData.filter(r => r.ae_region === regionId);
  const seSet = new Set(rows.filter(r => !r.se.startsWith('TBH') && r.se !== 'UNASSIGNED').map(r => r.se));
  const aeSet = new Set(rows.map(r => r.ae));
  if (!seSet.size) return 'healthy';
  const ratio = aeSet.size / seSet.size;
  if (ratio <= 3.0) return 'healthy';
  if (ratio <= 4.0) return 'stretched';
  return 'overloaded';
}

export function computeStats(data, extraSEs) {
  extraSEs = extraSEs || [];
  const map = {};
  data.forEach(r => {
    if (!map[r.se]) map[r.se] = {
      se: r.se, se_leader: r.se_leader, segment: r.segment,
      ae_region: r.ae_region, home_city: r.home_city || '',
      accounts: new Map(), aes: new Set(), rds: new Set()
    };
    map[r.se].accounts.set(r.account, r.account); // value unused now; kept for Map API compat
    map[r.se].aes.add(r.ae);
    map[r.se].rds.add(r.rd);
  });
  extraSEs.forEach(s => {
    if (!map[s.se]) map[s.se] = {
      se: s.se, se_leader: s.se_leader, segment: s.segment,
      ae_region: s.ae_region, home_city: s.home_city || '',
      accounts: new Map(), aes: new Set(), rds: new Set()
    };
  });
  return Object.values(map).map(s => ({
    ...s, accountCount: s.accounts.size, aeCount: s.aes.size, rdCount: s.rds.size,
    isTBH: s.se.startsWith('TBH'), isUnassigned: s.se === 'UNASSIGNED'
  }));
}

export function workload(se) {
  if (se.isUnassigned) return { label: '\u26a0 Needs Assignment', cls: 'badge-red', reasons: [] };
  if (se.isTBH)        return { label: 'Open HC',                cls: 'badge-muted', reasons: [] };
  return classifyWorkload(se);
}

/**
 * Compute a minimum-hires proposal that reduces every active SE to Healthy.
 * Groups by (region, segment). Uses account count as the primary load driver.
 *
 * Returns:
 *   {
 *     totalHires: number,
 *     groups: [
 *       {
 *         region: string, segment: string,
 *         hiresNeeded: number,
 *         fromSEs:   [ { se, before: { accounts, aes }, after: { accounts } } ],
 *         moves:     [ { account, from: seName, to: tbhLabel } ],
 *         tbhLabels: [ 'TBH - Proposed 1', ... ]  // names for the created TBHs
 *       }
 *     ]
 *   }
 *
 * Caller is expected to mutate state.workingData and state.addedSEs based on the returned moves.
 * This function is pure and does not touch global state.
 */
export function computeHireProposal(seList, { tbhSeed = 'Proposed' } = {}) {
  const result = { totalHires: 0, groups: [] };

  // Only consider real, active SEs (skip TBH / UNASSIGNED)
  const active = seList.filter(se => !se.isTBH && !se.isUnassigned);
  if (!active.length) return result;

  // Group by region + segment
  const groups = new Map();
  active.forEach(se => {
    const key = (se.ae_region || '') + '\u0000' + (se.segment || '');
    if (!groups.has(key)) groups.set(key, { region: se.ae_region || '', segment: se.segment || '', ses: [] });
    groups.get(key).ses.push(se);
  });

  let tbhCounter = 1;

  for (const group of groups.values()) {
    const { region, segment, ses } = group;
    // How overloaded each SE is, by accounts
    const accountsHealthy = (_thresholdsFor(segment).accounts || {}).healthy || 999;
    // Working copies of each SE's account set (names)
    const workingAccts = new Map();
    ses.forEach(se => workingAccts.set(se.se, [...se.accounts.keys()]));

    // Does any SE in this group still exceed the healthy accounts threshold?
    const anyOver = () => [...workingAccts.values()].some(acctList => acctList.length > accountsHealthy);
    if (!anyOver()) continue;

    const moves = [];
    const tbhLabels = [];
    let hiresForGroup = 0;

    // Keep adding TBHs until no existing SE exceeds healthy.
    // Safety cap: don't loop forever if config is pathological.
    for (let safety = 0; safety < 100; safety++) {
      if (!anyOver()) break;

      hiresForGroup += 1;
      const tbhLabel = `TBH - ${tbhSeed} ${tbhCounter++}`;
      tbhLabels.push(tbhLabel);
      let tbhAccounts = 0;

      // Each pass, take ONE account from the most-loaded SE until TBH is full or no-one is over.
      while (tbhAccounts < accountsHealthy && anyOver()) {
        // Find the SE with the most accounts currently (must exceed healthy)
        let worstSe = null;
        let worstCount = -1;
        for (const [seName, acctList] of workingAccts.entries()) {
          if (acctList.length > accountsHealthy && acctList.length > worstCount) {
            worstSe = seName;
            worstCount = acctList.length;
          }
        }
        if (!worstSe) break;

        // Pop one account from that SE and move it to the TBH
        const acctList = workingAccts.get(worstSe);
        const movedAccount = acctList.pop(); // take from end (cheap)
        moves.push({ account: movedAccount, from: worstSe, to: tbhLabel });
        tbhAccounts += 1;
      }
    }

    if (!hiresForGroup) continue;

    const fromSEs = ses.map(se => {
      const remaining = workingAccts.get(se.se) || [];
      return {
        se: se.se,
        before: { accounts: se.accountCount, aes: se.aeCount },
        after:  { accounts: remaining.length }
      };
    }).filter(x => x.before.accounts !== x.after.accounts);

    result.groups.push({ region, segment, hiresNeeded: hiresForGroup, fromSEs, moves, tbhLabels });
    result.totalHires += hiresForGroup;
  }

  return result;
}

export function renderRegionGrid(regions, seList, data) {
  document.getElementById('regionGrid').innerHTML = regions.map(region => {
    const rSEs  = seList.filter(s => s.ae_region === region.name && !s.isTBH && !s.isUnassigned);
    const rAEs  = new Set(data.filter(r => r.ae_region === region.name).map(r => r.ae));
    const tbhN  = seList.filter(s => s.ae_region === region.name && s.isTBH).length;
    const ratio = rSEs.length ? (rAEs.size / rSEs.length).toFixed(1) : '—';
    let stCls = 'badge-green', stLabel = 'Healthy';
    if (rSEs.some(s => workload(s).label === 'Overloaded'))     { stCls = 'badge-red';    stLabel = 'Overloaded'; }
    else if (rSEs.some(s => workload(s).label === 'Stretched')) { stCls = 'badge-yellow'; stLabel = 'Stretched'; }
    return `<div class="region-card">
      <div class="region-header">
        <div class="region-name"><span class="region-dot" style="background:${region.color}"></span>${region.name}</div>
        <span class="badge ${stCls}">${stLabel}</span>
      </div>
      <div class="region-stat"><span class="region-key">Active SEs</span><span class="region-val">${rSEs.length}</span></div>
      <div class="region-stat"><span class="region-key">AEs</span><span class="region-val">${rAEs.size}</span></div>
      <div class="region-stat"><span class="region-key">Avg AE:SE</span><span class="region-val">1:${ratio}</span></div>
      ${tbhN ? `<div class="region-stat"><span class="region-key">Open HC</span><span class="region-val" style="color:var(--muted)">${tbhN}</span></div>` : ''}
    </div>`;
  }).join('');
}
