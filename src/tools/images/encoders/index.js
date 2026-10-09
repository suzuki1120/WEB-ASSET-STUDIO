import { loadJsquashWebp, loadJsquashAvif } from '../../../lib/vendor.js';
import { encodeCanvas, flattenCanvas } from './canvas.js';
import { encodeWebp } from './webp.js';
import { encodeAvif } from './avif.js';

const readPixels = (canvas) => canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
const wasmOptions = (v) => ({ quality: v.quality, lossless: v.lossless, effort: v.effort });

/** WASM モジュールを読み込めるかを返す（ローダーは結果をキャッシュする）。 */
async function canLoad(loader) {
  try {
    await loader();
    return true;
  } catch {
    return false;
  }
}

function webpEncoder(caps) {
  return async (canvas, v) => {
    if (await canLoad(loadJsquashWebp)) return encodeWebp(readPixels(canvas), wasmOptions(v));
    if (caps?.canvasWebp) return encodeCanvas(canvas, 'image/webp', v.quality / 100);
    throw new Error('WebPエンコーダを読み込めませんでした');
  };
}

function avifEncoder() {
  return async (canvas, v) => {
    if (!(await canLoad(loadJsquashAvif))) throw new Error('AVIFエンコーダを読み込めませんでした');
    return encodeAvif(readPixels(canvas), wasmOptions(v));
  };
}

/**
 * 形式に応じたエンコード関数 (canvas, variant) => Promise<Blob> を返す。
 * @param {'png'|'jpeg'|'webp'|'avif'} format
 * @param {{canvasWebp?:boolean}} caps
 */
export function selectEncoder(format, caps = {}) {
  switch (format) {
    case 'png':
      return (canvas) => encodeCanvas(canvas, 'image/png');
    case 'jpeg':
      return (canvas, v) => encodeCanvas(flattenCanvas(canvas, v.background), 'image/jpeg', v.quality / 100);
    case 'webp':
      return webpEncoder(caps);
    case 'avif':
      return avifEncoder();
    default:
      throw new Error(`未対応の形式です: ${format}`);
  }
}
