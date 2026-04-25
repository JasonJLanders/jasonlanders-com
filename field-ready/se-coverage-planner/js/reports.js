/**
 * Reports / Analytics dashboard.
 *
 * Renders into the #reportsView full-screen overlay. Charts via Chart.js.
 * Each chart can export to PNG; the whole report can export to PDF (via jsPDF).
 *
 * Charts all derive from computeStats output - no new data model.
 */

import { state } from './data.js';
import { CONFIG, roleLabel } from './config.js';
import { computeStats, workload } from './stats.js';
import { formatCompact } from './quotas.js';

// Track active Chart.js instances so we can destroy them on re-render / close.
let _charts = [];
function _destroyCharts() {
  _charts.forEach(c => { try { c.destroy(); } catch {} });
  _charts = [];
}

// ── Theme helpers ────────────────────────────────────────────────────────────

function _cssVar(name, fallback) {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch { return fallback; }
}

function _themeColors() {
  return {
    text:    _cssVar('--text',    '#1f1733'),
    muted:   _cssVar('--muted',   '#6b6584'),
    border:  _cssVar('--border',  '#d9d3e6'),
    surface: _cssVar('--surface', '#ffffff'),
    surface2:_cssVar('--surface2','#f0eef6'),
    accent:  _cssVar('--accent',  '#b91fd4'),
    green:   _cssVar('--green',   '#15803d'),
    yellow:  _cssVar('--yellow',  '#b45309'),
    red:     _cssVar('--red',     '#b91c1c')
  };
}

// ── Public entry point ───────────────────────────────────────────────────────

export function openReports() {
  const view = document.getElementById('reportsView');
  if (!view) return;
  view.style.display = 'flex';
  _renderReports();
}

export function closeReports() {
  _destroyCharts();
  const view = document.getElementById('reportsView');
  if (view) view.style.display = 'none';
}

// Re-render on theme change (chart text/grid colors are baked at construction time).
document.addEventListener('theme-changed', () => {
  const view = document.getElementById('reportsView');
  if (view && view.style.display !== 'none') _renderReports();
});

// ── Aggregations ─────────────────────────────────────────────────────────────

function _aggregate() {
  const data = state.workingData || [];
  const seList = computeStats(data, []).filter(s => !s.isTBH && !s.isUnassigned);
  const tbhCount = computeStats(data, []).filter(s => s.isTBH).length;
  const quotaTrackingOn = !!(seList.length && seList[0].quotaTrackingOn);

  // Org-wide ratios
  const allAE  = new Set(data.map(r => r.ae).filter(Boolean));
  const allRD  = new Set(data.map(r => r.rd).filter(Boolean));
  const allAcct = data.length;
  const seCount = seList.length;
  const aeCount = allAE.size;
  const rdCount = allRD.size;

  const orgRatios = {
    aePerSE:    seCount ? aeCount / seCount : 0,
    acctPerSE:  seCount ? allAcct / seCount : 0,
    aePerRD:    rdCount ? aeCount / rdCount : 0,
    acctPerAE:  aeCount ? allAcct / aeCount : 0
  };

  let coveragePct = null;
  if (quotaTrackingOn) {
    const carried  = seList.reduce((s, x) => s + (x.quotaCarried  || 0), 0);
    const personal = seList.reduce((s, x) => s + (x.quotaPersonal || 0), 0);
    if (personal > 0) coveragePct = Math.round((carried / personal) * 100);
  }

  // Per-region breakdown
  const regions = (CONFIG.regions || []).map(r => r.name);
  const byRegion = regions.map(name => {
    const rows = data.filter(r => r.ae_region === name);
    const seSet = new Set(rows.filter(r => r.se && !r.se.startsWith('TBH') && r.se !== 'UNASSIGNED').map(r => r.se));
    const aeSet = new Set(rows.map(r => r.ae).filter(Boolean));
    const ses = [...seSet].map(n => seList.find(s => s.se === n)).filter(Boolean);
    let healthy = 0, stretched = 0, overloaded = 0;
    ses.forEach(s => {
      const wl = workload(s);
      if (wl.label === 'Overloaded') overloaded++;
      else if (wl.label === 'Stretched') stretched++;
      else healthy++;
    });
    return {
      name,
      color:  ((CONFIG.regions || []).find(r => r.name === name) || {}).color || '#6b6584',
      seCount: seSet.size,
      aeCount: aeSet.size,
      acctCount: rows.length,
      ratio: seSet.size ? (aeSet.size / seSet.size) : 0,
      healthy, stretched, overloaded
    };
  });

  // Segment x Region matrix
  const segments = (CONFIG.teams || []).map(t => t.name);
  const matrix = segments.map(seg => ({
    segment: seg,
    cells: regions.map(reg => {
      const rows = data.filter(r => r.segment === seg && r.ae_region === reg);
      const seSet = new Set(rows.filter(r => r.se && !r.se.startsWith('TBH') && r.se !== 'UNASSIGNED').map(r => r.se));
      const aeSet = new Set(rows.map(r => r.ae).filter(Boolean));
      return { region: reg, accounts: rows.length, aes: aeSet.size, ses: seSet.size };
    })
  }));

  return {
    seList, regions, segments, byRegion, matrix,
    orgRatios, coveragePct, tbhCount, seCount, aeCount, rdCount,
    quotaTrackingOn
  };
}

