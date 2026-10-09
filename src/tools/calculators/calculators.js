import { h } from '../../lib/dom.js';
import { copyText } from '../../lib/clipboard.js';
import { button, field, numberInput, segmented } from '../../ui/components.js';
import { toPercent, toVw, aspectRatio, fluidClamp } from './calc-math.js';

const KEY = (id) => `was.settings.${id}`;

function loadSettings(id, defaults) {
  try {
    const raw = localStorage.getItem(KEY(id));
    return { ...defaults, ...(raw ? JSON.parse(raw) : {}) };
  } catch {
    return { ...defaults };
  }
}

function saveSettings(id, value) {
  try { localStorage.setItem(KEY(id), JSON.stringify(value)); } catch { /* 保存不可でも続行 */ }
}

/**
 * クリックでコピーする結果表示。
 * set(text, { unit, copyText }) / setEmpty(message) / setError(message)
 */
function createResult({ label, code = false }) {
  const valueEl = h('span', { class: code ? 'result-code' : 'result-value num' });
  const unitEl = h('span', { class: 'result-unit' });
  const hint = h('span', { class: 'result-hint' }, 'クリックしてコピー');
  const el = h('button', { type: 'button', class: 'result is-empty', 'aria-live': 'polite' },
    h('span', { class: 'result-label' }, label),
    code ? valueEl : h('span', { class: 'result-line' }, valueEl, unitEl),
    hint,
  );
  let text = '';
  let timer = null;

  const resetCopied = () => {
    el.classList.remove('is-copied');
    hint.textContent = text ? 'クリックしてコピー' : '';
  };

  el.addEventListener('click', async () => {
    if (!text) return;
    const ok = await copyText(text);
    if (!ok) return;
    el.classList.add('is-copied');
    hint.textContent = 'コピーしました';
    clearTimeout(timer);
    timer = setTimeout(resetCopied, 1500);
  });

  const api = {
    el,
    get text() { return text; },
    set(value, { unit = '', copy = `${value}${unit}` } = {}) {
      text = copy;
      valueEl.textContent = String(value);
      unitEl.textContent = unit;
      el.classList.remove('is-empty', 'is-error');
      resetCopied();
    },
    setEmpty(message = '入力してください') {
      text = '';
      valueEl.textContent = message;
      unitEl.textContent = '';
      el.classList.add('is-empty');
      el.classList.remove('is-error');
      resetCopied();
    },
    setError(message) {
      api.setEmpty(message);
      el.classList.remove('is-empty');
      el.classList.add('is-error');
    },
  };
  return api;
}

function makeTool({ id, title, subtitle, iconName, main }) {
  return { id, title, subtitle, icon: iconName, group: 'calc', main, aside: null };
}

/** 2 つの px 入力から 1 つの値を出す px→% / px→vw 共通部分。 */
function createRatioLikeTool({ id, title, subtitle, iconName, labelA, labelB, hintA, unit, compute, resultLabel }) {
  const state = loadSettings(id, { a: null, b: null });
  const result = createResult({ label: resultLabel });

  const update = () => {
    saveSettings(id, state);
    const v = compute(state.a, state.b);
    if (v == null) result.setEmpty('入力してください');
    else result.set(v, { unit });
  };

  const a = numberInput({ value: state.a, min: 0, placeholder: '例: 1000', unit: 'px', onInput: (v) => { state.a = v; update(); } });
  const b = numberInput({ value: state.b, min: 0, placeholder: '例: 500', unit: 'px', onInput: (v) => { state.b = v; update(); } });

  const main = h('div', { class: 'calc-stack' },
    h('div', { class: 'calc-grid' },
      field({ label: labelA, hint: hintA, control: a }),
      field({ label: labelB, control: b }),
    ),
    result.el,
  );
  update();
  return makeTool({ id, title, subtitle, iconName, main });
}

export function createPercentTool() {
  return createRatioLikeTool({
    id: 'percent',
    title: 'px → %',
    subtitle: '親要素のサイズと対象の値から、幅や余白の割合を算出します。',
    iconName: 'percent',
    labelA: '親要素のサイズ',
    hintA: '割合の基準になる値（px）',
    labelB: '対象のサイズ',
    unit: '%',
    resultLabel: '割合',
    compute: toPercent,
  });
}

export function createVwTool() {
  return createRatioLikeTool({
    id: 'vw',
    title: 'px → vw',
    subtitle: '画面幅と対象の値から、vw 単位の値を算出します。',
    iconName: 'vw',
    labelA: '画面幅',
    hintA: 'デザインカンプの幅（px）',
    labelB: '対象のサイズ',
    unit: 'vw',
    resultLabel: 'ビューポート幅に対する値',
    compute: toVw,
  });
}

