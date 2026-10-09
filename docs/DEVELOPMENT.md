# 開発ガイド

Web Asset Studio v2 の開発者向けドキュメントです。設計の契約（関数のシグネチャ、データ構造、設定値の定義）は [ARCHITECTURE.md](ARCHITECTURE.md) にあります。このガイドは、その内容と矛盾しないよう、作業の進め方と注意点をまとめたものです。利用者向けの説明は [USAGE.md](USAGE.md)、概要は [../README.md](../README.md) を参照してください。

## 1. 技術方針

| 方針 | 内容 |
| --- | --- |
| ビルドなし | バンドラーもトランスパイラーも使いません。書いたファイルがそのままブラウザで動きます |
| ES Modules | `<script type="module">` と `import` / `export` を使います。Worker も module Worker です |
| 相対 import と拡張子 | `import { h } from './lib/dom.js'` のように、相対パスで書き、拡張子 `.js` を必ず付けます。静的サーバーは拡張子を補ってくれないためです。絶対パス（`/src/...`）は使いません |
| innerHTML 禁止 | 利用者由来の文字列（ファイル名など）を `innerHTML` に入れません。DOM は `src/lib/dom.js` の `h()` で組み立てます |
| トークン参照 | 色とフォントは `css/tokens.css` のカスタムプロパティ（`var(--accent)` など）を使い、生の色コードを各所に書きません |
| CDN は vendor.js のみ | 外部ライブラリの URL は `src/lib/vendor.js` だけに書きます。Worker 内でも同じ URL を使います |
| 無料のみ | 無料のオープンソースライブラリと無料の CDN だけを使います |
| 表記 | UI の文言は日本語です。コードのコメントは簡潔に書きます。絵文字は使いません。アイコンは `index.html` の SVG スプライト（`<symbol id="i-*">`）を `<use href="#i-*">` で参照します |

### localStorage のキー

| キー | 内容 |
| --- | --- |
| `was.theme` | `light` または `dark`（未設定なら OS に従う） |
| `was.panel.open` | 設定パネルの開閉（`1` または `0`。900px 未満で使用） |
| `was.settings.<toolId>` | 各ツールの設定と入力値（`percent`、`vw`、`ratio`、`clamp`、`images`、`video`） |

読み書きはすべて `try / catch` で囲み、保存できなくても動くようにします（プライベートモードなどで例外が出るためです）。

## 2. ローカル起動とキャッシュ対策

1. MAMP を起動し、`htdocs/myApp/WEB-ASSET-STUDIO/` を配信します。URL は `http://localhost:<ポート>/myApp/WEB-ASSET-STUDIO/` です（ポートは 8080 か 8888 が一般的です）。
2. MAMP を使わない場合は、プロジェクト直下で `python3 -m http.server 8000` を実行します。
3. `file://` では ES Modules と Worker が動かないため、必ず HTTP で開きます。

ES Modules はファイルごとに別々にキャッシュされるため、修正した一部だけが古いまま残ると、原因の分かりにくい不具合になります。開発中は次の設定にします。

- ブラウザの開発者ツールを開き、「Network」タブで「Disable cache」にチェックを入れます（開発者ツールを開いている間だけ有効です）。
- 修正が反映されないときは、Cmd/Ctrl + Shift + R でスーパーリロードします。
- Worker のスクリプト（`image-worker.js`）が古いままのときは、「Disable cache」を有効にして再読み込みします。それでも直らなければ、タブを開き直します。

画像・動画ツールは `main.js` が動的に import します。ツールの読み込みに失敗すると、そのツールは「このツールは準備中です。」の表示になり、原因はコンソールの警告（`[main] ... を読み込めませんでした`）に出ます。構文エラーや import 先のパス間違いは、まずコンソールを確認してください。

## 3. モジュール構成

```
index.html              画面の骨格、SVG スプライト
css/                    tokens / base / components / layout / tools
src/main.js             起動。ツールの登録、サイドバー、ルーター、ショートカット、機能検出
src/router.js           #/<id> でツールを切り替える
src/store.js            画像・動画のキュー状態（createStore）
src/theme.js            テーマの初期化と切替
src/capabilities.js     ブラウザ機能の検出（caps）
src/lib/
  dom.js                h()、icon()、clear()、uid()、escapeFilename()
  vendor.js             CDN の URL と、ライブラリの読み込み関数
  worker-pool.js        module Worker のプール
  download.js           個別保存、ZIP、フォルダ保存
  naming.js             ファイル名の生成、重複の解消
  objecturl.js          Object URL の登録と解放（所有者単位）
  clipboard.js          コピーとトースト通知
  format.js             バイト数、時間、削減率の整形
src/ui/                 components（ボタン、モーダル等）、dropzone、filegrid、actionbar、compare（変換前後の比較ビュー）
src/tools/calculators/  calc-math.js（計算式）、calculators.js（4ツールの UI）
src/tools/images/       画像変換（下記）
src/tools/video/        動画変換（下記）
```

