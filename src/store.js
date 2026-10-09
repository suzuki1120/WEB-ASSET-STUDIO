import { uid } from './lib/dom.js';
import { revokeOwner } from './lib/objecturl.js';

const keyOf = (f) => `${f.name}|${f.size}|${f.lastModified}`;

/**
 * 画像/動画キューの状態ストア。
 * @param {'image'|'video'} kind
 */
export function createStore(kind) {
  const list = [];
  const listeners = new Set();

  const emit = (event) => {
    for (const fn of [...listeners]) {
      try {
        fn(event);
      } catch (err) {
        console.error(err);
      }
    }
  };
  const get = (id) => list.find((it) => it.id === id);

  return {
    items: () => [...list],
    get,

    /** name+size+lastModified が同じファイルは追加しない。追加した item を返す。 */
    add(files) {
      const seen = new Set(list.map((it) => keyOf(it.file)));
      const added = [];
      for (const file of files) {
        const key = keyOf(file);
        if (seen.has(key)) continue;
        seen.add(key);
        added.push({
          id: uid(kind), kind, file, name: file.name, size: file.size, type: file.type,
          addedAt: Date.now(), thumbUrl: null, meta: {}, status: 'queued', progress: 0,
          error: null, stale: false, selected: true, outputs: [],
        });
      }
      if (added.length) {
        list.push(...added);
        emit({ type: 'add', ids: added.map((it) => it.id) });
      }
      return added;
    },

    remove(id) {
      const i = list.findIndex((it) => it.id === id);
      if (i < 0) return;
      list.splice(i, 1);
      revokeOwner(id);
      emit({ type: 'remove', id });
    },

    clear() {
      for (const it of list.splice(0)) revokeOwner(it.id);
      emit({ type: 'clear' });
    },

    /** 浅いマージ。 */
    update(id, patch) {
      const it = get(id);
      if (!it) return;
      Object.assign(it, patch);
      emit({ type: 'update', id });
    },

    setSelected(id, bool) {
      const it = get(id);
      if (!it) return;
      it.selected = Boolean(bool);
      emit({ type: 'select', id });
    },

    selectAll(bool) {
      for (const it of list) it.selected = Boolean(bool);
      emit({ type: 'select', ids: list.map((it) => it.id) });
    },

    selected: () => list.filter((it) => it.selected),

    addOutput(id, output) {
      const it = get(id);
      if (!it) return;
      it.outputs.push({ ...output, id: output.id ?? uid('out') });
      emit({ type: 'update', id });
    },

    /** 出力・エラー・進捗を消して 'queued' に戻す。Object URL も解放する（thumbUrl も対象のため null に戻す）。 */
    resetForRerun(ids) {
      for (const id of ids) {
        const it = get(id);
        if (!it) continue;
        revokeOwner(id);
        Object.assign(it, { outputs: [], error: null, progress: 0, status: 'queued', stale: false, thumbUrl: null });
      }
      emit({ type: 'update', ids: [...ids] });
    },

    /** 設定変更後、完了済みの item に「再実行が必要」の印を付ける。 */
    markStale() {
      const ids = [];
      for (const it of list) {
        if (it.status === 'done') {
          it.stale = true;
          ids.push(it.id);
        }
      }
      if (ids.length) emit({ type: 'update', ids });
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
