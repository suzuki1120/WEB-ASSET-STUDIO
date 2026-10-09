import { loadFflate } from './vendor.js';
import { dedupeNames, stripExt } from './naming.js';
import { escapeFilename } from './dom.js';

/** Blob を anchor クリックで保存する。URL は少し後に解放する。 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.hidden = true;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const safeNames = (entries) => dedupeNames(entries.map((e) => escapeFilename(e.name)));

/**
 * 複数ファイルを無圧縮（level 0）の ZIP にして保存する。
 * @param {{name:string, blob:Blob}[]} entries
 * @param {string} zipName
 */
export async function downloadZip(entries, zipName) {
  const { Zip, ZipPassThrough } = await loadFflate();
  const names = safeNames(entries);
  const chunks = [];
  const finished = new Promise((resolve, reject) => {
    const zip = new Zip((err, chunk, final) => {
      if (err) return reject(err);
      chunks.push(chunk);
      if (final) resolve(new Blob(chunks, { type: 'application/zip' }));
    });
    (async () => {
      for (let i = 0; i < entries.length; i++) {
        const file = new ZipPassThrough(names[i]);
        zip.add(file);
        const reader = entries[i].blob.stream().getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          file.push(value);
        }
        file.push(new Uint8Array(0), true);
      }
      zip.end();
    })().catch(reject);
  });
  const blob = await finished;
  downloadBlob(blob, /\.zip$/i.test(zipName) ? zipName : `${zipName}.zip`);
}

/** フォルダ保存（File System Access API）が使えるか。 */
export function canSaveToDirectory() {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

async function fileExists(dir, name) {
  try {
    await dir.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

/** 保存先の既存ファイルとも重ならない名前に付け替える（-2, -3 を付ける）。 */
async function renameAgainstDir(dir, names, conflicts) {
  const taken = new Set(names.map((n) => n.toLowerCase()));
  const out = [];
  for (const name of names) {
    if (!conflicts.has(name)) {
      out.push(name);
      continue;
    }
    const base = stripExt(name);
    const ext = name.slice(base.length);
    let n = 2;
    let candidate;
    do candidate = `${base}-${n++}${ext}`;
    while (taken.has(candidate.toLowerCase()) || (await fileExists(dir, candidate)));
    taken.add(candidate.toLowerCase());
    out.push(candidate);
  }
  return out;
}

/**
 * 選択したフォルダへファイルを書き込み、保存件数を返す。キャンセル時は 0。
 * 同名ファイルがあると onConflict(names) を呼び、'overwrite' / 'rename' / 'cancel' で扱いを決める。
 * onConflict を省略すると上書きせず別名で保存する。
 * @param {{name:string, blob:Blob}[]} entries
 * @param {{onConflict?: (names: string[]) => Promise<'overwrite'|'rename'|'cancel'>}} [opts]
 * @returns {Promise<number>}
 */
export async function saveToDirectory(entries, { onConflict } = {}) {
  try {
    const dir = await window.showDirectoryPicker({ mode: 'readwrite' });
    let names = safeNames(entries);
    const conflicts = new Set();
    for (const name of names) if (await fileExists(dir, name)) conflicts.add(name);
    if (conflicts.size) {
      const choice = onConflict ? await onConflict([...conflicts]) : 'rename';
      if (choice === 'cancel') return 0;
      if (choice === 'rename') names = await renameAgainstDir(dir, names, conflicts);
    }
    for (let i = 0; i < entries.length; i++) {
      const handle = await dir.getFileHandle(names[i], { create: true });
      const writable = await handle.createWritable();
      await writable.write(entries[i].blob);
      await writable.close();
    }
    return entries.length;
  } catch (err) {
    if (err?.name === 'AbortError') return 0;
    throw err;
  }
}
