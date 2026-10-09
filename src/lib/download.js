import { loadFflate } from './vendor.js';
import { dedupeNames } from './naming.js';
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

/**
 * 選択したフォルダへファイルを書き込み、保存件数を返す。キャンセル時は 0。
 * @param {{name:string, blob:Blob}[]} entries
 * @returns {Promise<number>}
 */
export async function saveToDirectory(entries) {
  try {
    const dir = await window.showDirectoryPicker({ mode: 'readwrite' });
    const names = safeNames(entries);
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