// ── Renderer ─────────────────────────────────────────────────────────────────

function _renderReports() {
  _destroyCharts();
  const body = document.getElementById('reportsBody');
  if (!body) return;
  const agg = _aggregate();
  if (!agg.seCount) {
    body.innerHTML = `<div style="padding:40px;text-align:center;color:var(--muted);font-size:14px">No active SEs to report on. Add accounts and SEs in Manage Data.</div>`;
    return;
  }

  const cards = [
    { key: 'aePerSE',   label: `${roleLabel('ae')} per ${roleLabel('se')}`,  value: '1:' + agg.orgRatios.aePerSE.toFixed(1) },
    { key: 'acctPerSE', label: 'Accounts per ' + roleLabel('se'),             value: agg.orgRatios.acctPerSE.toFixed(1) },
    { key: 'aePerRD',   label: `${roleLabel('ae')} per ${roleLabel('rd')}`,  value: '1:' + agg.orgRatios.aePerRD.toFixed(1) },
    { key: 'acctPerAE', label: 'Accounts per ' + roleLabel('ae'),             value: agg.orgRatios.acctPerAE.toFixed(1) }
  ];
  if (agg.coveragePct != null) cards.push({ key: 'cov', label: 'Coverage', value: agg.coveragePct + '%' });
  if (agg.tbhCount > 0)        cards.push({ key: 'tbh', label: 'Open HC',  value: String(agg.tbhCount) });

  const cardHtml = cards.map(c => `
    <div class="rpt-stat">
      <div class="rpt-stat-val">${c.value}</div>
      <div class="rpt-stat-lbl">${c.label}</div>
    </div>
  `).join('');

  // Build the body skeleton.
  body.innerHTML = `
    <div class="rpt-strip">${cardHtml}</div>

    <div class="rpt-card">
      <div class="rpt-card-head">
        <div class="rpt-card-title">Account Load by ${roleLabel('se')}</div>
        <div class="rpt-card-sub">Bars colored by workload health. Sorted by account count.</div>
        <button class="rpt-png-btn" data-chart="chartAcctLoad">PNG</button>
      </div>
      <div class="rpt-canvas-wrap" style="height:${Math.max(320, agg.seList.length * 22 + 60)}px">
        <canvas id="chartAcctLoad"></canvas>
      </div>
    </div>

    <div class="rpt-card">
      <div class="rpt-card-head">
        <div class="rpt-card-title">${roleLabel('ae')} Load by ${roleLabel('se')}</div>
        <div class="rpt-card-sub">${roleLabel('ae')}s assigned to each ${roleLabel('se')}, sorted descending.</div>
        <button class="rpt-png-btn" data-chart="chartAELoad">PNG</button>
      </div>
      <div class="rpt-canvas-wrap" style="height:${Math.max(320, agg.seList.length * 22 + 60)}px">
        <canvas id="chartAELoad"></canvas>
      </div>
    </div>

    <div class="rpt-card">
      <div class="rpt-card-head">
        <div class="rpt-card-title">Region Health Distribution</div>
        <div class="rpt-card-sub">Stacked counts of healthy / stretched / overloaded ${roleLabel('se')}s per region.</div>
        <button class="rpt-png-btn" data-chart="chartRegionHealth">PNG</button>
      </div>
      <div class="rpt-canvas-wrap" style="height:340px"><canvas id="chartRegionHealth"></canvas></div>
    </div>

    <div class="rpt-card">
      <div class="rpt-card-head">
        <div class="rpt-card-title">Region ${roleLabel('ae')}:${roleLabel('se')} Ratio</div>
        <div class="rpt-card-sub">Each region's average ratio. Dashed line = org-wide average (${'1:' + agg.orgRatios.aePerSE.toFixed(1)}).</div>
        <button class="rpt-png-btn" data-chart="chartRegionRatio">PNG</button>
      </div>
      <div class="rpt-canvas-wrap" style="height:340px"><canvas id="chartRegionRatio"></canvas></div>
    </div>

    ${agg.quotaTrackingOn ? `
    <div class="rpt-card">
      <div class="rpt-card-head">
        <div class="rpt-card-title">Coverage Outliers</div>
        <div class="rpt-card-sub">Each ${roleLabel('se')} plotted by account count vs coverage %. Reveals over- and under-loaded carry.</div>
        <button class="rpt-png-btn" data-chart="chartCoverageScatter">PNG</button>
      </div>
      <div class="rpt-canvas-wrap" style="height:380px"><canvas id="chartCoverageScatter"></canvas></div>
    </div>
    ` : ''}

    <div class="rpt-card">
      <div class="rpt-card-head">
        <div class="rpt-card-title">Segment x Region Matrix</div>
        <div class="rpt-card-sub">Account / ${roleLabel('ae')} / ${roleLabel('se')} counts in each cell. Darker = denser.</div>
      </div>
      <div id="matrixWrap" class="rpt-matrix-wrap"></div>
    </div>
  `;

  _renderMatrix(agg);
  _wirePngButtons();
  // Charts: defer one tick so canvases have layout dimensions.
  requestAnimationFrame(() => {
    _buildAcctLoad(agg);
    _buildAELoad(agg);
    _buildRegionHealth(agg);
    _buildRegionRatio(agg);
    if (agg.quotaTrackingOn) _buildCoverageScatter(agg);
  });
}

