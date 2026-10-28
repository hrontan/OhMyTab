# OhMyTab の開発手順

OhMyTabはTypeScript 7.0.2とVite 8.3.5でChrome／Firefox向けの拡張機能を生成します。ソースは `src/`、manifest・画面・翻訳・画像は `public/` にあります。対応版は[対応ブラウザー](browser-support.ja.md)を参照してください。

## クリーンな作業コピーの準備

Node.jsは `^22.18.0 || ^24.0.0 || >=26.0.0` の範囲を使う。pnpm 12に対応するNode.jsと、`packageManager` で固定したpnpm 12.14.0を用意する。依存関係の正本は `pnpm-lock.yaml` であり、導入時は `--frozen-lockfile` で更新を禁止する。CI定義の対象はWindows／Linux、Node.js 22.18.0／24.xである。配布物の読取り検査にはPython 3.13と標準ライブラリを使います。クリーンな作業コピーのルートで実行してください。

```powershell
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run lint
pnpm run test:lint
pnpm test
pnpm run test:build
pnpm run test:zip
pnpm run build
node --experimental-vm-modules scripts/checks/check-bundles.ts
pnpm run zip
python scripts/checks/check-distribution.py
```

各コマンドの終了コードが0であることを確認してから次へ進みます。これは現行scriptに対応する手順であり、実行成功の記録ではありません。使用したrevision、OS、Node.js、依存関係と各結果を保存し、失敗・未実施を区別します。

## ビルドと拡張機能の読み込み

`pnpm run build`はChrome、Firefoxの順に子ビルドを実行し、失敗を非ゼロで返します。出力は`dist_chrome/`と`dist_firefox/`です。`prebuild`や一時tsconfigの生成は使いません。片方だけなら`pnpm run build-chrome`または`pnpm run build-firefox`を実行します。

Viteはbackground・options・preview・undoの4 entryを個別にbundle化し、共有chunkなしの `background.mjs`・`options.mjs`・`preview.mjs`・`undo.mjs` を出力する。ビルドとVitest 5.0.5は同じブラウザ条件付き変換を使う。各出力には対象manifest、実行スクリプト、HTML、画像、3言語の翻訳を含めます。Firefoxはmoduleの非永続background scripts、Chromeはmodule Service Workerを使用します。

専用のブラウザープロファイルとテスト用タブを用意します。Chromeでは拡張機能管理画面の「パッケージ化されていない拡張機能を読み込む」で`dist_chrome/`を指定します。Firefoxでは`about:debugging`の一時的なアドオン読込みから`dist_firefox/manifest.json`を選びます。起動、初期設定の読込み、保存と再読込み、操作結果、メニューを別々に確認します。

## ZIPと生成物の削除

ZIPコマンドは再ビルドしません。ソース変更後は先にビルドし、その出力をZIP化します。

```powershell
pnpm run build
pnpm run zip
```

`dist/`を自動作成し、`chrome.zip`と`firefox.zip`を生成します。片方だけなら`pnpm run zip-chrome`または`pnpm run zip-firefox`を使います。Node.js組込みのZIP生成なので、OSの`zip`コマンドは不要です。

各ZIPの直下に対象ブラウザーの`manifest.json`を置き、preview／undoを含む必要な実行資産だけを収録します。他ブラウザーのmanifest、source map、開発ファイルは含めません。資産不足、manifest不一致、書込み失敗は非ゼロになります。失敗前のZIPが残る場合があるため、終了コードと内容を確認してください。

`pnpm run clean`は`dist_chrome/`・`dist_firefox/`・`dist/`だけを削除します。ソースや依存関係は削除しません。Makefileの`build`・`chrome`・`firefox`・`clean`・`test-build`は対応するpnpm scriptを呼ぶ補助です。WindowsではMakeを用意せずpnpm scriptを直接使えます。

## 型定義と静的検査

ViteのTypeScript変換は型検査を行わない。ビルド成功とは別に、TypeScript 7.0.2の `pnpm run typecheck` で製品・製品テスト・Node tooling・ストア画像生成元の型を確認する。CIでも独立した必須stepである。

