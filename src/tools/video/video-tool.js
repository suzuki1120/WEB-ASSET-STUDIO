// 動画変換ツール（UI）。
import { h, clear, uid } from '../../lib/dom.js';
import { createUrl, revokeOwner } from '../../lib/objecturl.js';
import { formatBytes, formatDuration, formatPct, formatDims } from '../../lib/format.js';
import { dedupeNames } from '../../lib/naming.js';
import { downloadBlob, downloadZip, canSaveToDirectory, saveToDirectory } from '../../lib/download.js';
import { copyText } from '../../lib/clipboard.js';
import { createStore } from '../../store.js';
import { probeCapabilities } from '../../capabilities.js';
import {
  button, field, numberInput, rangeField, switchField, select, segmented, toast, confirmDialog, askSaveConflict, section, notice, setSectionSummary,
} from '../../ui/components.js';
import { createDropzone } from '../../ui/dropzone.js';
import { createFileGrid } from '../../ui/filegrid.js';
import { createActionBar } from '../../ui/actionbar.js';
import {
  CODEC_MATRIX, VIDEO_CODEC_LABELS, AUDIO_CODEC_LABELS, loadSettings, saveSettings,
  isVideoEncodable, isAudioEncodable, firstEncodableVideoCodec,
} from './video-settings.js';
import { probeVideo, makeThumbnail } from './probe.js';
import { createVideoPipeline } from './video-pipeline.js';
import { createSamplePreview } from './video-preview.js';