function _wirePngButtons() {
  document.querySelectorAll('.rpt-png-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.chart;
      const inst = _charts.find(c => c && c.canvas && c.canvas.id === id);
      if (!inst) return;
      const url = inst.toBase64Image('image/png', 1.0);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${id}-${new Date().toISOString().slice(0, 10)}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    });
  });
}

// ── Charts ───────────────────────────────────────────────────────────────────

function _wlColor(label, theme) {
  if (label === 'Overloaded') return theme.red;
  if (label === 'Stretched')  return theme.yellow;
  return theme.green;
}

function _buildAcctLoad(agg) {
  const theme = _themeColors();
  const sorted = agg.seList.slice().sort((a, b) => b.accountCount - a.accountCount);
  const labels = sorted.map(s => s.se);
  const values = sorted.map(s => s.accountCount);
  const colors = sorted.map(s => _wlColor(workload(s).label, theme));

  const ctx = document.getElementById('chartAcctLoad');
  if (!ctx) return;
  _charts.push(new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 0 }] },
    options: {
      indexAxis: 'y',
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => `${ctx.parsed.x} accounts (${workload(sorted[ctx.dataIndex]).label})` } }
      },
      scales: {
        x: { ticks: { color: theme.muted }, grid: { color: theme.border } },
        y: { ticks: { color: theme.text }, grid: { display: false } }
      }
    }
  }));
}

function _buildAELoad(agg) {
  const theme = _themeColors();
  const sorted = agg.seList.slice().sort((a, b) => b.aeCount - a.aeCount);
  const labels = sorted.map(s => s.se);
  const values = sorted.map(s => s.aeCount);
  const colors = sorted.map(s => _wlColor(workload(s).label, theme));

  const ctx = document.getElementById('chartAELoad');
  if (!ctx) return;
  _charts.push(new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 0 }] },
    options: {
      indexAxis: 'y',
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => `${ctx.parsed.x} ${roleLabel('ae')}s` } }
      },
      scales: {
        x: { ticks: { color: theme.muted }, grid: { color: theme.border } },
        y: { ticks: { color: theme.text }, grid: { display: false } }
      }
    }
  }));
}

function _buildRegionHealth(agg) {
  const theme = _themeColors();
  const labels  = agg.byRegion.map(r => r.name);
  const healthy = agg.byRegion.map(r => r.healthy);
  const stretched = agg.byRegion.map(r => r.stretched);
  const overloaded = agg.byRegion.map(r => r.overloaded);

  const ctx = document.getElementById('chartRegionHealth');
  if (!ctx) return;
  _charts.push(new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Healthy',    data: healthy,    backgroundColor: theme.green,  stack: 'wl' },
        { label: 'Stretched',  data: stretched,  backgroundColor: theme.yellow, stack: 'wl' },
        { label: 'Overloaded', data: overloaded, backgroundColor: theme.red,    stack: 'wl' }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: theme.text } } },
      scales: {
        x: { stacked: true, ticks: { color: theme.text }, grid: { display: false } },
        y: { stacked: true, ticks: { color: theme.muted, stepSize: 1 }, grid: { color: theme.border }, title: { display: true, text: roleLabel('se') + ' count', color: theme.muted } }
      }
    }
  }));
}