ブラウザー型定義は `@types/chrome@0.3.6` と `@types/firefox-webext-browser@143.0.1` に固定する。前者のグローバル `browser` aliasが後者のnamespaceと衝突するため、[最小patch](../patches/@types__chrome@0.3.6.patch)でalias宣言の1行だけを削除する。Chromeの `chrome` API定義は変更せず、`browser` はFirefoxの型定義を使う。patchのSHA-256は `b05d0f04929e8720d1635ec4dd40c88cc2092fafdb65a3d57b66c021fce50b39` であり、[pnpm設定](../pnpm-workspace.yaml)とlockに結び付けて管理する。上流更新時は共存可否を再評価し、衝突が解消された場合や型定義の設計を変更した場合はpatchを除去する。他版へそのまま持ち越さない。

## 静的検査と利用仕様

`typecheck`は製品・テスト・tooling・ストア画像生成元の型を確認し、`lint`はファイルを書き換えません。`lint:fix`は明示的な修正用です。[テスト手順](testing.ja.md)と[CI定義](ci.ja.md)で対象と失敗伝播を確認できます。

URLルールは正規表現ではなくglobです。[構文と上限](pattern-matching.ja.md)、[セッション・保護・確認・復元](domain-operations.ja.md)、[保存先・JSON・同期の機密情報](settings-sync.ja.md)を参照してください。公開やストアへのアップロードは、開発手順の実行成功と別に扱います。

## Node toolingのTypeScript実行

手書きのビルド・配布・検査・benchmarkとストア画像生成元はTypeScriptで管理する。Node.js 22.18.0以降の対応範囲では、`node scripts/build/build.ts all` のように直接実行できる。Node.jsの型除去は型検査を行わず、tsconfigも読み込まない。実行前に `pnpm run typecheck` を行う。Node直接実行用のimportには `.ts` を明記し、型だけのimportには `import type` を使う。enumなど実行コードへの変換が必要な構文は使わない。追加runnerやruntime依存は不要である。

型検査の範囲は次のとおりである。どの移行ファイルも型検査から除外しない。

| 設定・コマンド | 対象 |
| --- | --- |
| `tsconfig.json` | 拡張機能の `src/` |
| `tests/tsconfig.json` | 製品テストとそのfixture。Node専用のtooling・benchmarkは次の設定が担当 |
| `pnpm run typecheck:tooling` / `tsconfig.tooling.json` | Vite/Vitest設定、`scripts/**/*.ts`、`tests/tooling/**/*.ts`、`tests/benchmarks/**/*.ts` |
| `pnpm run typecheck:store` / `resource/store/tsconfig.json` | `generate.ts`・SVG生成helper・局所Playwright宣言。Nodeに加え、評価callback用のDOM・Chrome型を使用 |

`pnpm run typecheck` は上の4範囲を順に検査する。Vitestは製品テストを担当し、Nodeの `node:test` を使うtooling・benchmarkテストは読み込まない。`test:build`・`test:zip`・`test:lint` は既存の契約をNodeで実行する。

benchmarkの小さい合成fixtureには `pnpm run test:benchmark-lifecycle` を使う。実行には `BENCHMARK_LIFECYCLE_OUT`（新規の結果保存先）と `BENCHMARK_LIFECYCLE_PLAN`（固定したNode・依存・workspace・計画JSON）が必要である。計画の境界と明示sampleは `tests/benchmarks/plan.ts` と `run-comparison.ts` が検証する。実製品の性能比較は[性能計測手順](performance.ja.md)に従う。

画像生成は `node resource/store/src/generate.ts` で実行する。説明図1〜3とプロモーション画像は純SVGとしてNode.jsだけで生成できる。画像4だけは実設定画面の撮影に既存の `playwright-core` と対応Chromium、現在のHTML・ロケール・options entryが揃ったChromeビルドを使い、撮影PNGをSVGへ内部埋め込みする。`STORE_IMAGES`にはSVG名を指定する。プロモーション画像のSVG原稿だけを生成する場合は `node resource/store/src/promo-svg.ts` を使い、Node.jsだけで実行できる。局所宣言はこの依存を導入せず、型検査成功も実ブラウザー実行や画像の妥当性を示さない。画像の実生成は[ストア資材](../resource/store/README.md)の作業として扱う。

