/**
 * PPT + PDF deck export.
 *
 * Layout: one summary slide + one slide per region.
 * Each region slide has the configured-region-color map image on the left and an
 * AE -> Account -> SE table on the right.
 *
 * Tech: PptxGenJS (window.PptxGenJS) for PPT, jsPDF (window.jspdf.jsPDF) for PDF.
 * Map -> PNG via html2canvas (window.html2canvas), which captures the live DOM
 * (region polygons, divIcon markers, tile imagery) all together. Theme is forced
 * to light during capture for clean rendering on white slide backgrounds.
 */

import { state } from './data.js';
import { CONFIG, roleLabel } from './config.js';

// ── Theming for export ───────────────────────────────────────────────────────

/**
 * Capture the Leaflet map as a PNG data URL. Briefly forces light theme for the
 * capture and restores the user's prior theme after.
 *
 * Returns: Promise<{ dataUrl: string, width: number, height: number } | null>
 */
async function _captureMap() {
  const mapEl = document.getElementById('map');
  if (!mapEl || !window.html2canvas) return null;

  const mapInstance = window.__planner_map || null;

  // Force-light theme for the capture so the exported image reads clean on white slides.
  const root = document.documentElement;
  const previousTheme = root.getAttribute('data-theme');
  if (previousTheme !== 'light') {
    root.setAttribute('data-theme', 'light');
    document.dispatchEvent(new CustomEvent('theme-changed', { detail: { theme: 'light' } }));
  }

  // Wait for tiles to settle (theme change triggers a tile-layer rebuild).
  if (mapInstance) await _waitTilesLoaded(mapInstance, 4500);

  // Small extra delay so any final paint flushes.
  await new Promise(r => setTimeout(r, 200));

  // Read each pane's live computed transform here — we'll re-apply them on the html2canvas
  // clone so the panes render at the same absolute screen positions as the source map.
  const liveTransforms = _readLeafletPaneTransforms(mapEl);

  let dataUrl = null, width = 0, height = 0;
  try {
    const canvas = await html2canvas(mapEl, {
      x: 0, y: 0,
      width:  mapEl.clientWidth,
      height: mapEl.clientHeight,
      useCORS:    true,
      allowTaint: false,
      backgroundColor: '#FFFFFF',
      scale:      2,
      logging:    false,
      ignoreElements: el => {
        if (!el || !el.classList) return false;
        return el.classList.contains('leaflet-control-attribution')
            || el.classList.contains('layer-bar')
            || el.classList.contains('toolbar');
      },
      // After html2canvas has cloned the DOM into a hidden iframe, force-replace each
      // Leaflet pane transform with the matrix value we read from the live DOM. This
      // prevents html2canvas's CSS-parsing from miscalculating compound transforms.
      onclone: (clonedDoc) => {
        const clonedMap = clonedDoc.getElementById('map');
        if (!clonedMap) return;
        liveTransforms.forEach(({ selector, transform }) => {
          const el = clonedMap.querySelector(selector);
          if (el) {
            el.style.transform = transform;
            el.style.willChange = 'auto';
          }
        });
      }
    });
    dataUrl = canvas.toDataURL('image/png');
    width   = canvas.width;
    height  = canvas.height;
  } catch (e) {
    console.warn('[export-deck] html2canvas capture failed:', e);
  }

  // Restore previous theme
  if (previousTheme !== 'light') {
    if (previousTheme) root.setAttribute('data-theme', previousTheme);
    else root.removeAttribute('data-theme');
    document.dispatchEvent(new CustomEvent('theme-changed', { detail: { theme: previousTheme || 'dark' } }));
  }

  if (!dataUrl) return null;
  return { dataUrl, width, height };
}

/**
 * Read the live computed transform of every Leaflet pane element inside the given map
 * container. Returns an array of { selector, transform } that html2canvas can re-apply
 * to its DOM clone via onclone, so the cloned panes inherit the exact transform matrix
 * the real map uses (avoiding any CSS recalculation that drifts from the source).
 */
