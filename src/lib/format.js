const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

/** バイト数を "1.23 MB" 形式にする（B は小数なし）。 */
export function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return '0 B';
  let i = 0;
  let v = n;
  while (v >= 1024 && i < UNITS.length - 1) {
    v /= 1024;
    i += 1;
  }
  return i === 0 ? `${Math.round(v)} B` : `${v.toFixed(2)} ${UNITS[i]}`;
}

/** 秒数を m:ss.s 形式にする（例: 65.3 → "1:05.3"）。 */
export function formatDuration(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '0:00.0';
  const tenths = Math.round(sec * 10);
  const m = Math.floor(tenths / 600);
  const s = (tenths % 600) / 10;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

/** 出力/入力の比率を増減率にする（0.19 → "-81%"、1.2 → "+20%"）。 */
export function formatPct(ratio) {
  if (!Number.isFinite(ratio)) return '-';
  const pct = Math.round((ratio - 1) * 100);
  if (pct === 0) return '0%';
  return `${pct > 0 ? '+' : ''}${pct}%`;
}

/** 幅×高さを "1920×1080" 形式にする。 */
export function formatDims(w, h) {
  return `${Math.round(w)}×${Math.round(h)}`;
}
