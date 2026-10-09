// 画像変換の設定: 既定値・プリセット・保存・検証・出力バリアント展開。

export const DEFAULTS = {
  formats: {
    webp: { enabled: true, quality: 80, lossless: false, effort: 4 },
    avif: { enabled: false, quality: 60, lossless: false, effort: 6 },
    jpeg: { enabled: false, quality: 82, background: '#ffffff' },
    png: { enabled: false },
  },
  resize: { mode: 'none', width: null, height: null, scale: 100, fit: 'contain', upscale: false },
  srcset: { enabled: false, widths: [480, 768, 1024, 1440, 1920], includeOriginal: true },
  naming: { pattern: '{name}{suffix}.{ext}', sizeSuffix: '-{w}w', lowercase: false, slugify: false },
  snippet: { pathPrefix: '/assets/img/', sizes: '(max-width: 768px) 100vw, 768px', lazy: true },
};

/** プリセット。settings は DEFAULTS に深くマージして使う。 */
export const PRESETS = {
  web: {
    label: 'Web標準',
    settings: {
      formats: { webp: { enabled: true, quality: 80 }, jpeg: { enabled: true, quality: 82 } },
      srcset: { enabled: true, includeOriginal: true },
    },
  },
  hq: {
    label: '高品質',
    settings: {
      formats: {
        avif: { enabled: true, quality: 65, effort: 6 },
        webp: { enabled: true, quality: 90, effort: 5 },
        jpeg: { enabled: true, quality: 92 },
      },
    },
  },
  thumb: {
    label: 'サムネイル',
    settings: {
      formats: { webp: { enabled: true, quality: 70, effort: 4 } },
      resize: { mode: 'box', width: 320, height: 320, fit: 'cover' },
    },
  },
};

const STORAGE_KEY = 'was.settings.images';
const FORMAT_INFO = {
  webp: { ext: 'webp', mime: 'image/webp' },
  avif: { ext: 'avif', mime: 'image/avif' },
  jpeg: { ext: 'jpg', mime: 'image/jpeg' },
  png: { ext: 'png', mime: 'image/png' },
};

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const clone = (v) => JSON.parse(JSON.stringify(v));

/** base に patch を深くマージした新しいオブジェクトを返す。型が違う値は無視する。 */
export function deepMerge(base, patch) {
  const out = clone(base);
  if (!isPlain(patch)) return out;
  for (const [key, val] of Object.entries(patch)) {
    const def = out[key];
    if (isPlain(def)) {
      out[key] = deepMerge(def, val);
    } else if (def == null || typeof def === typeof val) {
      if (Array.isArray(def) && !Array.isArray(val)) continue;
      out[key] = val;
    }
  }
  return out;
}

export function defaultSettings() {
  return clone(DEFAULTS);
}

export function presetSettings(key) {
  const preset = PRESETS[key];
  return preset ? deepMerge(DEFAULTS, preset.settings) : defaultSettings();
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultSettings();
    return deepMerge(DEFAULTS, JSON.parse(raw));
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* 保存できなくても動作は継続する */
  }
}

/** "480, 768 1024" のような文字列を昇順・重複なしの正の整数配列にする。 */
export function parseWidths(text) {
  const nums = String(text ?? '')
    .split(/[\s,、，]+/)
    .map((s) => Math.round(Number(s)))
    .filter((n) => Number.isFinite(n) && n > 0);
  return [...new Set(nums)].sort((a, b) => a - b);
}

const positive = (n) => Number.isFinite(Number(n)) && Number(n) > 0;

function resizeErrors(r) {
  if (r.mode === 'width' && !positive(r.width)) return ['リサイズの幅を入力してください'];
  if (r.mode === 'height' && !positive(r.height)) return ['リサイズの高さを入力してください'];
  if (r.mode === 'scale' && !positive(r.scale)) return ['リサイズの倍率を入力してください'];
  if (r.mode === 'box' && !positive(r.width) && !positive(r.height)) {
    return ['枠に収める場合は幅か高さのどちらかを入力してください'];
  }
  return [];
}

/** @returns {{ok:boolean, errors:string[]}} */
export function validateSettings(settings) {
  const errors = [];
  const enabled = Object.values(settings.formats).some((f) => f.enabled);
  if (!enabled) errors.push('出力形式を1つ以上選んでください');
  errors.push(...resizeErrors(settings.resize));
  if (settings.srcset.enabled && !settings.srcset.widths.some(positive)) {
    errors.push('srcset の幅を1つ以上入力してください');
  }
  if (!settings.naming.pattern.includes('{ext}')) {
    errors.push('ファイル名パターンに {ext} を含めてください');
  }
  return { ok: errors.length === 0, errors };
}

