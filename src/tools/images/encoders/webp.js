import { loadJsquashWebp } from '../../../lib/vendor.js';

/**
 * jSquash (libwebp WASM) で WebP にエンコードする。
 * @param {ImageData} imageData
 * @param {{quality:number, lossless?:boolean, effort?:number}} opts
 * @returns {Promise<Blob>}
 */
export async function encodeWebp(imageData, { quality, lossless, effort }) {
  const mod = await loadJsquashWebp();
  const buffer = await mod.default(imageData, {
    quality,
    lossless: lossless ? 1 : 0,
    method: effort ?? 4,
    alpha_quality: 100,
    exact: lossless ? 1 : 0,
  });
  return new Blob([buffer], { type: 'image/webp' });
}
