import { BENCH } from './data.js';
import { CONFIG } from './config.js';
import { computeSEQuota, normalizeToAnnual } from './quotas.js';
import { PEOPLE } from './roster.js';

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
  // Quota dimension is virtual: derived from quotaAttainment (% of personal target).
  // It only contributes when quota tracking is on AND the dimension toggle is on AND the SE has a personal quota.
  if (dims.quota && se.quotaTrackingOn && se.quotaPersonal > 0 && se.quotaAttainment != null) {
    const pct = Math.round(se.quotaAttainment * 100);
    if (se.quotaAttainment > 1.30) {
      checks.push({ key: 'quota', label: 'Quota Load', value: `${pct}%`, _verdict: 'overloaded', _reason: `${pct}% of target > 130% (overloaded)` });
    } else if (se.quotaAttainment > 1.10) {
      checks.push({ key: 'quota', label: 'Quota Load', value: `${pct}%`, _verdict: 'stretched', _reason: `${pct}% of target > 110% (stretched)` });
    } else {
      checks.push({ key: 'quota', label: 'Quota Load', value: `${pct}%`, _verdict: 'healthy', _reason: `${pct}% of target \u2264 110% (healthy)` });
    }
  }

  if (!checks.length) {
    return { label: 'Healthy', cls: 'badge-green', reasons: ['No dimensions enabled'] };
  }

  let worst = 'healthy';
  const reasons = [];
  checks.forEach(c => {
    // Pre-classified quota check carries its verdict directly.
    if (c._verdict) {
      if (c._verdict === 'overloaded') worst = 'overloaded';
      else if (c._verdict === 'stretched' && worst !== 'overloaded') worst = 'stretched';
      reasons.push(c._reason);
      return;
    }
    if (c.value > c.th.stretched) {
      worst = 'overloaded';
      reasons.push(`${c.value} ${c.label} > ${c.th.stretched} (overloaded)`);
    } else if (c.value > c.th.healthy) {
      if (worst !== 'overloaded') worst = 'stretched';
      reasons.push(`${c.value} ${c.label} > ${c.th.healthy} (stretched)`);
    } else {
      reasons.push(`${c.value} ${c.label} \u2264 ${c.th.healthy} (healthy)`);
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
  const levels = (CONFIG.quotas && CONFIG.quotas.levels) || {};
  const quotaTrackingOn = !!(levels.account || levels.ae || levels.se);

  return Object.values(map).map(s => {
    const isTBH = s.se.startsWith('TBH');
    const isUnassigned = s.se === 'UNASSIGNED';
    let quotaCarried = 0;
    let quotaPersonal = 0;
    let quotaAttainment = null;
    if (quotaTrackingOn && !isTBH && !isUnassigned) {
      // computeSEQuota already applies the buffer when account/ae level is on.
      // For attainment we want the RAW carry, undivided by buffer; recompute without buffer.
      const buffer = 1 - (CONFIG.quotas?.buffer ?? 0.20);
      const buffered = computeSEQuota(s.se, data) || 0;
      quotaCarried = buffer > 0 ? buffered / buffer : buffered;
      const p = PEOPLE.find(p => p.name === s.se && p.role === 'SE');
      quotaPersonal = p ? normalizeToAnnual(p.quota || 0, p.quotaPeriod || 'annual') : 0;
      if (quotaPersonal > 0) {
        quotaAttainment = quotaCarried / quotaPersonal;
      }
    }
    return {
      ...s,
      accountCount: s.accounts.size,
      aeCount: s.aes.size,
      rdCount: s.rds.size,
      isTBH,
      isUnassigned,
      quotaTrackingOn,
      quotaCarried,
      quotaPersonal,
      quotaAttainment
    };
  });
}

/**
 * Classify quota attainment into healthy / stretched / overloaded / under bands.
 * Drives the Quota column badge color in the SE table.
 */
export function classifyQuotaAttainment(attainment) {
  if (attainment === null || attainment === undefined) {
    return { label: '\u2014', cls: 'badge-muted', tier: 'na' };
  }
  const pct = Math.round(attainment * 100);
  if (attainment > 1.30) return { label: `${pct}%`, cls: 'badge-red',    tier: 'overloaded' };
  if (attainment > 1.10) return { label: `${pct}%`, cls: 'badge-yellow', tier: 'stretched' };
  if (attainment >= 0.80) return { label: `${pct}%`, cls: 'badge-green',  tier: 'healthy' };
  return { label: `${pct}%`, cls: 'badge-muted', tier: 'under' };
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
  // Quota tracking flag (any SE row carries it; first row is fine).
  const quotaShown = !!(seList.length && seList[0].quotaTrackingOn);

  document.getElementById('regionGrid').innerHTML = regions.map(region => {
    const rSEs  = seList.filter(s => s.ae_region === region.name && !s.isTBH && !s.isUnassigned);
    const rAEs  = new Set(data.filter(r => r.ae_region === region.name).map(r => r.ae));
    const tbhN  = seList.filter(s => s.ae_region === region.name && s.isTBH).length;
    const ratio = rSEs.length ? (rAEs.size / rSEs.length).toFixed(1) : '-';
    let stCls = 'badge-green', stLabel = 'Healthy';
    if (rSEs.some(s => workload(s).label === 'Overloaded'))     { stCls = 'badge-red';    stLabel = 'Overloaded'; }
    else if (rSEs.some(s => workload(s).label === 'Stretched')) { stCls = 'badge-yellow'; stLabel = 'Stretched'; }

    // Quota rollup for this region
    let quotaRow = '';
    if (quotaShown) {
      const carried = rSEs.reduce((sum, s) => sum + (s.quotaCarried || 0), 0);
      const target  = rSEs.reduce((sum, s) => sum + (s.quotaPersonal || 0), 0);
      const pct     = target > 0 ? Math.round((carried / target) * 100) : null;
      const carriedLabel = _formatCompactInline(carried);
      const targetLabel  = target > 0 ? _formatCompactInline(target) : '\u2014';
      let qCls = 'var(--muted)';
      if (pct !== null) {
        if (pct > 130) qCls = 'var(--red)';
        else if (pct > 110) qCls = 'var(--yellow)';
        else if (pct >= 80) qCls = 'var(--green)';
      }
      quotaRow = `<div class="region-stat" title="Sum of carried quota across this region's active SEs vs sum of their personal targets">
        <span class="region-key">Quota Load</span>
        <span class="region-val" style="color:${qCls}">${carriedLabel}${target > 0 ? ' / ' + targetLabel : ''}${pct !== null ? ' (' + pct + '%)' : ''}</span>
      </div>`;
    }

    return `<div class="region-card">
      <div class="region-header">
        <div class="region-name"><span class="region-dot" style="background:${region.color}"></span>${region.name}</div>
        <span class="badge ${stCls}">${stLabel}</span>
      </div>
      <div class="region-stat"><span class="region-key">Active SEs</span><span class="region-val">${rSEs.length}</span></div>
      <div class="region-stat"><span class="region-key">AEs</span><span class="region-val">${rAEs.size}</span></div>
      <div class="region-stat"><span class="region-key">Avg AE:SE</span><span class="region-val">1:${ratio}</span></div>
      ${quotaRow}
      ${tbhN ? `<div class="region-stat"><span class="region-key">Open HC</span><span class="region-val" style="color:var(--muted)">${tbhN}</span></div>` : ''}
    </div>`;
  }).join('');
}

function _formatCompactInline(n) {
  n = Number(n) || 0;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}
