// WebCodecs（mediabunny）による高速変換エンジン。
import { loadMediabunny } from '../../../lib/vendor.js';
import { BITRATE_PRESETS, CODEC_MATRIX } from '../video-settings.js';

const abortError = () => Object.assign(new Error('変換を中止しました'), { name: 'AbortError' });

const REASONS = {
  no_encodable_target_codec: '出力形式で使えるコーデックにエンコードできません',
  undecodable_source_codec: '元のコーデックをデコードできません',
  unknown_source_codec: '元のコーデックを判別できません',
  discarded_by_user: '設定により除外しました',
  cannot_copy: '元のコーデックのままでは出力できません',
  max_track_count_reached: '出力形式のトラック数上限を超えました',
  max_track_count_of_type_reached: '出力形式の同種トラック数上限を超えました',
};
const trackLabel = (t) => (t?.isVideoTrack?.() ? '映像' : t?.isAudioTrack?.() ? '音声' : 'トラック');
const reasonText = (r) => REASONS[r] ?? String(r ?? '不明な理由');

// H.264 / H.265 は幅・高さが奇数だとエンコードできないため、元のサイズでも偶数に切り上げる
const EVEN_ONLY = new Set(['avc', 'hevc']);
const ceilEven = (n) => Math.ceil(n / 2) * 2;

function resizeOptions(resize, srcW, srcH, codec) {
  const r = resize ?? { mode: 'none' };
  const odd = srcW % 2 === 1 || srcH % 2 === 1;
  if ((r.mode === 'none' || !r.mode) && odd && EVEN_ONLY.has(codec)) {
    return { width: ceilEven(srcW), height: ceilEven(srcH), fit: 'fill' };
  }
  switch (r.mode) {
    case 'width': return r.width > 0 ? { width: Math.round(r.width) } : {};
    case 'height': return r.height > 0 ? { height: Math.round(r.height) } : {};
    case 'scale': {
      const w = Math.round(((srcW || 0) * (r.scale || 100)) / 100 / 2) * 2;
      return w > 0 && r.scale !== 100 ? { width: w } : {};
    }
    case 'box':
      return r.width > 0 && r.height > 0
        ? { width: Math.round(r.width), height: Math.round(r.height), fit: r.fit || 'contain' }
        : {};
    default: return {};
  }
}

/**
 * @param {File} file
 * @param {object} settings constrainVideoSettings 通過後の設定
 * @param {{onProgress?:(p:number)=>void, signal?:AbortSignal, caps?:object}} opts
 * @returns {Promise<{blob:Blob, mime:string, ext:string, warnings:string[]}>}
 */
export async function convert(file, settings, { onProgress, signal } = {}) {
  if (signal?.aborted) throw abortError();
  const mb = await loadMediabunny();
  const { Input, BlobSource, ALL_FORMATS, Output, BufferTarget, WebMOutputFormat, Mp4OutputFormat, Conversion } = mb;
  const container = settings.container === 'mp4' ? 'mp4' : 'webm';
  const v = settings.video;
  const a = settings.audio;
  const copy = v.mode === 'copy';

  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const output = new Output({
    format: container === 'mp4' ? new Mp4OutputFormat() : new WebMOutputFormat(),
    target: new BufferTarget(),
  });

  try {
    const vt = await input.getPrimaryVideoTrack();
    const at = await input.getPrimaryAudioTrack();
    const srcW = vt ? await vt.getDisplayWidth() : 0;
    const srcH = vt ? await vt.getDisplayHeight() : 0;

    // 映像
    const video = { discard: false };
    if (copy) {
      // 元コーデックが出力形式で使えるなら codec を省略し、そのまま取り込ませる
      if (!(vt?.codec && CODEC_MATRIX[container].video.includes(vt.codec))) video.codec = v.codec;
      video.forceTranscode = false;
    } else {
      video.codec = v.codec;
      video.forceTranscode = true;
      video.bitrate = v.bitrateMode === 'custom' && v.bitrate > 0
        ? Math.round(v.bitrate)
        : mb[BITRATE_PRESETS[v.preset] ?? 'QUALITY_HIGH'];
      Object.assign(video, resizeOptions(v.resize, srcW, srcH, v.codec));
      if (v.fps > 0) video.frameRate = v.fps;
    }

    // 音声
    let audio;
    if (a.mode === 'mute') audio = { discard: true };
    else if (copy || a.copy) {
      audio = {};
      if (!(at?.codec && CODEC_MATRIX[container].audio.includes(at.codec)) && !a.copy) audio.codec = a.codec;
    } else audio = { codec: a.codec, bitrate: Math.round(a.bitrate) };

    // トリム
    // 主トラックのみ変換する（解析・サイズ推定も主トラック前提のため）
    const opts = { input, output, video, audio, tracks: 'primary' };
    const start = Number(settings.trim?.start) || 0;
    const end = settings.trim?.end;
    if (start > 0 || (end != null && end > 0)) {
      opts.trim = { start };
      if (end != null && end > start) opts.trim.end = end;
    }

    const conversion = await Conversion.init(opts);
    const warnings = [];
    for (const { track, reason } of conversion.discardedTracks ?? []) {
      if (reason === 'discarded_by_user') continue;
      warnings.push(`${trackLabel(track)}トラックを出力に含められませんでした: ${reasonText(reason)}`);
    }
    // 映像が落ちて音声だけになる場合も失敗として扱う（MediaRecorder への切り替え対象にする）
    const videoDropped = vt && !conversion.utilizedTracks?.includes(vt);
    if (!conversion.isValid || videoDropped) {
      const detail = warnings.length ? warnings.join(' / ') : '出力できるトラックがありません';
      throw new Error(`この設定では変換できません。${detail}`);
    }

    conversion.onProgress = (p) => onProgress?.(Math.max(0, Math.min(1, p)));
    const onAbort = () => { conversion.cancel(); };
    signal?.addEventListener('abort', onAbort, { once: true });
    // 準備中（リスナー登録前）に中止された場合も止める
    if (signal?.aborted) throw abortError();
    try {
      await conversion.execute();
    } catch (err) {
      if (err instanceof mb.ConversionCanceledError || signal?.aborted) throw abortError();
      throw err;
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }

    const mime = container === 'mp4' ? 'video/mp4' : 'video/webm';
    const blob = new Blob([output.target.buffer], { type: mime });
    return { blob, mime, ext: container, warnings };
  } finally {
    input.dispose?.();
  }
}
