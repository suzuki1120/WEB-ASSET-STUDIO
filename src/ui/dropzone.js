import { h, icon } from '../lib/dom.js';
import { toast } from './components.js';

function parseAccept(accept) {
  const list = Array.isArray(accept) ? accept : String(accept || '').split(',');
  return list.map((s) => s.trim().toLowerCase()).filter(Boolean);
}

function matches(file, tokens) {
  if (!tokens.length) return true;
  const type = (file.type || '').toLowerCase();
  const name = (file.name || '').toLowerCase();
  return tokens.some((t) => {
    if (t.endsWith('/*')) return type.startsWith(t.slice(0, -1));
    if (t.startsWith('.')) return name.endsWith(t);
    return type === t;
  });
}

/**
 * ドロップゾーン。クリック / Enter / Space でファイル選択、ドラッグ&ドロップ、任意でペーストに対応。
 * accept は "image/*" や ["video/*", ".mp4"] のように指定する。
 */
export function createDropzone({ accept = 'image/*', multiple = true, label = 'ファイルをドロップ、またはクリックして選択', sublabel = '', onFiles, paste = false } = {}) {
  const tokens = parseAccept(accept);
  const input = h('input', { type: 'file', class: 'hidden', accept: tokens.join(','), multiple: !!multiple, tabindex: '-1', 'aria-hidden': 'true' });
  const el = h('div', { class: 'dropzone', role: 'button', tabindex: '0', 'aria-label': label },
    h('div', { class: 'dropzone-icon' }, icon('upload', 24)),
    h('div', { class: 'dropzone-label' }, label),
    sublabel ? h('div', { class: 'dropzone-sub' }, sublabel) : null,
    input,
  );

  function handle(fileList) {
    const all = Array.from(fileList || []);
    if (!all.length) return;
    let ok = all.filter((f) => matches(f, tokens));
    const rejected = all.length - ok.length;
    if (rejected > 0) toast(`対応していない形式の ${rejected} 件を無視しました`, { tone: 'warning' });
    if (!ok.length) return;
    if (!multiple) ok = ok.slice(0, 1);
    onFiles?.(ok);
  }

  const open = () => input.click();
  el.addEventListener('click', (e) => { if (e.target !== input) open(); });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      open();
    }
  });
  input.addEventListener('change', () => {
    const files = Array.from(input.files || []);
    input.value = '';
    handle(files);
  });

  el.addEventListener('dragenter', (e) => { e.preventDefault(); el.classList.add('is-dragover'); });
  el.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    el.classList.add('is-dragover');
  });
  el.addEventListener('dragleave', (e) => {
    if (!e.relatedTarget || !el.contains(e.relatedTarget)) el.classList.remove('is-dragover');
  });
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    el.classList.remove('is-dragover');
    handle(e.dataTransfer?.files);
  });

  // ゾーン外に落としたファイルでブラウザが画面遷移しないようにする（表示中のみ）
  const isFileDrag = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');
  window.addEventListener('dragover', (e) => { if (el.isConnected && isFileDrag(e)) e.preventDefault(); });
  window.addEventListener('drop', (e) => { if (el.isConnected && isFileDrag(e)) e.preventDefault(); });

  if (paste) {
    document.addEventListener('paste', (e) => {
      if (!el.isConnected) return;
      const files = Array.from(e.clipboardData?.files || []);
      if (!files.length) return;
      e.preventDefault();
      handle(files);
    });
  }

  return { el, setCompact: (b) => el.classList.toggle('is-compact', !!b) };
}
