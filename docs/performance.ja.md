# タブ操作の性能計測

重複削除はURLごとの集合を使う平均O(n)の走査です。既定では操作対象の走査順で最後の同一URLタブを残します。アクティブ優先を選んだ場合と、セッション・保護条件による除外は[操作対象の説明](domain-operations.ja.md)に従います。

URLとドメインの解析結果は操作内のMapで共有し、次の操作へ持ち越しません。URLルールも有効時だけ操作ごとに一度コンパイルします。LISによる順序計算と移動命令の生成は別の処理で、操作全体をO(n log n)とする保証はありません。

## 現在の処理の分担

操作とその一時cacheは`src/operations/operation-runtime.ts`、バッジ描画・session cacheは`src/background/badge.ts`、反映worker・revisionは`src/background/background-reflection.ts`が所有します。固定タブもバッジの計数に含め、値が変わった表示だけを更新します。session記録を使えない環境では、再開後の初回に表示を書き直します。

メニューの下位行・対象は`src/background/contextmenu.ts`が所有し、アクティブタブのURL・固定状態に関係する変更だけを反映します。操作中に保留した反映は終了時に行います。

## 固定fixtureでの計測方法

fixtureは[order-and-actions.ts](../tests/benchmarks/order-and-actions.ts)です。比較するrevision、依存関係、Node.js、ブラウザーモード、fixtureを固定して実行します。

fixtureのローダーは既存のVite/OxcでTypeScriptをCommonJSへ変換し、ブラウザー条件付き処理を適用します。変換は計測開始前に行い、minifyとtree shakingを無効にします。結果にはVite版と実際に読み込んだソースの相対パス・SHA-256を記録します。機能別配置と従来の平坦な比較用ソースの両方を扱います。TypeScriptの旧 `transpileModule` を使った過去の数値と比較する場合は、同じローダーで両候補を再計測してください。

```powershell
node --expose-gc --max-old-space-size=384 tests/benchmarks/order-and-actions.ts duplicates 5000 chrome
```

`order`・`duplicates`・`groups`、100・1000・5000タブ、対応モードを指定できます。グループ化はChromeのみです。子プロセスの外側で20秒のtimeoutを設け、同じ条件を3回ずつ比較する場合も各結果を保存します。fixtureは残存ID・順序等の正解とRSS上限768MiBを確認します。経過時間の不安定な閾値はCI合否に使いません。

この手順は計測結果を示すものではない。過去の異なる入力やローダーの数値を、現在の候補の性能や実ブラウザーの応答時間として転用しない。
