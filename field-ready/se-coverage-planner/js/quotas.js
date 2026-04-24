import { CONFIG } from './config.js';
import { ACCOUNTS } from './accounts.js';
import { PEOPLE } from './roster.js';

// ── Period conversions ────────────────────────────────────────────────────────

/** Convert a {value, period} pair to its annual equivalent. */
export function normalizeToAnnual(quota, period) {
  quota = Number(quota) || 0;
  if (period === 'monthly')   return quota * 12;
  if (period === 'quarterly') return quota * 4;
  return quota; // 'annual' or unknown
}

/** Convert an annual number to the target display period. */
export function convertFromAnnual(annual, period) {
  annual = Number(annual) || 0;
  if (period === 'monthly')   return annual / 12;
  if (period === 'quarterly') return annual / 4;
  return annual;
}

// ── Formatting ────────────────────────────────────────────────────────────────

/** Format a number as USD compact: $2.1M / $500K / $24 */
export function formatCompact(n) {
  n = Number(n) || 0;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

/**
 * Format a quota (stored in its native period) for display.
 * Uses CONFIG.quotas.displayPeriod for the output unit.
 * Adds a gray annotation of the annualized value when the native period
 * differs from the display period.
 */
export function formatQuotaDisplay(quota, nativePeriod) {
  const annual      = normalizeToAnnual(quota, nativePeriod);
  const displayPer  = CONFIG.quotas?.displayPeriod || 'annual';
  const displayVal  = convertFromAnnual(annual, displayPer);

  let label = formatCompact(displayVal);
  if (displayPer === 'monthly')   label += '/mo';
  if (displayPer === 'quarterly') label += '/qtr';

  // Show annotation when native-period value differs from display-period value
  if (nativePeriod !== displayPer && nativePeriod !== 'annual') {
    const annLabel = formatCompact(annual);
    return `${label} <span class="quota-ann">(${annLabel} annual)</span>`;
  }
  return label;
}

// ── Rollup math ───────────────────────────────────────────────────────────────

/**
 * Effective AE quota (annual).
 * If account-level tracking is on → sum normalized quotas of all that AE's active accounts.
 * Otherwise → return the AE's own stored quota, normalized to annual.
 */
export function computeAEQuota(aeName, workingData) {
  const levels = CONFIG.quotas?.levels || {};
  if (levels.account) {
    return ACCOUNTS
      .filter(a => a.active !== false && a.ae === aeName)
      .reduce((sum, a) => sum + normalizeToAnnual(a.quota || 0, a.quotaPeriod || 'annual'), 0);
  }
  const p = PEOPLE.find(p => p.name === aeName && p.role === 'AE');
  return p ? normalizeToAnnual(p.quota || 0, p.quotaPeriod || 'annual') : 0;
}

/**
 * Effective SE quota (annual).
 * Account level on → sum SE's active account quotas × (1 − buffer).
 * AE level on      → sum SE's AE quotas × (1 − buffer).
 * Otherwise        → SE's own stored quota.
 */
export function computeSEQuota(seName, workingData) {
  const levels = CONFIG.quotas?.levels || {};
  const buffer = 1 - (CONFIG.quotas?.buffer ?? 0.20);

  if (levels.account) {
    const total = ACCOUNTS
      .filter(a => a.active !== false && a.se === seName)
      .reduce((sum, a) => sum + normalizeToAnnual(a.quota || 0, a.quotaPeriod || 'annual'), 0);
    return total * buffer;
  }

  if (levels.ae) {
    const data = workingData || [];
    const aeNames = [...new Set(data.filter(r => r.se === seName).map(r => r.ae).filter(Boolean))];
    const total = aeNames.reduce((sum, ae) => sum + computeAEQuota(ae, workingData), 0);
    return total * buffer;
  }

  const p = PEOPLE.find(p => p.name === seName && p.role === 'SE');
  return p ? normalizeToAnnual(p.quota || 0, p.quotaPeriod || 'annual') : 0;
}

/**
 * Org-wide quota total (annual) at a chosen rollup layer.
 * mode: 'account' | 'ae' | 'se'
 */
export function computeOrgQuota(workingData, mode = 'ae') {
  const data = workingData || [];
  if (mode === 'account') {
    return ACCOUNTS
      .filter(a => a.active !== false)
      .reduce((sum, a) => sum + normalizeToAnnual(a.quota || 0, a.quotaPeriod || 'annual'), 0);
  }
  if (mode === 'se') {
    const seNames = [...new Set(
      data.filter(r => r.se && !r.se.startsWith('TBH') && r.se !== 'UNASSIGNED').map(r => r.se)
    )];
    return seNames.reduce((sum, se) => sum + computeSEQuota(se, data), 0);
  }
  // 'ae'
  const aeNames = [...new Set(data.map(r => r.ae).filter(Boolean))];
  return aeNames.reduce((sum, ae) => sum + computeAEQuota(ae, data), 0);
}
