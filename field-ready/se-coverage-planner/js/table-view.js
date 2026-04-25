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

    // SE name cell: separates the wrap-able name text from the auxiliary icons (note pencil,
    // proposed badge, remove button) so icons stay anchored to the right and don't wrap below the name.
    let seNameTextHtml;
    let seNameAuxHtml;
    if (se.isUnassigned) {
      seNameTextHtml = `<span class="needs-assign-badge">&#9888; UNASSIGNED</span>`;
      seNameAuxHtml = '';
    } else {
      const sePerson = getPersonByName(se.se, 'SE');
      const seNameContent = sePerson
        ? `<span class="person-link" data-person-id="${sePerson.id}" title="Click to edit ${esc(se.se)}">${esc(se.se)}</span>`
        : esc(se.se);
      const seNote = _personNoteIcon(sePerson);
      const proposedBadge = isProposed ? '<span class="proposed-badge" title="Proposed by Propose Hires wizard">\u2728 Proposed</span>' : '';
      seNameTextHtml = seNameContent;
      seNameAuxHtml = (seNote || '') + proposedBadge + removeBtnHtml;
    }

    let quotaCellHtml = '';
    if (quotaShown) {
      if (se.isTBH || se.isUnassigned) {
        quotaCellHtml = '<td class="quota-cell">\u2014</td>';
      } else {
        const q = classifyQuotaAttainment(se.quotaAttainment);
        const carriedLabel  = formatCompact(se.quotaCarried || 0);
        const hasPersonal   = se.quotaPersonal > 0;
        const personalLabel = hasPersonal ? formatCompact(se.quotaPersonal) : null;
        const desc = quotaCoverageDescription(q.tier);
        const tip = hasPersonal
          ? `Carrying ${carriedLabel} against personal target of ${personalLabel} (${q.label}).${desc ? '\n\n' + desc : ''}`
          : `No personal quota set for this SE; carrying ${carriedLabel} from accounts/AEs assigned.`;
        // Show "$13.0M / $3.0M" when a personal target exists, else just the carried number.
        const headlineHtml = hasPersonal
          ? `<span class="quota-carry">${carriedLabel}</span><span class="quota-target"> / ${personalLabel}</span>`
          : `<span class="quota-carry">${carriedLabel}</span><span class="quota-target quota-target-missing" title="No personal quota set in Manage Data \u2192 People"> / no target</span>`;
        quotaCellHtml = `<td class="quota-cell" title="${esc(tip)}">
          <div class="quota-cell-stack">
            <div class="quota-cell-line">${headlineHtml}</div>
            <span class="badge ${q.cls} quota-attain-badge">${q.label}</span>
          </div>
        </td>`;
      }
    }

    seRow.innerHTML = `
      <td><div class="se-name-cell"><span class="chevron">&#9654;</span><span class="se-name-text">${seNameTextHtml}</span>${seNameAuxHtml ? `<span class="se-name-aux">${seNameAuxHtml}</span>` : ''}</div></td>
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

    // Expand panel — grouped by AE so the relationship 'this AE owns these accounts (under this SE)' is visible.
    // Pull this SE's working-data rows; each row has { account, ae, ... }.
    const seRows = data.filter(r => r.se === se.se);
    // Group accounts by AE (preserve discovery order; UNASSIGNED bucket goes last).
    const aeOrder = [];
    const aeGroups = {};
    seRows.forEach(r => {
      const aeKey = (r.ae && !r.ae.startsWith('UNASSIGNED')) ? r.ae : '__UNASSIGNED__';
      if (!aeGroups[aeKey]) {
        aeGroups[aeKey] = { ae: aeKey, accounts: [] };
        aeOrder.push(aeKey);
      }
      // Avoid duplicate accounts (defensive)
      if (!aeGroups[aeKey].accounts.find(a => a.name === r.account)) {
        const acctRecord = ACCOUNTS.find(a => a.name === r.account);
        const annual = acctRecord ? normalizeToAnnual(acctRecord.quota || 0, acctRecord.quotaPeriod || 'annual') : 0;
        aeGroups[aeKey].accounts.push({ name: r.account, annual });
      }
    });
    // Sort accounts within each group by quota desc (when tracking is on) so big contributors surface.
    if (quotaShown) {
      aeOrder.forEach(k => aeGroups[k].accounts.sort((x, y) => y.annual - x.annual));
    }
    // Move __UNASSIGNED__ to the end
    const unIdx = aeOrder.indexOf('__UNASSIGNED__');
    if (unIdx !== -1) { aeOrder.splice(unIdx, 1); aeOrder.push('__UNASSIGNED__'); }

    function _renderAcctLine({ name: a, annual }) {
      const isChanged = changedSet.has(a);
      const cls = (isChanged ? ' changed' : '') + (se.isUnassigned ? ' unassigned-acct' : '');
      const note = _noteIcon(a);
      const quotaTag = quotaShown
        ? `<span class="acct-quota-tag" title="Annualized quota for ${esc(a)}">${annual > 0 ? formatCompact(annual) : '\u2014'}</span>`
        : '';
      if (rebalanceMode && viewMode !== 'proposed') {
        const defaultOpt = se.isUnassigned
          ? `<option value="" disabled selected>\u2014 assign to SE \u2014</option>`
          : '';
        const opts = defaultOpt + seNames.map(n =>
          `<option value="${n}"${!se.isUnassigned && n === se.se ? ' selected' : ''}>${esc(n)}</option>`
        ).join('');
        return `<div class="ae-acct-row${cls}">
          <span class="expand-name-wrap">${esc(a)}${note ? ' ' + note : ''}${quotaTag}</span>
          <select class="se-select" data-account="${esc(a)}"
            onchange="if(this.value)reassignAccount(this.dataset.account,this.value)">${opts}</select>
        </div>`;
      }
      return `<div class="ae-acct-row${cls}"><span class="expand-name-wrap">${esc(a)}${note ? ' ' + note : ''}${quotaTag}</span></div>`;
    }

    const groupsHtml = aeOrder.map(aeKey => {
      const grp = aeGroups[aeKey];
      const isUnassigned = aeKey === '__UNASSIGNED__';
      const totalAnnual = grp.accounts.reduce((s, a) => s + (a.annual || 0), 0);
      const aePerson = isUnassigned ? null : getPersonByName(aeKey, 'AE');
      const aeNoteIcon = aePerson ? _personNoteIcon(aePerson) : '';
      const aeNameHtml = isUnassigned
        ? `<span class="needs-assign-badge">&#9888; UNASSIGNED AE</span>`
        : (aePerson
            ? `<span class="ae-clickable" data-person-id="${aePerson.id}" title="Click to edit ${esc(aeKey)}">${esc(aeKey)}</span>`
            : esc(aeKey));
      const summary = `${grp.accounts.length} acct${grp.accounts.length !== 1 ? 's' : ''}${quotaShown && totalAnnual > 0 ? ' \u00b7 ' + formatCompact(totalAnnual) : ''}`;
      const acctsHtml = grp.accounts.map(_renderAcctLine).join('');
      return `<div class="ae-group${isUnassigned ? ' ae-group-unassigned' : ''}">
        <div class="ae-group-header">
          <span class="ae-group-icon">\u25c7</span>
          <span class="expand-name-wrap">${aeNameHtml}${aeNoteIcon ? ' ' + aeNoteIcon : ''}</span>
          <span class="ae-group-summary">${summary}</span>
        </div>
        <div class="ae-group-accounts">${acctsHtml}</div>
      </div>`;
    }).join('');

    // RDs footer (small line; RDs are a coverage signal not directly tied to specific accounts)
    const rdNames = [...se.rds].filter(r => r && !r.startsWith('UNASSIGNED'));
    const rdsFooter = rdNames.length
      ? `<div class="expand-rds-footer"><span class="expand-rds-label">RDs:</span> ${rdNames.map(n => esc(n)).join(', ')}</div>`
      : '';

    const expandRow = document.createElement('tr');
    expandRow.className = 'expand-row';
    expandRow.innerHTML = `<td colspan="${quotaShown ? 8 : 7}"><div class="expand-inner ae-grouped" id="exp-${i}">
      ${groupsHtml || '<div style="color:var(--muted);font-size:12px">No accounts assigned</div>'}
      ${rdsFooter}
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
