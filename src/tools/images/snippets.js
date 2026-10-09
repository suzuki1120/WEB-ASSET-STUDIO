// <picture> / srcset のコード生成。

const MIME = { avif: 'image/avif', webp: 'image/webp', jpeg: 'image/jpeg', png: 'image/png' };
const SOURCE_ORDER = ['avif', 'webp'];
const FALLBACK_ORDER = ['jpeg', 'png', 'webp', 'avif'];

const escapeAttr = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function withPrefix(prefix, filename) {
  const p = prefix ?? '';
  const base = p && !p.endsWith('/') ? `${p}/` : p;
  return base + encodeURIComponent(filename);
}

const byWidth = (a, b) => a.width - b.width;

/** 同じ形式の出力から srcset 属性値を作る。例: "a-480w.webp 480w, a-768w.webp 768w" */
export function buildSrcset(outputs, pathPrefix = '') {
  return [...outputs]
    .sort(byWidth)
    .map((o) => `${withPrefix(pathPrefix, o.filename)} ${o.width}w`)
    .join(', ');
}

function groupByFormat(outputs) {
  const groups = new Map();
  for (const o of outputs) {
    if (!groups.has(o.format)) groups.set(o.format, []);
    groups.get(o.format).push(o);
  }
  return groups;
}

const largest = (outputs) => outputs.reduce((a, b) => (b.width > a.width ? b : a));

function attrs(list) {
  return list
    .filter(([, v]) => v !== null && v !== undefined && v !== false)
    .map(([k, v]) => (v === true ? k : `${k}="${escapeAttr(v)}"`))
    .join(' ');
}

function responsiveAttrs(group, settings) {
  if (group.length < 2) return [];
  return [
    ['srcset', buildSrcset(group, settings.snippet.pathPrefix)],
    ['sizes', settings.snippet.sizes || null],
  ];
}

function imgTag(group, settings) {
  const fallback = largest(group);
  const list = [
    ['src', withPrefix(settings.snippet.pathPrefix, fallback.filename)],
    ...responsiveAttrs(group, settings),
    ['width', fallback.width],
    ['height', fallback.height],
    ['alt', ''],
    ['loading', settings.snippet.lazy ? 'lazy' : null],
    ['decoding', settings.snippet.lazy ? 'async' : null],
  ];
  return `<img ${attrs(list)}>`;
}

function sourceTag(format, group, settings) {
  const srcset =
    group.length > 1
      ? responsiveAttrs(group, settings)
      : [['srcset', withPrefix(settings.snippet.pathPrefix, group[0].filename)]];
  return `<source ${attrs([['type', MIME[format]], ...srcset])}>`;
}

/**
 * アイテムの出力から <picture>（出力が 1 形式のみなら <img>）を作る。出力が無ければ空文字。
 * @param {{outputs: any[]}} item
 * @param {object} settings
 */
export function buildPictureSnippet(item, settings) {
  const outputs = (item.outputs ?? []).filter((o) => o.kind === 'image' || !o.kind);
  if (!outputs.length) return '';
  const groups = groupByFormat(outputs);
  const fallbackFormat = FALLBACK_ORDER.find((f) => groups.has(f));
  const fallbackGroup = groups.get(fallbackFormat);
  if (groups.size === 1) return imgTag(fallbackGroup, settings);
  const sources = SOURCE_ORDER.filter((f) => groups.has(f) && f !== fallbackFormat).map((f) =>
    sourceTag(f, groups.get(f), settings),
  );
  const lines = ['<picture>', ...sources.map((s) => `  ${s}`), `  ${imgTag(fallbackGroup, settings)}`, '</picture>'];
  return lines.join('\n');
}
