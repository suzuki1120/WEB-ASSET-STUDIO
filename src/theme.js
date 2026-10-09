const KEY = 'was.theme';
const root = document.documentElement;

function readStored() {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

/** 現在の表示テーマ。data-theme が無ければ OS 設定に従う。 */
export function currentTheme() {
  const t = root.dataset.theme;
  if (t === 'light' || t === 'dark') return t;
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

/** トグルボタン (#theme-toggle) のアイコンと aria-label を現在のテーマに合わせる。 */
export function updateThemeToggle() {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  const dark = currentTheme() === 'dark';
  const use = btn.querySelector('use');
  if (use) use.setAttribute('href', dark ? '#i-sun' : '#i-moon');
  const label = dark ? 'ライトテーマに切り替え' : 'ダークテーマに切り替え';
  btn.setAttribute('aria-label', label);
  btn.setAttribute('title', label);
}

export function initTheme() {
  const stored = readStored();
  if (stored) root.dataset.theme = stored;
  updateThemeToggle();
  window.matchMedia?.('(prefers-color-scheme: light)').addEventListener?.('change', updateThemeToggle);
}

export function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  root.dataset.theme = next;
  try { localStorage.setItem(KEY, next); } catch { /* 保存できなくても動作は継続 */ }
  updateThemeToggle();
  return next;
}