function _readLeafletPaneTransforms(mapEl) {
  const out = [];
  const ids = ['.leaflet-map-pane', '.leaflet-tile-pane', '.leaflet-overlay-pane',
               '.leaflet-shadow-pane', '.leaflet-marker-pane', '.leaflet-tooltip-pane',
               '.leaflet-popup-pane'];
  ids.forEach(sel => {
    const el = mapEl.querySelector(sel);
    if (!el) return;
    const t = getComputedStyle(el).transform;
    if (t && t !== 'none') out.push({ selector: sel, transform: t });
  });
  // Each tile container also has its own transform (the per-zoom-level container).
  const tileContainers = mapEl.querySelectorAll('.leaflet-tile-container');
  tileContainers.forEach((el, i) => {
    const t = getComputedStyle(el).transform;
    if (t && t !== 'none') {
      // Stable selector by index within tile-pane
      out.push({ selector: `.leaflet-tile-pane .leaflet-tile-container:nth-child(${i + 1})`, transform: t });
    }
  });
  return out;
}

function _waitTilesLoaded(map, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    // If map already has no pending tile loads, finish soon.
    setTimeout(finish, timeoutMs);
    try {
      map.whenReady(() => {
        // Listen once for next idle
        let idle;
        const onLoad = () => {
          clearTimeout(idle);
          idle = setTimeout(finish, 400); // 400ms quiescence
        };
        map.eachLayer(l => {
          if (l && l.on) {
            l.on('load', onLoad);
            l.on('tileload', onLoad);
          }
        });
        idle = setTimeout(finish, 600);
      });
    } catch { finish(); }
  });
}

// ── Data shaping for the slide content ───────────────────────────────────────

function _aggregateForExport(data) {
  const regions = (CONFIG.regions || []).map(r => ({ name: r.name, color: r.color || '#6b6584' }));

  // Per region: rows of { ae, account, se, segment }
  const byRegion = {};
  regions.forEach(r => { byRegion[r.name] = []; });

  data.forEach(row => {
    if (!row.ae_region || !byRegion[row.ae_region]) return;
    byRegion[row.ae_region].push({
      ae:       row.ae      || '',
      account:  row.account || '',
      se:       row.se      || '',
      segment:  row.segment || ''
    });
  });

  // Per region: counts + leadership chain summary
  const summary = regions.map(r => {
    const rows = byRegion[r.name] || [];
    const seSet = new Set();
    const aeSet = new Set();
    rows.forEach(x => {
      if (x.se && !x.se.startsWith('TBH') && x.se !== 'UNASSIGNED') seSet.add(x.se);
      if (x.ae) aeSet.add(x.ae);
    });
    return {
      name: r.name,
      color: r.color,
      seCount: seSet.size,
      aeCount: aeSet.size,
      acctCount: rows.length,
      ratio: seSet.size ? (aeSet.size / seSet.size).toFixed(1) : '\u2014'
    };
  });

  // Sort regions by AE count desc so biggest-first in summary lists
  summary.sort((a, b) => b.aeCount - a.aeCount);

  // Sort each region's rows by AE then account
  Object.keys(byRegion).forEach(r => {
    byRegion[r].sort((a, b) => (a.ae || '').localeCompare(b.ae || '') || (a.account || '').localeCompare(b.account || ''));
  });

  // Org-wide totals
  const allSE = new Set();
  const allAE = new Set();
  data.forEach(r => {
    if (r.se && !r.se.startsWith('TBH') && r.se !== 'UNASSIGNED') allSE.add(r.se);
    if (r.ae) allAE.add(r.ae);
  });

  return {
    regions, summary, byRegion,
    totals: {
      seCount:   allSE.size,
      aeCount:   allAE.size,
      acctCount: data.length,
      ratio:     allSE.size ? (allAE.size / allSE.size).toFixed(1) : '\u2014'
    }
  };
}

function _hexToRgb(hex) {
  const h = (hex || '').replace('#', '').trim();
  if (h.length !== 6) return { r: 100, g: 100, b: 100 };
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16)
  };
}
function _luminance(hex) {
  const { r, g, b } = _hexToRgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}
function _contrastText(hex) { return _luminance(hex) > 0.55 ? '1F1733' : 'FFFFFF'; }
/** Normalize a color to a 6-char uppercase hex string with no leading #. */
function _stripHash(hex) {
  let s = String(hex || '').replace('#', '').trim().toUpperCase();
  // Expand 3-char shorthand if encountered
  if (/^[0-9A-F]{3}$/.test(s)) s = s.split('').map(c => c + c).join('');
  if (!/^[0-9A-F]{6}$/.test(s)) return '6B6584'; // safe default if anything weird
  return s;
}

