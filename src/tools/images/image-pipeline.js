// 変換キューの実行。Worker プールが使えれば並列、使えなければメインスレッドで順次処理する。
import { createPool } from '../../lib/worker-pool.js';
import { buildName, dedupeNames, slugify, stripExt } from '../../lib/naming.js';
import { createUrl } from '../../lib/objecturl.js';
import { uid } from '../../lib/dom.js';
import { expandVariants } from './image-settings.js';
import { processJob } from './image-process.js';

const DECODE_ERROR = '画像を読み込めませんでした';
const yieldToUi = () => new Promise((resolve) => setTimeout(resolve));

function documentCanvas(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

/** 設定のファイル名規則で出力ファイル名を作る。 */
function outputFilename(item, variant, settings) {
  const { pattern, lowercase, slugify: doSlug } = settings.naming;
  const base = stripExt(item.name);
  const name = doSlug ? slugify(base) || 'image' : base;
  const filename = buildName(pattern, {
    name,
    w: variant.width,
    h: variant.height,
    ext: variant.ext,
    suffix: variant.suffix,
  });
  return lowercase ? filename.toLowerCase() : filename;
}

/**
 * @param {{store: any, caps: any}} deps
 */
export function createImagePipeline({ store, caps }) {
  let pool = null;
  let workersDisabled = false;
  // caps は非同期に埋まるため、実行時に毎回評価する
  const useWorkers = () => !workersDisabled && !!(caps.moduleWorker && caps.offscreenCanvas);
  let running = false;
  let cancelled = false;
  let controller = null;
  const handles = new Set();

  const poolSize = () => Math.max(1, Math.min(caps.hardwareConcurrency || 2, 4));

  function getPool() {
    if (pool || !useWorkers()) return pool;
    try {
      pool = createPool({ url: new URL('./image-worker.js', import.meta.url), size: poolSize(), type: 'module' });
    } catch {
      workersDisabled = true;
    }
    return pool;
  }

  function safeUpdate(id, patch) {
    if (store.get(id)) store.update(id, patch);
  }

  /** 変換前に寸法を確定する（サムネイル生成が済んでいればそれを使う）。 */
  async function ensureMeta(item) {
    const cur = store.get(item.id) ?? item;
    if (cur.meta?.width && cur.meta?.height) return cur.meta;
    let bitmap;
    try {
      bitmap = await createImageBitmap(cur.file, { imageOrientation: 'from-image' });
    } catch {
      throw new Error(DECODE_ERROR);
    }
    const meta = { ...cur.meta, width: bitmap.width, height: bitmap.height };
    bitmap.close();
    safeUpdate(item.id, { meta });
    return meta;
  }

  function createHandler(item, settings, variants, state) {
    const byId = new Map(variants.map((v) => [v.id, v]));
    return (msg) => {
      if (msg.type === 'meta') {
        safeUpdate(item.id, { meta: { ...(store.get(item.id)?.meta ?? {}), width: msg.width, height: msg.height } });
      } else if (msg.type === 'output') {
        const v = byId.get(msg.variantId);
        if (v) addOutput(item, settings, v, msg);
      } else if (msg.type === 'progress') {
        safeUpdate(item.id, { progress: msg.total ? msg.done / msg.total : 0 });
      } else if (msg.type === 'done') {
        state.done = true;
      } else if (msg.type === 'error') {
        // 中止後に Worker が送る終了通知（error）はエラーとして扱わない
        if (!state.cancelled) state.error = msg.message;
      } else if (msg.type === 'cancelled') {
        state.cancelled = true;
      }
      // メインスレッド実行時は進捗のたびに UI へ処理を譲る
      return state.inline && msg.type === 'progress' ? yieldToUi() : undefined;
    };
  }

  function addOutput(item, settings, v, msg) {
    if (!store.get(item.id)) return;
    store.addOutput(item.id, {
      id: uid('out'),
      label: `${v.format.toUpperCase()} ${msg.width}×${msg.height}`,
      format: v.format,
      width: msg.width,
      height: msg.height,
      blob: msg.blob,
      bytes: msg.bytes ?? msg.blob.size,
      url: createUrl(msg.blob, item.id),
      filename: outputFilename(item, v, settings),
      kind: 'image',
    });
  }

  async function runInline(item, variants, signal, handler) {
    const makeCanvas = caps.offscreenCanvas ? undefined : documentCanvas;
    const job = { file: item.file, variants, caps: { canvasWebp: caps.canvasWebp }, makeCanvas };
    await processJob(job, handler, signal);
  }

  async function runInWorker(item, variants, state, handler) {
    const job = pool.run(
      { file: item.file, variants, caps: { canvasWebp: caps.canvasWebp, offscreenCanvas: true } },
      { onMessage: handler },
    );
    handles.add(job);
    try {
      await job.promise;
    } catch (err) {
      if (!state.error && !cancelled) state.error = err?.message || '変換に失敗しました';
    } finally {
      handles.delete(job);
    }
  }

  async function runItem(item, settings, signal) {
    safeUpdate(item.id, { status: 'processing', progress: 0, error: null });
    const state = { error: null, cancelled: false, done: false, inline: false };
    try {
      const meta = await ensureMeta(item);
      const variants = expandVariants(settings, meta);
      const handler = createHandler(item, settings, variants, state);
      if (getPool()) await runInWorker(item, variants, state, handler);
      else {
        state.inline = true;
        await runInline(item, variants, signal, handler);
      }
    } catch (err) {
      state.error = state.error || err?.message || DECODE_ERROR;
    }
    finishItem(item, state);
  }

  function finishItem(item, state) {
    if (state.error) safeUpdate(item.id, { status: 'error', error: state.error });
    else if (state.done) safeUpdate(item.id, { status: 'done', progress: 1 });
    else safeUpdate(item.id, { status: 'cancelled' });
  }

  /** 今回の出力名を、前回までに変換済みの出力名とも重ならないようにする（既存の名前を優先する）。 */
  function dedupeBatch(items) {
    const batchIds = new Set(items.map((it) => it.id));
    const rows = [];
    for (const item of store.items()) {
      if (batchIds.has(item.id)) continue;
      for (const o of item.outputs ?? []) if (o.kind === 'image') rows.push({ o, fixed: true });
    }
    for (const item of items) {
      for (const o of store.get(item.id)?.outputs ?? []) if (o.kind === 'image') rows.push({ o, fixed: false });
    }
    const names = dedupeNames(rows.map((r) => r.o.filename));
    const renamed = new Map();
    rows.forEach((r, i) => {
      if (!r.fixed && names[i] !== r.o.filename) renamed.set(r.o.id, names[i]);
    });
    if (!renamed.size) return;
    for (const item of items) {
      const outputs = store.get(item.id)?.outputs;
      if (outputs?.some((o) => renamed.has(o.id))) {
        safeUpdate(item.id, { outputs: outputs.map((o) => (renamed.has(o.id) ? { ...o, filename: renamed.get(o.id) } : o)) });
      }
    }
  }

  async function lane(items, settings, signal, cursor) {
    while (!cancelled) {
      const i = cursor.next;
      cursor.next += 1;
      if (i >= items.length) return;
      await runItem(items[i], settings, signal);
    }
  }

  async function run(items, settings) {
    if (running || !items.length) return;
    running = true;
    cancelled = false;
    controller = new AbortController();
    store.resetForRerun(items.map((it) => it.id));
    const cursor = { next: 0 };
    const lanes = useWorkers() && getPool() ? poolSize() : 1;
    try {
      await Promise.all(
        Array.from({ length: Math.min(lanes, items.length) }, () => lane(items, settings, controller.signal, cursor)),
      );
      for (const item of items.slice(cursor.next)) {
        if (cancelled) safeUpdate(item.id, { status: 'cancelled' });
      }
      dedupeBatch(items);
    } finally {
      running = false;
      handles.clear();
    }
  }

  function cancel() {
    if (!running) return;
    cancelled = true;
    controller?.abort();
    for (const job of handles) job.cancel();
  }

  return { run, cancel, isRunning: () => running };
}
