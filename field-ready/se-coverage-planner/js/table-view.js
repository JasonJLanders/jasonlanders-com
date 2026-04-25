import { workload, classifyQuotaAttainment, quotaCoverageDescription } from './stats.js';
import { formatCompact, normalizeToAnnual } from './quotas.js';
import { ACCOUNTS } from './accounts.js';
import { getPersonByName } from './roster.js';
import { getAccountByName } from './accounts.js';

/** Returns an HTML note-indicator button for an account, or '' if no notes. */
function _noteIcon(accountName) {
  const acct = getAccountByName(accountName);
  const notes = acct?.notes || '';
  if (!notes) return '';
  const preview = notes.length > 80 ? notes.slice(0, 77) + '…' : notes;
  return `<button type="button" class="note-icon" title="${esc(preview)} — click to open"
    onclick="event.stopPropagation();openNotesModal('${esc(accountName).replace(/'/g, "\\'")}')">&#x1F4DD;</button>`;
}

/** Returns an HTML note-indicator button for a person (by id), or '' if no notes. */
function _personNoteIcon(person) {
  if (!person) return '';
  const notes = person.notes || '';
  if (!notes) return '';
  const preview = notes.length > 80 ? notes.slice(0, 77) + '…' : notes;
  return `<button type="button" class="note-icon" title="${esc(preview)} — click to open"
    onclick="event.stopPropagation();openPersonNotesModal('${person.id}')">&#x1F4DD;</button>`;
}

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

export function renderDiffBanner(viewMode, scenarioB, getDiff, narrative) {
  const diffBanner = document.getElementById('diffBanner');
  if (viewMode === 'proposed' && scenarioB) {
    const diffs = getDiff();
    const narrativeHtml = narrative
      ? `<div class="diff-narrative"><span class="diff-narrative-icon">\u2728</span> ${esc(narrative)}</div>`
      : '';
    if (diffs.length) {
      diffBanner.style.display = 'block';
      diffBanner.innerHTML = `<div class="diff-banner">
        ${narrativeHtml}
        <div class="diff-banner-title">Scenario Changes vs Current</div>
        <div class="diff-list">${diffs.map(d => `<div class="diff-item">
          <strong>${esc(d.se)}</strong>
          ${d.gained.length ? `<span class="diff-gained">+${d.gained.length}</span>` : ''}
          ${d.lost.length   ? `<span class="diff-lost">&#8722;${d.lost.length}</span>` : ''}
        </div>`).join('')}</div>
      </div>`;
    } else {
      diffBanner.innerHTML = `<div class="diff-banner">${narrativeHtml}<div class="diff-banner-title">No changes vs Current</div></div>`;
      diffBanner.style.display = 'block';
    }
  } else {
    diffBanner.style.display = 'none';
  }
}

