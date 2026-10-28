# 対応ブラウザー

デスクトップ版の Chrome 123 以降、Firefox 112 以降を対象とする。manifest の最低バージョンもこの値に合わせている。ビルド用のNode.jsとpnpmの条件は[開発手順](development.ja.md)を参照する。

Microsoft EdgeとBraveのデスクトップ版は、Chromeと同じChromium系のブラウザーであり、Chrome用のビルド（`dist_chrome/`）をそのまま使う。グループ化を含め、Chromeと同じ機能を使える。Chromium 156ベースのEdgeとBraveの実機で、拡張機能の読込み、設定の保存とバックアップ、タブの集約・並べ替え・グループ化、保護、確認画面、復元の動作を確認した。右クリックメニューのブラウザー上でのクリック、タブ数のバッジ、端末間の同期は確認していない。EdgeとBraveの最低バージョンは定めておらず、156より前の版は確認していない。

Chrome は module Service Worker、Firefox は module の非永続バックグラウンド scripts を使用する。どちらも待機中に停止しうるため、メニューはブラウザー起動時（`runtime.onStartup`）とインストール・更新時に作り直す。停止後に再開した直後のドメイン別メニューのクリックは、保存済み設定とクリックしたタブの URL から対象を復元する。Firefox は `background.service_worker` に対応していない。module バックグラウンドの対応開始は Firefox 112 である。[MDN background](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background)、[MDN 互換性データ](https://github.com/mdn/browser-compat-data/blob/main/webextensions/manifest/background.json)。

Chrome の下限は、使用中の `contextMenus.update()` と `removeAll()` の Promise 対応が Chrome 123 以降であることに基づく。`contextMenus.create()` は Promise を返さず ID を同期的に返すため、失敗はコールバック内の `runtime.lastError` で判定する。`tabGroups` の Chrome 89、Manifest V3 の `action`、tabs/windows/storage の既存 API はこの下限以内である。[Chrome contextMenus](https://developer.chrome.com/docs/extensions/reference/api/contextMenus)、[Chrome tabGroups](https://developer.chrome.com/docs/extensions/reference/api/tabGroups)。

Firefox では Manifest V3/action の 109 より module バックグラウンドの 112 が高い。tabs、windows、contextMenus（Firefox では `menus` の別名）、storage、runtime、commands、i18n の使用メソッド・イベントは 112 以前に対応している。ただし、メソッドの存在だけでは全オプションの動作を保証しない。Firefox では Chrome 専用のタブグループ操作を使用しない。設定画面でもグループ化の項目を非表示・無効とし、有効値を false にする。他のブラウザーと共有する保存済みのChrome設定は消去しない。[MDN action 互換性データ](https://github.com/mdn/browser-compat-data/blob/main/webextensions/api/action.json)、[MDN WebExtensions 互換性データ](https://github.com/mdn/browser-compat-data/tree/main/webextensions/api)。

タブ数バッジの表示済みの値は `storage.session`（Chrome 102、Firefox 115 以降）に記録する。無い環境では記録を省き、バックグラウンドの再開後に一度だけ全件を書き直す。タブ別・ウィンドウ別のバッジを消すときは `text: null` を渡し、全体の値へ戻す。

## 台帳で区別する呼出し形式とオプション

台帳はChrome の Manifest V3 開始版 88を基準とし、製品が使う呼出し形式とオプションの対応版を加味する。`tabs.create()`のPromiseはChrome 88 以降。`runtime.sendMessage()`はChromeではコールバック形式を使うため、Promise対応開始の99を要求しない。FirefoxではPromiseを使う。`runtime.onMessage`の受信処理は非asyncのlistenerから`true`を返し、応答 callbackを使う。返却Promiseの対応には依存しない。要求元を照合する`sender.id`は、Firefox 54 以降のアドオンIDとして扱う。[Chrome tabs](https://developer.chrome.com/docs/extensions/reference/api/tabs#method-create)、[Chrome runtime](https://developer.chrome.com/docs/extensions/reference/api/runtime#method-sendMessage)、[MDN runtime互換性データ](https://github.com/mdn/browser-compat-data/blob/main/webextensions/api/runtime.json)。

使用オプションでは、バッジの`text: null`はChrome 116、メニュー生成・更新の`visible`はFirefox 63、`windows.getAll()`の`windowTypes`はFirefox 58が下限となる。いずれも宣言最小版Chrome 123・Firefox 112の範囲内である。[MDN action互換性データ](https://github.com/mdn/browser-compat-data/blob/main/webextensions/api/action.json)、[MDN menus互換性データ](https://github.com/mdn/browser-compat-data/blob/main/webextensions/api/menus.json)、[MDN windows互換性データ](https://github.com/mdn/browser-compat-data/blob/main/webextensions/api/windows.json)。

一方、Firefoxは`windows.getLastFocused()`の`windowTypes`を無視する。このオプションはFirefox 62 以降deprecatedであり、メソッドの対応版を数値で記載しても、最後にフォーカスされた通常ウィンドウの選択を保証できない。Firefoxでは実際の操作起点がpopup の場合はタブ操作を行わず、未実行を通知する。通常ウィンドウからの操作は受け付け、toolbar やメニューでクリックされた通常ウィンドウのタブを、無関係なpopup の focusより優先する。キーボード操作では返却された起点 windowの種別を確認する。種別が不明な場合や取得失敗も、別の通常ウィンドウを推測せず未実行とする。Chromeの既存のfilter引数と動作は維持する。[MDN getLastFocused](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/windows/getLastFocused)。

## 検証と配布の範囲

この下限は API の対応開始から決めたもので、最低バージョンそのものの実機動作を保証する試験結果ではない。配布物の実機試験は使用したブラウザーのブランド・バージョン・専用プロファイル・起動、操作、設定保存、メニュー登録の結果を個別に記録する。Chromium や Google Chrome for Testing の結果を通常配布版 Chrome の結果と混同しない。

Firefox for Android は対象外とする。manifest には `gecko_android` を指定しないが、それだけでは Android 版への配布を止められない。AMO へ提出するときは Android 互換の指定をしない。

URLルールの保存先切替にはWeb Locksを使う。利用できない環境での制限と同期データの残存は[設定の保存](settings-sync.ja.md#urlルールの保存先)を参照する。

API ごとの下限は `tests/browser/browser-manifests.test.ts` の表に記録している。テストはソースで使っている API が表にあること、manifest の下限が表の最大値と一致することを確認する。新しい API を使うときは表に下限を追加する。API表の検査と実ブラウザーの操作確認は別に行い、使用したrevisionと環境を結果に記録する。