// ── PPT generator ────────────────────────────────────────────────────────────

async function _buildPPT() {
  if (typeof PptxGenJS === 'undefined') {
    alert('PowerPoint export library is still loading. Try again in a moment.');
    return;
  }
  const data = (state.viewMode === 'proposed' && state.scenarioB) ? state.scenarioB : state.workingData;
  const agg = _aggregateForExport(data);

  const map = await _captureMap();
  // map may be null in degenerate setups; we'll lay out without it in that case.

  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'WIDE_16x9', width: 13.333, height: 7.5 });
  pptx.layout = 'WIDE_16x9';
  pptx.title = 'SE Coverage Map';

  const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  const scenarioStr = (state.viewMode === 'proposed' && state.scenarioB) ? 'Proposed Scenario' : 'Current Coverage';

  // ---- SUMMARY SLIDE ----
  const s1 = pptx.addSlide();
  s1.background = { color: 'FFFFFF' };

  // Title
  s1.addText('SE Coverage Map', {
    x: 0.4, y: 0.25, w: 10, h: 0.5,
    fontSize: 24, bold: true, color: '0F0A1F', fontFace: 'Inter'
  });
  s1.addText(`${scenarioStr}  \u00b7  ${dateStr}`, {
    x: 0.4, y: 0.78, w: 10, h: 0.3,
    fontSize: 12, color: '6B6584', fontFace: 'Inter'
  });

  // Org totals strip
  const totals = agg.totals;
  const totalCards = [
    { label: roleLabel('se') + 's',       value: totals.seCount },
    { label: roleLabel('ae') + 's',       value: totals.aeCount },
    { label: 'Accounts',                  value: totals.acctCount },
    { label: 'Avg ' + roleLabel('ae') + ':' + roleLabel('se'), value: '1:' + totals.ratio }
  ];
  totalCards.forEach((card, i) => {
    const x = 0.4 + i * 1.55;
    s1.addShape(pptx.ShapeType.rect, {
      x, y: 1.2, w: 1.4, h: 0.85,
      fill: { color: 'F0EEF6' },
      line: { color: 'D9D3E6', width: 0.5 }
    });
    s1.addText(String(card.value), {
      x, y: 1.22, w: 1.4, h: 0.45,
      fontSize: 22, bold: true, color: '0F0A1F', align: 'center', valign: 'middle', fontFace: 'Inter'
    });
    s1.addText(card.label, {
      x, y: 1.62, w: 1.4, h: 0.35,
      fontSize: 9, color: '6B6584', align: 'center', valign: 'middle', fontFace: 'Inter'
    });
  });

  // Map image (left half, large)
  if (map && map.dataUrl) {
    const mapAspect = map.width / map.height;
    const mapTargetW = 7.5;
    const mapTargetH = mapTargetW / mapAspect;
    const mapY = 2.3;
    s1.addImage({
      data: map.dataUrl,
      x: 0.4, y: mapY,
      w: mapTargetW,
      h: Math.min(mapTargetH, 4.7)
    });
  }

  // Region summary block (right side)
  const rsX = 8.2;
  const rsY = 2.3;
  const rsW = 4.7;
  s1.addText('Region Summary', {
    x: rsX, y: rsY - 0.05, w: rsW, h: 0.35,
    fontSize: 11, bold: true, color: '6B6584', fontFace: 'Inter'
  });

  let yy = rsY + 0.4;
  agg.summary.forEach(r => {
    const fillRgb = _stripHash(r.color);
    const textRgb = _contrastText(r.color);
    // Color band on the left
    s1.addShape(pptx.ShapeType.rect, {
      x: rsX, y: yy, w: 0.18, h: 0.6,
      fill: { color: fillRgb },
      line: { color: fillRgb, width: 0 }
    });
    // Card body
    s1.addShape(pptx.ShapeType.rect, {
      x: rsX + 0.18, y: yy, w: rsW - 0.18, h: 0.6,
      fill: { color: 'FFFFFF' },
      line: { color: 'D9D3E6', width: 0.5 }
    });
    s1.addText(r.name, {
      x: rsX + 0.3, y: yy + 0.02, w: rsW - 0.4, h: 0.28,
      fontSize: 12, bold: true, color: '0F0A1F', fontFace: 'Inter'
    });
    s1.addText(`${r.seCount} ${roleLabel('se')}  \u00b7  ${r.aeCount} ${roleLabel('ae')}  \u00b7  ${r.acctCount} accts  \u00b7  1:${r.ratio}`, {
      x: rsX + 0.3, y: yy + 0.3, w: rsW - 0.4, h: 0.28,
      fontSize: 10, color: '6B6584', fontFace: 'Inter'
    });
    yy += 0.7;
  });

  // Footer
  s1.addText('Generated by SE Coverage Planner \u00b7 jasonlanders.com', {
    x: 0.4, y: 7.15, w: 12.5, h: 0.25,
    fontSize: 9, color: '8A839E', italic: true, fontFace: 'Inter'
  });

  // ---- PER-REGION SLIDES ----
  agg.summary.forEach(r => {
    const slide = pptx.addSlide();
    slide.background = { color: 'FFFFFF' };

    // Region color band across the top
    const fillRgb = _stripHash(r.color);
    const textRgb = _contrastText(r.color);
    slide.addShape(pptx.ShapeType.rect, {
      x: 0, y: 0, w: 13.333, h: 0.7,
      fill: { color: fillRgb },
      line: { color: fillRgb, width: 0 }
    });
    slide.addText(r.name, {
      x: 0.4, y: 0.1, w: 6, h: 0.5,
      fontSize: 22, bold: true, color: textRgb, fontFace: 'Inter'
    });
    slide.addText(`${r.seCount} ${roleLabel('se')}  \u00b7  ${r.aeCount} ${roleLabel('ae')}  \u00b7  ${r.acctCount} accts  \u00b7  Avg ratio 1:${r.ratio}`, {
      x: 6.5, y: 0.18, w: 6.7, h: 0.4,
      fontSize: 12, color: textRgb, align: 'right', valign: 'middle', fontFace: 'Inter'
    });

    // Map on the left
    if (map && map.dataUrl) {
      const mapAspect = map.width / map.height;
      const mapW = 6.0;
      const mapH = Math.min(mapW / mapAspect, 6.0);
      slide.addImage({ data: map.dataUrl, x: 0.4, y: 1.0, w: mapW, h: mapH });
    }

    // AE -> Account -> SE table on the right
    const tblX = 6.7;
    const tblY = 1.0;
    const tblW = 6.3;
    const tblH = 6.0;
    const rows = agg.byRegion[r.name] || [];

    const tableHeader = [
      { text: roleLabel('ae'),   options: { bold: true, color: 'FFFFFF', fill: { color: '1F1733' }, fontFace: 'Inter', fontSize: 10, align: 'left' } },
      { text: 'Account',         options: { bold: true, color: 'FFFFFF', fill: { color: '1F1733' }, fontFace: 'Inter', fontSize: 10, align: 'left' } },
      { text: roleLabel('se'),   options: { bold: true, color: 'FFFFFF', fill: { color: '1F1733' }, fontFace: 'Inter', fontSize: 10, align: 'left' } }
    ];
    const tableRows = rows.map(x => [
      { text: x.ae      || '\u2014', options: { fontFace: 'Inter', fontSize: 9, color: '1F1733', align: 'left' } },
      { text: x.account || '\u2014', options: { fontFace: 'Inter', fontSize: 9, color: '1F1733', align: 'left' } },
      { text: x.se      || '\u2014', options: { fontFace: 'Inter', fontSize: 9, color: '1F1733', align: 'left' } }
    ]);
    if (!tableRows.length) {
      tableRows.push([
        { text: 'No accounts in this region', options: { fontFace: 'Inter', fontSize: 10, color: '8A839E', italic: true } },
        { text: '', options: { fontFace: 'Inter', fontSize: 10, color: '8A839E' } },
        { text: '', options: { fontFace: 'Inter', fontSize: 10, color: '8A839E' } }
      ]);
    }

    slide.addTable([tableHeader, ...tableRows], {
      x: tblX, y: tblY, w: tblW, h: tblH,
      colW: [1.9, 2.5, 1.9],
      border: { type: 'solid', color: 'E5E2EC', pt: 0.5 }
    });

    // Footer
    slide.addText('Generated by SE Coverage Planner \u00b7 jasonlanders.com', {
      x: 0.4, y: 7.15, w: 12.5, h: 0.25,
      fontSize: 9, color: '8A839E', italic: true, fontFace: 'Inter'
    });
  });

  const filename = `SE-Coverage-${new Date().toISOString().slice(0, 10)}.pptx`;
  await pptx.writeFile({ fileName: filename });
}

