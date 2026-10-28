# Windows／LinuxのCI手順

[CI定義](../.github/workflows/ci.yml)はWindowsとLinuxで同じ必須チェックを実行します。対象はNode.js 22.18.0（package.jsonの下限）と24.xです。package.jsonのNode.js条件は `^22.18.0 || ^24.0.0 || >=26.0.0` ですが、この行列だけで他の全バージョンの動作を保証するものではありません。配布物の独立した読取り検査にはPython 3.13と標準ライブラリのzipfileを使います。Pythonパッケージの追加は不要です。

クリーンな作業コピーで対応するNode.js、固定版pnpm 12.14.0、Pythonを用意し、ルートから次を順に実行します。各コマンドが成功したことを確認してから次へ進みます。既存の作業コピーや過去の固定候補へ出力を重ねる手順ではありません。

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

lintはファイルを書き換えません。テストはChrome／Firefoxの両モード、ビルドとZIP生成は両ブラウザーを対象にします。配布物検査は両ZIPのCRC、直下のmanifest、preview／undoを含む実行資産、全locale、ビルド済みファイルとのバイト一致を確認し、余分なファイルや重複entryを拒否します。

各チェックは独立した必須stepです。失敗を許容する設定や終了コードを握りつぶす処理はなく、失敗するとjobが失敗します。行列のfail-fastはfalseなので、別のOS／Nodeの結果も収集できます。これは失敗を合格へ変える設定ではありません。[GitHubのworkflow構文](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)を参照してください。

CIの定義、各チェックの実行結果、実ブラウザー上の操作確認は分けて記録します。対象revision、環境と各チェックの結果を保存し、失敗・未実施を区別します。ローカルのWindows／Linux検証とGitHub上のCI実行も区別します。ブラウザーの最低バージョンやprivate／container等の統合動作は、CIとは別に確認します。

pnpmはpackageManagerの固定版を `pnpm/action-setup@v4` で導入し、lockを変更しないfrozen installを行います。導入の仕組みは公式の[checkout](https://github.com/actions/checkout)、[setup-node](https://github.com/actions/setup-node)、[setup-python](https://github.com/actions/setup-python)を使用します。ビルドと配布の詳細は[開発手順](development.ja.md)を参照してください。

## リリースの作成

[リリース定義](../.github/workflows/release.yml)は、`v` で始まるタグ（例: `v3.0.0-rc.1`、`v3.0.0`）をpushしたときに実行します。ブランチへのpushだけではリリースを作成しません。

1. タグのバージョンから `v` と `-` 以降を除いた値が、`package.json`、`public/chrome.json`、`public/firefox.json` の `version` と一致することを確認します。一致しない場合はリリースを作成せずに失敗します。
2. Ubuntu・Node.js 24.xで、型検査、lint、両モードのテスト、ビルド、配布モジュールの初期化、ZIP作成、配布物の検査を実行します。
3. すべて成功した場合だけ、`ohmytab-<タグ>-chrome.zip` と `ohmytab-<タグ>-firefox.zip` を添付したGitHub Releaseを作成します。タグに `-` を含む場合（`-rc.1` など）はプレリリースになります。

タグは、検証済みの製品candidateのcommitに付けます。
