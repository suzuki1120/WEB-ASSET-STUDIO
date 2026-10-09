// 動画のメタデータ取得とサムネイル生成。mediabunny を優先し、失敗時は <video> 要素で代替する。
import { loadMediabunny } from '../../lib/vendor.js';

/** File から <video> 要素を作り、メタデータ読み込みまで待つ。呼び出し側が dispose() で後始末する。 */
export function openVideoElement(file) {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  const dispose = () => {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  };
  return new Promise((resolve, reject) => {
    video.onloadedmetadata = () => resolve({ video, dispose });
    video.onerror = () => {
      dispose();
      reject(new Error('動画を読み込めませんでした（形式が未対応か、ファイルが壊れています）'));
    };
    video.src = url;
  });
}

/** <video> を指定秒へシークして描画可能になるまで待つ。 */
export function seekVideo(video, time) {
  return new Promise((resolve) => {
    const t = Math.max(0, Math.min(time, Number.isFinite(video.duration) ? video.duration : time));
    if (Math.abs(video.currentTime - t) < 0.001 && video.readyState >= 2) return resolve();
    const done = () => {
      video.removeEventListener('seeked', done);
      resolve();
    };
    video.addEventListener('seeked', done);
    video.currentTime = t;
  });
}

export function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.85) {
  if (typeof canvas.convertToBlob === 'function') return canvas.convertToBlob({ type, quality });
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('画像の書き出しに失敗しました'))), type, quality);
  });
}

async function probeWithMediabunny(file) {
  const { Input, BlobSource, ALL_FORMATS } = await loadMediabunny();
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const duration = await input.computeDuration();
    const vt = await input.getPrimaryVideoTrack();
    const at = await input.getPrimaryAudioTrack();
    if (!vt) throw new Error('映像トラックが見つかりません');
    let fps = null;
    let bitrate = null;
    try {
      const stats = await vt.computePacketStats(200);
      fps = stats.averagePacketRate ? Math.round(stats.averagePacketRate * 100) / 100 : null;
      bitrate = stats.averageBitrate ? Math.round(stats.averageBitrate) : null;
    } catch { /* 統計は任意 */ }
    return {
      duration,
      width: await vt.getDisplayWidth(),
      height: await vt.getDisplayHeight(),
      fps,
      vcodec: vt.codec ?? null,
      acodec: at?.codec ?? null,
      hasAudio: Boolean(at),
      bitrate,
    };
  } finally {
    input.dispose?.();
  }
}

async function probeWithVideoElement(file) {
  const { video, dispose } = await openVideoElement(file);
  try {
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    return {
      duration,
      width: video.videoWidth,
      height: video.videoHeight,
      fps: null,
      vcodec: null,
      acodec: null,
      hasAudio: true, // <video> では判定できないため保持扱いにする
      bitrate: duration > 0 ? Math.round((file.size * 8) / duration) : null,
    };
  } finally {
    dispose();
  }
}

/**
 * @returns {Promise<{duration:number,width:number,height:number,fps:number|null,vcodec:string|null,acodec:string|null,hasAudio:boolean,bitrate:number|null}>}
 */
export async function probeVideo(file) {
  try {
    return await probeWithMediabunny(file);
  } catch (err) {
    console.warn('[video] mediabunny での解析に失敗。<video> で代替します', err);
    return probeWithVideoElement(file);
  }
}

async function thumbWithMediabunny(file, width) {
  const { Input, BlobSource, ALL_FORMATS, CanvasSink } = await loadMediabunny();
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('映像トラックが見つかりません');
    const sink = new CanvasSink(track, { width, fit: 'contain' });
    const first = await track.getFirstTimestamp();
    const duration = await input.computeDuration();
    let wrapped = await sink.getCanvas(first + Math.min(1, duration / 4));
    if (!wrapped) wrapped = await sink.getCanvas(first);
    if (!wrapped) throw new Error('フレームを取得できません');
    return await canvasToBlob(wrapped.canvas, 'image/jpeg', 0.8);
  } finally {
    input.dispose?.();
  }
}

async function thumbWithVideoElement(file, width) {
  const { video, dispose } = await openVideoElement(file);
  try {
    await seekVideo(video, Math.min(1, (video.duration || 0) / 4));
    const w = width;
    const h = Math.max(1, Math.round((w * video.videoHeight) / Math.max(1, video.videoWidth)));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(video, 0, 0, w, h);
    return await canvasToBlob(canvas, 'image/jpeg', 0.8);
  } finally {
    dispose();
  }
}

/** サムネイル（JPEG Blob）を作る。 */
export async function makeThumbnail(file, { width = 160 } = {}) {
  try {
    return await thumbWithMediabunny(file, width);
  } catch (err) {
    console.warn('[video] mediabunny でのサムネイル生成に失敗。<video> で代替します', err);
    return thumbWithVideoElement(file, width);
  }
}