const ASSET_PREFIX = '/assets/video/';
const numOrNull = (input) => {
  if (input.value === '') return null;
  const n = Number(input.value);
  return Number.isFinite(n) ? n : null;
};
const round2 = (n) => Math.round(n * 100) / 100;
/** トリムは動画ごとに持つ（item.trim）。未設定なら全体。 */
const NO_TRIM = Object.freeze({ start: 0, end: null });
const trimOf = (item) => item?.trim ?? NO_TRIM;
/** 変換が必要な item（未変換・エラー・中止・設定変更済み）。 */
const needsRun = (item) => item.status !== 'processing' && (item.status !== 'done' || item.stale);
const attrEscape = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function createTool(ctx) {
  const caps = ctx.caps;
  const store = ctx.store ?? createStore('video');
  const settings = loadSettings();
  delete settings.trim; // 旧バージョンで保存された共通トリムは使わない
  const pipeline = createVideoPipeline({ store, caps });

  // プレビュー・サムネイルの URL は item.id と別の所有者で管理する（再変換の resetForRerun で解放されないように）
  const mediaOwner = (id) => `media-${id}`;
  const previewUrls = new Map(); // itemId -> object URL
  const mediaIds = new Set();
  function releaseMissingMedia() {
    for (const id of [...mediaIds]) {
      if (store.get(id)) continue;
      revokeOwner(mediaOwner(id));
      previewUrls.delete(id);
      mediaIds.delete(id);
    }
  }
  let previewId = null;
  let active = false;

  /* ---------- ヘルパー ---------- */
  function fld(label, control, { input, hint } = {}) {
    const el = field({ label, hint, control });
    if (input) {
      if (!input.id) input.id = uid('vid');
      el.querySelector('label')?.setAttribute('for', input.id);
    }
    return el;
  }
  const numField = (label, opts, onValue, hint) => {
    const ni = numberInput({ ...opts, onInput: () => onValue(numOrNull(ni.input)) });
    return { ni, el: fld(label, ni.el, { input: ni.input, hint }) };
  };

  function changed() {
    saveSettings(settings);
    store.markStale();
    sample.markStale();
    updateDerived();
    updateCounts();
    document.dispatchEvent(new CustomEvent('was:settings-change'));
  }

  /* ---------- メイン: ドロップゾーン・プレビュー ---------- */
  const queue = (() => {
    let chain = Promise.resolve();
    return (fn) => { chain = chain.then(fn, fn); return chain; };
  })();

  async function analyze(item) {
    try {
      const meta = await probeVideo(item.file);
      store.update(item.id, { meta });
    } catch (err) {
      toast(`${item.name}: ${err.message}`, { tone: 'danger' });
      return;
    }
    try {
      const blob = await makeThumbnail(item.file, { width: 160 });
      if (store.get(item.id)) {
        mediaIds.add(item.id);
        store.update(item.id, { thumbUrl: createUrl(blob, mediaOwner(item.id)) });
      }
    } catch { /* サムネイルなしで続行 */ }
  }

  const dropzone = createDropzone({
    accept: 'video/*,.mp4,.mov,.webm,.m4v',
    multiple: true,
    label: '動画をドロップ、またはクリックして選択',
    sublabel: 'MP4 / MOV / WebM / M4V（ファイルはブラウザ内だけで処理され、外部へ送信されません）',
    onFiles(files) {
      const added = store.add(files);
      if (!added.length) {
        toast('すでに追加済みのファイルです', { tone: 'warning' });
        return;
      }
      for (const item of added) queue(() => analyze(item));
    },
  });

  const engineBox = h('div', { class: 'video-engine-notice' });
  function refreshEngineNotice() {
    clear(engineBox);
    const fast = caps.webcodecs && !caps.mediabunnyError;
    engineBox.appendChild(
      fast
        ? notice('WebCodecsで高速変換', 'info')
        : notice('この環境では WebCodecs を使えないため、リアルタイム変換（MediaRecorder）で処理します。再生時間と同じ時間がかかります', 'warning'),
    );
  }

  // プレビュー
  const previewVideo = h('video', {
    controls: true,
    playsinline: true,
    preload: 'metadata',
    onLoadedmetadata: () => updateTrimBar(),
  });
  const itemSelect = select({ options: [], value: '', onChange: () => { previewId = itemSelect.input.value; updatePreview(); } });
  const itemSelectField = fld('プレビュー対象', itemSelect.el, { input: itemSelect.input });

  const trimFill = h('div', {
    style: { position: 'absolute', top: 0, bottom: 0, left: '0%', width: '100%', background: 'var(--accent)' },
  });
  const trimBar = h('div', {
    role: 'img',
    'aria-label': 'トリム範囲',
    style: { position: 'relative', height: '6px', background: 'var(--bg-3)', borderRadius: 'var(--radius-s)', overflow: 'hidden' },
  }, trimFill);
  const trimText = h('span', { style: { fontSize: 'var(--text-xs)', color: 'var(--fg-2)' } });

  /** プレビュー中の動画のトリムを変更する。変換済みならその動画だけ「設定変更あり」にする。 */
  function setTrim(patch) {
    const item = store.get(previewId);
    if (!item) return;
    const trim = { ...trimOf(item), ...patch };
    store.update(item.id, { trim, stale: item.stale || item.status === 'done' });
    sample.markStale();
    updateTrimBar();
    updateCounts();
  }
  const trimStart = numField('開始位置', { value: 0, min: 0, step: 0.1, unit: '秒' }, (v) => setTrim({ start: v ?? 0 }), 'プレビュー中の動画だけに適用');
  const trimEnd = numField('終了位置', { value: '', min: 0, step: 0.1, unit: '秒', placeholder: '末尾まで' }, (v) => setTrim({ end: v }), '空欄で末尾まで');
  function syncTrimInputs(item) {
    const t = trimOf(item);
    trimStart.ni.input.value = t.start || 0;
    trimEnd.ni.input.value = t.end ?? '';
  }
  const setFromPlayhead = (which) => {
    const t = round2(previewVideo.currentTime || 0);
    if (which === 'start') {
      trimStart.ni.input.value = t;
      setTrim({ start: t });
    } else {
      trimEnd.ni.input.value = t;
      setTrim({ end: t });
    }
  };

  const sample = createSamplePreview({
    caps,
    getItem: () => store.get(previewId),
    getSettings: () => ({ ...settings, trim: trimOf(store.get(previewId)) }),
    getPlayhead: () => previewVideo.currentTime || 0,
    getDuration: () => (Number.isFinite(previewVideo.duration) ? previewVideo.duration : 0),
  });

  const previewBlock = h('div', { class: 'video-block card', style: { display: 'none', padding: 'var(--space-4)' } },
    itemSelectField,
    h('div', { class: 'video-preview' }, previewVideo),
    h('div', { style: { display: 'grid', gap: 'var(--space-3)', marginTop: 'var(--space-3)' } },
      h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)', alignItems: 'flex-end' } },
        trimStart.el,
        button({ label: '現在位置をセット', variant: 'secondary', size: 'sm', onClick: () => setFromPlayhead('start') }),
        trimEnd.el,
        button({ label: '現在位置をセット', variant: 'secondary', size: 'sm', onClick: () => setFromPlayhead('end') }),
      ),
      trimBar,
      trimText,
    ),
    sample.el,
  );

  function previewDuration() {
    const item = store.get(previewId);
    return item?.meta?.duration || (Number.isFinite(previewVideo.duration) ? previewVideo.duration : 0);
  }

  function updateTrimBar() {
    const dur = previewDuration();
    const trim = trimOf(store.get(previewId));
    const start = Math.max(0, trim.start || 0);
    const end = trim.end != null && trim.end > start ? trim.end : dur;
    if (dur > 0) {
      const l = Math.min(100, (start / dur) * 100);
      const w = Math.max(0.5, Math.min(100 - l, ((Math.min(end, dur) - start) / dur) * 100));
      trimFill.style.left = `${l}%`;
      trimFill.style.width = `${w}%`;
      trimText.textContent = `${formatDuration(start)} から ${formatDuration(Math.min(end, dur))}（${round2(Math.max(0, Math.min(end, dur) - start))} 秒 / 全体 ${formatDuration(dur)}）`;
    } else {
      trimFill.style.left = '0%';
      trimFill.style.width = '100%';
      trimText.textContent = '動画の長さを取得中です';
    }
  }

  function updatePreview() {
    const items = store.items();
    if (!items.some((i) => i.id === previewId)) previewId = items[0]?.id ?? null;
    const item = store.get(previewId);
    if (!item) {
      sample.reset();
      previewBlock.style.display = 'none';
      if (previewVideo.dataset.itemId) {
        previewVideo.removeAttribute('src');
        previewVideo.load();
        delete previewVideo.dataset.itemId;
      }
      return;
    }
    previewBlock.style.display = '';
    itemSelectField.style.display = items.length > 1 ? '' : 'none';
    itemSelect.setOptions(items.map((i) => ({ value: i.id, label: i.name })));
    itemSelect.input.value = item.id;
    if (previewVideo.dataset.itemId !== item.id) {
      sample.reset();
      syncTrimInputs(item);
      if (!previewUrls.has(item.id)) {
        mediaIds.add(item.id);
        previewUrls.set(item.id, createUrl(item.file, mediaOwner(item.id)));
      }
      previewVideo.src = previewUrls.get(item.id);
      previewVideo.dataset.itemId = item.id;
    }
    updateTrimBar();
  }

  /* ---------- ファイルグリッド ---------- */
  function copySnippet(item) {
    const v = item.outputs.find((o) => o.kind === 'video');
    if (!v) return;
    const p = item.outputs.find((o) => o.kind === 'poster');
    // encodeURI は # や ? を残すため、ファイル名部分は encodeURIComponent で変換する
    const attrs = [`src="${attrEscape(ASSET_PREFIX + encodeURIComponent(v.filename))}"`];
    if (p) attrs.push(`poster="${attrEscape(ASSET_PREFIX + encodeURIComponent(p.filename))}"`);
    copyText(`<video ${attrs.join(' ')} autoplay muted loop playsinline></video>`, { successMessage: '<video> タグをコピーしました' });
  }

  const grid = createFileGrid(store, {
    renderMeta(item) {
      const m = item.meta ?? {};
      const parts = [formatBytes(item.size)];
      if (m.duration) parts.push(formatDuration(m.duration));
      if (m.width && m.height) parts.push(formatDims(m.width, m.height));
      if (m.fps) parts.push(`${round2(m.fps)}fps`);
      if (m.vcodec) parts.push(m.vcodec);
      return parts.join(' · ');
    },
    renderOutputs(item) {
      if (!item.outputs.length) return null;
      const small = { fontSize: 'var(--text-xs)', color: 'var(--fg-1)' };
      const rows = item.outputs.map((o) => h('div', {
        class: 'output-row',
        style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-3)' },
      },
      h('span', { style: { fontWeight: 600, minWidth: '88px' } }, o.label),
      h('span', { style: small }, o.width && o.height ? formatDims(o.width, o.height) : '-'),
      h('span', { style: small }, formatBytes(o.bytes)),
      h('span', { style: small }, o.kind === 'video' && item.size ? formatPct(o.bytes / item.size) : ''),
      button({ label: 'ダウンロード', icon: 'download', variant: 'secondary', size: 'sm', onClick: () => downloadBlob(o.blob, o.filename) }),
      ));
      const hasVideo = item.outputs.some((o) => o.kind === 'video');
      return h('div', { class: 'output-list', style: { display: 'grid', gap: 'var(--space-2)' } },
        rows,
        hasVideo && item.status === 'done'
          ? button({ label: '<video> タグをコピー', icon: 'copy', variant: 'ghost', size: 'sm', onClick: () => copySnippet(item) })
          : null,
      );
    },
    onRemove(item) { store.remove(item.id); },
    onRerun(item) { runItems([item]); },
  });

  /* ---------- アクションバー ---------- */
  function outputEntries() {
    const items = store.selected().filter((i) => i.outputs.length);
    const outs = items.flatMap((i) => i.outputs);
    const names = dedupeNames(outs.map((o) => o.filename));
    return outs.map((o, i) => ({ name: names[i], blob: o.blob }));
  }

  async function runItems(items) {
    if (pipeline.isRunning()) return;
    if (!items.length) {
      toast('変換する動画を選択してください', { tone: 'warning' });
      return;
    }
    for (const item of items) {
      const t = trimOf(item);
      if (t.end != null && t.end <= (t.start || 0)) {
        toast(`${item.name}: トリムの終了位置は開始位置より後にしてください`, { tone: 'danger' });
        return;
      }
      const dur = item.meta?.duration;
      if (dur > 0 && (t.start || 0) >= dur) {
        toast(`${item.name}: トリムの開始位置が動画の長さ（${formatDuration(dur)}）を超えています`, { tone: 'danger' });
        return;
      }
    }
    runIds = items.map((i) => i.id);
    actionbar.setRunning(true);
    updateCounts();
    try {
      const r = await pipeline.run(items, settings);
      if (r.cancelled) toast('変換を中止しました');
      else if (r.done) toast(`${r.done} 件の変換が完了しました`, { tone: 'success' });
    } finally {
      runIds = [];
      actionbar.setRunning(false);
      updateCounts();
    }
  }

  let runIds = [];
  // 未変換・設定変更済みのものだけ変換する。すべて変換済みなら選択分をすべて変換し直す
  const runSelected = () => {
    const sel = store.selected().filter((i) => i.status !== 'processing');
    const pending = sel.filter(needsRun);
    return runItems(pending.length ? pending : sel);
  };

  const actionbar = createActionBar({
    primaryLabel: '変換を開始',
    onPrimary: runSelected,
    onRerunAll: () => runItems(store.selected().filter((i) => i.status !== 'processing')),
    onCancel: () => pipeline.cancel(),
    onZip: () => {
      const entries = outputEntries();
      if (!entries.length) return toast('ダウンロードできる変換結果がありません', { tone: 'warning' });
      return downloadZip(entries, 'videos.zip').catch((err) => {
        toast(`ZIPを作成できませんでした: ${err?.message ?? err}`, { tone: 'danger' });
      });
    },
    onSaveDir: canSaveToDirectory() ? async () => {
      const entries = outputEntries();
      if (!entries.length) return toast('保存できる変換結果がありません', { tone: 'warning' });
      try {
        const n = await saveToDirectory(entries, { onConflict: askSaveConflict });
        if (n) toast(`${n} 件を保存しました`, { tone: 'success' });
      } catch (err) {
        if (err?.name !== 'AbortError') toast(`保存に失敗しました: ${err.message}`, { tone: 'danger' });
      }
    } : undefined,
    onClear: async () => {
      if (!store.items().length) return;
      if (pipeline.isRunning()) pipeline.cancel();
      const ok = await confirmDialog({ title: 'リストを空にしますか', message: '追加した動画と変換結果をすべて破棄します。', confirmLabel: '空にする', danger: true });
      if (ok) store.clear();
    },
    onSelectAll: (checked) => store.selectAll(Boolean(checked)),
  });

  function countSummary(selected, pending) {
    if (pipeline.isRunning() && runIds.length) {
      const finished = runIds.filter((id) => ['done', 'error', 'cancelled'].includes(store.get(id)?.status)).length;
      return `変換中 ${finished}/${runIds.length}件`;
    }
    if (pending.length) return `${pending.length}件を変換予定（${outputSummary()}）`;
    const outs = selected.flatMap((i) => i.outputs);
    if (!outs.length) return selected.length ? '' : '変換する動画を選んでください';
    const inBytes = selected.filter((i) => i.outputs.length).reduce((n, i) => n + (i.size || 0), 0);
    const outBytes = outs.filter((o) => o.kind === 'video').reduce((n, o) => n + (o.bytes || 0), 0);
    return `${outs.length}出力 · ${formatBytes(inBytes)} → ${formatBytes(outBytes)} (${formatPct(outBytes / inBytes)})`;
  }

  function updateCounts() {
    const items = store.items();
    const selected = items.filter((i) => i.selected);
    const pending = selected.filter(needsRun);
    actionbar.setCounts({
      selected: selected.length,
      total: items.length,
      outputs: items.reduce((n, i) => n + i.outputs.length, 0),
      pending: pending.length,
    });
    actionbar.setZipEnabled(selected.some((i) => i.outputs.length));
    actionbar.setSummary(countSummary(selected, pending));
    dropzone.setCompact(items.length > 0);
  }

  store.subscribe((ev) => {
    if (ev.type === 'remove' || ev.type === 'clear') releaseMissingMedia();
    if (ev.type === 'add' || ev.type === 'remove' || ev.type === 'clear') updatePreview();
    else if (ev.type === 'update' && ev.id === previewId) updateTrimBar();
    updateCounts();
  });

  const main = h('div', { class: 'tool-main video-tool', style: { display: 'grid', gap: 'var(--space-4)', alignContent: 'start' } },
    dropzone.el, engineBox, previewBlock, grid.el, actionbar.el);

  /* ---------- 右パネル（設定） ---------- */
  const matrixOf = () => CODEC_MATRIX[settings.container];

  const containerSeg = segmented({
    options: [{ value: 'webm', label: 'WebM' }, { value: 'mp4', label: 'MP4' }],
    value: settings.container,
    onChange: (val) => {
      settings.container = val;
      if (!matrixOf().video.includes(settings.video.codec)) {
        settings.video.codec = firstEncodableVideoCodec(val, caps) ?? matrixOf().video[0];
      }
      if (settings.audio.codec !== 'auto' && !matrixOf().audio.includes(settings.audio.codec)) settings.audio.codec = 'auto';
      refreshCodecOptions();
      changed();
    },
  });
  const codecSel = select({
    options: [],
    value: settings.video.codec,
    onChange: () => { settings.video.codec = codecSel.input.value; changed(); },
  });
  const audioCodecSel = select({
    options: [],
    value: settings.audio.codec,
    onChange: () => { settings.audio.codec = audioCodecSel.input.value; changed(); },
  });
  const modeSeg = segmented({
    options: [{ value: 'transcode', label: '再エンコード' }, { value: 'copy', label: 'コピー（高速）' }],
    value: settings.video.mode,
    onChange: (val) => { settings.video.mode = val; changed(); },
  });
  const codecField = fld('映像コーデック', codecSel.el, { input: codecSel.input });
  const copyHint = notice('コピーでは再エンコードせず、形式が合わない場合のみ変換します。解像度・FPS・ビットレートの設定は無視されます。', 'info');

  function refreshCodecOptions() {
    codecSel.setOptions(matrixOf().video.map((c) => {
      const ok = isVideoEncodable(c, caps);
      return { value: c, label: VIDEO_CODEC_LABELS[c] ?? c, disabled: !ok, hint: ok ? undefined : '未対応' };
    }));
    codecSel.input.value = settings.video.codec;
    audioCodecSel.setOptions([
      { value: 'auto', label: '自動' },
      ...matrixOf().audio.map((c) => {
        const ok = isAudioEncodable(c, caps);
        return { value: c, label: AUDIO_CODEC_LABELS[c] ?? c, disabled: !ok, hint: ok ? undefined : '未対応' };
      }),
    ]);
    audioCodecSel.input.value = settings.audio.codec;
  }

  // 解像度
  const r = settings.video.resize;
  const resizeSeg = segmented({
    options: [
      { value: 'none', label: '元のまま' }, { value: 'width', label: '幅' }, { value: 'height', label: '高さ' },
      { value: 'scale', label: '倍率' }, { value: 'box', label: '枠' },
    ],
    value: r.mode,
    onChange: (val) => { r.mode = val; changed(); },
  });
  const wField = numField('幅', { value: r.width ?? '', min: 2, step: 2, unit: 'px', placeholder: '1280' }, (v) => { r.width = v; changed(); });
  const hField = numField('高さ', { value: r.height ?? '', min: 2, step: 2, unit: 'px', placeholder: '720' }, (v) => { r.height = v; changed(); });
  const sField = numField('倍率', { value: r.scale, min: 1, max: 400, step: 1, unit: '%' }, (v) => { r.scale = v ?? 100; changed(); });
  const fitSel = select({
    options: [{ value: 'contain', label: '収める（余白あり）' }, { value: 'cover', label: '埋める（はみ出しを切り取り）' }, { value: 'fill', label: '引き伸ばす' }],
    value: r.fit,
    onChange: () => { r.fit = fitSel.input.value; changed(); },
  });
  const fitField = fld('枠へのはめ方', fitSel.el, { input: fitSel.input });

  // FPS
  const fpsSel = select({
    options: [{ value: '', label: '元のまま' }, { value: '24', label: '24 fps' }, { value: '30', label: '30 fps' }, { value: '60', label: '60 fps' }],
    value: String(settings.video.fps ?? ''),
    onChange: () => { settings.video.fps = fpsSel.input.value ? Number(fpsSel.input.value) : null; changed(); },
  });

  // ビットレート
  const v = settings.video;
  const brSeg = segmented({
    options: [{ value: 'preset', label: 'プリセット' }, { value: 'custom', label: '指定' }],
    value: v.bitrateMode,
    onChange: (val) => { v.bitrateMode = val; changed(); },
  });
  const presetSel = select({
    options: [{ value: 'low', label: '低（小さいファイル）' }, { value: 'medium', label: '中' }, { value: 'high', label: '高' }, { value: 'very_high', label: '最高' }],
    value: v.preset,
    onChange: () => { v.preset = presetSel.input.value; changed(); },
  });
  const presetField = fld('画質プリセット', presetSel.el, { input: presetSel.input });
  const customBr = numField('ビットレート', { value: Math.round(v.bitrate / 1000), min: 100, max: 100000, step: 100, unit: 'kbps' }, (val) => {
    if (val) { v.bitrate = Math.round(val * 1000); changed(); }
  });

  // 音声
  const a = settings.audio;
  const audioSeg = segmented({
    options: [{ value: 'keep', label: '音声を残す' }, { value: 'mute', label: '音声なし' }],
    value: a.mode,
    onChange: (val) => { a.mode = val; changed(); },
  });
  const audioBrSel = select({
    options: [96, 128, 192, 256].map((k) => ({ value: String(k * 1000), label: `${k} kbps` })),
    value: String(a.bitrate),
    onChange: () => { a.bitrate = Number(audioBrSel.input.value); changed(); },
  });
  const audioCodecField = fld('音声コーデック', audioCodecSel.el, { input: audioCodecSel.input });
  const audioBrField = fld('音声ビットレート', audioBrSel.el, { input: audioBrSel.input });

  // ポスター
  const p = settings.poster;
  const posterSwitch = switchField({
    label: 'ポスター画像を書き出す',
    hint: '指定時刻のフレームを静止画で保存します',
    checked: p.enabled,
    onChange: () => { p.enabled = posterSwitch.input.checked; changed(); },
  });
  const posterTime = numField('時刻', { value: p.time, min: 0, step: 0.1, unit: '秒' }, (val) => { p.time = val ?? 0; changed(); }, 'トリムの開始位置からの秒数');
  const posterFormat = select({
    options: [{ value: 'jpeg', label: 'JPEG' }, { value: 'webp', label: 'WebP' }, { value: 'avif', label: 'AVIF' }],
    value: p.format,
    onChange: () => { p.format = posterFormat.input.value; changed(); },
  });
  const posterQuality = rangeField({
    label: '品質', min: 1, max: 100, step: 1, value: p.quality, format: (val) => String(val),
    onInput: () => { p.quality = Number(posterQuality.input.value); changed(); },
  });
  const posterWidth = numField('幅（空欄で元のサイズ）', { value: p.width ?? '', min: 16, step: 10, unit: 'px' }, (val) => { p.width = val; changed(); });

  const capsBox = h('div');
  const secRes = section({
    title: '解像度',
    children: [resizeSeg.el, wField.el, hField.el, sField.el, fitField],
  });
  const secFps = section({ title: 'フレームレート', children: [fld('FPS', fpsSel.el, { input: fpsSel.input })] });
  const secBr = section({ title: 'ビットレート', children: [brSeg.el, presetField, customBr.el] });
  const secOut = section({
    title: '出力',
    children: [fld('コンテナ', containerSeg.el), codecField, fld('変換方法', modeSeg.el), copyHint],
  });
  const secAudio = section({ title: '音声', children: [audioSeg.el, audioCodecField, audioBrField] });
  const secPoster = section({ title: 'ポスター画像', open: false, children: [posterSwitch.el, posterTime.el, fld('形式', posterFormat.el, { input: posterFormat.input }), posterQuality.el, posterWidth.el] });
  const aside = h('div', { class: 'tool-aside' }, secOut, secRes, secFps, secBr, secAudio, secPoster, capsBox);

  /* ---------- 見出しの要約 ---------- */
  const BR_PRESET_LABELS = { low: '低', medium: '中', high: '高', very_high: '最高' };
  const outputSummary = () => {
    const parts = [settings.container === 'mp4' ? 'MP4' : 'WebM'];
    parts.push(v.mode === 'copy' ? 'コピー' : VIDEO_CODEC_LABELS[v.codec] ?? v.codec);
    return parts.join(' · ');
  };
  const resizeSummary = () => {
    switch (r.mode) {
      case 'width': return `幅 ${r.width ?? '–'}px`;
      case 'height': return `高さ ${r.height ?? '–'}px`;
      case 'scale': return `倍率 ${r.scale ?? '–'}%`;
      case 'box': return `枠 ${r.width ?? '–'}×${r.height ?? '–'}`;
      default: return '元のまま';
    }
  };
  const audioSummary = () => {
    if (a.mode === 'mute') return 'なし';
    const codec = a.codec === 'auto' ? '自動' : AUDIO_CODEC_LABELS[a.codec] ?? a.codec;
    return `${codec} · ${Math.round(a.bitrate / 1000)} kbps`;
  };
  function updateSummaries() {
    setSectionSummary(secOut, outputSummary());
    setSectionSummary(secRes, resizeSummary());
    setSectionSummary(secFps, settings.video.fps ? `${settings.video.fps} fps` : '元のまま');
    setSectionSummary(secBr, v.bitrateMode === 'custom' ? `${Math.round(v.bitrate / 1000)} kbps` : `プリセット ${BR_PRESET_LABELS[v.preset] ?? v.preset}`);
    setSectionSummary(secAudio, audioSummary());
    setSectionSummary(secPoster, p.enabled ? `${p.format.toUpperCase()} · ${p.time}秒` : 'オフ');
  }

  function show(el, on) { el.style.display = on ? '' : 'none'; }
  function updateDerived() {
    const rm = r.mode;
    show(wField.el, rm === 'width' || rm === 'box');
    show(hField.el, rm === 'height' || rm === 'box');
    show(sField.el, rm === 'scale');
    show(fitField, rm === 'box');
    show(presetField, v.bitrateMode === 'preset');
    show(customBr.el, v.bitrateMode === 'custom');
    const copy = v.mode === 'copy';
    show(copyHint, copy);
    for (const el of [secRes, secFps, secBr, codecField]) {
      el.style.opacity = copy ? '0.45' : '';
      el.style.pointerEvents = copy ? 'none' : '';
    }
    const muted = a.mode === 'mute';
    show(audioCodecField, !muted);
    show(audioBrField, !muted);
    audioBrField.style.opacity = copy ? '0.45' : '';
    for (const el of [posterTime.el, posterWidth.el, posterQuality.el]) show(el, p.enabled);
    show(posterFormat.el.closest('.field') ?? posterFormat.el, p.enabled);
    updateTrimBar();
    updateSummaries();
  }

  function refreshCaps() {
    refreshEngineNotice();
    refreshCodecOptions();
    clear(capsBox);
    if (caps.ready && caps.webcodecs && !caps.mediabunnyError && caps.videoEncoders) {
      const ng = Object.keys(VIDEO_CODEC_LABELS).filter((c) => !caps.videoEncoders[c]).map((c) => VIDEO_CODEC_LABELS[c]);
      const ngAudio = Object.keys(AUDIO_CODEC_LABELS).filter((c) => !caps.audioEncoders?.[c]).map((c) => AUDIO_CODEC_LABELS[c]);
      const lines = [];
      if (ng.length) lines.push(`映像: ${ng.join('、')}`);
      if (ngAudio.length) lines.push(`音声: ${ngAudio.join('、')}`);
      if (lines.length) capsBox.appendChild(notice(`このブラウザでエンコードできないコーデック（${lines.join(' / ')}）。選択肢は無効にしています。`, 'warning'));
    }
  }

  /* ---------- ショートカット・ライフサイクル ---------- */
  const onKey = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !e.isComposing && !document.querySelector('dialog[open]')) {
      e.preventDefault();
      runSelected();
    }
  };

  refreshCaps();
  updateDerived();
  updateCounts();

  return {
    id: 'video',
    title: '動画変換',
    subtitle: 'WebM / MP4 へ変換。トリム・解像度・FPS・ビットレート・ポスター画像',
    icon: 'video',
    group: 'convert',
    main,
    aside,
    settingsSummary: () => `${outputSummary()} · ${resizeSummary()} · 音声${a.mode === 'mute' ? 'なし' : 'あり'}`,
    activate() {
      active = true;
      document.addEventListener('keydown', onKey);
      refreshCaps();
      updateDerived();
      // 機能検出は非同期なので、完了後にもう一度描画する
      probeCapabilities().then(() => { if (active) refreshCaps(); }).catch(() => {});
    },
    deactivate() {
      active = false;
      document.removeEventListener('keydown', onKey);
      previewVideo.pause();
      sample.pause();
    },
  };
}