function _buildRegionRatio(agg) {
  const theme = _themeColors();
  const labels = agg.byRegion.map(r => r.name);
  const values = agg.byRegion.map(r => r.ratio);
  const colors = agg.byRegion.map(r => r.color || theme.accent);
  const orgAvg = agg.orgRatios.aePerSE;

  const ctx = document.getElementById('chartRegionRatio');
  if (!ctx) return;
  _charts.push(new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 0 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => `1:${ctx.parsed.y.toFixed(1)}` } },
        // Render the org-avg line via afterDraw plugin
        annotation: undefined
      },
      scales: {
        x: { ticks: { color: theme.text }, grid: { display: false } },
        y: { ticks: { color: theme.muted, callback: (v) => '1:' + v.toFixed(1) }, grid: { color: theme.border } }
      }
    },
    plugins: [{
      id: 'orgAvgLine',
      afterDraw: (chart) => {
        const yScale = chart.scales.y;
        if (!yScale) return;
        const y = yScale.getPixelForValue(orgAvg);
        const ctxd = chart.ctx;
        ctxd.save();
        ctxd.strokeStyle = theme.accent;
        ctxd.setLineDash([6, 4]);
        ctxd.lineWidth = 1.5;
        ctxd.beginPath();
        ctxd.moveTo(chart.chartArea.left,  y);
        ctxd.lineTo(chart.chartArea.right, y);
        ctxd.stroke();
        ctxd.fillStyle = theme.accent;
        ctxd.font = '11px Inter, system-ui, sans-serif';
        ctxd.fillText(`Org avg 1:${orgAvg.toFixed(1)}`, chart.chartArea.right - 90, y - 4);
        ctxd.restore();
      }
    }]
  }));
}

function _buildCoverageScatter(agg) {
  const theme = _themeColors();
  const points = agg.seList.filter(s => s.quotaPersonal > 0).map(s => ({
    x: s.accountCount,
    y: Math.round((s.quotaCarried / s.quotaPersonal) * 100),
    name: s.se,
    color: _wlColor(workload(s).label, theme)
  }));

  const ctx = document.getElementById('chartCoverageScatter');
  if (!ctx) return;
  _charts.push(new Chart(ctx, {
    type: 'scatter',
    data: {
      datasets: [{
        data: points,
        backgroundColor: points.map(p => p.color),
        pointRadius: 7,
        pointHoverRadius: 9
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const p = points[ctx.dataIndex];
              return `${p.name}: ${p.x} accts, ${p.y}% coverage`;
            }
          }
        }
      },
      scales: {
        x: { title: { display: true, text: 'Accounts', color: theme.muted }, ticks: { color: theme.muted, stepSize: 1 }, grid: { color: theme.border } },
        y: { title: { display: true, text: 'Coverage %', color: theme.muted }, ticks: { color: theme.muted, callback: v => v + '%' }, grid: { color: theme.border } }
      }
    }
  }));
}

function _renderMatrix(agg) {
  const wrap = document.getElementById('matrixWrap');
  if (!wrap) return;
  const regions = agg.regions;
  if (!regions.length || !agg.matrix.length) {
    wrap.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:12px">No segments or regions configured.</div>';
    return;
  }

  // Find maxes per metric for color-scaling
  let maxAcct = 0, maxAE = 0, maxSE = 0;
  agg.matrix.forEach(r => r.cells.forEach(c => {
    if (c.accounts > maxAcct) maxAcct = c.accounts;
    if (c.aes      > maxAE)   maxAE   = c.aes;
    if (c.ses      > maxSE)   maxSE   = c.ses;
  }));

  function intensity(val, max) {
    if (!max) return 0;
    return Math.min(1, val / max);
  }

  const headerCells = ['<th></th>'].concat(regions.map(r => `<th>${_esc(r)}</th>`)).join('');
  const rows = agg.matrix.map(r => {
    const cells = r.cells.map(c => {
      const a = intensity(c.accounts, maxAcct);
      const bg = `rgba(217,70,239,${(a * 0.25).toFixed(3)})`;
      return `<td style="background:${bg}">
        <div class="rpt-cell-num">${c.accounts}</div>
        <div class="rpt-cell-meta">${c.aes} ${roleLabel('ae')}s &middot; ${c.ses} ${roleLabel('se')}s</div>
      </td>`;
    }).join('');
    return `<tr><th class="rpt-row-hdr">${_esc(r.segment)}</th>${cells}</tr>`;
  }).join('');

  wrap.innerHTML = `
    <table class="rpt-matrix">
      <thead><tr>${headerCells}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div style="font-size:11px;color:var(--muted);margin-top:8px">Cell shading scales with account count.</div>
  `;
}

