// 動画の圧縮プレビュー。現在の設定で数秒だけ変換し、元の動画と重ねて比較する。全体のサイズはサンプルから推定する。
import { h, uid } from '../../lib/dom.js';
import { createUrl, revokeOwner } from '../../lib/objecturl.js';
import { formatBytes, formatDuration, formatPct, formatDims } from '../../lib/format.js';
import { button, segmented, progressBar, notice, badge, field, toast } from '../../ui/components.js';
import { createCompareView } from '../../ui/compare.js';
import { constrainVideoSettings, VIDEO_CODEC_LABELS } from './video-settings.js';
import { convertWithFallback } from './video-pipeline.js';

const LENGTHS = [3, 5, 10];
const DRIFT = 0.15; // 元動画とのずれがこれを超えたら合わせ直す（秒）

function setIcon(btn, name, label) {
  btn.querySelector('use')?.setAttribute('href', `#i-${name}`);
  btn.setAttribute('aria-label', label);
  btn.title = label;
}

/** 変換後の動画を基準に、元の動画を offset 秒ずらして同期再生する。 */
function createSyncPlayer(before, after, offset, fallbackDuration) {
  let raf = 0;
  const duration = () => (Number.isFinite(after.duration) && after.duration > 0 ? after.duration : fallbackDuration);
  const playBtn = button({ icon: 'play', variant: 'secondary', size: 'sm', onClick: () => (after.paused ? play() : pause()) });
  setIcon(playBtn, 'play', '再生');
  const seek = h('input', { class: 'range', type: 'range', min: '0', max: String(fallbackDuration), step: '0.01', 'aria-label': '再生位置' });
  seek.value = '0';
  const time = h('span', { class: 'sample-time' });

  function sync(force) {
    const target = offset + after.currentTime;
    if (force || (!before.seeking && Math.abs(before.currentTime - target) > DRIFT)) before.currentTime = target;
  }
  function updateTime() {
    seek.max = String(duration());
    seek.value = String(after.currentTime);
    time.textContent = `${formatDuration(after.currentTime)} / ${formatDuration(duration())}`;
  }
  function tick() {
    sync(false);
    updateTime();
    if (!after.paused) raf = requestAnimationFrame(tick);
  }
  async function play() {
    sync(true);
    setIcon(playBtn, 'pause', '一時停止');
    try {
      await Promise.all([after.play(), before.play()]);
    } catch { /* 自動再生の制限などは無視 */ }
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tick);
  }
  function pause() {
    after.pause();
    before.pause();
    cancelAnimationFrame(raf);
    setIcon(playBtn, 'play', '再生');
    sync(true);
    updateTime();
  }

  after.addEventListener('ended', () => {
    after.currentTime = 0;
    play();
  });
  after.addEventListener('loadedmetadata', updateTime);
  if (before.readyState >= 1) sync(true);
  else before.addEventListener('loadedmetadata', () => sync(true), { once: true });
  seek.addEventListener('input', () => {
    if (!after.paused) pause();
    after.currentTime = Number(seek.value);
    sync(true);
    updateTime();
  });
  updateTime();

  return { el: h('div', { class: 'sample-player' }, playBtn, seek, time), pause };
}

function makeVideo(src, label) {
  const v = h('video', { src, playsinline: true, preload: 'auto', 'aria-label': label });
  v.muted = true;
  v.playsInline = true;
  return v;
}

function waitMetadata(video) {
  if (video.readyState >= 1) return Promise.resolve();
  return new Promise((resolve, reject) => {
    video.addEventListener('loadedmetadata', resolve, { once: true });
    video.addEventListener('error', () => reject(new Error('変換したサンプルを再生できませんでした')), { once: true });
  });
}

/**
 * @param {{ caps: any, getItem: () => any, getSettings: () => any, getPlayhead: () => number, getDuration: () => number }} deps
 */
