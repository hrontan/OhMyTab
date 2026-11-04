# テストと静的チェック

製品ルートで依存を導入し、次のコマンドを実行します。

```sh
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run lint
pnpm run test:lint
pnpm test
```

`typecheck` は製品コードとテストの型を確認します。`lint` は Oxlint 1.89.0 で確認し、ファイルを書き換えません。自動修正を行う場合は `pnpm run lint:fix` を使い、差分を確認してください。生成物と依存パッケージは lint の対象から除外します。

lint移行では旧設定125項目を対応付け、122項目を対応ルールへ移し、重複引数と旧式8進数表記の検出はparserで補う。error／warn、アンダースコアの除外条件、型参照だけに使う値の未使用判定を保持する。`pnpm run test:lint` はこれらを含む10件の実行fixtureを確認する。対象は現行のstrict ESMソースであり、自動修正や診断文言を含めた全般的な同等性を保証するものではない。

テストは TypeScript・ESM のまま Vitest で実行します。`pnpm test` は Chrome、Firefox の順に実行し、失敗時は非ゼロで終了します。製品コードの条件分岐には、ビルドと同じ `ifdef-loader` を適用します。ブラウザ単位の実行とファイルの絞り込みは次の形式です。

```sh
pnpm run test:chrome tests/browser/api.test.ts
pnpm run test:firefox tests/browser/api.test.ts
```

回帰テストは `tests/**/*.test.ts` に追加し、`vitest` の `test` と `expect` を使います。API を使うコードは `tests/helpers/browser.ts` の `installBrowserMock` でグローバルを置換してから動的に import してください。`vi.resetModules()` で import のキャッシュを除き、終了時は `vi.unstubAllGlobals()` で元に戻します。例は [API テスト](../tests/browser/api.test.ts) を参照してください。

モックの `api` には `vi.fn` があり、`mockResolvedValueOnce`、`mockImplementationOnce` で戻り値や失敗を指定し、呼び出し引数を確認できます。`data` は同期ストレージの内容です。Chrome は callback、Firefox は Promise でストレージ結果を返します。browser bindingとStorage primitiveの所有元は `src/browser/browser-api.ts` です。必要な API は現在のmanifest権限と実APIの形に合わせてモックへ追加し、実際のブラウザに接続しないテストとして記述してください。このテストは実ブラウザでの動作確認とは別に行います。
