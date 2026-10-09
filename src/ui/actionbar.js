import { h } from '../lib/dom.js';
import { button, checkbox } from './components.js';

/**
 * 画面下の操作バー。左: 全選択 + サマリー、右: 補助ボタン + 主ボタン。
 * 主ボタンは状態で切り替わる:
 *   run     … 未変換（または設定変更済み）の選択ファイルがある → 「変換を開始（N件）」
 *   save    … 選択ファイルがすべて変換済み → 「ZIPでダウンロード」（変換は「再変換」に降格）
 *   running … 変換中 → 「キャンセル」
 * ファイルが 0 件のときはバー全体を隠す。
 * <600px では補助ボタン群を「その他」メニューにまとめる（CSS で切り替え）。
 */
export function createActionBar({ primaryLabel = '変換を開始', onPrimary, onRerunAll, onCancel, onZip, onSaveDir, onClear, onSelectAll } = {}) {
  let running = false;
  let counts = { selected: 0, total: 0, outputs: 0, pending: 0 };
  let zipEnabled = false;
  let customSummary = null;
  let mode = 'run';

  const selectAll = checkbox({ label: '全選択', checked: false, onChange: (v) => onSelectAll?.(v) });
  const summary = h('span', { class: 'actionbar-summary', 'aria-live': 'polite' }, '');

  const closeMenu = () => setMenuOpen(false);
  const act = (fn) => () => { closeMenu(); fn?.(); };

  const clearBtn = button({ label: 'クリア', icon: 'trash', variant: 'ghost', title: 'すべてのファイルと結果を削除', onClick: act(onClear) });
  clearBtn.classList.add('actionbar-clear');
  const saveBtn = onSaveDir ? button({ label: 'フォルダに保存', icon: 'folder', variant: 'secondary', onClick: act(onSaveDir) }) : null;
  const zipBtn = button({ label: 'ZIPでダウンロード', icon: 'zip', variant: 'secondary', onClick: act(onZip) });
  const rerunBtn = button({ label: '再変換', icon: 'refresh', variant: 'secondary', onClick: act(onRerunAll ?? onPrimary) });
  const primaryBtn = button({ label: primaryLabel, icon: 'play', variant: 'primary', onClick: () => onPrimaryClick() });

  const moreBtn = button({ label: 'その他', icon: 'chevron-down', variant: 'secondary', onClick: () => setMenuOpen(!el.classList.contains('is-menu-open')) });
  moreBtn.classList.add('actionbar-more');
  moreBtn.setAttribute('aria-haspopup', 'true');
  moreBtn.setAttribute('aria-expanded', 'false');

  const secondary = h('div', { class: 'actionbar-secondary' }, clearBtn, saveBtn, zipBtn, rerunBtn);
  const el = h('div', { class: 'actionbar' },
    h('div', { class: 'actionbar-left' }, selectAll.el, summary),
    h('div', { class: 'actionbar-right' }, secondary, moreBtn, primaryBtn),
  );

  function setMenuOpen(open) {
    el.classList.toggle('is-menu-open', open);
    moreBtn.setAttribute('aria-expanded', String(open));
  }
  document.addEventListener('click', (e) => { if (!el.contains(e.target)) closeMenu(); });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && el.classList.contains('is-menu-open')) {
      closeMenu();
      moreBtn.focus();
    }
  });

  function onPrimaryClick() {
    if (running) onCancel?.();
    else if (mode === 'save') onZip?.();
    else onPrimary?.();
  }

  function setPrimary(label, iconName) {
    primaryBtn.querySelector('.btn-label').textContent = label;
    primaryBtn.querySelector('.icon use')?.setAttribute('href', `#i-${iconName}`);
  }

  function render() {
    const { selected, total, outputs, pending } = counts;
    el.classList.toggle('hidden', total === 0);
    mode = running ? 'running' : selected > 0 && pending === 0 && zipEnabled ? 'save' : 'run';

    summary.textContent = customSummary ?? `選択 ${selected}/${total} ・ 出力 ${outputs}`;
    summary.title = summary.textContent;
    selectAll.input.checked = total > 0 && selected === total;
    selectAll.input.indeterminate = selected > 0 && selected < total;
    selectAll.input.disabled = total === 0 || running;

    primaryBtn.classList.toggle('is-loading', running);
    primaryBtn.setAttribute('aria-busy', String(running));
    primaryBtn.querySelector('.icon')?.classList.toggle('hidden', running);
    if (mode === 'running') setPrimary('キャンセル', 'x');
    else if (mode === 'save') setPrimary('ZIPでダウンロード', 'zip');
    else setPrimary(pending > 0 ? `${primaryLabel}（${pending}件）` : primaryLabel, 'play');
    primaryBtn.disabled = mode === 'run' && selected === 0;

    clearBtn.disabled = running;
    zipBtn.classList.toggle('hidden', mode === 'save' || outputs === 0);
    zipBtn.disabled = running || !zipEnabled;
    rerunBtn.classList.toggle('hidden', mode !== 'save');
    if (saveBtn) {
      saveBtn.classList.toggle('hidden', outputs === 0);
      saveBtn.disabled = running || !zipEnabled;
    }
    moreBtn.disabled = running;
    if (running) closeMenu();
  }

  render();
  return {
    el,
    setSummary(text) { customSummary = text == null ? null : String(text); render(); },
    setRunning(b) { running = !!b; render(); },
    /** counts: { selected, total, outputs, pending }。pending は未変換・設定変更済みの選択件数。 */
    setCounts(c) { counts = { ...counts, ...c }; customSummary = null; render(); },
    setZipEnabled(b) { zipEnabled = !!b; render(); },
  };
}
