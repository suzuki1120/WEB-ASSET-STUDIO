// 画像変換ツール（UI）。
import { h, clear } from '../../lib/dom.js';
import { createUrl, revokeOwner } from '../../lib/objecturl.js';
import { formatBytes, formatPct, formatDims } from '../../lib/format.js';
import { downloadBlob, downloadZip, canSaveToDirectory, saveToDirectory } from '../../lib/download.js';
import { copyText } from '../../lib/clipboard.js';
import { createStore } from '../../store.js';
import { button, toast, confirmDialog } from '../../ui/components.js';
import { createDropzone } from '../../ui/dropzone.js';
import { createFileGrid } from '../../ui/filegrid.js';
import { createActionBar } from '../../ui/actionbar.js';
import {
  PRESETS, loadSettings, saveSettings, validateSettings, defaultSettings, presetSettings, expandVariants,
} from './image-settings.js';
import { createImagePipeline } from './image-pipeline.js';
import { buildPictureSnippet } from './snippets.js';
import { totals, itemStats } from './stats.js';
import { buildSettingsSections, settingsSummary } from './settings-panel.js';
import { openImagePreview } from './image-preview.js';

const THUMB_SIZE = 96;
const DECODE_ERROR = '画像を読み込めませんでした';
const imageOutputs = (item) => (item.outputs ?? []).filter((o) => o.kind === 'image');
/** 変換が必要な item（未変換・エラー・中止・設定変更済み）。 */
const needsRun = (item) => item.status !== 'processing' && (item.status !== 'done' || item.stale);

