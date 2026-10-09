const BOOL_PROPS = new Set(['disabled', 'checked', 'hidden', 'selected', 'multiple', 'readOnly', 'required', 'open', 'autofocus']);
const SVG_NS = 'http://www.w3.org/2000/svg';

function appendChildren(parent, children) {
  for (const child of children) {
    if (child == null || child === false || child === true) continue;
    if (Array.isArray(child)) appendChildren(parent, child);
    else if (child instanceof Node) parent.appendChild(child);
    else parent.appendChild(document.createTextNode(String(child)));
  }
}

/**
 * 要素を作る。innerHTML は使わない。
 * attrs: class(string|array), id, dataset{}, style{}, on<Event>, aria-* と data-*, boolean props, value, その他は setAttribute。
 * children: string | number | Node | null | false | undefined | 入れ子配列。
 * @param {string} tag
 * @param {Record<string, any>|null} [attrs]
 * @param {...any} children
 * @returns {HTMLElement}
 */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  let value;
  let hasValue = false;
  for (const [key, val] of Object.entries(attrs ?? {})) {
    if (val == null) continue;
    if (key === 'class' || key === 'className') {
      const cls = Array.isArray(val) ? val.filter(Boolean).join(' ') : String(val);
      if (cls) el.className = cls;
    } else if (key === 'dataset') {
      for (const [k, v] of Object.entries(val)) if (v != null) el.dataset[k] = String(v);
    } else if (key === 'style') {
      if (typeof val === 'string') el.style.cssText = val;
      else for (const [k, v] of Object.entries(val)) {
        if (v == null) continue;
        if (k.startsWith('--')) el.style.setProperty(k, String(v));
        else el.style[k] = v;
      }
    } else if (/^on[A-Z]/.test(key)) {
      el.addEventListener(key.slice(2).toLowerCase(), val);
    } else if (key === 'value') {
      value = val; // type など他の属性を先に設定してから代入する
      hasValue = true;
    } else if (BOOL_PROPS.has(key)) {
      el[key] = Boolean(val);
    } else if (val === false) {
      continue;
    } else {
      el.setAttribute(key, val === true ? '' : String(val));
    }
  }
  if (hasValue) el.value = value;
  appendChildren(el, children);
  return el;
}

/**
 * index.html の SVG スプライト <symbol id="i-{name}"> を参照するアイコンを返す。
 * @param {string} name
 * @param {number} [size]
 * @returns {SVGSVGElement}
 */
export function icon(name, size = 16) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.appendChild(use);
  return svg;
}

/** 子要素をすべて削除する。 */
export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

let counter = 0;
/** 一意な ID 文字列を返す（例: image-3-k2f9）。 */
export function uid(prefix = 'id') {
  counter += 1;
  return `${prefix}-${counter}-${Math.random().toString(36).slice(2, 6)}`;
}

/** ファイル名に使えない文字を '_' に置換する。空になる場合は 'file'。 */
export function escapeFilename(name) {
  const cleaned = String(name ?? '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/^[\s.]+|[\s.]+$/g, '');
  return cleaned || 'file';
}
