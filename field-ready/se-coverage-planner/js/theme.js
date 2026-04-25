/**
 * Theme controller for the SE Coverage Planner.
 *
 * Sets data-theme="light" on the <html> root for light mode (no attribute = dark).
 * Persists choice in localStorage under "secp:theme".
 * Dispatches a "theme-changed" event so the map can swap tile providers.
 */

const STORAGE_KEY = 'secp:theme';

export function getTheme() {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

export function applyTheme(theme) {
  const t = theme === 'light' ? 'light' : 'dark';
  if (t === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  try { localStorage.setItem(STORAGE_KEY, t); } catch {}
  document.dispatchEvent(new CustomEvent('theme-changed', { detail: { theme: t } }));
}

export function toggleTheme() {
  applyTheme(getTheme() === 'light' ? 'dark' : 'light');
}

/** Call once at app startup, BEFORE the map is initialized. */
export function initTheme() {
  let stored = null;
  try { stored = localStorage.getItem(STORAGE_KEY); } catch {}
  // Default: dark. Only flip to light if explicitly stored.
  if (stored === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
  }

  const btn = document.getElementById('btnThemeToggle');
  if (btn) btn.addEventListener('click', toggleTheme);
}
