import { BENCH } from './data.js';

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
    map[r.se].accounts.set(r.account, r.priority);
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
  if (se.isUnassigned) return { label: '\u26a0 Needs Assignment', cls: 'badge-red' };
  if (se.isTBH)        return { label: 'Open HC',               cls: 'badge-muted' };
  const b = BENCH[se.segment] || BENCH.Key;
  if (se.aeCount <= b.healthy)   return { label: 'Healthy',   cls: 'badge-green' };
  if (se.aeCount <= b.stretched) return { label: 'Stretched', cls: 'badge-yellow' };
  return                                { label: 'Overloaded', cls: 'badge-red' };
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
