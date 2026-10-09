// 変換前のプレビュー。現在の設定で 1 形式・最大サイズだけをエンコードし、元画像と重ねて比較する。
import { h, uid } from '../../lib/dom.js';
import { createUrl, revokeOwner, revokeUrl } from '../../lib/objecturl.js';
import { createPool } from '../../lib/worker-pool.js';
import { formatBytes, formatPct, formatDims } from '../../lib/format.js';
import { modal, rangeField, segmented, switchField, field, notice } from '../../ui/components.js';
import { createCompareView } from '../../ui/compare.js';
import { expandVariants, validateSettings } from './image-settings.js';
import { processJob } from './image-process.js';

const FORMATS = [
  { value: 'webp', label: 'WebP' },
  { value: 'avif', label: 'AVIF' },
  { value: 'jpeg', label: 'JPEG' },
  { value: 'png', label: 'PNG' },
];
const LABEL = Object.fromEntries(FORMATS.map((f) => [f.value, f.label]));
const DEBOUNCE_MS = 250;
const DECODE_ERROR = '画像を読み込めませんでした';
const isAbort = (err) => err?.name === 'AbortError';

function documentCanvas(w, hgt) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = hgt;
  return canvas;
}

/** 指定形式だけを有効にした設定で、最大サイズのバリアントを返す。 */
function previewVariant(settings, format, meta) {
  const formats = {};
  for (const { value } of FORMATS) formats[value] = { ...settings.formats[value], enabled: value === format };
  const only = { ...settings, formats };
  const check = validateSettings(only);
  if (!check.ok) throw new Error(check.errors[0]);
  const variants = expandVariants(only, meta);
  return variants[variants.length - 1];
}

/** 1 バリアントだけをエンコードする。新しい依頼が来たら実行中の Worker を止めて作り直す。 */
function createEncoder(caps) {
  let pool = null;
  let current = null; // 実行中の依頼（null なら待機中）
  const useWorker = () => !!(caps.moduleWorker && caps.offscreenCanvas);

  function getPool() {
    if (!pool && useWorker()) {
      try {
        pool = createPool({ url: new URL('./image-worker.js', import.meta.url), size: 1, type: 'module' });
      } catch {
        pool = null;
      }
    }
    return pool;
  }

  function stop() {
    if (current && pool) {
      pool.terminate();
      pool = null;
    }
  }

  async function encode(file, variant) {
    stop();
    const token = {};
    current = token;
    let out = null;
    let error = null;
    const onMessage = (msg) => {
      if (msg.type === 'output') out = msg;
      else if (msg.type === 'error') error = msg.message;
    };
    try {
      const p = getPool();
      if (p) {
        await p.run({ file, variants: [variant], caps: { canvasWebp: caps.canvasWebp, offscreenCanvas: true } }, { onMessage }).promise;
      } else {
        const makeCanvas = caps.offscreenCanvas ? undefined : documentCanvas;
        await processJob({ file, variants: [variant], caps: { canvasWebp: caps.canvasWebp }, makeCanvas }, onMessage);
        if (error) throw new Error(error);
      }
    } finally {
      if (current === token) current = null;
    }
    if (!out) throw new Error(error || '変換に失敗しました');
    return out;
  }

  return {
    encode,
    dispose() {
      pool?.terminate();
      pool = null;
    },
  };
}

/**
 * プレビューを開く。品質と「出力に含める」の変更は設定に直接書き込み、閉じるときに onSettingsChange を呼ぶ。
 * @param {{ item: any, caps: any, getSettings: () => any, onSettingsChange: () => void, onClose?: () => void }} opts
 */
