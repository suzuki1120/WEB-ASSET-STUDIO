import { h, icon } from '../lib/dom.js';
import { badge, button, checkbox, progressBar } from './components.js';

const STATUS = {
  queued: ['待機中', 'neutral'],
  processing: ['変換中', 'info'],
  done: ['完了', 'success'],
  error: ['エラー', 'danger'],
  cancelled: ['中止', 'warning'],
};

/**
 * ファイルカードのグリッド。store を購読し、data-id をキーに差分更新する。
 * 返り値の destroy() で購読を解除する。
 */
export function createFileGrid(store, { renderOutputs, renderMeta, onRemove, onRerun, onThumb } = {}) {
  const el = h('div', { class: 'filegrid' });
  const cards = new Map(); // id -> refs

  function buildCard(item) {
    const sel = checkbox({ label: '', checked: item.selected !== false, onChange: (v) => store.setSelected(item.id, v) });
    sel.input.setAttribute('aria-label', `${item.name} を選択`);
    const thumb = h('div', { class: 'filecard-thumb' });
    const name = h('div', { class: 'filecard-name' }, item.name);
    name.title = item.name;
    const meta = h('div', { class: 'filecard-meta' });
    const status = badge('', 'neutral');
    const stale = badge('設定が変更されました', 'warning');
    stale.classList.add('hidden');
    const rerunBtn = onRerun ? button({ icon: 'refresh', variant: 'ghost', size: 'sm', title: '再変換', onClick: () => onRerun(store.get(item.id) || item) }) : null;
    rerunBtn?.setAttribute('aria-label', `${item.name} を再変換`);
    const removeBtn = button({ icon: 'trash', variant: 'ghost', size: 'sm', title: '削除', onClick: () => onRemove?.(store.get(item.id) || item) });
    removeBtn.setAttribute('aria-label', `${item.name} を削除`);
    const progress = progressBar(0);
    progress.el.classList.add('hidden', 'is-thin');
    const errorEl = h('div', { class: 'filecard-error hidden', role: 'alert' });
    const outputs = h('div', { class: 'outputs' });

    const card = h('article', { class: 'filecard', dataset: { id: item.id } },
      h('div', { class: 'filecard-head' }, sel.el, thumb, h('div', { class: 'filecard-info' }, name, meta)),
      h('div', { class: 'filecard-status' }, status, stale, h('div', { class: 'filecard-actions' }, rerunBtn, removeBtn)),
      progress.el,
      errorEl,
      outputs,
    );
    const refs = { card, sel, thumb, meta, status, stale, rerunBtn, progress, errorEl, outputs, thumbUrl: undefined, outSig: null };
    cards.set(item.id, refs);
    return refs;
  }

  function patch(item) {
    const r = cards.get(item.id) || buildCard(item);
    const [text, tone] = STATUS[item.status] || STATUS.queued;
    r.status.textContent = text;
    r.status.className = `badge badge-${tone}`;
    r.card.classList.toggle('is-error', item.status === 'error');
    r.meta.textContent = renderMeta ? renderMeta(item) : '';
    r.sel.input.checked = item.selected !== false;
    r.stale.classList.toggle('hidden', !item.stale);

    const processing = item.status === 'processing';
    r.progress.el.classList.toggle('hidden', !processing);
    if (processing) {
      const p = Number(item.progress) || 0;
      r.progress.set(p > 1 ? p / 100 : p);
    }
    r.errorEl.classList.toggle('hidden', !(item.status === 'error' && item.error));
    r.errorEl.textContent = item.status === 'error' ? String(item.error || '') : '';
    if (r.rerunBtn) r.rerunBtn.classList.toggle('hidden', !['done', 'error', 'cancelled'].includes(item.status));

    if (r.thumbUrl !== (item.thumbUrl || null)) {
      r.thumbUrl = item.thumbUrl || null;
      r.thumb.textContent = '';
      if (r.thumbUrl) r.thumb.appendChild(h('img', { src: r.thumbUrl, alt: '', loading: 'lazy', decoding: 'async' }));
      else r.thumb.appendChild(icon(item.kind === 'video' ? 'video' : 'image', 20));
    }

    const sig = `${item.status}|${(item.outputs || []).map((o) => o.id).join(',')}`;
    if (sig !== r.outSig) {
      r.outSig = sig;
      r.outputs.textContent = '';
      const node = renderOutputs ? renderOutputs(item) : null;
      if (node) r.outputs.appendChild(node);
    }
    return r;
  }

  function sync() {
    const items = store.items();
    const ids = new Set(items.map((i) => i.id));
    for (const [id, r] of cards) {
      if (!ids.has(id)) { r.card.remove(); cards.delete(id); }
    }
    for (const item of items) {
      const had = cards.has(item.id);
      const r = patch(item);
      if (!had) {
        el.appendChild(r.card);
        if (!item.thumbUrl) onThumb?.(item);
      }
    }
  }

  const idsOf = (e) => e.ids || (e.id != null ? [e.id] : null);

  const unsubscribe = store.subscribe((e) => {
    switch (e.type) {
      case 'add':
      case 'remove':
        sync();
        break;
      case 'clear':
        cards.clear();
        el.textContent = '';
        break;
      case 'update': {
        const ids = idsOf(e);
        if (!ids) { sync(); break; }
        for (const id of ids) { const item = store.get(id); if (item && cards.has(id)) patch(item); }
        break;
      }
      case 'select': {
        const ids = idsOf(e) || store.items().map((i) => i.id);
        for (const id of ids) {
          const item = store.get(id);
          const r = cards.get(id);
          if (item && r) r.sel.input.checked = item.selected !== false;
        }
        break;
      }
      default:
        break;
    }
  });

  sync();
  return { el, destroy: unsubscribe };
}