// ---- バリアント展開 ----

const clampDim = (n) => Math.max(1, Math.round(n));

function sizeObj(w, h, fit = 'contain') {
  return { width: clampDim(w), height: clampDim(h), fit };
}

function limitScale(f, upscale) {
  return upscale ? f : Math.min(1, f);
}

function boxSize(r, sw, sh) {
  const bw = positive(r.width) ? Number(r.width) : null;
  const bh = positive(r.height) ? Number(r.height) : null;
  if (bw && !bh) return byWidth(bw, sw, sh, r.upscale);
  if (bh && !bw) return byHeight(bh, sw, sh, r.upscale);
  if (!bw || !bh) return sizeObj(sw, sh);
  if (r.fit === 'contain') {
    const f = limitScale(Math.min(bw / sw, bh / sh), r.upscale);
    return sizeObj(sw * f, sh * f);
  }
  if (r.fit === 'cover') {
    const need = Math.max(bw / sw, bh / sh);
    const k = r.upscale || need <= 1 ? 1 : need;
    return sizeObj(bw / k, bh / k, 'cover');
  }
  const w = r.upscale ? bw : Math.min(bw, sw);
  const h = r.upscale ? bh : Math.min(bh, sh);
  return sizeObj(w, h, 'fill');
}

function byWidth(w, sw, sh, upscale) {
  const width = upscale ? w : Math.min(w, sw);
  return sizeObj(width, (sh * width) / sw);
}

function byHeight(h, sw, sh, upscale) {
  const height = upscale ? h : Math.min(h, sh);
  return sizeObj((sw * height) / sh, height);
}

/** リサイズ設定から基準サイズ {width,height,fit} を求める。 */
export function baseSize(resize, meta) {
  const { width: sw, height: sh } = meta;
  switch (resize.mode) {
    case 'width':
      return positive(resize.width) ? byWidth(Number(resize.width), sw, sh, resize.upscale) : sizeObj(sw, sh);
    case 'height':
      return positive(resize.height) ? byHeight(Number(resize.height), sw, sh, resize.upscale) : sizeObj(sw, sh);
    case 'scale': {
      const f = limitScale(Number(resize.scale) / 100, resize.upscale);
      return positive(f) ? sizeObj(sw * f, sh * f) : sizeObj(sw, sh);
    }
    case 'box':
      return boxSize(resize, sw, sh);
    default:
      return sizeObj(sw, sh);
  }
}

function targetSizes(settings, meta) {
  const base = baseSize(settings.resize, meta);
  if (!settings.srcset.enabled) return [base];
  const bound = settings.resize.mode === 'none' ? meta.width : base.width;
  const upscale = settings.resize.upscale;
  const sizes = settings.srcset.widths
    .filter(positive)
    .map((w) => Math.round(Number(w)))
    .filter((w) => (upscale ? w <= bound : w < bound))
    .map((w) => sizeObj(w, (meta.height * w) / meta.width));
  if (settings.srcset.includeOriginal) sizes.push(base);
  const byW = new Map(sizes.map((s) => [s.width, s]));
  const list = [...byW.values()].sort((a, b) => a.width - b.width);
  return list.length ? list : [base];
}

function makeSuffix(pattern, size) {
  return pattern.replaceAll('{w}', String(size.width)).replaceAll('{h}', String(size.height));
}

function variantFor(format, conf, size, suffix) {
  const info = FORMAT_INFO[format];
  return {
    id: `${format}@${size.width}`,
    format,
    ext: info.ext,
    mime: info.mime,
    width: size.width,
    height: size.height,
    fit: size.fit,
    quality: conf.quality ?? null,
    lossless: format === 'png' ? true : !!conf.lossless,
    effort: conf.effort ?? null,
    background: format === 'jpeg' ? conf.background || '#ffffff' : null,
    suffix,
  };
}

/**
 * 有効な形式 × 目標サイズでバリアント配列を作る（サイズ順、同サイズ内は形式順）。
 * @param {typeof DEFAULTS} settings
 * @param {{width:number,height:number}} meta
 */
export function expandVariants(settings, meta) {
  const formats = Object.keys(FORMAT_INFO).filter((f) => settings.formats[f]?.enabled);
  const sizes = targetSizes(settings, meta);
  const out = [];
  for (const size of sizes) {
    const differs = size.width !== meta.width || size.height !== meta.height;
    const suffix = settings.srcset.enabled || differs ? makeSuffix(settings.naming.sizeSuffix, size) : '';
    for (const format of formats) out.push(variantFor(format, settings.formats[format], size, suffix));
  }
  return out;
}