export function openImagePreview({ item, caps, getSettings, onSettingsChange, onClose }) {
  const owner = uid('preview');
  const encoder = createEncoder(caps);
  const view = createCompareView();
  let meta = null;
  let seq = 0;
  let timer = 0;
  let afterUrl = null;
  let closed = false;
  let dirty = false; // 設定を書き換えたか（閉じるときに保存と再描画をまとめて行う）

  const settings = () => getSettings();
  const firstEnabled = FORMATS.find((f) => settings().formats[f.value]?.enabled)?.value ?? 'webp';
  let format = firstEnabled;

  /* ---------- 操作部品 ---------- */
  const formatSeg = segmented({
    options: FORMATS,
    value: format,
    onChange: (v) => {
      format = v;
      syncControls();
      schedule(0);
    },
  });
  const quality = rangeField({
    label: '品質',
    min: 1,
    max: 100,
    step: 1,
    value: settings().formats[format].quality ?? 80,
    onInput: (v) => {
      settings().formats[format].quality = v;
      dirty = true;
      schedule(DEBOUNCE_MS);
    },
  });
  const qualityHint = h('p', { class: 'field-hint' });
  const enabledSwitch = switchField({
    label: 'この形式を出力に含める',
    checked: settings().formats[format].enabled,
    onChange: (v) => {
      settings().formats[format].enabled = v;
      dirty = true;
    },
  });
  const zoomSeg = segmented({
    options: [{ value: 'fit', label: '全体' }, { value: '1', label: '100%' }, { value: '2', label: '200%' }],
    value: 'fit',
    onChange: (v) => view.setZoom(v),
  });

  const stats = h('dl', { class: 'preview-stats' });
  const message = h('div');

  function syncControls() {
    const conf = settings().formats[format];
    const noQuality = format === 'png' || conf.lossless;
    quality.setValue(conf.quality ?? 80);
    quality.setDisabled(noQuality);
    qualityHint.textContent = format === 'png'
      ? 'PNG は可逆圧縮のため品質の指定はありません'
      : conf.lossless ? '可逆圧縮が有効なため品質は使いません（設定パネルで切り替えられます）' : '品質の変更は変換設定にも反映されます';
    enabledSwitch.input.checked = !!conf.enabled;
  }

  function stat(label, value, tone) {
    return [h('dt', null, label), h('dd', { class: tone ? `is-${tone}` : null }, value)];
  }

  function renderStats(result, variant, ms) {
    stats.textContent = '';
    const ratio = item.size ? result.bytes / item.size : null;
    stats.append(
      ...stat('元画像', `${formatBytes(item.size)} · ${formatDims(meta.width, meta.height)}`),
      ...stat(`${LABEL[format]}`, `${formatBytes(result.bytes)} · ${formatDims(result.width, result.height)}`),
      ...stat('削減率', ratio == null ? '-' : formatPct(ratio), ratio != null && ratio > 1 ? 'bad' : 'good'),
      ...stat('エンコード時間', `${(ms / 1000).toFixed(2)} 秒`),
    );
    message.textContent = '';
    if (ratio != null && ratio > 1) {
      message.appendChild(notice('元画像より大きくなっています。品質を下げるか、別の形式を試してください。', 'warning'));
    } else if (settings().srcset.enabled || variant.width !== meta.width) {
      message.appendChild(notice(`出力サイズのうち最大の ${formatDims(variant.width, variant.height)} でプレビューしています。`, 'info'));
    }
  }

  function labelFor() {
    const conf = settings().formats[format];
    if (format === 'png' || conf.lossless) return `${LABEL[format]}（可逆）`;
    return `${LABEL[format]} 品質 ${conf.quality}`;
  }

  /* ---------- エンコード ---------- */
  function schedule(delay) {
    clearTimeout(timer);
    timer = setTimeout(() => { run(); }, delay);
  }

  async function run() {
    if (closed || !meta) return;
    const my = ++seq;
    let variant;
    try {
      variant = previewVariant(settings(), format, meta);
    } catch (err) {
      view.setOverlay({ text: err.message, tone: 'danger' });
      return;
    }
    view.setOverlay({ text: `${labelFor()} でエンコード中`, spinner: true });
    view.setLabels('元画像', labelFor());
    const t0 = performance.now();
    try {
      const result = await encoder.encode(item.file, variant);
      if (closed || my !== seq) return;
      const ms = performance.now() - t0;
      if (afterUrl) revokeUrl(afterUrl);
      afterUrl = createUrl(result.blob, owner);
      const img = h('img', { src: afterUrl, alt: `${labelFor()} で変換した画像`, decoding: 'async', draggable: 'false' });
      await img.decode().catch(() => {});
      if (closed || my !== seq) return;
      view.setBefore(beforeImg, { fit: variant.fit === 'cover' ? 'cover' : variant.fit === 'fill' ? 'fill' : 'contain' });
      view.setAfter(img);
      view.setSize(result.width, result.height);
      view.setOverlay(null);
      renderStats({ ...result, bytes: result.bytes ?? result.blob.size }, variant, ms);
    } catch (err) {
      if (closed || my !== seq || isAbort(err)) return;
      view.setOverlay({ text: err?.message || '変換に失敗しました', tone: 'danger' });
    }
  }

  /* ---------- 画面 ---------- */
  const beforeImg = h('img', { src: createUrl(item.file, owner), alt: '元の画像', decoding: 'async', draggable: 'false' });
  view.setLabels('元画像', labelFor());
  view.setOverlay({ text: '画像を読み込み中', spinner: true });

  const controls = h('div', { class: 'preview-controls' },
    field({ label: '形式', control: formatSeg.el }),
    h('div', { class: 'field' }, quality.el, qualityHint),
    enabledSwitch.el,
    field({ label: '表示倍率', control: zoomSeg.el }),
  );

  const { dlg } = modal({
    title: `プレビュー: ${item.name}`,
    className: 'modal-preview',
    children: h('div', { class: 'preview-layout' },
      view.el,
      h('aside', { class: 'preview-side' }, controls, stats, message),
    ),
    footer: h('p', { class: 'field-hint' }, '境界線をドラッグするか、矢印キーで左右の表示範囲を変えられます。左が元画像、右が変換後です。'),
    onClose() {
      closed = true;
      clearTimeout(timer);
      encoder.dispose();
      view.destroy();
      revokeOwner(owner);
      if (dirty) onSettingsChange();
      onClose?.();
    },
  });

  syncControls();
  beforeImg.decode()
    .then(() => {
      if (closed) return;
      meta = { width: beforeImg.naturalWidth, height: beforeImg.naturalHeight };
      view.setBefore(beforeImg);
      view.setSize(meta.width, meta.height);
      run();
    })
    .catch(() => view.setOverlay({ text: DECODE_ERROR, tone: 'danger' }));

  return { close: () => dlg.close() };
}
