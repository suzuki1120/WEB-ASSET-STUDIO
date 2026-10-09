// 動画ツールの設定（既定値・コーデック表・永続化・環境に合わせた補正）。

const STORAGE_KEY = 'was.settings.video';

export const DEFAULTS = {
  container: 'webm',
  video: {
    codec: 'vp9',
    mode: 'transcode', // 'transcode' | 'copy'
    resize: { mode: 'none', width: null, height: null, scale: 100, fit: 'contain' },
    fps: null,
    bitrateMode: 'preset', // 'preset' | 'custom'
    preset: 'high',
    bitrate: 4000000,
  },
  audio: { mode: 'keep', codec: 'auto', bitrate: 128000 },
  poster: { enabled: false, time: 0, format: 'jpeg', quality: 85, width: null },
};

export const CODEC_MATRIX = {
  webm: { video: ['vp9', 'vp8', 'av1'], audio: ['opus'] },
  mp4: { video: ['avc', 'hevc', 'av1'], audio: ['aac', 'opus'] },
};

/** プリセット名 → mediabunny の QUALITY_* 定数名 */
export const BITRATE_PRESETS = {
  low: 'QUALITY_LOW',
  medium: 'QUALITY_MEDIUM',
  high: 'QUALITY_HIGH',
  very_high: 'QUALITY_VERY_HIGH',
};

export const VIDEO_CODEC_LABELS = { vp9: 'VP9', vp8: 'VP8', av1: 'AV1', avc: 'H.264 (AVC)', hevc: 'H.265 (HEVC)' };
export const AUDIO_CODEC_LABELS = { opus: 'Opus', aac: 'AAC' };

const clone = (v) => JSON.parse(JSON.stringify(v));
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function deepMerge(base, extra) {
  if (!isObj(extra)) return base;
  for (const [key, val] of Object.entries(extra)) {
    if (!(key in base)) continue;
    const def = base[key];
    if (isObj(def)) {
      if (isObj(val)) deepMerge(def, val);
    } else if (def === null || typeof def === typeof val) {
      base[key] = val;
    }
  }
  return base;
}

export function loadSettings() {
  const settings = clone(DEFAULTS);
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) deepMerge(settings, JSON.parse(raw));
  } catch { /* 破損・利用不可は既定値のまま */ }
  if (!CODEC_MATRIX[settings.container]) settings.container = DEFAULTS.container;
  return settings;
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch { /* 保存不可は無視 */ }
}

/** WebCodecs のエンコーダ可否を判定できる環境か。できない場合は可否を絞り込まない。 */
function hasEncoderInfo(caps) {
  return Boolean(caps && caps.ready && caps.webcodecs && !caps.mediabunnyError && caps.videoEncoders);
}

export function isVideoEncodable(codec, caps) {
  return !hasEncoderInfo(caps) || Boolean(caps.videoEncoders[codec]);
}

export function isAudioEncodable(codec, caps) {
  return !hasEncoderInfo(caps) || Boolean(caps.audioEncoders?.[codec]);
}

/** コンテナ内で最初にエンコード可能な映像コーデック（なければ null）。 */
export function firstEncodableVideoCodec(container, caps) {
  return CODEC_MATRIX[container].video.find((c) => isVideoEncodable(c, caps)) ?? null;
}

/** 音声コーデック 'auto' の解決先。 */
export function defaultAudioCodec(container, caps) {
  if (container === 'webm') return 'opus';
  return isAudioEncodable('aac', caps) ? 'aac' : 'opus';
}

/**
 * リサイズ設定から出力サイズを求める（偶数に丸める）。MediaRecorder 経路と出力表示で使う。
 * @returns {{width:number, height:number}}
 */
export function resolveTargetSize(resize, srcW, srcH) {
  const even = (n) => Math.max(2, Math.round(n / 2) * 2);
  if (!srcW || !srcH) return { width: Number(resize?.width) || 0, height: Number(resize?.height) || 0 };
  const r = resize ?? { mode: 'none' };
  const ratio = srcW / srcH;
  if (r.mode === 'width' && r.width > 0) return { width: even(r.width), height: even(r.width / ratio) };
  if (r.mode === 'height' && r.height > 0) return { width: even(r.height * ratio), height: even(r.height) };
  if (r.mode === 'scale' && r.scale > 0) return { width: even((srcW * r.scale) / 100), height: even((srcH * r.scale) / 100) };
  if (r.mode === 'box' && r.width > 0 && r.height > 0) return { width: even(r.width), height: even(r.height) };
  return { width: even(srcW), height: even(srcH) };
}

/**
 * 実行環境に合わせて設定を補正する。元の設定は変更しない。
 * @returns {{settings: object, warnings: string[]}}
 */
export function constrainVideoSettings(settings, caps) {
  const s = clone(settings);
  const warnings = [];
  const matrix = CODEC_MATRIX[s.container] ?? CODEC_MATRIX.webm;
  if (!CODEC_MATRIX[s.container]) s.container = 'webm';

  if (!matrix.video.includes(s.video.codec)) {
    const next = firstEncodableVideoCodec(s.container, caps) ?? matrix.video[0];
    warnings.push(`${s.container.toUpperCase()} では ${s.video.codec} を使えないため ${next} に切り替えました`);
    s.video.codec = next;
  } else if (!isVideoEncodable(s.video.codec, caps)) {
    const next = firstEncodableVideoCodec(s.container, caps);
    if (next) {
      warnings.push(`この環境では ${s.video.codec} のエンコードに未対応のため ${next} に切り替えました`);
      s.video.codec = next;
    } else {
      warnings.push(`この環境では ${s.container.toUpperCase()} 向けの映像エンコードに対応していません`);
    }
  }

  if (s.audio.mode === 'keep') {
    if (s.audio.codec === 'auto' || !matrix.audio.includes(s.audio.codec)) s.audio.codec = defaultAudioCodec(s.container, caps);
    if (!isAudioEncodable(s.audio.codec, caps)) {
      const alt = matrix.audio.find((c) => isAudioEncodable(c, caps));
      if (alt) {
        warnings.push(`この環境では ${s.audio.codec} に未対応のため音声を ${alt} にします`);
        s.audio.codec = alt;
      } else {
        warnings.push('音声をエンコードできないため、元の音声をそのまま取り込みます（形式が合わない場合は音声なしになります）');
        s.audio.copy = true;
      }
    }
  }
  return { settings: s, warnings };
}
