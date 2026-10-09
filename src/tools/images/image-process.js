// 1 ファイル分の変換ジョブ。Worker / メインスレッドのどちらでも動く（document は makeCanvas 未指定時のみ参照）。
import { selectEncoder } from './encoders/index.js';
import { createCanvas } from './encoders/canvas.js';

const DECODE_ERROR = '画像を読み込めませんでした';

/** 変換元の中で、出力サイズに対応する切り出し範囲を返す（cover のときだけ縁を切る）。 */
function cropRect(bitmap, v) {
  const full = { sx: 0, sy: 0, sw: bitmap.width, sh: bitmap.height };
  if (v.fit !== 'cover') return full;
  const scale = Math.max(v.width / bitmap.width, v.height / bitmap.height);
  const sw = Math.min(bitmap.width, Math.max(1, Math.round(v.width / scale)));
  const sh = Math.min(bitmap.height, Math.max(1, Math.round(v.height / scale)));
  return { sx: Math.round((bitmap.width - sw) / 2), sy: Math.round((bitmap.height - sh) / 2), sw, sh };
}

const isFull = (bitmap, c) => c.sw === bitmap.width && c.sh === bitmap.height;

function drawInto(makeCanvas, src, w, h) {
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h);
  return canvas;
}

async function resizeBitmap(bitmap, c, v) {
  const options = { resizeWidth: v.width, resizeHeight: v.height, resizeQuality: 'high' };
  if (isFull(bitmap, c)) return createImageBitmap(bitmap, options);
  return createImageBitmap(bitmap, c.sx, c.sy, c.sw, c.sh, options);
}

/** createImageBitmap のリサイズが使えない環境向け。半分ずつ縮小して画質を保つ。 */
function stepDown(makeCanvas, bitmap, c, v) {
  let src = bitmap;
  let rect = c;
  for (;;) {
    const nw = Math.max(v.width, Math.ceil(rect.sw / 2));
    const nh = Math.max(v.height, Math.ceil(rect.sh / 2));
    const canvas = makeCanvas(nw, nh);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, nw, nh);
    if (nw === v.width && nh === v.height) return canvas;
    src = canvas;
    rect = { sx: 0, sy: 0, sw: nw, sh: nh };
  }
}

/** バリアントのサイズに描画した canvas を返す。 */
async function renderVariant(bitmap, v, makeCanvas) {
  const c = cropRect(bitmap, v);
  if (isFull(bitmap, c) && v.width === bitmap.width && v.height === bitmap.height) {
    return drawInto(makeCanvas, bitmap, v.width, v.height);
  }
  let resized = null;
  try {
    resized = await resizeBitmap(bitmap, c, v);
  } catch {
    resized = null;
  }
  if (!resized) return stepDown(makeCanvas, bitmap, c, v);
  try {
    return drawInto(makeCanvas, resized, v.width, v.height);
  } finally {
    resized.close();
  }
}

function releaseCanvas(canvas) {
  if (canvas && 'width' in canvas) {
    canvas.width = 0;
    canvas.height = 0;
  }
}

/** 同じサイズの canvas を使い回しつつ、バリアントごとに描画する。 */
function createRenderer(bitmap, makeCanvas) {
  let key = '';
  let canvas = null;
  return {
    async get(v) {
      const k = `${v.width}x${v.height}`;
      if (k !== key) {
        releaseCanvas(canvas);
        canvas = await renderVariant(bitmap, v, makeCanvas);
        key = k;
      }
      return canvas;
    },
    dispose() {
      releaseCanvas(canvas);
      canvas = null;
    },
  };
}

async function decode(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return null;
  }
}

async function encodeAll({ bitmap, variants, caps, makeCanvas }, post, signal) {
  const renderer = createRenderer(bitmap, makeCanvas);
  const encoders = new Map();
  try {
    for (let i = 0; i < variants.length; i += 1) {
      if (signal?.aborted) return post({ type: 'cancelled' });
      const v = variants[i];
      if (!encoders.has(v.format)) encoders.set(v.format, selectEncoder(v.format, caps));
      const canvas = await renderer.get(v);
      const blob = await encoders.get(v.format)(canvas, v);
      if (signal?.aborted) return post({ type: 'cancelled' });
      await post({ type: 'output', variantId: v.id, blob, width: v.width, height: v.height, bytes: blob.size });
      await post({ type: 'progress', done: i + 1, total: variants.length });
    }
    return post({ type: 'done' });
  } finally {
    renderer.dispose();
  }
}

/**
 * @param {{file: Blob, variants: any[], caps?: object, makeCanvas?: (w:number,h:number)=>any}} job
 * @param {(msg: object) => any} post メッセージ送信。Promise を返すと完了まで待つ（メインスレッドでの譲り用）
 * @param {AbortSignal} [signal]
 */
export async function processJob({ file, variants, caps = {}, makeCanvas = createCanvas }, post, signal) {
  const bitmap = await decode(file);
  if (!bitmap) {
    await post({ type: 'error', message: DECODE_ERROR });
    return;
  }
  try {
    await post({ type: 'meta', width: bitmap.width, height: bitmap.height });
    await encodeAll({ bitmap, variants, caps, makeCanvas }, post, signal);
  } catch (err) {
    await post({ type: 'error', message: err?.message || '変換に失敗しました' });
  } finally {
    bitmap.close();
  }
}