export function createRatioTool() {
  const id = 'ratio';
  const state = loadSettings(id, { w: null, h: null });
  const result = createResult({ label: 'アスペクト比' });

  const copyCss = button({
    label: 'aspect-ratio をコピー',
    icon: 'copy',
    size: 'sm',
    variant: 'secondary',
    disabled: true,
    onClick: () => result.text && copyText(`aspect-ratio: ${result.text};`),
  });

  const update = () => {
    saveSettings(id, state);
    const r = aspectRatio(state.w, state.h);
    if (!r) {
      result.setEmpty('入力してください');
      copyCss.disabled = true;
    } else {
      result.set(r.string, { copy: r.string });
      copyCss.disabled = false;
    }
  };

  const w = numberInput({ value: state.w, min: 1, step: 1, placeholder: '例: 1920', unit: 'px', onInput: (v) => { state.w = v; update(); } });
  const hgt = numberInput({ value: state.h, min: 1, step: 1, placeholder: '例: 1080', unit: 'px', onInput: (v) => { state.h = v; update(); } });

  const main = h('div', { class: 'calc-stack' },
    h('div', { class: 'calc-grid' },
      field({ label: '幅', control: w }),
      field({ label: '高さ', control: hgt }),
    ),
    result.el,
    h('div', { class: 'calc-actions' }, copyCss),
  );
  update();
  return makeTool({
    id,
    title: 'アスペクト比',
    subtitle: '幅と高さを最大公約数で約分し、CSS に書ける比率を求めます。',
    iconName: 'ratio',
    main,
  });
}

export function createClampTool() {
  const id = 'clamp';
  const state = loadSettings(id, { minPx: null, maxPx: null, minVw: 320, maxVw: 1280, rootPx: 16, unit: 'rem' });
  const result = createResult({ label: 'clamp() の値', code: true });

  const update = () => {
    saveSettings(id, state);
    const { minPx, maxPx, minVw, maxVw, rootPx, unit } = state;
    const anyEmpty = [minPx, maxPx, minVw, maxVw, rootPx].some((v) => v == null);
    if (anyEmpty) return result.setEmpty('すべての項目を入力してください');
    if (maxVw === minVw) return result.setError('最小画面幅と最大画面幅に同じ値は指定できません');
    if (rootPx <= 0) return result.setError('ルートのフォントサイズは 0 より大きい値にしてください');
    const css = fluidClamp({ minPx, maxPx, minVw, maxVw, rootPx, unit });
    if (!css) return result.setError('値を確認してください');
    return result.set(css, { copy: css });
  };

  const bind = (key) => (v) => { state[key] = v; update(); };
  const minPx = numberInput({ value: state.minPx, min: 0, placeholder: '例: 16', unit: 'px', onInput: bind('minPx') });
  const maxPx = numberInput({ value: state.maxPx, min: 0, placeholder: '例: 24', unit: 'px', onInput: bind('maxPx') });
  const minVw = numberInput({ value: state.minVw, min: 0, placeholder: '例: 320', unit: 'px', onInput: bind('minVw') });
  const maxVw = numberInput({ value: state.maxVw, min: 0, placeholder: '例: 1280', unit: 'px', onInput: bind('maxVw') });
  const rootPx = numberInput({ value: state.rootPx, min: 1, placeholder: '16', unit: 'px', onInput: bind('rootPx') });
  const unitSeg = segmented({
    options: [{ value: 'rem', label: 'rem' }, { value: 'px', label: 'px' }],
    value: state.unit,
    onChange: (v) => { state.unit = v; update(); },
  });

  const main = h('div', { class: 'calc-stack' },
    h('div', { class: 'calc-grid' },
      field({ label: '最小サイズ', control: minPx }),
      field({ label: '最大サイズ', control: maxPx }),
      field({ label: '最小画面幅', control: minVw }),
      field({ label: '最大画面幅', control: maxVw }),
      field({ label: 'ルートのフォントサイズ', hint: 'rem 換算の基準（通常は 16px）', control: rootPx }),
      field({ label: '出力単位', control: unitSeg.el }),
    ),
    result.el,
  );
  update();
  return makeTool({
    id,
    title: 'Fluid clamp()',
    subtitle: '画面幅に応じてサイズが滑らかに変わる clamp() を生成します。',
    iconName: 'clamp',
    main,
  });
}
