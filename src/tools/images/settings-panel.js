// 画像変換の設定パネル（右パネル）。settings オブジェクトを直接書き換え、変更のたびに onChange を呼ぶ。
import { h } from '../../lib/dom.js';
import { buildName } from '../../lib/naming.js';
import {
  button, field, numberInput, textInput, rangeField, switchField, select, segmented, checkbox, section, notice,
} from '../../ui/components.js';
import { PRESETS, parseWidths } from './image-settings.js';

const PRESET_KEYS = ['web', 'hq', 'thumb'];
const RESIZE_MODES = [
  { value: 'none', label: 'なし' },
  { value: 'width', label: '幅' },
  { value: 'height', label: '高さ' },
  { value: 'scale', label: '倍率' },
  { value: 'box', label: '枠' },
];
const FIT_OPTIONS = [
  { value: 'contain', label: '枠内に収める（余白なし）' },
  { value: 'cover', label: '枠を埋めて中央で切り抜く' },
  { value: 'fill', label: '縦横比を無視して引き伸ばす' },
];

const toggle = (el, visible) => el.classList.toggle('hidden', !visible);

// ---- 出力形式 ----

function qualityRange(conf, onChange) {
  const ctl = rangeField({
    label: '品質',
    min: 1,
    max: 100,
    step: 1,
    value: conf.quality,
    format: (v) => String(v),
    onInput: (v) => {
      conf.quality = v;
      onChange();
    },
  });
  return ctl;
}

function effortRange(conf, max, onChange) {
  return rangeField({
    label: '圧縮の手間（高いほど遅く小さい）',
    min: 0,
    max,
    step: 1,
    value: conf.effort,
    format: (v) => String(v),
    onInput: (v) => {
      conf.effort = v;
      onChange();
    },
  });
}

function backgroundField(conf, onChange) {
  const input = h('input', { class: 'input', type: 'color', value: conf.background || '#ffffff' });
  input.addEventListener('input', () => {
    conf.background = input.value;
    onChange();
  });
  const el = field({ label: '背景色（透過部分の塗りつぶし）', control: input });
  return { el, input };
}