export function renderSETable(seList, data, seNames, rebalanceMode, viewMode, changedSet, proposedSet) {
  const tbody = document.getElementById('seTableBody');
  tbody.innerHTML = '';
  const proposed = proposedSet || new Set();
  // Detect whether quota tracking is on (any SE in the list has it). All entries share the flag.
  const quotaShown = !!(seList.length && seList[0].quotaTrackingOn);
  const quotaHeader = document.getElementById('seTableQuotaHeader');
  if (quotaHeader) quotaHeader.style.display = quotaShown ? '' : 'none';

  seList.forEach((se, i) => {
    const wl = workload(se);
    const isProposed = proposed.has(se.se);
    const seRow = document.createElement('tr');
    seRow.className = 'se-row'
      + (se.isTBH ? ' tbh' : '')
      + (se.isUnassigned ? ' unassigned' : '')
      + (isProposed ? ' proposed-hire' : '');
    seRow.dataset.sename = se.se;

    const canRemove = rebalanceMode && !se.isTBH && !se.isUnassigned && viewMode !== 'proposed';
    const removeBtnHtml = canRemove
      ? `<button class="remove-se-btn" onclick="event.stopPropagation();removeSE(this.dataset.sename)" data-sename="${esc(se.se)}">&#x2715;</button>`
      : '';

    // SE name cell: clickable to edit if the person exists in PEOPLE
    let seNameCell;
    if (se.isUnassigned) {
      seNameCell = `<span class="needs-assign-badge">&#9888; UNASSIGNED</span>`;
    } else {
      const sePerson = getPersonByName(se.se, 'SE');
      const seNameContent = sePerson
        ? `<span class="person-link" data-person-id="${sePerson.id}" title="Click to edit ${esc(se.se)}">${esc(se.se)}</span>`
        : esc(se.se);
      const seNote = _personNoteIcon(sePerson);
      const proposedBadge = isProposed ? '<span class="proposed-badge" title="Proposed by Propose Hires wizard">\u2728 Proposed</span>' : '';
      seNameCell = seNameContent + (seNote ? ' ' + seNote : '') + proposedBadge + removeBtnHtml;
    }

    let quotaCellHtml = '';
    if (quotaShown) {
      if (se.isTBH || se.isUnassigned) {
        quotaCellHtml = '<td class="quota-cell">\u2014</td>';
      } else {
        const q = classifyQuotaAttainment(se.quotaAttainment);
        const carriedLabel  = formatCompact(se.quotaCarried || 0);
        const personalLabel = se.quotaPersonal > 0 ? formatCompact(se.quotaPersonal) : '\u2014';
        const desc = quotaCoverageDescription(q.tier);
        const tip = se.quotaPersonal > 0
          ? `Carrying ${carriedLabel} against personal target of ${personalLabel} (${q.label}).${desc ? '\n\n' + desc : ''}`
          : `No personal quota set for this SE; carrying ${carriedLabel} from accounts/AEs assigned.`;
        quotaCellHtml = `<td class="quota-cell" title="${esc(tip)}">
          <div class="quota-cell-stack">
            <span class="quota-carry">${carriedLabel}</span>
            <span class="badge ${q.cls} quota-attain-badge">${q.label}</span>
          </div>
        </td>`;
      }
    }

    seRow.innerHTML = `
      <td><span class="chevron">&#9654;</span>${seNameCell}</td>
      <td>${se.isUnassigned ? '\u2014' : esc(se.se_leader)}</td>
      <td>${se.isUnassigned ? '\u2014' : esc(se.segment)}</td>
      <td>${se.accountCount}</td><td>${se.aeCount}</td><td>${se.rdCount}</td>
      ${quotaCellHtml}
      <td><span class="badge ${wl.cls}" title="${wl.reasons && wl.reasons.length ? esc(wl.reasons.join('\n')) : ''}">${wl.label}</span></td>`;

    seRow.onclick = e => {
      // Don't toggle row when clicking a person-link (handled separately)
      if (e.target.closest('.person-link') || e.target.closest('.remove-se-btn')) return;
      seRow.classList.toggle('open');
      document.getElementById('exp-' + i).classList.toggle('open');
    };
    tbody.appendChild(seRow);

    // Expand panel — accounts with optional reassignment dropdowns and (when tracking is on) per-account quota.
    const acctEntries = [...se.accounts.keys()].map(name => {
      const acctRecord = ACCOUNTS.find(a => a.name === name);
      const annual = acctRecord ? normalizeToAnnual(acctRecord.quota || 0, acctRecord.quotaPeriod || 'annual') : 0;
      return { name, annual };
    });
    // Sort biggest-quota first when tracking is on so expensive accounts surface to the top.
    if (quotaShown) acctEntries.sort((x, y) => y.annual - x.annual);

    const acctHtml = acctEntries.map(({ name: a, annual }) => {
      const isChanged = changedSet.has(a);
      const cls = (isChanged ? ' changed' : '') + (se.isUnassigned ? ' unassigned-acct' : '');
      const note = _noteIcon(a);
      const quotaTag = quotaShown
        ? `<span class="acct-quota-tag" title="Annualized quota for ${esc(a)}">${annual > 0 ? formatCompact(annual) : '\u2014'}</span>`
        : '';
      if (rebalanceMode && viewMode !== 'proposed') {
        const defaultOpt = se.isUnassigned
          ? `<option value="" disabled selected>— assign to SE —</option>`
          : '';
        const opts = defaultOpt + seNames.map(n =>
          `<option value="${n}"${!se.isUnassigned && n === se.se ? ' selected' : ''}>${esc(n)}</option>`
        ).join('');
        return `<div class="expand-item${cls}">
          <span>${esc(a)}${note ? ' ' + note : ''}${quotaTag}</span>
          <span style="display:flex;align-items:center;gap:6px">
            <select class="se-select" data-account="${esc(a)}"
              onchange="if(this.value)reassignAccount(this.dataset.account,this.value)">${opts}</select>
          </span>
        </div>`;
      }
      return `<div class="expand-item${cls}"><span>${esc(a)}${note ? ' ' + note : ''}${quotaTag}</span></div>`;
    }).join('');

    // AE list — clickable if person exists in PEOPLE; orphan values shown in red
    const aeHtml = [...se.aes].map(a => {
      if (a.startsWith('UNASSIGNED')) {
        return `<div class="expand-item unassigned-acct"><span class="needs-assign-badge">&#9888; ${esc(a)}</span></div>`;
      }
      const aePerson = getPersonByName(a, 'AE');
      const note = _personNoteIcon(aePerson);
      if (aePerson) {
        return `<div class="expand-item"><span class="ae-clickable" data-person-id="${aePerson.id}" title="Click to edit ${esc(a)}">${esc(a)}</span>${note ? ' ' + note : ''}</div>`;
      }
      return `<div class="expand-item">${esc(a)}</div>`;
    }).join('');

    const expandRow = document.createElement('tr');
    expandRow.className = 'expand-row';
    expandRow.innerHTML = `<td colspan="${quotaShown ? 8 : 7}"><div class="expand-inner" id="exp-${i}">
      <div><div class="expand-col-title">Accounts</div>${acctHtml || '<div style="color:var(--muted);font-size:12px">No accounts assigned</div>'}</div>
      <div><div class="expand-col-title">AEs</div>${aeHtml || '<div style="color:var(--muted);font-size:12px">—</div>'}</div>
    </div></td>`;
    tbody.appendChild(expandRow);
  });

  // Delegate clicks for person-link (SE name) and ae-clickable (AE name in expand panel)
  tbody.addEventListener('click', e => {
    const link = e.target.closest('.person-link, .ae-clickable');
    if (!link) return;
    e.stopPropagation();
    const personId = link.dataset.personId;
    if (personId) {
      document.dispatchEvent(new CustomEvent('edit-person', { detail: { personId } }));
    }
  });
}
