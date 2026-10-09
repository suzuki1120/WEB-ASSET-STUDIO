# Web Asset Studio v2 — アーキテクチャ契約

全モジュール共通の約束事。実装者（人・エージェント）は必ずこの契約に従う。

## 前提
- バニラ ES Modules、ビルドなし。MAMP で静的配信（`http://localhost:<MAMPのポート>/myApp/WEB-ASSET-STUDIO/`。ポートは環境により 8080 や 8888）。相対パスで動くこと（絶対パス `/src/...` 禁止）。
- 外部ライブラリは CDN（無料）。URL は `src/lib/vendor.js` のみに書く。
- `innerHTML` に利用者由来の文字列を入れない。DOM は `src/lib/dom.js` の `h()` で組む。
- UI 文言は日本語。コード・コメントは簡潔に。
- 色・フォントは必ず `css/tokens.css` のカスタムプロパティを参照（生の hex を各所に書かない）。
- 絵文字・グラデーション文字・ガラス風ぼかしは使わない。アイコンは `index.html` 内の SVG スプライト `<symbol id="i-*">` を `<use href="#i-*">` で使う。

## ディレクトリ

```
index.html            シェル（サイドバー / メイン / 右パネル）＋ SVG スプライト
css/tokens.css        トークン（ダーク既定、ライト上書き）
css/base.css          リセット・タイポ・focus-visible・reduced-motion
css/components.css    .btn .field .switch .range .segmented .select .badge .progress .toast .card dialog details
css/layout.css        アプリシェル・ブレークポイント
css/tools.css         計算結果・ドロップゾーン・ファイルカード・動画プレビュー・サマリー/アクションバー
src/main.js           起動
src/router.js         ハッシュルーター
src/theme.js          テーマ
src/store.js          キュー状態
src/capabilities.js   機能検出
src/lib/*.js          汎用
src/ui/*.js           共通UI部品
src/tools/calculators/*.js
src/tools/images/*.js  (+ encoders/)
src/tools/video/*.js   (+ engines/)
```

## CDN（`src/lib/vendor.js`）

```js
export const CDN = {
  jsquashWebp: 'https://esm.sh/@jsquash/webp@1.5.0/encode',
  jsquashAvif: 'https://esm.sh/@jsquash/avif@2.1.1/encode',
  fflate: 'https://esm.sh/fflate@0.8.3',
  mediabunny: 'https://cdn.jsdelivr.net/npm/mediabunny@1.61.3/dist/bundles/mediabunny.min.mjs',
};
// cachedLoader(url) は import を1回だけ行い、失敗時はキャッシュを捨てて再試行できるようにする
export const loadFflate = cachedLoader(CDN.fflate);
export const loadMediabunny = cachedLoader(CDN.mediabunny);
export const loadJsquashWebp = cachedLoader(CDN.jsquashWebp);
export const loadJsquashAvif = cachedLoader(CDN.jsquashAvif);
// Worker 内でも同じ URL を import する（import map は使わない）
```

jSquash encode: `import encode from URL; const buf = await encode(imageData, options)` → ArrayBuffer。
- webp オプション: `{ quality: 0-100, lossless: 0|1, method: 0-6, alpha_quality: 0-100, exact: 0|1 }`
- avif オプション: `{ quality: 0-100, qualityAlpha: -1|0-100, speed: 0-10, lossless: boolean, subsample: 1 }`

mediabunny（確認済み API）:
- `new Input({ source: new BlobSource(file), formats: ALL_FORMATS })`
- `input.computeDuration()`, `input.getPrimaryVideoTrack()`, `input.getPrimaryAudioTrack()`
- track: `.codec`, `getDisplayWidth()`, `getDisplayHeight()`, `computePacketStats()` → `{ averagePacketRate, averageBitrate }`, `getFirstTimestamp()`, `canDecode()`
- `canEncodeVideo(codec, {width,height,bitrate})`, `canEncodeAudio(codec, {numberOfChannels,sampleRate,bitrate})`
- `Conversion.init({ input, output, video: { codec, bitrate:number, width, height, fit, frameRate, forceTranscode }, audio: { discard } | { codec, bitrate }, trim: { start, end } })`
- `conversion.isValid`, `conversion.discardedTracks[{track, reason}]`, `conversion.onProgress = (p, processedTime) => {}`, `await conversion.execute()`, `await conversion.cancel()`（execute は `ConversionCanceledError` を投げる）
- `new Output({ format: new WebMOutputFormat() | new Mp4OutputFormat(), target: new BufferTarget() })` → 完了後 `output.target.buffer`（ArrayBuffer）
- `new CanvasSink(videoTrack, { width, fit:'contain' })` → `await sink.getCanvas(t)` → `{ canvas, timestamp, duration } | null`
- `QUALITY_LOW / QUALITY_MEDIUM / QUALITY_HIGH / QUALITY_VERY_HIGH` を `bitrate` に渡せる
- VideoCodec: `'avc'|'hevc'|'vp9'|'av1'|'vp8'`、AudioCodec: `'aac'|'opus'|'vorbis'|...`

