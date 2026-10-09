import { loadJsquashAvif } from '../../../lib/vendor.js';

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

/**
 * jSquash (libavif WASM) で AVIF にエンコードする。effort が高いほど遅く小さくなる。
 * @param {ImageData} imageData
 * @param {{quality:number, lossless?:boolean, effort?:number}} opts
 * @returns {Promise<Blob>}
 */
export async function encodeAvif(imageData, { quality, lossless, effort }) {
  const mod = await loadJsquashAvif();
  const buffer = await mod.default(imageData, {
    quality,
    qualityAlpha: -1,
    speed: clamp(10 - (effort ?? 6), 0, 10),
    lossless: !!lossless,
    subsample: 1,
  });
  return new Blob([buffer], { type: 'image/avif' });
}
