// 動画キューの逐次変換パイプライン。
import { createUrl } from '../../lib/objecturl.js';
import { stripExt } from '../../lib/naming.js';
import { toast } from '../../ui/components.js';
import { constrainVideoSettings, resolveTargetSize } from './video-settings.js';
import { extractPoster } from './poster.js';
import * as mediabunnyEngine from './engines/mediabunny-engine.js';
import * as mediarecorderEngine from './engines/mediarecorder-engine.js';

const UNSUPPORTED_RE = /codec|encod|unsupported|support|未対応|エンコード|コーデック|WebCodecs/i;
const isAbort = (err) => err?.name === 'AbortError';

export function createVideoPipeline({ store, caps }) {
  let controller = null;
  let running = false;
  let engineName = null;

  const preferred = () => (caps.webcodecs && !caps.mediabunnyError ? 'mediabunny' : 'mediarecorder');
  const engines = { mediabunny: mediabunnyEngine, mediarecorder: mediarecorderEngine };

  async function convertItem(item, settings, signal) {
    const onProgress = (p) => store.update(item.id, { progress: p });
    const run = (name) => {
      engineName = name;
      return engines[name].convert(item.file, settings, { onProgress, signal, caps });
    };
    const first = preferred();
    try {
      return await run(first);
    } catch (err) {
      if (isAbort(err) || first !== 'mediabunny' || !UNSUPPORTED_RE.test(err?.message ?? '')) throw err;
      console.warn('[video] mediabunny で変換できず MediaRecorder に切り替えます', err);
      toast('WebCodecs で変換できなかったため、リアルタイム変換に切り替えます', { tone: 'warning' });
      store.update(item.id, { progress: 0 });
      return run('mediarecorder');
    }
  }

  async function run(items, rawSettings) {
    if (running) return { done: 0, errors: 0, cancelled: false };
    running = true;
    controller = new AbortController();
    const { signal } = controller;
    const { settings, warnings } = constrainVideoSettings(rawSettings, caps);
    for (const w of warnings) toast(w, { tone: 'warning', duration: 5000 });
    const seen = new Set();
    const result = { done: 0, errors: 0, cancelled: false };
    try {
      for (const item of items) {
        if (signal.aborted) {
          result.cancelled = true;
          break;
        }
        const thumbUrl = item.thumbUrl; // resetForRerun が thumbUrl を消すため退避する
        store.resetForRerun([item.id]);
        store.update(item.id, { status: 'processing', progress: 0, error: null, stale: false, thumbUrl });
        try {
          const meta = item.meta ?? {};
          const { blob, ext, warnings: engineWarnings } = await convertItem(item, settings, signal);
          for (const w of engineWarnings ?? []) {
            if (!seen.has(w)) { seen.add(w); toast(w, { tone: 'warning', duration: 5000 }); }
          }
          const copy = settings.video.mode === 'copy';
          const size = copy
            ? { width: meta.width || 0, height: meta.height || 0 }
            : resolveTargetSize(settings.video.resize, meta.width, meta.height);
          store.addOutput(item.id, {
            kind: 'video',
            label: `${settings.container.toUpperCase()} ${copy ? '元コーデック' : settings.video.codec}`,
            format: settings.container,
            width: size.width,
            height: size.height,
            blob,
            bytes: blob.size,
            url: createUrl(blob, item.id),
            filename: `${stripExt(item.name)}.${ext}`,
          });

          if (settings.poster.enabled) {
            try {
              const p = settings.poster;
              const poster = await extractPoster(item.file, { time: p.time, width: p.width, format: p.format, quality: p.quality, caps });
              store.addOutput(item.id, {
                kind: 'poster',
                label: 'ポスター',
                format: p.format,
                width: poster.width,
                height: poster.height,
                blob: poster.blob,
                bytes: poster.blob.size,
                url: createUrl(poster.blob, item.id),
                filename: `${stripExt(item.name)}-poster.${poster.ext}`,
              });
            } catch (err) {
              toast(`ポスター画像を作れませんでした（${item.name}）: ${err.message}`, { tone: 'warning' });
            }
          }
          store.update(item.id, { status: 'done', progress: 1 });
          result.done += 1;
        } catch (err) {
          if (isAbort(err)) {
            store.update(item.id, { status: 'cancelled', progress: 0 });
            result.cancelled = true;
            break;
          }
          console.error('[video] 変換エラー', err);
          store.update(item.id, { status: 'error', error: err?.message ?? String(err) });
          toast(`${item.name}: ${err?.message ?? '変換に失敗しました'}`, { tone: 'danger', duration: 6000 });
          result.errors += 1;
        }
      }
    } finally {
      running = false;
      controller = null;
    }
    return result;
  }

  return {
    run,
    cancel() { controller?.abort(); },
    isRunning: () => running,
    currentEngine: () => engineName ?? preferred(),
  };
}