// ── PDF generator ────────────────────────────────────────────────────────────

async function _buildPDF() {
  if (!(window.jspdf && window.jspdf.jsPDF)) {
    alert('PDF export library is still loading. Try again in a moment.');
    return;
  }
  const data = (state.viewMode === 'proposed' && state.scenarioB) ? state.scenarioB : state.workingData;
  const agg = _aggregateForExport(data);

  const map = await _captureMap();

  // Landscape, letter
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'in', format: 'letter' });
  const pageW = 11;
  const pageH = 8.5;

  const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  const scenarioStr = (state.viewMode === 'proposed' && state.scenarioB) ? 'Proposed Scenario' : 'Current Coverage';

  // --- SUMMARY PAGE ---
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(20);
  pdf.setTextColor(15, 10, 31);
  pdf.text('SE Coverage Map', 0.4, 0.55);

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(11);
  pdf.setTextColor(107, 101, 132);
  pdf.text(`${scenarioStr}  \u00b7  ${dateStr}`, 0.4, 0.85);

  // Totals strip
  const totals = agg.totals;
  const totalCards = [
    { label: roleLabel('se') + 's',       value: String(totals.seCount) },
    { label: roleLabel('ae') + 's',       value: String(totals.aeCount) },
    { label: 'Accounts',                  value: String(totals.acctCount) },
    { label: 'Avg ' + roleLabel('ae') + ':' + roleLabel('se'), value: '1:' + totals.ratio }
  ];
  totalCards.forEach((card, i) => {
    const x = 0.4 + i * 1.5;
    pdf.setDrawColor(217, 211, 230);
    pdf.setFillColor(240, 238, 246);
    pdf.roundedRect(x, 1.1, 1.35, 0.75, 0.05, 0.05, 'FD');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(16);
    pdf.setTextColor(15, 10, 31);
    pdf.text(card.value, x + 1.35 / 2, 1.45, { align: 'center' });
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(107, 101, 132);
    pdf.text(card.label, x + 1.35 / 2, 1.72, { align: 'center' });
  });

  // Map image on the left
  if (map && map.dataUrl) {
    const mapAspect = map.width / map.height;
    const mapW = 6.0;
    const mapH = Math.min(mapW / mapAspect, 5.5);
    try {
      pdf.addImage(map.dataUrl, 'PNG', 0.4, 2.1, mapW, mapH);
    } catch (e) { /* skip image on failure */ }
  }

  // Region summary on the right
  let ry = 2.1;
  const rx = 6.7;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(10);
  pdf.setTextColor(107, 101, 132);
  pdf.text('REGION SUMMARY', rx, ry);
  ry += 0.25;

  agg.summary.forEach(r => {
    const { r: cr, g: cg, b: cb } = _hexToRgb(r.color);
    pdf.setFillColor(cr, cg, cb);
    pdf.rect(rx, ry, 0.18, 0.55, 'F');
    pdf.setDrawColor(217, 211, 230);
    pdf.setFillColor(255, 255, 255);
    pdf.rect(rx + 0.18, ry, 4.0 - 0.18, 0.55, 'FD');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(11);
    pdf.setTextColor(15, 10, 31);
    pdf.text(r.name, rx + 0.32, ry + 0.22);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor(107, 101, 132);
    pdf.text(`${r.seCount} ${roleLabel('se')}  \u00b7  ${r.aeCount} ${roleLabel('ae')}  \u00b7  ${r.acctCount} accts  \u00b7  1:${r.ratio}`, rx + 0.32, ry + 0.42);
    ry += 0.65;
  });

  pdf.setFont('helvetica', 'italic');
  pdf.setFontSize(8);
  pdf.setTextColor(138, 131, 158);
  pdf.text('Generated by SE Coverage Planner \u00b7 jasonlanders.com', 0.4, pageH - 0.25);

  // --- PER-REGION PAGES ---
  agg.summary.forEach(r => {
    pdf.addPage();

    // Top color band
    const { r: cr, g: cg, b: cb } = _hexToRgb(r.color);
    pdf.setFillColor(cr, cg, cb);
    pdf.rect(0, 0, pageW, 0.6, 'F');

    const textColor = _luminance(r.color) > 0.55 ? [31, 23, 51] : [255, 255, 255];
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(18);
    pdf.setTextColor(textColor[0], textColor[1], textColor[2]);
    pdf.text(r.name, 0.4, 0.4);

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(11);
    pdf.text(
      `${r.seCount} ${roleLabel('se')}  \u00b7  ${r.aeCount} ${roleLabel('ae')}  \u00b7  ${r.acctCount} accts  \u00b7  Avg 1:${r.ratio}`,
      pageW - 0.4, 0.4, { align: 'right' }
    );

    // Map on the left
    if (map && map.dataUrl) {
      const mapAspect = map.width / map.height;
      const mapW = 5.0;
      const mapH = Math.min(mapW / mapAspect, 5.5);
      try { pdf.addImage(map.dataUrl, 'PNG', 0.4, 0.85, mapW, mapH); } catch {}
    }

    // Table on the right (manual layout because jsPDF table autoPage isn't built in here)
    const tx = 5.6;
    const tw = pageW - tx - 0.4;
    let ty = 0.85;

    // Header
    pdf.setFillColor(31, 23, 51);
    pdf.rect(tx, ty, tw, 0.35, 'F');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9);
    pdf.setTextColor(255, 255, 255);
    pdf.text(roleLabel('ae'),   tx + 0.1,         ty + 0.22);
    pdf.text('Account',         tx + tw * 0.38,   ty + 0.22);
    pdf.text(roleLabel('se'),   tx + tw * 0.72,   ty + 0.22);
    ty += 0.35;

    // Rows
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(31, 23, 51);
    const rows = agg.byRegion[r.name] || [];
    if (!rows.length) {
      pdf.setTextColor(138, 131, 158);
      pdf.setFont('helvetica', 'italic');
      pdf.text('No accounts in this region', tx + 0.1, ty + 0.22);
    } else {
      rows.forEach((x, idx) => {
        if (ty > pageH - 0.5) { return; } // truncate; very long region tables would need pagination
        if (idx % 2 === 1) {
          pdf.setFillColor(244, 242, 248);
          pdf.rect(tx, ty, tw, 0.27, 'F');
        }
        pdf.setTextColor(31, 23, 51);
        pdf.text(_truncate(x.ae      || '\u2014', 24), tx + 0.1,         ty + 0.18);
        pdf.text(_truncate(x.account || '\u2014', 28), tx + tw * 0.38,   ty + 0.18);
        pdf.text(_truncate(x.se      || '\u2014', 22), tx + tw * 0.72,   ty + 0.18);
        ty += 0.27;
      });
    }

    // Footer
    pdf.setFont('helvetica', 'italic');
    pdf.setFontSize(8);
    pdf.setTextColor(138, 131, 158);
    pdf.text('Generated by SE Coverage Planner \u00b7 jasonlanders.com', 0.4, pageH - 0.25);
  });

  const filename = `SE-Coverage-${new Date().toISOString().slice(0, 10)}.pdf`;
  pdf.save(filename);
}

function _truncate(s, max) {
  s = String(s);
  return s.length <= max ? s : s.slice(0, max - 1) + '\u2026';
}

// ── Public entry points ──────────────────────────────────────────────────────

export async function exportPPT() {
  try {
    await _buildPPT();
  } catch (e) {
    console.error('[export-deck] PPT failed', e);
    alert('PowerPoint export failed: ' + (e && e.message ? e.message : e));
  }
}

export async function exportPDF() {
  try {
    await _buildPDF();
  } catch (e) {
    console.error('[export-deck] PDF failed', e);
    alert('PDF export failed: ' + (e && e.message ? e.message : e));
  }
}