### 起動の流れ（main.js）

1. `initTheme()` を呼びます。
2. `boot()` で、画像・動画ツールを動的 import します（失敗時は準備中の表示に置き換えます）。
3. `TOOLS` 配列を作り、サイドバー、設定パネルの開閉ボタン、ルーターを組み立てます。
4. `router.start()` で、URL のハッシュに応じたツールを表示します。
5. `probeCapabilities()` を、初回描画の後に非同期で実行します。完了するとサイドバー下部の表示を更新します。

## 4. 処理の流れ

### 画像変換

```
dropzone → store → (サムネイル生成) ─────────────┐
                                                 │
「変換を開始」→ image-tool.runItems              │
  → validateSettings                             │
  → image-pipeline.run                           │
      store.resetForRerun                        │
      レーン数 = min(CPU コア数, 4) で並行実行   │
      各画像: ensureMeta → expandVariants        │
        → worker-pool.run({ file, variants, caps })
          → image-worker.js
            → image-process.processJob
              デコード → 出力サイズごとに描画（リサイズ・切り抜き）
              → encoders/index.js の selectEncoder
                 webp: jSquash（失敗時は canvas の WebP）
                 avif: jSquash
                 jpeg / png: canvas
              → meta / output / progress / done を送信
        → store.addOutput（Object URL、ファイル名を付与）
      最後に dedupeBatch（同名ファイルに -2、-3 を付与）
```

- 画像の追加（`image-tool.js` の `createDropzone`）で、`store.add` と、サムネイル生成の要求（`requestThumb`）を行います。サムネイルは1枚ずつ順番に作り、作成時に画像の幅と高さを `meta` に入れます。
- Worker とのやり取りは `{ jobId, ... }` の形式です。Worker 側は `output`（1ファイル分の Blob）、`progress`、`done`、`error` を返します。中止時は `cancelled` の後に `error`（メッセージ `cancelled`）を返し、プールが完了扱いにできるようにしています。
- Worker が使えない環境（module Worker か OffscreenCanvas が使えない）では、メインスレッドで `processJob` を直接呼びます。この場合は1枚ずつ順に処理し、進捗のたびに UI へ処理を譲ります（`image-pipeline.js` の `runInline`）。
- 出力サイズと形式の組み合わせ（バリアント）は、`image-settings.js` の `expandVariants()` が決めます。ファイル名は `image-pipeline.js` の `outputFilename()` が、`naming.js` の `buildName()` で作ります。
- `<picture>` コードは `snippets.js`、集計は `stats.js` が担当します。
- 圧縮プレビュー（`image-preview.js`）は、変換キューとは別に 1 形式・最大サイズだけをエンコードします。Worker は専用のプール（1 本）を使い、品質を動かして新しい依頼が来たら、実行中の Worker を止めて作り直します（WASM のエンコードは途中で止められないためです）。結果は store に入れず、Object URL はプレビューを閉じるときに解放します。

### 動画変換

```
dropzone → store → probe.probeVideo（長さ・寸法・コーデック等）→ makeThumbnail
                    └ mediabunny で失敗したら <video> 要素で代替

「変換を開始」→ video-tool.runItems（トリムの検証）
  → video-pipeline.run
      constrainVideoSettings（環境に合わせて設定を補正し、警告を通知）
      動画を1本ずつ順に処理:
        resetForRerun → 状態を processing に
        convertItem: エンジンを選ぶ
          caps.webcodecs && !caps.mediabunnyError → mediabunny-engine
          それ以外 → mediarecorder-engine
          mediabunny が「コーデック未対応」系のエラーなら mediarecorder-engine で再試行
        → store.addOutput（kind: 'video'）
        poster.enabled なら poster.extractPoster → store.addOutput（kind: 'poster'）
```

