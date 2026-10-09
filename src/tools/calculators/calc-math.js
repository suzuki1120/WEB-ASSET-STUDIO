const round3 = (n) => Number(n.toFixed(3));
const isNum = (n) => typeof n === 'number' && Number.isFinite(n);

/** target が parent の何 % か。入力が不正なら null。 */
export function toPercent(parent, target) {
  if (!isNum(parent) || !isNum(target) || parent <= 0) return null;
  return round3((target / parent) * 100);
}

/** target が viewport 幅の何 vw か。入力が不正なら null。 */
export function toVw(viewport, target) {
  if (!isNum(viewport) || !isNum(target) || viewport <= 0) return null;
  return round3((target / viewport) * 100);
}

const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));

/** 幅と高さを最大公約数で約分する。入力が不正なら null。 */
export function aspectRatio(w, h) {
  if (!isNum(w) || !isNum(h)) return null;
  const rw = Math.round(w);
  const rh = Math.round(h);
  if (rw <= 0 || rh <= 0) return null;
  const g = gcd(rw, rh);
  const rw2 = rw / g;
  const rh2 = rh / g;
  return { w: rw2, h: rh2, string: `${rw2} / ${rh2}` };
}

/** px を rem に変換する。 */
export const pxToRem = (px, root = 16) => px / root;
/** rem を px に変換する。 */
export const remToPx = (rem, root = 16) => rem * root;

/**
 * 画面幅 minVw〜maxVw の間でサイズを線形に変化させる clamp() を返す。入力が不正なら null。
 * 例: "clamp(1.000rem, 0.750rem + 0.833vw, 1.500rem)"
 * @param {{minPx:number, maxPx:number, minVw:number, maxVw:number, rootPx?:number, unit?:'rem'|'px'}} opts
 * @returns {string|null}
 */
export function fluidClamp({ minPx, maxPx, minVw, maxVw, rootPx = 16, unit = 'rem' }) {
  if (![minPx, maxPx, minVw, maxVw, rootPx].every(isNum) || maxVw === minVw || rootPx <= 0) return null;
  const slope = (maxPx - minPx) / (maxVw - minVw);
  const intercept = minPx - minVw * slope;
  const conv = (px) => (unit === 'rem' ? px / rootPx : px);
  const fmt = (n) => (Math.round(n * 1000) / 1000).toFixed(3);
  const lo = conv(Math.min(minPx, maxPx));
  const hi = conv(Math.max(minPx, maxPx));
  const base = conv(intercept);
  const vw = slope * 100;
  const mid = `${fmt(base)}${unit} ${vw < 0 ? '-' : '+'} ${fmt(Math.abs(vw))}vw`;
  return `clamp(${fmt(lo)}${unit}, ${mid}, ${fmt(hi)}${unit})`;
}