function _esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── PDF export ───────────────────────────────────────────────────────────────

export async function exportReportsPDF() {
  if (!(window.jspdf && window.jspdf.jsPDF)) {
    alert('PDF library is still loading. Try again in a moment.');
    return;
  }
  if (!_charts.length) {
    alert('Open Reports first so charts can render before exporting.');
    return;
  }
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'in', format: 'letter' });
  const pageW = 11, pageH = 8.5;
  const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

  // Cover
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(22);
  pdf.setTextColor(15, 10, 31);
  pdf.text('SE Coverage Report', 0.4, 0.6);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(11);
  pdf.setTextColor(107, 101, 132);
  pdf.text(`Generated ${dateStr}`, 0.4, 0.85);

  // Stat cards strip
  const agg = _aggregate();
  const cards = [
    { label: `${roleLabel('ae')} per ${roleLabel('se')}`, value: '1:' + agg.orgRatios.aePerSE.toFixed(1) },
    { label: 'Accounts per ' + roleLabel('se'),           value: agg.orgRatios.acctPerSE.toFixed(1) },
    { label: `${roleLabel('ae')} per ${roleLabel('rd')}`, value: '1:' + agg.orgRatios.aePerRD.toFixed(1) },
    { label: 'Accounts per ' + roleLabel('ae'),           value: agg.orgRatios.acctPerAE.toFixed(1) }
  ];
  if (agg.coveragePct != null) cards.push({ label: 'Coverage', value: agg.coveragePct + '%' });
  if (agg.tbhCount > 0) cards.push({ label: 'Open HC', value: String(agg.tbhCount) });

  const cw = (pageW - 0.8 - (cards.length - 1) * 0.15) / cards.length;
  cards.forEach((card, i) => {
    const x = 0.4 + i * (cw + 0.15);
    pdf.setDrawColor(217, 211, 230);
    pdf.setFillColor(240, 238, 246);
    pdf.roundedRect(x, 1.15, cw, 0.85, 0.05, 0.05, 'FD');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(18);
    pdf.setTextColor(15, 10, 31);
    pdf.text(card.value, x + cw / 2, 1.5, { align: 'center' });
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor(107, 101, 132);
    pdf.text(card.label, x + cw / 2, 1.85, { align: 'center' });
  });

  // One chart per page after the cover.
  const chartTitles = {
    chartAcctLoad:        `Account Load by ${roleLabel('se')}`,
    chartAELoad:          `${roleLabel('ae')} Load by ${roleLabel('se')}`,
    chartRegionHealth:    'Region Health Distribution',
    chartRegionRatio:     `Region ${roleLabel('ae')}:${roleLabel('se')} Ratio`,
    chartCoverageScatter: 'Coverage Outliers'
  };
  for (const c of _charts) {
    if (!c || !c.canvas) continue;
    const id = c.canvas.id;
    const title = chartTitles[id] || id;
    pdf.addPage();
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(18);
    pdf.setTextColor(15, 10, 31);
    pdf.text(title, 0.4, 0.6);

    const dataUrl = c.toBase64Image('image/png', 1.0);
    // Fit image proportionally within the page bounds (leaving header room)
    const imgX = 0.4, imgY = 0.95;
    const imgMaxW = pageW - 0.8, imgMaxH = pageH - imgY - 0.4;
    const cnv = c.canvas;
    const aspect = cnv.width / cnv.height;
    let imgW = imgMaxW, imgH = imgMaxW / aspect;
    if (imgH > imgMaxH) { imgH = imgMaxH; imgW = imgMaxH * aspect; }
    try { pdf.addImage(dataUrl, 'PNG', imgX, imgY, imgW, imgH); } catch (e) { console.warn('[reports] PDF chart embed failed', e); }
  }

  pdf.save(`SE-Coverage-Report-${new Date().toISOString().slice(0, 10)}.pdf`);
}