- エンジンは `convert(file, settings, { onProgress, signal, caps })` を実装し、`{ blob, mime, ext, warnings }` を返します（契約は ARCHITECTURE.md を参照）。
- 中止は `AbortController` で伝えます。エンジンは `name: 'AbortError'` のエラーを投げ、パイプラインはそれを中止として扱います。
- `poster.js` は、mediabunny の `CanvasSink` でフレームを取り出し、失敗したら `<video>` 要素で代替します。静止画の書き出しは画像側の `selectEncoder` を再利用します。
- 圧縮プレビュー（`video-preview.js`）は、設定の `trim` を「再生位置から N 秒」に差し替えて `convertWithFallback()` で変換します。比較表示では、変換後の動画を基準に、元の動画を開始位置の分だけずらして同期再生します（ずれが 0.15 秒を超えたら合わせ直します）。
- mediarecorder-engine は、`video` 要素を再生しながら canvas に描画し、`MediaRecorder` で録画します。変換には再生時間と同じ時間がかかります。音声コーデックと音声ビットレートの指定は反映されません。

## 5. ツールの追加手順

ツールは `createTool(ctx)` を export するモジュールとして作ります。戻り値の形は ARCHITECTURE.md の「ツール登録インターフェース」を参照してください。

```js
export function createTool(ctx /* { caps } */) {
  return {
    id, title, subtitle, icon,      // icon は SVG スプライトのシンボル名
    group: 'convert',               // 'calc' または 'convert'（サイドバーの見出し）
    main: Node,                     // 中央に表示する要素
    aside: Node | null,             // 右パネル。null なら 2 カラム表示
    activate() {},                  // 画面に表示されたとき（省略可）
    deactivate() {},                // 別のツールに切り替わるとき（省略可）
  };
}
```

手順は次のとおりです。

1. `src/tools/<名前>/<名前>-tool.js` を作り、`createTool` を export します。
2. 新しいアイコンが必要なら、`index.html` の SVG スプライトに `<symbol id="i-名前" viewBox="0 0 24 24" ...>` を追加します（既存の `i-image` などと同じ線の太さ・スタイルにそろえます）。
3. `src/main.js` に登録します。
   - 画像・動画のように重いツールは、`boot()` の `Promise.all` に `loadConvertTool('./tools/<名前>/<名前>-tool.js', { id, title, subtitle, iconName })` を足します。読み込みに失敗しても、他のツールは動き続けます。
   - 計算ツールのように軽いものは、`calculators.js` のように `createXxxTool()` を export し、`main.js` で import して呼びます。
   - 最後に、`TOOLS` 配列へ追加します。配列の順番が、サイドバーの並び順と Option/Alt + 数字のショートカットの番号になります。ショートカットは1桁の数字（1 から 9）だけを想定しているため、ツールが 9 個を超える場合は `main.js` のキー処理を見直してください。
4. 設定を保存するなら、`localStorage['was.settings.<id>']` に JSON で保存し、起動時に既定値とマージして読み込みます（`image-settings.js` の `loadSettings` が参考になります）。
5. 画面全体に効くイベント（`document` の keydown など）は、`activate()` で登録し、`deactivate()` で解除します。`image-tool.js` と `video-tool.js` の Cmd/Ctrl + Enter が例です。
6. ファイルを扱うツールは、`createStore(kind)` でキューを作り、`createDropzone`、`createFileGrid`、`createActionBar` の共通部品を組み合わせます。
7. ARCHITECTURE.md の `TOOLS` の記述と、このガイド、USAGE.md、README.md を更新します。

`main` と `aside` の要素は、ツールを切り替えても破棄されず、再び表示されるときにそのまま使われます。入力途中の内容や結果は、切り替えても残ります。

## 6. 設定項目の追加手順

### 画像変換

1. `image-settings.js` の `DEFAULTS` に項目と既定値を追加します。保存済みの設定とは `deepMerge` で統合され、型が違う値は無視されます。
2. 入力に制約があるなら、`validateSettings()` にエラー文言を追加します。
3. `settings-panel.js` に操作部品を追加します。`settings` オブジェクトを直接書き換え、`onChange()` を呼びます。`onChange` が保存と、完了済みカードへの「設定が変更されました」表示（`store.markStale()`）を行います。
4. 出力に反映するなら、`expandVariants()` の `variantFor()` が作るバリアントにも値を渡します。
5. エンコーダのオプションにするなら、`encoders/index.js` の `wasmOptions()` に追加し、`webp.js` または `avif.js` でライブラリのオプションへ渡します。
6. プリセット（`PRESETS`）、ファイル名（`image-pipeline.js` の `outputFilename`）、コード出力（`snippets.js`）に関係する場合は、そこも更新します。
7. ARCHITECTURE.md の「画像設定」の記述を更新し、手動テストで確認します。