## `src/lib/dom.js`

```js
h(tag, attrs?, ...children)   // attrs: class, id, dataset:{}, style:{}, on<Event>: fn, aria-*, その他は setAttribute / プロパティ。
                               // children: string | Node | null | false | array。文字列は TextNode。
icon(name, size=16)            // <svg class="icon" width height><use href="#i-{name}"></use></svg>
clear(el); uid(prefix='id'); escapeFilename(name)
```

## `src/lib/objecturl.js`
```js
createUrl(blob, ownerId) → url   // 登録
revokeUrl(url); revokeOwner(ownerId); revokeAll()
```

## `src/lib/format.js`
`formatBytes(n)` → "1.23 MB"、`formatDuration(sec)` → "1:05.3"、`formatPct(ratio)` → "-81%"、`formatDims(w,h)` → "1920×1080"

## `src/lib/naming.js`
`stripExt(name)`, `extOf(name)`, `slugify(s)`, `buildName(pattern, ctx)`（`{name} {w} {h} {ext} {suffix}`）, `dedupeNames(names[])`

## `src/lib/download.js`
```js
downloadBlob(blob, filename)
downloadZip(entries /*[{name, blob}]*/, zipName)     // fflate Zip + ZipPassThrough(level 0)
canSaveToDirectory() → boolean                       // 'showDirectoryPicker' in window
saveToDirectory(entries) → Promise<number>           // 保存件数
```

## `src/lib/clipboard.js`
`copyText(text, {successMessage})` → toast を出す

## `src/lib/worker-pool.js`
```js
createPool({ url, size, type:'module' }) → {
  run(payload, { transfer?, onMessage(msg) }) → { promise, cancel() }   // メッセージ {type:'done'} で解決、{type:'error', message} で reject
  terminate()
}
```
プロトコル: メイン→Worker `{ jobId, ...payload }` / `{ jobId, type:'cancel' }`。Worker→メイン `{ jobId, type, ...}`。

## `src/store.js`

```js
createStore(kind /* 'image'|'video' */) → store
store.items() → item[]（配列コピー）
store.get(id)
store.add(files: File[]) → item[]   // name+size+lastModified で重複排除、末尾追記
store.remove(id)                    // revokeOwner(id)
store.clear()
store.update(id, patch)             // 浅いマージ、'update' イベント
store.setSelected(id, bool); store.selectAll(bool); store.selected() → item[]
store.addOutput(id, output); store.resetForRerun(ids) ; store.markStale()
store.subscribe(fn) → unsubscribe   // fn({ type:'add'|'remove'|'clear'|'update'|'select', id?, ids? })

item = { id, kind, file, name, size, type, addedAt, thumbUrl:null, meta:{}, status:'queued', progress:0, error:null, stale:false, selected:true, outputs:[] }
status: 'queued'|'processing'|'done'|'error'|'cancelled'
output = { id, label, format, width, height, blob, bytes, url, filename, kind:'image'|'video'|'poster' }
```

## `src/capabilities.js`
```js
export const caps = { ready:false, offscreenCanvas, moduleWorker, canvasWebp, webcodecs,
  videoEncoders:{avc,hevc,vp9,vp8,av1}, audioEncoders:{aac,opus}, mediaRecorderMimes:[], fsAccess, hardwareConcurrency }
export async function probeCapabilities() // caps を埋める（mediabunny は遅延ロードし、失敗しても他は埋める）
```

