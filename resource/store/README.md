# ストア掲載用リソース

ChromeウェブストアとFirefoxアドオン（AMO）向けの文章・画像素材です。掲載文の準備と、実際のアップロード・公開は別の作業です。

| ファイル | 用途 |
| --- | --- |
| [listing.ja.md](listing.ja.md)、[listing.en.md](listing.en.md)、[listing.zh_CN.md](listing.zh_CN.md) | 名前、概要、機能・対象範囲・保存と機密情報の説明。概要は各言語のmanifestの説明（`public/_locales/<言語>/messages.json` の `appDesc`）と同じ文にし、Chromeの上限の132文字以内に収める |
| [privacy.md](privacy.md) | 単一用途、権限、端末内処理・ブラウザー同期・復旧データの説明 |
| [src/copy.json](src/copy.json) | 画像生成用の3言語コピー原稿。既存schemaを維持 |
| `images/screenshot-<言語>-1.svg`〜`4.svg` | 純ベクターの機能説明図（1〜3）と実撮影を埋め込んだChrome設定画面の抜粋（4） |
| `images/promo-small-<言語>.svg`、`images/promo-marquee-<言語>.svg` | プロモーション画像のベクター原稿 |
| `../../public/image/icon128.png` | ストアアイコン |

`copy.json`を編集しても既存画像は更新されません。画像の寸法・撮影内容・現在の候補との一致は、画像作業時に確認します。

## 掲載する文章

3言語で操作の対象・Chromeのみのグループ化・globと正規表現の違いを揃えます。保護・通常／プライベート・コンテナー境界、既定OFFの確認画面、期限前にも消える復元記録、URLルール2項目だけのlocal化、JSONと同期先に含まれる機密情報も説明します。

対象はデスクトップ版Chrome 123以降とFirefox 112以降です。Firefox for Androidは対象外で、AMO提出時にAndroid互換を指定しません。宣言下限と実際の検証済み範囲は[ブラウザー対応](../../docs/browser-support.ja.md)で区別します。

## 配布物と掲載作業

1. [開発手順](../../docs/development.ja.md)に従い、検証結果と制約を確認する。
2. `pnpm run build`で両ブラウザーの出力を作り、`pnpm run zip`で`dist/chrome.zip`・`dist/firefox.zip`を作る。
3. 標準readerでZIPのmanifest・実行資産・内容を確認し、対象ブラウザーで起動・保存・操作を確認する。
4. 公開工程で各ストアの対象ZIP、言語別の掲載文・画像、プライバシー説明を提出する。

掲載文の準備は公開や画像再生成の実行結果を示すものではありません。提出するZIPと画像を固定し、検証済みの範囲と未確認の範囲を区別します。公開は掲載先・対象版を確認してから行います。

## 画像生成元

生成元は`src/generate.ts`、共通部品は`src/svg.ts`、説明図は`src/screenshot-svg.ts`、プロモーション画像は`src/promo-svg.ts`です。全18点をSVG原稿として保持します。画像1〜3は図形と文字による説明図、画像4は指定したChromeビルドの実設定画面（保存手順のエディター）をPNGで内部埋め込みしたSVGです。外枠・製品名・見出し・説明は画像4もベクターです。重複の説明図は同じURLのタブを示し、既定の対象内で最後のタブを残す例です。グループ化の説明図はChrome限定で、同じドメインをまとめ、ドメイン名を自動設定して折りたたんだ状態を示します。

`node resource/store/src/generate.ts`で全画像を生成します。`STORE_OUTPUT_DIR`で出力先、`STORE_IMAGES`で出力するSVG名をカンマ区切りで指定できます（例：`screenshot-ja-2.svg,screenshot-ja-4.svg`）。省略時は全18点を生成します。PNG名など未知の出力名はエラーになります。説明図1〜3とプロモーション画像だけを選べばNode.jsのみで実行でき、ブラウザーやChromeビルドを使用しません。`node resource/store/src/promo-svg.ts`も3言語・2サイズのプロモーションSVGだけを生成します。

画像4の実撮影だけは`src/capture.ts`が既存のplaywright-coreとChromiumを使います。`CHROMIUM_PATH`に既存ブラウザー、`PLAYWRIGHT_CORE_PATH`に既存モジュール、`STORE_DIST_DIR`に現在のソースから作成したChromeビルドを指定します。`STORE_TEMP_DIR`には一時ファイル・撮影PNG・描画範囲の検査記録・隔離プロファイルの保存先を絶対パスで指定します。撮影は実拡張ページをheadlessで開き、保存手順のエディターに保存しない例（手順名、すべての対象ウィンドウ、3つの操作）を入力します。「手順を編集」の見出しから最後の操作項目までを区切ります。文字の描画範囲と横方向のはみ出しを検査します。設定画面の配置や文言を変更した場合は、HTML・ロケール・options entryが揃ったビルドで撮影し直します。

背景・ロゴ・ウィンドウ・タブは編集できる図形とパス、文字はSVGのtextです。背景・ブランド・コピー・説明図／撮影を名前付きのレイヤーに分け、ロゴはsymbol/useで共有します。ロゴは`resource/icon.ai`由来の`src/logo.svg`を使い、灰色のパスを保持し、橙色の円をcircleで表します。疑似グラデーションやHTML描画は使いません。

製品名OhMyTabは全18点で共通のSegoe UI・太さ800を指定します。説明文は`copy.json`のローカルフォント指定に従い、英語はSegoe UI、日本語はYu Gothic UI、中国語はMicrosoft YaHei UIを優先します。指定フォントがない端末では後続のフォントへ切り替わるため、提出前に実際のフォント・文字の描画範囲・余白を確認します。フォントの取得や埋め込みは行いません。

### ストア提出用のPNG

[Chromeウェブストアの公式仕様](https://developer.chrome.com/docs/webstore/cws-dashboard-listing)では、小画像は440×280、横長画像は1400×560のPNGまたはJPEGです。SVGは編集用の原稿で、提出時には選択したSVGを既存Chromiumで同じ寸法で表示し、PNGを`.tmp/store-upload/`などの別ディレクトリへ明示的に書き出します。3言語の原稿を保持しますが、Chromeウェブストアのプロモーション画像は言語別登録に対応しないため、掲載する言語を選びます。

既存playwright-coreを使う場合は、`chromium.launch({ executablePath: CHROMIUM_PATH })`でブラウザーを起動し、SVGの寸法を指定した`newPage({ viewport: { width, height }, deviceScaleFactor: 1 })`で原稿を開きます。`document.fonts.ready`を待ってから、`page.screenshot({ path: 出力先PNG })`で保存します。出力先を`images/`にせず、提出用PNGとSVG原稿を分けます。通常の生成処理は旧スクリーンショットPNGやプロモーションPNGを再作成しません。