/** 1 形式分の行。有効/無効と可逆圧縮の状態に応じて部品の有効状態を揃える。 */
function formatRow({ key, label, conf, effortMax, note, onChange }) {
  const quality = key === 'png' ? null : qualityRange(conf, onChange);
  const effort = effortMax ? effortRange(conf, effortMax, onChange) : null;
  const background = key === 'jpeg' ? backgroundField(conf, onChange) : null;
  const lossless = effortMax
    ? switchField({
        label: '可逆圧縮',
        hint: '画質は劣化しませんが、サイズは大きくなります',
        checked: conf.lossless,
        onChange: (v) => {
          conf.lossless = v;
          sync();
          onChange();
        },
      })
    : null;

  const sync = () => {
    const on = conf.enabled;
    quality?.setDisabled(!on || conf.lossless);
    effort?.setDisabled(!on);
    if (lossless) lossless.input.disabled = !on;
    if (background) background.input.disabled = !on;
  };
  const enable = checkbox({
    label,
    checked: conf.enabled,
    onChange: (v) => {
      conf.enabled = v;
      sync();
      onChange();
    },
  });
  sync();
  const body = [quality?.el, lossless?.el, effort?.el, background?.el, note].filter(Boolean);
  return h('div', { class: 'format-row', style: { display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' } }, enable.el, ...body);
}

function formatsSection(settings, onChange) {
  const f = settings.formats;
  const rows = [
    formatRow({ key: 'webp', label: 'WebP', conf: f.webp, effortMax: 6, onChange }),
    formatRow({
      key: 'avif',
      label: 'AVIF',
      conf: f.avif,
      effortMax: 9,
      note: notice('AVIFはエンコードに時間がかかります', 'info'),
      onChange,
    }),
    formatRow({ key: 'jpeg', label: 'JPEG', conf: f.jpeg, onChange }),
    formatRow({ key: 'png', label: 'PNG', conf: f.png, onChange }),
  ];
  return section({ title: '出力形式', children: rows });
}

// ---- リサイズ ----

function resizeNumber(label, unit, r, key, onChange) {
  const ctl = numberInput({
    value: r[key],
    min: 1,
    unit,
    onInput: (n) => {
      r[key] = n;
      onChange();
    },
  });
  return { ctl, el: field({ label, control: ctl }) };
}

function resizeSection(settings, onChange) {
  const r = settings.resize;
  const width = resizeNumber('幅', 'px', r, 'width', onChange);
  const height = resizeNumber('高さ', 'px', r, 'height', onChange);
  const scale = resizeNumber('倍率', '%', r, 'scale', onChange);
  const fit = select({
    options: FIT_OPTIONS,
    value: r.fit,
    onChange: (v) => {
      r.fit = v;
      onChange();
    },
  });
  const fitField = field({ label: '枠への合わせ方', control: fit });
  const upscale = switchField({
    label: '拡大を許可',
    hint: '元より大きいサイズを指定したとき、拡大して書き出します',
    checked: r.upscale,
    onChange: (v) => {
      r.upscale = v;
      onChange();
    },
  });
  const refresh = () => {
    toggle(width.el, r.mode === 'width' || r.mode === 'box');
    toggle(height.el, r.mode === 'height' || r.mode === 'box');
    toggle(scale.el, r.mode === 'scale');
    toggle(fitField, r.mode === 'box');
    toggle(upscale.el, r.mode !== 'none');
  };
  const mode = segmented({
    options: RESIZE_MODES,
    value: r.mode,
    onChange: (v) => {
      r.mode = v;
      refresh();
      onChange();
    },
  });
  refresh();
  return section({
    title: 'リサイズ',
    children: [field({ label: '指定方法', control: mode }), width.el, height.el, scale.el, fitField, upscale.el],
  });
}

// ---- srcset ----

function srcsetSection(settings, onChange) {
  const s = settings.srcset;
  const widths = textInput({
    value: s.widths.join(', '),
    mono: true,
    placeholder: '480, 768, 1024',
    onInput: (v) => {
      s.widths = parseWidths(v);
      onChange();
    },
  });
  const widthsField = field({ label: '書き出す幅（px、カンマ区切り）', control: widths, hint: '元の幅より小さいものだけ書き出します' });
  const original = switchField({
    label: '元のサイズも含める',
    hint: 'リサイズ後のサイズ（指定なしなら元のサイズ）を最大幅として追加します',
    checked: s.includeOriginal,
    onChange: (v) => {
      s.includeOriginal = v;
      onChange();
    },
  });
  const refresh = () => {
    toggle(widthsField, s.enabled);
    toggle(original.el, s.enabled);
  };
  const enable = switchField({
    label: '複数サイズを書き出す（srcset）',
    hint: '画面幅に応じて読み込む画像を切り替えるための複数サイズ',
    checked: s.enabled,
    onChange: (v) => {
      s.enabled = v;
      refresh();
      onChange();
    },
  });
  refresh();
  return section({ title: 'srcset', open: false, children: [enable.el, widthsField, original.el] });
}

// ---- ファイル名 ----

function namingExample(n) {
  const suffix = n.sizeSuffix.replaceAll('{w}', '480').replaceAll('{h}', '320');
  const name = buildName(n.pattern, { name: 'Photo Sample', w: 480, h: 320, ext: 'webp', suffix });
  return `例: ${n.lowercase ? name.toLowerCase() : name}`;
}

function namingSection(settings, onChange) {
  const n = settings.naming;
  const example = h('p', { class: 'field-hint' }, namingExample(n));
  const changed = () => {
    example.textContent = namingExample(n);
    onChange();
  };
  const pattern = textInput({ value: n.pattern, mono: true, onInput: (v) => { n.pattern = v; changed(); } });
  const suffix = textInput({ value: n.sizeSuffix, mono: true, onInput: (v) => { n.sizeSuffix = v; changed(); } });
  const lower = switchField({ label: '小文字にそろえる', checked: n.lowercase, onChange: (v) => { n.lowercase = v; changed(); } });
  const slug = switchField({
    label: '元の名前を URL 向けに整える',
    hint: '空白を - にし、記号を取り除きます',
    checked: n.slugify,
    onChange: (v) => { n.slugify = v; changed(); },
  });
  return section({
    title: 'ファイル名',
    open: false,
    children: [
      field({ label: 'ファイル名パターン', control: pattern, hint: '{name} {w} {h} {ext} {suffix} が使えます' }),
      field({ label: 'サイズ違いの接尾辞', control: suffix, hint: '{w} は幅、{h} は高さに置き換わります' }),
      example,
      lower.el,
      slug.el,
    ],
  });
}

// ---- コード出力 ----

function snippetSection(settings, onChange) {
  const s = settings.snippet;
  const prefix = textInput({ value: s.pathPrefix, mono: true, onInput: (v) => { s.pathPrefix = v; onChange(); } });
  const sizes = textInput({ value: s.sizes, mono: true, onInput: (v) => { s.sizes = v; onChange(); } });
  const lazy = switchField({
    label: '遅延読み込み（lazy）',
    hint: 'loading="lazy" と decoding="async" を付けます',
    checked: s.lazy,
    onChange: (v) => { s.lazy = v; onChange(); },
  });
  return section({
    title: 'コード出力',
    open: false,
    children: [
      field({ label: 'パスの接頭辞', control: prefix, hint: 'HTML の src / srcset の先頭に付けます' }),
      field({ label: 'sizes 属性', control: sizes }),
      lazy.el,
    ],
  });
}

// ---- プリセット ----

function presetSection(onPreset) {
  const buttons = PRESET_KEYS.map((key) =>
    button({ label: PRESETS[key].label, variant: 'secondary', size: 'sm', onClick: () => onPreset(key) }),
  );
  const reset = button({ label: '既定に戻す', variant: 'ghost', size: 'sm', onClick: () => onPreset('reset') });
  const row = h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' } }, ...buttons, reset);
  return section({ title: 'プリセット', open: false, children: [row] });
}

/**
 * @param {{settings: object, onChange: () => void, onPreset: (key: string) => void}} opts
 * @returns {HTMLElement[]} 右パネルに並べるセクション
 */
export function buildSettingsSections({ settings, onChange, onPreset }) {
  return [
    formatsSection(settings, onChange),
    resizeSection(settings, onChange),
    srcsetSection(settings, onChange),
    namingSection(settings, onChange),
    snippetSection(settings, onChange),
    presetSection(onPreset),
  ];
}