## `src/ui/components.js`（全て Element または {el,...} を返す）
```js
button({ label, icon?, variant:'primary'|'secondary'|'ghost'|'danger', size:'sm'|'md', onClick, disabled, type, title })
field({ label, hint?, control, inline?:boolean }) → .field（label に for=control.id、id が無ければ付与）
numberInput({ value, min, max, step, placeholder, unit?, onInput }) → { el, input }
textInput({ value, placeholder, onInput, mono? }) → { el, input }
rangeField({ label, min, max, step, value, format:(v)=>string, onInput }) → { el, input, setValue(v), setDisabled(b) }
switchField({ label, hint?, checked, onChange }) → { el, input }  // <input type=checkbox role=switch class=switch>
select({ options:[{value,label,disabled?,hint?}], value, onChange }) → { el, input, setOptions(opts) }
segmented({ options:[{value,label}], value, onChange }) → { el, setValue(v) }
checkbox({ label, checked, onChange }) → { el, input }
badge(text, tone:'neutral'|'info'|'success'|'warning'|'danger')
progressBar(value0to1) → { el, set(v) }
toast(message, { tone?, duration?=3000 })
confirmDialog({ title, message, confirmLabel, danger? }) → Promise<boolean>   // <dialog>
modal({ title, children, footer?, className?, onClose? }) → { dlg, close() }    // 閉じると要素を破棄
section({ title, open?=true, children }) → <details class="panel-section">
notice(message, tone) → .notice
```

## `src/ui/dropzone.js`
```js
createDropzone({ accept, multiple:true, label, sublabel, onFiles(files:File[]), paste?:boolean }) → { el, setCompact(bool) }
```
- `role="button" tabindex=0`、Enter/Space でファイル選択、`input.value=''` を毎回リセット、dragover クラス、`paste` 有効時は document の paste から画像を取り込む。

## `src/ui/filegrid.js`
```js
createFileGrid(store, { renderOutputs(item) → Node|null, renderMeta(item) → string, onRemove(item), onRerun?(item), onThumb?(item), onPreview?(item) }) → { el }
```
- `onPreview` を渡すと、カードに圧縮プレビューのボタン（`i-compare`）が出る（エラー状態では隠す）。

## `src/ui/compare.js`
```js
createCompareView() → {
  el, setBefore(node, { fit:'contain'|'cover'|'fill' }), setAfter(node), setSize(w, h),
  setZoom('fit'|'1'|'2'), setLabels(before, after), setOverlay({ text, spinner?, tone? } | null), destroy()
}
```
- 左が元、右が変換後。変換後のレイヤーを `clip-path` で切り、境界線（role=slider）をドラッグ・矢印キーで動かす。
- `fit` は等倍上限で枠に収める（ResizeObserver）。`1` / `2` はピクセル寸法の 1 倍・2 倍でスクロール表示（2 倍は画像を pixelated）。
- 中身は `img` / `video` のどちらでもよい。表示枠の高さは CSS 変数 `--compare-height` で変えられる。

## 圧縮プレビュー
- 画像: `images/image-preview.js` の `openImagePreview({ item, caps, getSettings, onSettingsChange, onClose? })`。選んだ形式だけを有効にした設定で `expandVariants()` の最大サイズを 1 つエンコードする。Worker が使えれば専用プール（size 1）で実行し、新しい依頼が来たら実行中の Worker を terminate して作り直す。品質と「出力に含める」は settings を直接書き換え、閉じるときに 1 回だけ `onSettingsChange` を呼ぶ。ツールの `deactivate()` で閉じる。
- 動画: `video/video-preview.js` の `createSamplePreview({ caps, getItem, getSettings, getPlayhead, getDuration })` → `{ el, markStale(), reset(), pause() }`。`constrainVideoSettings()` 後の設定の `trim` を再生位置から N 秒に差し替え、`video-pipeline.js` の `convertWithFallback()` で変換する。推定サイズ = サンプルのバイト数 ÷ サンプル秒数 × トリム範囲の秒数。
- item.id をキーに `data-id` 付きカードを差分更新。チェックボックス（選択）、サムネ、名前、メタ、状態バッジ、進捗、出力行、削除ボタン。

## `src/ui/actionbar.js`
```js
createActionBar({ primaryLabel, onPrimary, onCancel, onZip, onSaveDir?, onClear, onSelectAll }) → { el, setSummary(text), setRunning(bool), setCounts({ selected, total, outputs }), setZipEnabled(bool) }
```

## ツール登録インターフェース

画像・動画ツールは `createTool(ctx)` を export し、`main.js` が動的 import する。計算ツールは `calculators.js` の `createPercentTool()` などのファクトリ関数を `main.js` が静的 import する（戻り値の形は同じ）:
```js
export function createTool(ctx /* { caps, store? } */) → {
  id, title, subtitle, icon,             // icon はスプライト名
  group: 'calc'|'convert',
  main: Node,                             // 中央
  aside: Node | null,                     // 右パネル（なければ 2 カラム）
  activate?(), deactivate?()
}
```
`src/main.js` が `TOOLS = [percent, vw, ratio, clamp, images, video]` の順でサイドバーを生成し、`router.js` の `#/<id>` で切替。

