// 変換結果の集計。

const imageOutputs = (item) => (item.outputs ?? []).filter((o) => o.kind === 'image' || !o.kind);

/** 1 ファイル分の入出力サイズ。出力が無ければ ratio と best は null。 */
export function itemStats(item) {
  const outputs = imageOutputs(item);
  const inBytes = item.size ?? 0;
  const outBytes = outputs.reduce((sum, o) => sum + (o.bytes ?? 0), 0);
  let best = null;
  for (const o of outputs) {
    if (!best || o.bytes < best.bytes) best = { format: o.format, bytes: o.bytes };
  }
  return { inBytes, outBytes, ratio: outputs.length && inBytes ? outBytes / inBytes : null, best };
}

/** 出力があるファイルの合計。 */
export function totals(items) {
  const done = items.filter((item) => imageOutputs(item).length > 0);
  let outputs = 0;
  let inBytes = 0;
  let outBytes = 0;
  for (const item of done) {
    const s = itemStats(item);
    outputs += imageOutputs(item).length;
    inBytes += s.inBytes;
    outBytes += s.outBytes;
  }
  return { files: done.length, outputs, inBytes, outBytes, ratio: inBytes ? outBytes / inBytes : null };
}
