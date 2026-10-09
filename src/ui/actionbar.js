import { h } from '../lib/dom.js';
import { button, checkbox } from './components.js';

/**
 * 画面下の操作バー。左: 全選択 + サマリー、右: クリア / 保存 / ZIP / 主操作。
 */
export function createActionBar({ primaryLabel = '変換を開始', onPrimary, onCancel, onZip, onSaveDir, onClear, onSelectAll } = {}) {
  let running = false;
  let counts = { selected: 0, total: 0, outputs: 0 };
  let customSummary = null;

  const selectAll = checkbox({ label: '全選択', checked: false, onChange: (v) => onSelectAll?.(v) });
  const summary = h('span', { class: 'actionbar-summary', 'aria-live': 'polite' }, '');

  const clearBtn = button({ label: 'クリア', icon: 'trash', variant: 'ghost', onClick: () => onClear?.() });
  const saveBtn = onSaveDir ? button({ label: 'フォルダに保存', icon: 'folder', variant: 'secondary', onClick: () => onSaveDir() }) : null;
  const zipBtn = button({ label: 'ZIPでダウンロード', icon: 'zip', variant: 'secondary', disabled: true, onClick: () => onZip?.() });
  const primaryBtn = button({ label: primaryLabel, icon: 'play', variant: 'primary', onClick: () => (running ? onCancel?.() : onPrimary?.()) });

  const el = h('div', { class: 'actionbar' },
    h('div', { class: 'actionbar-left' }, selectAll.el, summary),
    h('div', { class: 'actionbar-right' }, clearBtn, saveBtn, zipBtn, primaryBtn),
  );

  function render() {
    const { selected, total, outputs } = counts;
    summary.textContent = customSummary ?? `選択 ${selected}/${total} ・ 出力 ${outputs}`;
    selectAll.input.checked = total > 0 && selected === total;
    selectAll.input.indeterminate = selected > 0 && selected < total;
    selectAll.input.disabled = total === 0 || running;
    primaryBtn.disabled = !running && selected === 0;
    clearBtn.disabled = running || total === 0;
    if (saveBtn) saveBtn.disabled = running || outputs === 0;
  }

  function setRunning(b) {
    running = !!b;
    primaryBtn.classList.toggle('is-loading', running);
    primaryBtn.setAttribute('aria-busy', String(running));
    primaryBtn.querySelector('.btn-label').textContent = running ? 'キャンセル' : primaryLabel;
    const ic = primaryBtn.querySelector('.icon');
    if (ic) ic.classList.toggle('hidden', running);
    render();
  }

  render();
  return {
    el,
    setSummary(text) { customSummary = text == null ? null : String(text); render(); },
    setRunning,
    setCounts(c) { counts = { ...counts, ...c }; customSummary = null; render(); },
    setZipEnabled(b) { zipBtn.disabled = !b; },
  };
}
