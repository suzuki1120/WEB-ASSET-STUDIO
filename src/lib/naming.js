import { escapeFilename } from './dom.js';

/** 拡張子を除いたファイル名を返す（先頭のドットのみのファイルはそのまま）。 */
export function stripExt(name) {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}

/** 小文字の拡張子（ドットなし）を返す。なければ空文字。 */
export function extOf(name) {
  const i = name.lastIndexOf('.');
  return i > 0 && i < name.length - 1 ? name.slice(i + 1).toLowerCase() : '';
}

/** 小文字化し、空白と _ を - にし、安全でない文字を除く。日本語などの文字は残す。 */
export function slugify(s) {
  return String(s ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^\p{L}\p{N}\p{M}-]+/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * パターンの {name} {w} {h} {ext} {suffix} を置換する。suffix 内の {w} {h} も展開する。
 * @param {string} pattern 例: '{name}{suffix}.{ext}'
 * @param {{name?:string, w?:number, h?:number, ext?:string, suffix?:string}} ctx
 */
export function buildName(pattern, ctx = {}) {
  const fill = (str, extra = {}) =>
    str.replace(/\{(name|w|h|ext|suffix)\}/g, (_, k) => String(extra[k] ?? ctx[k] ?? ''));
  const suffix = fill(ctx.suffix ?? '', { suffix: '' });
  return escapeFilename(fill(pattern, { suffix }));
}

/** 重複する名前に拡張子の前へ -2, -3 を付ける。大文字小文字は区別しない。 */
export function dedupeNames(names) {
  const used = new Set();
  return names.map((name) => {
    let candidate = name;
    if (used.has(candidate.toLowerCase())) {
      const base = stripExt(name);
      const ext = name.slice(base.length);
      let n = 2;
      do candidate = `${base}-${n++}${ext}`;
      while (used.has(candidate.toLowerCase()));
    }
    used.add(candidate.toLowerCase());
    return candidate;
  });
}