### 動画変換

1. `video-settings.js` の `DEFAULTS` に追加します。`loadSettings()` の統合処理は、`DEFAULTS` にないキーを読み込まないため、必ず `DEFAULTS` に先に書きます。
2. `video-tool.js` の設定パネル（`aside`）に部品を追加し、値が変わったら `changed()` を呼びます。表示の出し分けは `updateDerived()` に書きます。
3. 環境によって使えない値があるなら、`constrainVideoSettings()` で補正して警告を返します。
4. 変換への反映は、`engines/mediabunny-engine.js`（`Conversion.init` のオプション）と、`engines/mediarecorder-engine.js` の両方で検討します。片方だけが対応する設定は、設定パネルまたは USAGE.md に注意書きを入れます。

## 7. CDN ライブラリの更新手順

1. `src/lib/vendor.js` の `CDN` にある URL のバージョン番号を変更します。バージョンは必ず固定します（`@latest` や範囲指定は使いません）。
2. ブラウザのコンソールで、新しい URL を import できることを確認します。

   ```js
   const m = await import('https://esm.sh/@jsquash/webp@<新バージョン>/encode');
   typeof m.default; // 'function' であること（encode 関数）
   ```

3. 次を手動で確認します。
   - jSquash：画像変換で WebP と AVIF が出力できること。
   - fflate：ZIP をダウンロードして、展開できること。
   - mediabunny：動画の解析、変換、トリム、ポスター、キャンセルが動くこと。ARCHITECTURE.md の「mediabunny（確認済み API）」の関数が、変更されていないことも確認します。
4. ARCHITECTURE.md の CDN の記述と、README.md のライブラリ表（バージョン、ライセンス）を更新します。

Worker 内でも同じ URL が使われます。`image-worker.js` が `image-process.js`、`encoders/*.js`、`vendor.js` の順に import するため、`vendor.js` を直せば、メインスレッドと Worker の両方が新しい URL になります。import map は使いません。

`vendor.js` の読み込み関数は、import の Promise をキャッシュします。読み込みに失敗した場合はキャッシュを捨てるため、ネット接続が戻れば再試行できます。

## 8. 既知の注意点

### capabilities は非同期で埋まる

`caps`（`src/capabilities.js`）は、`probeCapabilities()` が完了するまで、すべて `false`（`ready` も `false`）です。ツールの生成時に `caps` の値を取り出して固定しないでください。次のどちらかにします。

- 実行する時点で評価する。例：`image-pipeline.js` の `useWorkers()`、`video-pipeline.js` の `preferred()`。
- `probeCapabilities().then(再描画)` で、完了後に画面を作り直す。例：`video-tool.js` の `activate()`。

`video-settings.js` の `isVideoEncodable()` と `isAudioEncodable()` は、`caps.ready` が `true` になるまで、コーデックを絞り込みません（すべて使えるものとして扱います）。

### .video-preview の内側は absolute 配置

`.video-preview` は 16:9 の枠で、中の `video`、`canvas`、`img` を絶対配置（`position: absolute; inset: 0`）で重ねます。トリム操作などの兄弟要素を枠の内側に入れると、動画の裏に隠れます。必ず枠の外に置いてください（`video-tool.js` では `.video-preview` の次の要素にしています）。

### Safari の canvas WebP 問題

Safari は、canvas に WebP の書き出しを頼んでも、PNG の Blob を返すことがあります。そのため、次の対策を入れています。

- `encoders/canvas.js` の `encodeCanvas()` は、返ってきた Blob の `type` が要求した MIME と違えば、例外を投げます。
- `capabilities.js` の `testCanvasWebp()` も、`blob.type === 'image/webp'` で判定します。
- WebP は jSquash（WebAssembly）で書き出すことを優先し、読み込みに失敗したときだけ、canvas の WebP を、`caps.canvasWebp` が `true` の場合に限って使います。

Blob の `type` を確認せずに保存すると、拡張子が `.webp` でも中身が PNG のファイルができます。canvas の書き出しを追加するときは、必ず `encodeCanvas()` を通してください。

### Object URL の所有者

