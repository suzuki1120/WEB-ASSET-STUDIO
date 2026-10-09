import { loadMediabunny } from './lib/vendor.js';

const VIDEO_CODECS = ['avc', 'hevc', 'vp9', 'vp8', 'av1'];
const AUDIO_CODECS = ['aac', 'opus'];
const MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4',
];

/** 機能検出の結果。probeCapabilities() が埋める（同じオブジェクトを更新する）。 */
export const caps = {
  ready: false,
  offscreenCanvas: false,
  moduleWorker: false,
  canvasWebp: false,
  webcodecs: false,
  videoEncoders: Object.fromEntries(VIDEO_CODECS.map((c) => [c, false])),
  audioEncoders: Object.fromEntries(AUDIO_CODECS.map((c) => [c, false])),
  mediaRecorderMimes: [],
  fsAccess: false,
  hardwareConcurrency: 2,
  mediabunnyError: null,
};

function testModuleWorker() {
  try {
    const url = URL.createObjectURL(new Blob([''], { type: 'text/javascript' }));
    try {
      const w = new Worker(url, { type: 'module' });
      w.terminate();
      return true;
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    return false;
  }
}

async function testCanvasWebp() {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp'));
    return blob?.type === 'image/webp';
  } catch {
    return false;
  }
}

async function probeMediabunny() {
  try {
    const mb = await loadMediabunny();
    const video = { width: 1280, height: 720, bitrate: 2e6 };
    const audio = { numberOfChannels: 2, sampleRate: 48000, bitrate: 128e3 };
    const check = (fn) => Promise.resolve().then(fn).catch(() => false);
    const [v, a] = await Promise.all([
      Promise.all(VIDEO_CODECS.map((c) => check(() => mb.canEncodeVideo(c, video)))),
      Promise.all(AUDIO_CODECS.map((c) => check(() => mb.canEncodeAudio(c, audio)))),
    ]);
    VIDEO_CODECS.forEach((c, i) => { caps.videoEncoders[c] = Boolean(v[i]); });
    AUDIO_CODECS.forEach((c, i) => { caps.audioEncoders[c] = Boolean(a[i]); });
  } catch (err) {
    caps.mediabunnyError = err?.message ?? String(err);
  }
}

let probing = null;

/** 各機能の対応状況を並列に調べ、caps を埋める。mediabunny の読み込みに失敗しても他の項目は埋まる。 */
export function probeCapabilities() {
  probing ??= (async () => {
    caps.offscreenCanvas = typeof OffscreenCanvas !== 'undefined';
    caps.webcodecs = 'VideoEncoder' in window && 'VideoDecoder' in window;
    caps.fsAccess = 'showDirectoryPicker' in window;
    caps.hardwareConcurrency = navigator.hardwareConcurrency || 2;
    caps.mediaRecorderMimes = typeof MediaRecorder === 'undefined'
      ? []
      : MIME_CANDIDATES.filter((m) => MediaRecorder.isTypeSupported(m));
    const [moduleWorker, canvasWebp] = await Promise.all([
      Promise.resolve(testModuleWorker()),
      testCanvasWebp(),
      probeMediabunny(),
    ]);
    caps.moduleWorker = moduleWorker;
    caps.canvasWebp = canvasWebp;
    caps.ready = true;
    return caps;
  })();
  return probing;
}
