# Web Asset Studio v2

フロントエンド開発で使う計算と、画像・動画の変換を、ブラウザの中だけで行うツールです。ファイルはサーバーへ送信されません。

## 主な機能

- 計算ツール（4種）
  - px → %：親要素のサイズと対象のサイズから割合を求めます。
  - px → vw：画面幅と対象のサイズから vw の値を求めます。
  - アスペクト比：幅と高さを約分し、`aspect-ratio` に書ける比率を求めます。
  - Fluid clamp()：画面幅に応じてサイズが滑らかに変わる `clamp()` を生成します。
- 画像変換
  - WebP / AVIF / JPEG / PNG への一括変換（複数形式・複数サイズを同時に書き出し）
  - リサイズ、`srcset`（画面幅ごとに読み込む画像を切り替える複数サイズ指定）、ファイル名パターン
  - `<picture>` タグのコード生成、ZIP またはフォルダへの保存
- 動画変換
  - WebM / MP4 への変換（コーデック、解像度、FPS、ビットレート、音声、トリムの指定）
  - ポスター画像（動画の代表フレームを静止画で書き出し）の生成
  - `<video>` タグのコード生成

## 動作要件

| 項目 | 内容 |
| --- | --- |
| ブラウザ | 最新のモダンブラウザ。Chrome と Edge を推奨します。Safari と Firefox は未検証です。 |
| ネット接続 | 必要です。無料のオープンソースライブラリを CDN から読み込みます（下記の表を参照）。 |
| 動画の変換方式 | WebCodecs（ブラウザ内蔵の動画エンコード機能）に対応していれば高速に変換します。非対応の場合は MediaRecorder（再生しながら録画する方式）に自動で切り替わります。 |
| 配信方法 | 静的サーバー経由で開く必要があります（次の「起動方法」を参照）。 |

## 起動方法

ビルドは不要です。このディレクトリを静的サーバーで配信し、ブラウザで開きます。`file://` で直接開くと、ES Modules と Web Worker が動かないため使えません。

### MAMP を使う場合

プロジェクトを MAMP の `htdocs` 配下に置き、次の URL を開きます。ポートは MAMP の設定で決まります（8080 や 8888 が一般的です）。

```
http://localhost:<MAMPのポート>/myApp/WEB-ASSET-STUDIO/
```

### Python を使う場合

プロジェクト直下で次を実行し、`http://localhost:8000/` を開きます。

```
python3 -m http.server 8000
```

画面が古いままのときは、ブラウザのキャッシュが残っています。スーパーリロード（Cmd/Ctrl+Shift+R）を試してください。詳細は [docs/USAGE.md](docs/USAGE.md) のトラブル対応を参照してください。

## 使用ライブラリ

すべて無料のオープンソースです。URL の定義は `src/lib/vendor.js` の1か所だけにあります。

| 名前 | バージョン | ライセンス | 用途 | 読み込み元 |
| --- | --- | --- | --- | --- |
| @jsquash/webp | 1.5.0 | Apache-2.0 | WebP エンコード（libwebp を WebAssembly 化したもの） | esm.sh |
| @jsquash/avif | 2.1.1 | Apache-2.0 | AVIF エンコード（libavif を WebAssembly 化したもの） | esm.sh |
| fflate | 0.8.3 | MIT | ZIP ファイルの作成 | esm.sh |
| mediabunny | 1.61.3 | MPL-2.0 | 動画の解析・変換・フレーム取得（WebCodecs を利用） | cdn.jsdelivr.net |

画面の文字には Google Fonts の Inter と JetBrains Mono（SIL Open Font License）を使います。読み込めない場合は代替フォントで表示されます。

## ディレクトリ構成

```
index.html            画面の骨格とアイコン（SVG スプライト）
css/                  tokens（色・余白などの値）、base、components、layout、tools
src/
  main.js             起動処理（ツール登録、サイドバー、ショートカット）
  router.js           ハッシュによるツール切替（#/images など）
  store.js            画像・動画のキュー状態
  theme.js            ライト／ダークテーマ
  capabilities.js     ブラウザ機能の検出
  lib/                汎用関数（DOM 作成、ダウンロード、CDN 読み込み、Worker プールなど）
  ui/                 共通 UI 部品（ボタン、ドロップゾーン、ファイルカード、操作バー）
  tools/
    calculators/      計算ツール4種
    images/           画像変換（encoders/ にエンコーダ）
    video/            動画変換（engines/ に変換エンジン）
docs/                 ドキュメント
```

## ドキュメント

| ファイル | 対象 | 内容 |
| --- | --- | --- |
| [docs/USAGE.md](docs/USAGE.md) | 利用者 | 画面の見方、各ツールの使い方、トラブル対応 |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | 開発者 | 技術方針、モジュール構成、機能の追加手順、手動テスト |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 開発者 | 設計の契約（インターフェース、データ構造、設定値の定義） |

## 制限事項

- 処理はすべてブラウザ内で完結し、ファイルをサーバーへ送信しません。ただしライブラリと Web フォントの読み込みのため、ネット接続は必要です。
- AVIF は、圧縮の手間（effort）を高くすると変換に時間がかかります。大きな画像を複数枚処理するときは、既定値付近から始めてください。
- MediaRecorder 方式の動画変換は、再生しながら録画するため、動画の再生時間と同じ時間がかかります。変換中はタブを前面に出したままにしてください。
- 「フォルダに保存」は Chrome と Edge でのみ表示されます。ほかのブラウザでは ZIP または個別ダウンロードを使ってください。
- Safari と Firefox は実機で確認していません。動かない機能がある場合は Chrome か Edge を使ってください。
