// 動画からポスター画像（静止画）を書き出す。
import { loadMediabunny } from '../../lib/vendor.js';
import { selectEncoder } from '../images/encoders/index.js';
import { openVideoElement, seekVideo } from './probe.js';

const EXT = { jpeg: 'jpg', jpg: 'jpg', webp: 'webp', avif: 'avif', png: 'png' };
const MIME = { jpeg: 'image/jpeg', jpg: 'image/jpeg', webp: 'image/webp', avif: 'image/avif', png: 'image/png' };

async function canvasWithMediabunny(file, time, width) {
  const { Input, BlobSource, ALL_FORMATS, CanvasSink } = await loadMediabunny();
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('映像トラックが見つかりません');
    const sink = new CanvasSink(track, width ? { width, fit: 'contain' } : {});
    let wrapped = await sink.getCanvas(Math.max(0, time));
    if (!wrapped) wrapped = await sink.getCanvas(await track.getFirstTimestamp());
    if (!wrapped) throw new Error('指定位置のフレームを取得できません');
    return wrapped.canvas;
  } finally {
    input.dispose?.();
  }
}

async function canvasWithVideoElement(file, time, width) {
  const { video, dispose } = await openVideoElement(file);
  try {
    await seekVideo(video, time);
    const srcW = video.videoWidth;
    const srcH = video.videoHeight;
    const w = width ? Math.round(width) : srcW;
    const h = Math.max(1, Math.round((w * srcH) / Math.max(1, srcW)));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(video, 0, 0, w, h);
    return canvas;
  } finally {
    dispose();
  }
}

/**
 * @returns {Promise<{blob:Blob, width:number, height:number, ext:string, mime:string}>}
 */
export async function extractPoster(file, { time = 0, width = null, format = 'jpeg', quality = 85, caps } = {}) {
  let canvas;
  try {
    canvas = await canvasWithMediabunny(file, time, width);
  } catch (err) {
    console.warn('[video] mediabunny でのポスター取得に失敗。<video> で代替します', err);
    canvas = await canvasWithVideoElement(file, time, width);
  }
  const mime = MIME[format] ?? MIME.jpeg;
  const variant = { format, quality, lossless: false, effort: 4, background: '#000000', mime };
  const encode = await selectEncoder(format, caps);
  const blob = await encode(canvas, variant);
  return { blob, width: canvas.width, height: canvas.height, ext: EXT[format] ?? 'jpg', mime };
}