## テーマ（`src/theme.js`）
`initTheme()`：`localStorage['was.theme']` が 'light'|'dark' なら `<html data-theme>` に設定。無ければ OS 追従（data-theme なし）。`toggleTheme()`。

## 設定の永続化
各ツールは `localStorage['was.settings.<toolId>']` に JSON 保存、起動時に DEFAULTS とマージ。

## 画像設定（`image-settings.js`）
```js
DEFAULTS = {
  formats: { webp:{enabled:true, quality:80, lossless:false, effort:4},
             avif:{enabled:false, quality:60, lossless:false, effort:6},
             jpeg:{enabled:false, quality:82, background:'#ffffff'},
             png:{enabled:false} },
  resize: { mode:'none'|'width'|'height'|'scale'|'box', width:null, height:null, scale:100, fit:'contain', upscale:false },
  srcset: { enabled:false, widths:[480,768,1024,1440,1920], includeOriginal:true },
  naming: { pattern:'{name}{suffix}.{ext}', sizeSuffix:'-{w}w', lowercase:false, slugify:false },
  snippet: { pathPrefix:'/assets/img/', sizes:'(max-width: 768px) 100vw, 768px', lazy:true },
}
expandVariants(settings, meta{width,height}) → [{ id, format, ext, mime, width, height, quality, lossless, effort, background, suffix }]
PRESETS = { web:{...}, hq:{...}, thumb:{...} }
```
Worker ジョブ: `{ jobId, file, variants }` → `meta`, `output{variantId, blob, width, height}`, `progress{done,total}`, `done`, `error`。

## 動画設定（`video-settings.js`）
```js
DEFAULTS = {
  container:'webm', video:{ codec:'vp9', mode:'transcode'|'copy', resize:{mode:'none',width:null,height:null,scale:100,fit:'contain'}, fps:null, bitrateMode:'preset'|'custom', preset:'high', bitrate:4000000 },
  audio:{ mode:'keep'|'mute', codec:'auto', bitrate:128000 },
  trim:{ start:0, end:null },
  poster:{ enabled:false, time:0, format:'jpeg', quality:85, width:null },
}
CODEC_MATRIX = { webm:{video:['vp9','vp8','av1'], audio:['opus']}, mp4:{video:['avc','hevc','av1'], audio:['aac','opus']} }
constrainVideoSettings(settings, caps) → { settings, warnings[] }
```
エンジン: `convert(file, settings, { onProgress(p), signal }) → Promise<{ blob, mime, ext, warnings[] }>`。
`video-pipeline.js` が `convertWithFallback(file, settings, { onProgress, signal, caps, onEngine? })`（エンジン選択と MediaRecorder への切り替え）と `preferredEngine(caps)` を export する。

## CSS トークン名（`css/tokens.css`）
`--bg-0 --bg-1 --bg-2 --bg-3 --fg-0 --fg-1 --fg-2 --border --border-strong --accent --accent-fg --accent-soft --success --warning --danger --radius-s --radius-m --radius-l --font-sans --font-mono --shadow-1 --space-1..8(4pt) --text-xs..2xl --ease-out --ease-in-out --dur-fast --dur-base`
ダークが既定。`@media (prefers-color-scheme: light) :root:not([data-theme="dark"])` と `:root[data-theme="light"]` でライト上書き。

## ブレークポイント
≥1280: 3カラム（240 / 1fr / 320）。900–1279: サイドバー 64px アイコンレール。600–899: 上部ナビ横スクロール、右パネルはメイン上部の `<details>`。<600: 1カラム、アクションバーを画面下固定。`html, body { overflow-x: clip }`。

## 実装上の注意（統合テストで判明）
- `caps` は `probeCapabilities()` 完了まで全て false。ツールは生成時に caps を固定せず、実行時に評価するか `probeCapabilities().then(再描画)` を使う（image-pipeline の Worker 判定、video-tool のエンジン表示で修正済み）。
- `.video-preview` は 16:9 の枠で中の `video` を絶対配置するため、トリム操作などの兄弟要素は枠の外に置く。
- 内蔵ブラウザでのテストは、`fetch` した Blob を `File` にして `DragEvent('drop')` をドロップゾーンに発火させる方法で行える。
