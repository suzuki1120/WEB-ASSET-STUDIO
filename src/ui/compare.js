// 変換前後を重ねて比較するビュー。左が元、右が変換後。境界線はドラッグか矢印キーで動かす。
import { h } from '../lib/dom.js';

const ZOOM = { fit: null, '1': 1, '2': 2 };
const FITS = new Set(['contain', 'cover', 'fill']);

/**
 * @returns {{
 *   el: HTMLElement,
 *   setBefore(node: HTMLElement|null, opts?: {fit?: string}): void,
 *   setAfter(node: HTMLElement|null): void,
 *   setSize(width: number, height: number): void,
 *   setZoom(zoom: 'fit'|'1'|'2'): void,
 *   setLabels(before: string, after: string): void,
 *   setOverlay(o: {text: string, spinner?: boolean, tone?: string}|null): void,
 *   destroy(): void,
 * }}
 */
export function createCompareView() {
  let size = { width: 0, height: 0 };
  let zoom = 'fit';
  let split = 0.5;

  const beforeLayer = h('div', { class: 'compare-layer compare-before' });
  const afterLayer = h('div', { class: 'compare-layer compare-after' });
  const handle = h('div', {
    class: 'compare-handle',
    role: 'slider',
    tabindex: '0',
    'aria-label': '比較位置（左が元、右が変換後）',
    'aria-valuemin': '0',
    'aria-valuemax': '100',
  }, h('span', { class: 'compare-knob', 'aria-hidden': 'true' }));
  const stage = h('div', { class: 'compare-stage' }, beforeLayer, afterLayer, handle);
  const viewport = h('div', { class: 'compare-viewport' }, stage);
  const beforeLabel = h('span', { class: 'compare-label' });
  const afterLabel = h('span', { class: 'compare-label is-after' });
  const overlayText = h('span');
  const overlaySpin = h('span', { class: 'spinner' });
  const overlay = h('div', { class: 'compare-overlay hidden', role: 'status' }, overlaySpin, overlayText);
  const el = h('div', { class: 'compare' },
    h('div', { class: 'compare-legend' }, beforeLabel, afterLabel),
    h('div', { class: 'compare-frame' }, viewport, overlay),
  );

  function applySplit() {
    const pct = Math.round(split * 1000) / 10;
    afterLayer.style.clipPath = `inset(0 0 0 ${pct}%)`;
    handle.style.left = `${pct}%`;
    handle.setAttribute('aria-valuenow', String(Math.round(pct)));
    handle.setAttribute('aria-valuetext', `元 ${Math.round(pct)}% / 変換後 ${Math.round(100 - pct)}%`);
  }

  function layout() {
    if (!size.width || !size.height) return;
    let scale = ZOOM[zoom];
    if (scale == null) {
      const cs = getComputedStyle(viewport);
      const aw = viewport.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const ah = viewport.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      if (aw <= 0 || ah <= 0) return;
      scale = Math.min(1, aw / size.width, ah / size.height);
    }
    stage.style.width = `${Math.max(1, Math.round(size.width * scale))}px`;
    stage.style.height = `${Math.max(1, Math.round(size.height * scale))}px`;
    el.classList.toggle('is-zoomed', zoom !== 'fit');
  }

  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { if (zoom === 'fit') layout(); }) : null;
  ro?.observe(viewport);

  // ドラッグ: マウスはステージ全体、タッチはつまみのみ（拡大時のスクロールを妨げないため）
  let dragging = null;
  function splitFromEvent(e) {
    const rect = stage.getBoundingClientRect();
    if (!rect.width) return;
    split = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    applySplit();
  }
  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (e.pointerType !== 'mouse' && !handle.contains(e.target)) return;
    e.preventDefault();
    dragging = e.pointerId;
    stage.setPointerCapture(e.pointerId);
    splitFromEvent(e);
    handle.focus({ preventScroll: true });
  });
  stage.addEventListener('pointermove', (e) => { if (e.pointerId === dragging) splitFromEvent(e); });
  const endDrag = (e) => {
    if (e.pointerId !== dragging) return;
    dragging = null;
    if (stage.hasPointerCapture(e.pointerId)) stage.releasePointerCapture(e.pointerId);
  };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);

  handle.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 0.1 : 0.02;
    const keys = { ArrowLeft: -step, ArrowDown: -step, ArrowRight: step, ArrowUp: step };
    if (e.key in keys) split += keys[e.key];
    else if (e.key === 'Home') split = 0;
    else if (e.key === 'End') split = 1;
    else return;
    e.preventDefault();
    split = Math.max(0, Math.min(1, split));
    applySplit();
  });

  function put(layer, node) {
    layer.textContent = '';
    if (node) layer.appendChild(node);
  }

  applySplit();

  return {
    el,
    setBefore(node, { fit = 'contain' } = {}) {
      beforeLayer.style.setProperty('--compare-fit', FITS.has(fit) ? fit : 'contain');
      put(beforeLayer, node);
    },
    setAfter(node) { put(afterLayer, node); },
    setSize(width, height) {
      size = { width: Number(width) || 0, height: Number(height) || 0 };
      layout();
    },
    setZoom(z) {
      zoom = z in ZOOM ? z : 'fit';
      if (zoom === 'fit') {
        stage.style.width = '';
        stage.style.height = '';
      }
      layout();
    },
    setLabels(before, after) {
      beforeLabel.textContent = before ?? '';
      afterLabel.textContent = after ?? '';
    },
    setOverlay(o) {
      overlay.classList.toggle('hidden', !o);
      if (!o) return;
      overlayText.textContent = o.text ?? '';
      overlaySpin.classList.toggle('hidden', !o.spinner);
      overlay.classList.toggle('is-danger', o.tone === 'danger');
    },
    destroy() { ro?.disconnect(); },
  };
}