`createUrl(blob, ownerId)` で作った URL は、所有者単位で解放されます。`store.resetForRerun()` と `store.remove()` は、`item.id` を所有者とする URL をすべて解放します。再変換しても消えてほしくないもの（サムネイル、プレビュー）は、別の所有者名（`thumb-<id>`、`media-<id>`）で作っています。サムネイルを使う処理を追加するときは、同じ方法にしてください。

### そのほか

- 設定パネルは、`settings` オブジェクトを直接書き換える方式です。`image-tool.js` では、プリセット適用時だけ `settings` を差し替え、パネルを作り直します。
- キーボードショートカットは、日本語入力の変換中に誤って動かないよう、画像変換では `e.isComposing` を確認しています。

## 9. 手動テスト

自動テストはありません。変更したら、ブラウザで次を確認します。

### 内蔵ブラウザでの操作方法

ファイル選択ダイアログは自動操作できないため、`fetch` した Blob から `File` を作り、`DragEvent('drop')` をドロップゾーンに発火させます（ARCHITECTURE.md の「実装上の注意」の方法です）。コンソールで次を実行します。

```js
async function dropFiles(files /* File[] */) {
  const dt = new DataTransfer();
  files.forEach((f) => dt.items.add(f));
  document.querySelector('.dropzone')
    .dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
}

// 例1: 配信しているファイルを使う（同じ配信元か、CORS を許可した URL）
const blob = await (await fetch('path/to/sample.jpg')).blob();
await dropFiles([new File([blob], 'sample.jpg', { type: blob.type, lastModified: Date.now() })]);

// 例2: 画像を生成する（ファイル不要）
const c = new OffscreenCanvas(1600, 900);
const g = c.getContext('2d');
g.fillStyle = '#4a6fa5'; g.fillRect(0, 0, 1600, 900);
g.fillStyle = '#e8c547'; g.fillRect(200, 150, 800, 450);
const png = await c.convertToBlob({ type: 'image/png' });
await dropFiles([new File([png], 'generated.png', { type: 'image/png', lastModified: Date.now() })]);
```

動画は、数秒の短いファイルを配信ディレクトリの下に一時的に置き、同じ方法で `fetch` して追加します（テストが終わったら削除し、コミットしません）。名前、サイズ、更新日時が同じファイルは重複として追加されないため、同じファイルを繰り返し追加するときは `lastModified` を変えてください。

### 機能検出を書き換えて分岐を試す

`caps` はモジュールの共有オブジェクトです。コンソールから動的に import して書き換えると、他の環境の動作を再現できます（相対パスは、開いているページの URL からの位置で解決されます）。

```js
const { caps } = await import(new URL('src/capabilities.js', location.href));
caps.webcodecs = false;      // 動画を MediaRecorder で変換する分岐を試す
caps.moduleWorker = false;   // 画像をメインスレッドで変換する分岐を試す
```

画像変換の Worker プールは、最初の変換で作られると再利用されます。`caps.moduleWorker` の書き換えは、ページを再読み込みしてから、最初の変換の前に行ってください。動画ツールの表示（通知やコーデックの選択肢）は、別のツールに切り替えてから戻ると更新されます。

### 確認項目

画像変換

- [ ] ドロップ、クリック、Cmd/Ctrl + V の3通りで追加できる。画像以外のファイルは無視され、通知が出る。
- [ ] 同じファイルの再追加で「すでに追加済み」と通知される。
- [ ] 初期設定（WebP のみ）で変換でき、出力行に形式、サイズ、削減率が出る。
- [ ] WebP、AVIF、JPEG、PNG をすべて有効にすると、形式の数だけ出力される。AVIF が完了する。
- [ ] 可逆圧縮をオンにすると、品質スライダーが無効になる。
- [ ] srcset をオンにすると、元の幅より小さい幅だけが書き出され、「元のサイズも含める」で最大幅が加わる。ファイル名に接尾辞（`-480w` など）が付く。
- [ ] リサイズの各指定（幅、高さ、倍率、枠の3種類）と「拡大を許可」の動作が正しい。
- [ ] 透過 PNG を JPEG にすると、背景色で塗りつぶされる。
- [ ] ファイル名パターン、小文字、URL 向け整形が反映される。同名ファイルは `-2` が付く。
- [ ] 「コードをコピー」で、複数形式のときは `<picture>`、1形式のときは `<img>` になる。パスの接頭辞、sizes、lazy が反映される。
- [ ] 設定変更後、完了済みカードに「設定が変更されました」が出る。更新アイコンで1枚だけ再変換できる。
- [ ] 変換中のキャンセルで、処理待ちが「中止」になる。
- [ ] カードの圧縮プレビューで、元画像と変換後が重なって表示され、境界線をドラッグ・矢印キーで動かせる。形式の切替、品質の変更で変換し直され、サイズと削減率が更新される。100% と 200% でスクロールできる。
- [ ] 圧縮プレビューで変えた品質が、閉じた後の設定パネルに反映される。何も変えずに閉じた場合は、完了済みカードに「設定が変更されました」が出ない。
- [ ] 圧縮プレビューを開いたまま Option/Alt + 数字でツールを切り替えると、プレビューが閉じる。
- [ ] 壊れた画像（テキストを `.jpg` にしたもの）でエラー表示が出て、ほかの画像は変換される。
- [ ] ZIP をダウンロードして展開でき、中身が選択した画像の出力と一致する。「フォルダに保存」は Chrome で動作する。
- [ ] プリセット3種と「既定に戻す」が動く。
- [ ] `caps.moduleWorker = false` でも変換が完了する。
- [ ] EXIF で回転した写真の向きが正しい。