export function createSamplePreview({ caps, getItem, getSettings, getPlayhead, getDuration }) {
  let owner = uid('sample');
  let length = LENGTHS[0];
  let controller = null;
  let player = null;
  let hasResult = false;
  let token = 0;

  const view = createCompareView();
  const lengthSeg = segmented({
    options: LENGTHS.map((n) => ({ value: String(n), label: `${n}秒` })),
    value: String(length),
    onChange: (v) => { length = Number(v); },
  });
  const zoomSeg = segmented({
    options: [{ value: 'fit', label: '全体' }, { value: '1', label: '100%' }, { value: '2', label: '200%' }],
    value: 'fit',
    onChange: (v) => view.setZoom(v),
  });
  const runBtn = button({ label: 'プレビューを作成', icon: 'compare', variant: 'primary', size: 'sm', onClick: () => toggleRun() });
  const staleBadge = badge('設定が変更されました', 'warning');
  staleBadge.classList.add('hidden');
  const progress = progressBar(0);
  progress.el.classList.add('hidden', 'is-thin');
  const stats = h('dl', { class: 'preview-stats' });
  const messages = h('div', { class: 'sample-messages' });
  const playerSlot = h('div');
  const zoomField = field({ label: '表示倍率', control: zoomSeg.el });
  const body = h('div', { class: 'sample-body hidden' }, view.el, playerSlot, zoomField, stats, messages);

  const el = h('section', { class: 'sample-preview', 'aria-label': '圧縮プレビュー' },
    h('div', { class: 'sample-head' },
      h('h3', { class: 'sample-title' }, '圧縮プレビュー'),
      h('p', { class: 'field-hint' }, '再生位置（トリム範囲内）から指定した秒数だけ、現在の設定で変換して元の動画と比べます。音声は再生しません。'),
    ),
    h('div', { class: 'sample-controls' }, field({ label: '長さ', control: lengthSeg.el }), runBtn, staleBadge),
    progress.el,
    body,
  );

  function setRunning(on) {
    runBtn.querySelector('.btn-label').textContent = on ? '中止' : hasResult ? 'プレビューを更新' : 'プレビューを作成';
    runBtn.classList.toggle('is-loading', on);
    runBtn.setAttribute('aria-busy', String(on));
    runBtn.querySelector('.icon')?.classList.toggle('hidden', on);
    progress.el.classList.toggle('hidden', !on);
  }

  /** サンプルにする範囲。トリム範囲の中で、再生位置から length 秒（末尾に近ければ前へずらす）。 */
  function sampleRange(item) {
    const s = getSettings();
    const total = item.meta?.duration || getDuration() || 0;
    const limit = total > 0 ? total : Infinity;
    const rangeStart = Math.min(Math.max(0, Number(s.trim.start) || 0), limit);
    const rangeEnd = s.trim.end != null && s.trim.end > rangeStart ? Math.min(s.trim.end, limit) : limit;
    let start = Math.min(Math.max(rangeStart, getPlayhead() || 0), rangeEnd);
    const end = Math.min(start + length, rangeEnd);
    if (end - start < length) start = Math.max(rangeStart, end - length);
    return { start, end, rangeStart, rangeEnd, total };
  }

  function clearResult() {
    player?.pause();
    player = null;
    view.setBefore(null);
    view.setAfter(null);
    playerSlot.textContent = '';
    stats.textContent = '';
    messages.textContent = '';
    revokeOwner(owner);
    owner = uid('sample');
  }

  function stat(label, value, tone) {
    return [h('dt', null, label), h('dd', { class: tone ? `is-${tone}` : null }, value)];
  }

  function renderStats({ item, bytes, width, height, sampleDur, range, ms }) {
    const kbps = Math.round((bytes * 8) / sampleDur / 1000);
    const target = Number.isFinite(range.rangeEnd) ? range.rangeEnd - range.rangeStart : 0;
    const trimmed = range.total > 0 && (range.rangeStart > 0 || range.rangeEnd < range.total);
    stats.textContent = '';
    stats.append(
      ...stat('サンプル', `${formatDuration(range.start)} から ${sampleDur.toFixed(1)} 秒 · ${formatBytes(bytes)}`),
      ...stat('出力', `${formatDims(width, height)} · ${kbps.toLocaleString()} kbps`),
    );
    if (target > 0) {
      const est = (bytes / sampleDur) * target;
      const src = range.total > 0 ? (item.size * target) / range.total : item.size;
      const ratio = src ? est / src : null;
      stats.append(
        ...stat(trimmed ? '推定サイズ（トリム範囲）' : '推定サイズ（全体）', `約 ${formatBytes(est)}`),
        ...stat('元の動画（同じ範囲）', `約 ${formatBytes(src)}${ratio == null ? '' : ` → ${formatPct(ratio)}`}`, ratio != null && ratio > 1 ? 'bad' : 'good'),
      );
    }
    stats.append(...stat('変換時間', `${(ms / 1000).toFixed(1)} 秒`));
  }

  async function run() {
    const item = getItem();
    if (!item) return;
    const range = sampleRange(item);
    if (!(range.end - range.start >= 0.2)) {
      toast('プレビューできる範囲がありません。トリムの設定を確認してください', { tone: 'warning' });
      return;
    }
    const t = getSettings().trim;
    if (t.end != null && t.end <= (t.start || 0)) {
      toast('トリムの終了位置は開始位置より後にしてください', { tone: 'danger' });
      return;
    }
    const { settings, warnings } = constrainVideoSettings(getSettings(), caps);
    settings.trim = { start: range.start, end: range.end };
    settings.poster.enabled = false;

    const my = ++token;
    controller = new AbortController();
    progress.set(0);
    setRunning(true);
    const t0 = performance.now();
    try {
      const out = await convertWithFallback(item.file, settings, {
        onProgress: (p) => progress.set(p),
        signal: controller.signal,
        caps,
      });
      if (my !== token || getItem()?.id !== item.id) return;
      const ms = performance.now() - t0;
      clearResult();
      const after = makeVideo(createUrl(out.blob, owner), '変換したサンプル');
      const before = makeVideo(createUrl(item.file, owner), '元の動画');
      await waitMetadata(after);
      if (my !== token) return;
      const width = after.videoWidth || item.meta?.width || 0;
      const height = after.videoHeight || item.meta?.height || 0;
      const sampleDur = Number.isFinite(after.duration) && after.duration > 0 ? after.duration : range.end - range.start;
      const r = settings.video.resize;
      const fit = settings.video.mode !== 'copy' && r.mode === 'box' ? r.fit : 'contain';
      view.setBefore(before, { fit });
      view.setAfter(after);
      view.setSize(width, height);
      const codec = settings.video.mode === 'copy' ? '元コーデック' : VIDEO_CODEC_LABELS[settings.video.codec] ?? settings.video.codec;
      view.setLabels('元の動画', `${settings.container.toUpperCase()} ${codec}`);
      player = createSyncPlayer(before, after, range.start, sampleDur);
      playerSlot.appendChild(player.el);
      renderStats({ item, bytes: out.blob.size, width, height, sampleDur, range, ms });
      messages.appendChild(notice('推定サイズはサンプルの平均ビットレートから計算した目安です。動きの多い場面では大きく、少ない場面では小さくなります。', 'info'));
      for (const w of [...warnings, ...(out.warnings ?? [])]) messages.appendChild(notice(w, 'warning'));
      hasResult = true;
      staleBadge.classList.add('hidden');
      body.classList.remove('hidden');
    } catch (err) {
      if (err?.name === 'AbortError' || my !== token) return;
      toast(`プレビューを作成できませんでした: ${err?.message ?? err}`, { tone: 'danger', duration: 6000 });
    } finally {
      if (my === token) {
        controller = null;
        setRunning(false);
      }
    }
  }

  function toggleRun() {
    if (controller) {
      controller.abort();
      return;
    }
    run();
  }

  return {
    el,
    /** 設定が変わったら、作成済みのプレビューに印を付ける。 */
    markStale() {
      if (hasResult) staleBadge.classList.remove('hidden');
    },
    /** 対象の動画が変わったとき・消えたときに呼ぶ。 */
    reset() {
      token += 1;
      controller?.abort();
      controller = null;
      clearResult();
      hasResult = false;
      staleBadge.classList.add('hidden');
      body.classList.add('hidden');
      setRunning(false);
    },
    pause() { player?.pause(); },
  };
}