export function createTool(ctx) {
  const caps = ctx.caps;
  const store = ctx.store ?? createStore('image');
  const pipeline = createImagePipeline({ store, caps });
  let settings = loadSettings();
  let active = false;
  let preview = null; // 開いている圧縮プレビュー

  /* ---------- サムネイル ---------- */
  // サムネイルの URL は item.id と別の所有者で管理する（再変換の resetForRerun で解放されないように）
  const thumbOwner = (id) => `thumb-${id}`;
  const thumbUrls = new Map(); // itemId -> object URL
  const thumbBusy = new Set();
  let thumbChain = Promise.resolve();

  async function renderThumb(file) {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    try {
      const px = THUMB_SIZE * Math.min(2, window.devicePixelRatio || 1);
      const scale = Math.min(1, px / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const g = canvas.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.8));
      return { blob, width: bitmap.width, height: bitmap.height };
    } finally {
      bitmap.close();
    }
  }

  async function makeThumb(id) {
    const item = store.get(id);
    if (!item) return;
    try {
      const { blob, width, height } = await renderThumb(item.file);
      if (!store.get(id) || !blob) return;
      const url = createUrl(blob, thumbOwner(id));
      thumbUrls.set(id, url);
      store.update(id, { thumbUrl: url, meta: { ...store.get(id).meta, width, height } });
    } catch {
      store.update(id, { status: 'error', error: DECODE_ERROR });
    }
  }

  function requestThumb(item) {
    if (thumbUrls.has(item.id) || thumbBusy.has(item.id)) return;
    thumbBusy.add(item.id);
    thumbChain = thumbChain.then(() => makeThumb(item.id)).finally(() => thumbBusy.delete(item.id));
  }

  /** resetForRerun で thumbUrl が消えたら作り直さずに復元し、削除済みの item の URL は解放する。 */
  function syncThumbs() {
    for (const [id, url] of [...thumbUrls]) {
      const item = store.get(id);
      if (!item) {
        revokeOwner(thumbOwner(id));
        thumbUrls.delete(id);
      } else if (item.thumbUrl !== url) {
        store.update(id, { thumbUrl: url });
      }
    }
  }

  /* ---------- 出力一覧 ---------- */
  function outputRow(item, o, isBest) {
    const ratio = item.size ? o.bytes / item.size : null;
    const reduction = ratio == null ? null : h('span', { class: ['output-reduction', ratio <= 1 ? 'is-good' : 'is-bad'] }, formatPct(ratio));
    const save = button({
      icon: 'download', variant: 'ghost', size: 'sm', title: `${o.filename} を保存`,
      onClick: () => downloadBlob(o.blob, o.filename),
    });
    save.setAttribute('aria-label', `${o.filename} を保存`);
    return h('div', { class: ['output-row', isBest ? 'is-best' : ''] },
      h('span', { class: 'output-label', title: o.filename }, o.label, isBest ? h('span', { class: 'output-best' }, '最小') : null),
      h('span', { class: 'output-size' }, formatBytes(o.bytes)),
      reduction ?? h('span'),
      save,
    );
  }

  async function copySnippet(id) {
    const item = store.get(id);
    if (!item) return;
    await copyText(buildPictureSnippet(item, settings), { successMessage: 'HTMLをコピーしました' });
  }

  function renderOutputs(item) {
    const outs = imageOutputs(item);
    if (!outs.length) return null;
    const best = outs.length > 1 ? itemStats(item).best : null;
    const frag = document.createDocumentFragment();
    for (const o of outs) frag.appendChild(outputRow(item, o, best && o.format === best.format && o.bytes === best.bytes));
    frag.appendChild(h('div', { class: 'filecard-footer' },
      button({ label: 'コードをコピー', icon: 'copy', size: 'sm', variant: 'ghost', onClick: () => copySnippet(item.id) }),
    ));
    return frag;
  }

  function renderMeta(item) {
    const parts = [formatBytes(item.size)];
    if (item.meta?.width) parts.push(formatDims(item.meta.width, item.meta.height));
    return parts.join(' · ');
  }

  /* ---------- 実行 ---------- */
  function reportRun(items) {
    const states = items.map((it) => store.get(it.id)?.status);
    const count = (s) => states.filter((x) => x === s).length;
    if (count('cancelled')) toast('変換を中止しました', { tone: 'warning' });
    else if (count('error')) toast(`${count('done')}件が完了、${count('error')}件でエラーが発生しました`, { tone: 'danger' });
    else toast(`${count('done')}件の変換が完了しました`, { tone: 'success' });
  }

  let runIds = [];

  async function runItems(items) {
    if (pipeline.isRunning()) return;
    if (!items.length) {
      toast('変換する画像を選んでください', { tone: 'warning' });
      return;
    }
    const check = validateSettings(settings);
    if (!check.ok) {
      toast(check.errors[0], { tone: 'warning' });
      return;
    }
    runIds = items.map((it) => it.id);
    bar.setRunning(true);
    refresh();
    try {
      await pipeline.run(items, settings);
      reportRun(items);
    } catch (err) {
      toast(err?.message || '変換に失敗しました', { tone: 'danger' });
    } finally {
      runIds = [];
      bar.setRunning(false);
      refresh();
    }
  }

  // 未変換・設定変更済みのものだけ変換する。すべて変換済みなら選択分をすべて変換し直す
  const runSelected = () => {
    const sel = store.selected().filter((it) => it.status !== 'processing');
    const pending = sel.filter(needsRun);
    return runItems(pending.length ? pending : sel);
  };
  const rerunSelected = () => runItems(store.selected().filter((it) => it.status !== 'processing'));

  function zipEntries() {
    return store.selected().flatMap((it) => imageOutputs(it).map((o) => ({ name: o.filename, blob: o.blob })));
  }

  async function downloadAll() {
    const entries = zipEntries();
    if (!entries.length) return toast('保存できる変換結果がありません', { tone: 'warning' });
    try {
      await downloadZip(entries, 'images.zip');
    } catch (err) {
      toast(`ZIPを作成できませんでした: ${err?.message ?? err}`, { tone: 'danger' });
    }
  }

  async function saveAll() {
    const entries = zipEntries();
    if (!entries.length) return toast('保存できる変換結果がありません', { tone: 'warning' });
    try {
      const n = await saveToDirectory(entries);
      if (n) toast(`${n}件をフォルダに保存しました`, { tone: 'success' });
    } catch (err) {
      toast(`フォルダに保存できませんでした: ${err?.message ?? err}`, { tone: 'danger' });
    }
  }

  async function clearAll() {
    const ok = await confirmDialog({
      title: 'すべて削除しますか',
      message: '読み込んだ画像と変換結果をすべて削除します。',
      confirmLabel: '削除する',
      danger: true,
    });
    if (!ok) return;
    pipeline.cancel();
    store.clear();
  }

  /* ---------- 画面 ---------- */
  const dropzone = createDropzone({
    accept: 'image/*',
    multiple: true,
    paste: true,
    label: '画像をドロップ、またはクリックして選択',
    sublabel: 'JPEG / PNG / WebP / AVIF / GIF ・ Cmd/Ctrl+V で貼り付け',
    onFiles(files) {
      const added = store.add(files);
      if (!added.length) toast('すでに追加済みの画像です');
      added.forEach(requestThumb);
    },
  });

  const grid = createFileGrid(store, {
    renderOutputs,
    renderMeta,
    onRemove: (item) => store.remove(item.id),
    onRerun: (item) => runItems([item]),
    onThumb: requestThumb,
    onPreview: (item) => {
      preview = openImagePreview({
        item,
        caps,
        getSettings: () => settings,
        onSettingsChange: () => {
          onSettingsChange();
          renderAside();
        },
        onClose: () => { preview = null; },
      });
    },
  });

  const bar = createActionBar({
    primaryLabel: '変換を開始',
    onPrimary: runSelected,
    onRerunAll: rerunSelected,
    onCancel: () => pipeline.cancel(),
    onZip: downloadAll,
    onSaveDir: canSaveToDirectory() ? saveAll : undefined,
    onClear: clearAll,
    onSelectAll: (v) => store.selectAll(v),
  });

  /** 変換前に「何ファイル出力されるか」を見積もる。サイズの数は画像の幅で変わるため、読み込み済みの寸法で数える。 */
  function planText(pending) {
    const formats = Object.values(settings.formats).filter((f) => f.enabled).length;
    if (!formats) return '出力形式を選んでください';
    let outputs = 0;
    let maxSizes = 1;
    for (const it of pending) {
      const n = it.meta?.width ? expandVariants(settings, it.meta).length : formats;
      outputs += n;
      maxSizes = Math.max(maxSizes, Math.round(n / formats));
    }
    const sizes = maxSizes > 1 ? `最大${maxSizes}サイズ` : '1サイズ';
    return `${outputs}ファイル出力予定（${pending.length}件 × ${formats}形式 × ${sizes}）`;
  }

  function summaryText(items) {
    if (pipeline.isRunning() && runIds.length) {
      const finished = runIds.filter((id) => ['done', 'error', 'cancelled'].includes(store.get(id)?.status)).length;
      return `変換中 ${finished}/${runIds.length}件`;
    }
    const pending = store.selected().filter(needsRun);
    if (pending.length) return planText(pending);
    const t = totals(store.selected());
    if (!t.files) return items.length ? '変換する画像を選んでください' : '';
    const ratio = t.ratio == null ? '' : ` (${formatPct(t.ratio)})`;
    return `${t.files}ファイル → ${t.outputs}出力 · ${formatBytes(t.inBytes)} → ${formatBytes(t.outBytes)}${ratio}`;
  }

  function refresh() {
    const items = store.items();
    const selected = store.selected();
    dropzone.setCompact(items.length > 0);
    bar.setCounts({
      selected: selected.length,
      total: items.length,
      outputs: totals(items).outputs,
      pending: selected.filter(needsRun).length,
    });
    bar.setZipEnabled(selected.some((it) => imageOutputs(it).length > 0));
    bar.setSummary(summaryText(items));
  }

  store.subscribe((e) => {
    if (e.type === 'remove' || e.type === 'clear' || e.type === 'update') syncThumbs();
    refresh();
  });

  const main = h('div', { class: 'image-tool' }, dropzone.el, grid.el, bar.el);

  /* ---------- 設定パネル ---------- */
  const aside = h('div', { class: 'settings-panel' });

  function onSettingsChange() {
    saveSettings(settings);
    store.markStale();
    refresh();
    document.dispatchEvent(new CustomEvent('was:settings-change'));
  }

  function applyPreset(key) {
    settings = key === 'reset' ? defaultSettings() : presetSettings(key);
    onSettingsChange();
    renderAside();
    toast(key === 'reset' ? '設定を既定に戻しました' : `「${PRESETS[key].label}」を適用しました`);
  }

  function renderAside() {
    clear(aside);
    for (const el of buildSettingsSections({ settings, onChange: onSettingsChange, onPreset: applyPreset })) {
      aside.appendChild(el);
    }
  }
  renderAside();
  refresh();

  /* ---------- キーボード ---------- */
  function onKeydown(e) {
    if (!(e.metaKey || e.ctrlKey) || e.key !== 'Enter' || e.isComposing) return;
    if (document.querySelector('dialog[open]')) return;
    e.preventDefault();
    runSelected();
  }

  return {
    id: 'images',
    title: '画像変換',
    subtitle: 'WebP / AVIF / JPEG / PNG へ一括変換。複数形式・複数サイズを同時に書き出し',
    icon: 'image',
    group: 'convert',
    main,
    aside,
    settingsSummary: () => settingsSummary(settings),
    activate() {
      if (active) return;
      active = true;
      document.addEventListener('keydown', onKeydown);
      refresh();
    },
    deactivate() {
      active = false;
      preview?.close();
      document.removeEventListener('keydown', onKeydown);
    },
  };
}
