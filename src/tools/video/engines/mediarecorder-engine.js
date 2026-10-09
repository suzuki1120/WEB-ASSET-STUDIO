// MediaRecorder によるフォールバックエンジン。再生しながら録画するため、再生時間と同じ時間がかかる。
import { resolveTargetSize } from '../video-settings.js';

const PRESET_BPS = { low: 1e6, medium: 2.5e6, high: 5e6, very_high: 10e6 };
const MIME_CANDIDATES = {
  webm: ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'],
  mp4: ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1.42E01E', 'video/mp4'],
};

const abortError = () => Object.assign(new Error('変換を中止しました'), { name: 'AbortError' });

function pickMime(container) {
  if (typeof MediaRecorder === 'undefined') return null;
  return MIME_CANDIDATES[container].find((m) => MediaRecorder.isTypeSupported(m)) ?? null;
}

/** 描画矩形（fit に応じて contain / cover / fill）。 */
function drawRect(fit, srcW, srcH, dstW, dstH) {
  if (fit === 'fill') return [0, 0, dstW, dstH];
  const k = fit === 'cover' ? Math.max(dstW / srcW, dstH / srcH) : Math.min(dstW / srcW, dstH / srcH);
  const w = srcW * k;
  const h = srcH * k;
  return [(dstW - w) / 2, (dstH - h) / 2, w, h];
}

export async function convert(file, settings, { onProgress, signal } = {}) {
  if (signal?.aborted) throw abortError();
  const container = settings.container === 'mp4' ? 'mp4' : 'webm';
  const mimeType = pickMime(container);
  if (!mimeType) {
    throw new Error(`このブラウザでは ${container.toUpperCase()} の録画に対応していません。別の形式を選ぶか、Chrome などの WebCodecs 対応ブラウザをお使いください`);
  }
  const v = settings.video;
  const wantAudio = settings.audio.mode !== 'mute';
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.playsInline = true;
  video.preload = 'auto';
  video.muted = false;
  video.src = url;

  let audioCtx = null;
  let raf = 0;
  let recorder = null;
  let onAbort = null;

  try {
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = () => reject(new Error('動画を読み込めませんでした（形式が未対応か、ファイルが壊れています）'));
    });
    const srcW = video.videoWidth;
    const srcH = video.videoHeight;
    const size = resolveTargetSize(v.mode === 'copy' ? { mode: 'none' } : v.resize, srcW, srcH);
    const fit = v.resize?.mode === 'box' ? v.resize.fit || 'contain' : 'fill';
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx2d = canvas.getContext('2d', { alpha: false });
    const rect = drawRect(fit, srcW, srcH, size.width, size.height);

    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const start = Math.max(0, Number(settings.trim?.start) || 0);
    const endSetting = settings.trim?.end;
    const end = endSetting != null && endSetting > start ? Math.min(endSetting, duration || endSetting) : duration;
    const span = Math.max(0.001, end - start);

    const stream = canvas.captureStream(v.fps > 0 ? v.fps : 30);
    if (wantAudio) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        audioCtx = new AC();
        const srcNode = audioCtx.createMediaElementSource(video);
        const dest = audioCtx.createMediaStreamDestination();
        srcNode.connect(dest); // スピーカーへは接続しない（無音で録音のみ）
        for (const t of dest.stream.getAudioTracks()) stream.addTrack(t);
        await audioCtx.resume();
      }
    } else {
      video.muted = true;
    }

    const bps = v.mode === 'transcode' && v.bitrateMode === 'custom' && v.bitrate > 0 ? v.bitrate : PRESET_BPS[v.preset] ?? PRESET_BPS.high;
    recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: Math.round(bps) });
    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };

    if (start > 0) {
      await new Promise((resolve) => {
        video.onseeked = resolve;
        video.currentTime = start;
      });
    }

    const stopped = new Promise((resolve, reject) => {
      recorder.onstop = resolve;
      recorder.onerror = (e) => reject(e.error ?? new Error('録画に失敗しました'));
    });
    const aborted = new Promise((_, reject) => {
      onAbort = () => {
        try { if (recorder.state !== 'inactive') recorder.stop(); } catch { /* 無視 */ }
        video.pause();
        reject(abortError());
      };
      signal?.addEventListener('abort', onAbort, { once: true });
    });

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(raf);
      if (recorder.state !== 'inactive') recorder.stop();
      video.pause();
    };
    const draw = () => {
      ctx2d.drawImage(video, rect[0], rect[1], rect[2], rect[3]);
      onProgress?.(Math.max(0, Math.min(1, (video.currentTime - start) / span)));
      if (video.ended || video.currentTime >= end) finish();
      else raf = requestAnimationFrame(draw);
    };
    video.onended = finish;
    video.onerror = () => finish();

    recorder.start(1000);
    await video.play();
    raf = requestAnimationFrame(draw);

    await Promise.race([stopped, aborted]);
    onProgress?.(1);
    const blob = new Blob(chunks, { type: container === 'mp4' ? 'video/mp4' : 'video/webm' });
    if (!blob.size) throw new Error('録画データが空でした。ブラウザのタブを前面に出したまま再度お試しください');
    return {
      blob,
      mime: blob.type,
      ext: container,
      warnings: ['リアルタイム変換のため再生時間と同じ時間がかかります'],
    };
  } finally {
    cancelAnimationFrame(raf);
    if (onAbort) signal?.removeEventListener('abort', onAbort);
    try { if (recorder && recorder.state !== 'inactive') recorder.stop(); } catch { /* 無視 */ }
    video.pause();
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
    if (audioCtx) audioCtx.close().catch(() => {});
  }
}
