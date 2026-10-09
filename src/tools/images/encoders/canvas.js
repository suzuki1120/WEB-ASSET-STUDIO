// Canvas による書き出し。Worker / メインスレッドの両方で動く。

/** OffscreenCanvas があれば使い、なければ document の canvas を作る。 */
export function createCanvas(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  if (typeof document === 'undefined') throw new Error('Canvas を作成できません');
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function toBlob(canvas, mime, quality) {
  if (typeof canvas.convertToBlob === 'function') return canvas.convertToBlob({ type: mime, quality });
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('画像を書き出せませんでした'))),
      mime,
      quality,
    );
  });
}

const MIME_LABEL = { 'image/webp': 'WebP', 'image/avif': 'AVIF', 'image/jpeg': 'JPEG', 'image/png': 'PNG' };

/**
 * canvas を指定 MIME の Blob にする。ブラウザが未対応で別形式（Safari の WebP → PNG など）を返したら例外。
 * @param {OffscreenCanvas|HTMLCanvasElement} canvas
 * @param {string} mime
 * @param {number} [quality] 0〜1
 * @returns {Promise<Blob>}
 */
export async function encodeCanvas(canvas, mime, quality) {
  const blob = await toBlob(canvas, mime, quality);
  if (!blob || blob.type !== mime) {
    throw new Error(`このブラウザは ${MIME_LABEL[mime] ?? mime} の書き出しに対応していません`);
  }
  return blob;
}

/** 背景色で塗りつぶした複製を返す（透過を持たない形式用）。元の canvas は変更しない。 */
export function flattenCanvas(canvas, background) {
  const copy = createCanvas(canvas.width, canvas.height);
  const ctx = copy.getContext('2d');
  ctx.fillStyle = background || '#ffffff';
  ctx.fillRect(0, 0, copy.width, copy.height);
  ctx.drawImage(canvas, 0, 0);
  return copy;
}