動画変換

- [ ] 追加後に、長さ、サイズ、FPS、コーデックがカードに出る。プレビューが再生でき、複数本のときに対象を切り替えられる。
- [ ] WebM（VP9）、MP4（H.264）に変換でき、再生できる。
- [ ] 「コピー（高速）」で、解像度などの設定欄が無効表示になり、変換できる。
- [ ] 解像度（幅、高さ、倍率、枠）、FPS、ビットレート（プリセット、指定）が出力に反映される。
- [ ] 「音声なし」で音声トラックがなくなる。
- [ ] トリム：「現在位置をセット」、バーの表示、終了位置が開始位置以前のときのエラーが動く。
- [ ] ポスター画像（JPEG、WebP、AVIF、時刻、幅）が書き出される。`<video>` タグに `poster` が入る。
- [ ] 変換中のキャンセルが効く。
- [ ] 圧縮プレビュー：再生位置から指定秒数で作成され、元の動画と同期して再生される。末尾付近やトリム範囲の外では、範囲内に収まるように開始位置がずれる。推定サイズが出る。設定変更で「設定が変更されました」が出て、「プレビューを更新」で作り直せる。作成中の「中止」が効く。
- [ ] ブラウザが未対応のコーデックは、選択肢が無効になり、設定パネル下部に警告が出る。
- [ ] `caps.webcodecs = false` で、「リアルタイム変換」の通知が出て、MediaRecorder で変換できる。
- [ ] ZIP 内のファイルが、同名でも重複しない。

画面と共通

- [ ] Option/Alt + 1 から 6 でツールが切り替わる。Cmd/Ctrl + Enter は画像・動画の画面だけで動き、ツールを切り替えても二重に実行されない。
- [ ] テーマ切替が動き、再読み込み後も保持される。OS のテーマにも従う。
- [ ] 画面幅 1280px、1279px、899px、599px の前後で、レイアウトが切り替わる（アイコンのみのサイドバー、上部ナビ、「設定」ボタン、画面下に固定された操作バー）。横スクロールが出ない。
- [ ] 設定パネルの開閉状態が、再読み込み後も保持される。
- [ ] 計算ツール4種が正しい値を出し、クリックでコピーできる。不正な入力でエラー表示になり、入力値が再読み込み後も残る。
- [ ] localStorage が使えない状態（プライベートウィンドウなど）でも、画面が崩れずに動く。
- [ ] Tab キーで主要な操作に到達でき、フォーカスが見える。
- [ ] コンソールにエラーが出ていない。

## 10. 未対応・今後の候補

- Safari と Firefox の実機確認。特に、Safari の WebP 書き出し、WebCodecs の可否、MediaRecorder の MP4 録画は未確認です。
- 自動テストの整備（計算式の `calc-math.js`、設定展開の `expandVariants()`、ファイル名生成の `naming.js` は、DOM に依存しないため、最初の対象にしやすい部分です）。
- ライブラリのローカル同梱。CDN を使わず、自分のサーバーからライブラリを配信する場合は、WebAssembly（`.wasm`）を正しい種類として返すために、Apache の設定が必要になることがあります。MAMP の場合は、配信ディレクトリの `.htaccess` に次を追加します。

  ```
  AddType application/wasm .wasm
  ```

  あわせて、`.mjs` が JavaScript として返されることも確認してください。