### 移行したファイル

| 移行元 | 現行ファイル・理由 |
| --- | --- |
| `vite.config.js` | `vite.config.ts`。設定・入出力と実行境界を型検査するため |
| `vitest.config.js` | `vitest.config.ts`。設定・入出力と実行境界を型検査するため |
| `scripts/build/browser-branches.mjs` | `scripts/build/browser-branches.ts`。設定・入出力と実行境界を型検査するため |
| `scripts/build/build-paths.mjs` | `scripts/build/build-paths.ts`。設定・入出力と実行境界を型検査するため |
| `scripts/build/build-target.mjs` | `scripts/build/build-target.ts`。設定・入出力と実行境界を型検査するため |
| `scripts/build/build.mjs` | `scripts/build/build.ts`。設定・入出力と実行境界を型検査するため |
| `scripts/build/clean.mjs` | `scripts/build/clean.ts`。設定・入出力と実行境界を型検査するため |
| `scripts/checks/check-bundles.mjs` | `scripts/checks/check-bundles.ts`。設定・入出力と実行境界を型検査するため |
| `scripts/distribution/zip.mjs` | `scripts/distribution/zip.ts`。設定・入出力と実行境界を型検査するため |
| `tests/tooling/build-clean.test.mjs` | `tests/tooling/build-clean.test.ts`。実行契約とfixtureを型検査するため |
| `tests/tooling/lint-config.test.mjs` | `tests/tooling/lint-config.test.ts`。実行契約とfixtureを型検査するため |
| `tests/tooling/zip.test.mjs` | `tests/tooling/zip.test.ts`。実行契約とfixtureを型検査するため |
| `tests/benchmarks/lifecycle.test.mjs` | `tests/benchmarks/lifecycle.test.ts`。実行契約とfixtureを型検査するため |
| `tests/benchmarks/order-and-actions.mjs` | `tests/benchmarks/order-and-actions.ts`。実行契約とfixtureを型検査するため |
| `tests/benchmarks/run-comparison.mjs` | `tests/benchmarks/run-comparison.ts`。実行契約とfixtureを型検査するため |
| `resource/store/src/generate.mjs` | `resource/store/src/generate.ts`。設定・入出力と実行境界を型検査するため |

### JavaScriptを保持する区分

| ファイル・区分 | 保持理由 |
| --- | --- |
| `dist_chrome/`・`dist_firefox/` の `background.mjs`・`options.mjs`・`preview.mjs`・`undo.mjs` | ブラウザーが実行する生成物。manifest・HTML・ZIP allowlistとVM検査の参照も生成物名を使う |
| `public/*.html` 内のJavaScript | 既存のHTML・ブラウザー実行経路で使う入力。toolingの実装とは別である |
| `tests/tooling/build-clean.test.ts` の `child.mjs` | 子Nodeの終了コードと実行順を検査する合成入力 |
| `tests/tooling/lint-config.test.ts` の `*.mjs`・生成元alias `generate.mjs` | JavaScript構文、未定義global、readonly globalの規則を検査する入力。TypeScript用overrideと区別する |
| `tests/tooling/zip.test.ts` 内の `.mjs`・HTML | 実配布物と同じ拡張子・参照・ZIP内容を検査する入力 |
| `tests/benchmarks/lifecycle.test.ts` の `synthetic-runner-fixture.mjs` と合成source | 子process・タイマーの回収と最初の失敗による停止を検査する入力 |
| `tests/benchmarks/order-and-actions.ts` のCommonJS文字列と `new Function` | 固定したVite変換結果を実行するbenchmarkの測定条件 |
| `scripts/checks/check-bundles.ts` の `SourceTextModule` 入力 | 配布JavaScriptをNode globalや外部importなしで初期化する検査対象 |
| `node_modules/`・一時 `.tmp/` のJavaScript | 外部依存と一時出力であり、製品の手書き実装の移行対象外 |

実行方式の根拠は[Node.jsのTypeScript対応](https://nodejs.org/api/typescript.html)、[Node.js 22.18.0](https://nodejs.org/download/release/v22.18.0/docs/api/typescript.html)、[Vite設定](https://v8.vite.dev/config/)を参照する。
