# システム・検索ページの判定

ボタンとショートカットは同じ判定ルールを使う。現在ウィンドウ／全ウィンドウの設定に従い、固定タブを除外する。URL 不明と、URL パーサーで解釈できない値は対象外とする。

## システムページ

| 対象 | 正常例 | 根拠 |
| --- | --- | --- |
| ホストを持つ `chrome:` | `chrome://settings/` | [Chrome の開発説明](https://developer.chrome.com/docs/extensions/get-started/tutorial/debug) |
| ホストを持つ `edge:` | `edge://settings/` | [Microsoft の設定説明](https://www.microsoft.com/en-us/edge/learning-center/how-to-manage-edge-startup-settings) |
| ホストを持つ `brave:` | `brave://settings/wallet` | [Brave Wallet の設定説明](https://wallet-docs.brave.com/default-wallet/) |
| ホストを持つ `chrome-extension:` | `chrome-extension://abcdefghijklmnopabcdefghijklmnop/options.html` | [Chrome の拡張 URL 説明](https://developer.chrome.com/docs/extensions/reference/api/runtime#method-getURL) |
| ページ名を持つ `about:` | `about:blank`、`about:newtab` | [Mozilla の新規タブ仕様](https://wiki.mozilla.org/Firefox/Projects/About%3Anewtab) |
| HTTPS の `ntp.msn.com` | `https://ntp.msn.com/`、`https://ntp.msn.com/edge/ntp` | [Microsoft の新規タブ配信先説明](https://learn.microsoft.com/en-us/deployedge/edge-learnmore-ntp-backward-compatibility) |

内部 URL のスキーム分類は既存の範囲を維持する。この表の例はブラウザーごとの全ページ一覧ではない。`chrome://` や `about:` のようにホスト／ページ名が空の値は除外する。`moz-extension:` など、新たなスキームは追加しない。

`ntp.msn.com` はホスト完全一致と HTTPS に限定する。`ntp.msn.com.evil.example`、`ntpXmsnYcom.example`、`ntp-msn.com`、一般の `www.msn.com` は対象外。ボタンにもシステム閉鎖ショートカットにも、この配信先を含む同じルールを適用する。

## 検索結果ページ

以下のホスト、パス、検索語パラメーターをすべて満たす HTTP／HTTPS URL を対象にする。検索語は空白だけの値を除く。パラメーターの順序やフラグメントは一致に影響しない。

| ホスト | パス | 検索語 | 正常 fixture |
| --- | --- | --- | --- |
| www.google.com | /search | q | `https://www.google.com/search?q=test` |
| 既存の Google 国別ホスト許可リスト | /search | q | `https://www.google.co.jp/search?q=test` |
| search.yahoo.com、search.yahoo.co.jp | /search | p | `https://search.yahoo.com/search?p=test` |
| www.bing.com | /search | q | `https://www.bing.com/search?q=test` |
| search.brave.com | /search | q | `https://search.brave.com/search?q=test` |
| scholar.google.com | /scholar | q | `https://scholar.google.com/scholar?q=test` |
| www.baidu.com | /s、/baidu | wd | `https://www.baidu.com/s?wd=test`、`https://www.baidu.com/baidu?wd=test` |
| duckduckgo.com | / | q | `https://duckduckgo.com/?q=test` |
| www.dogpile.com | /serp | q | `https://www.dogpile.com/serp?q=test` |
| yandex.com、yandex.ru | /search/ | text | `https://yandex.com/search/?text=test` |
| www.startpage.com | /sp/search | query または q | `https://www.startpage.com/sp/search?query=test` |
| www.ecosia.org | /search | q | `https://www.ecosia.org/search?q=test` |
| swisscows.com | /web | query | `https://swisscows.com/web?query=test` |
| search.naver.com | /search.naver | query | `https://search.naver.com/search.naver?query=test` |

検索ホーム、プライバシー説明、設定、プロフィール、候補取得 API は検索結果として扱わない。例えば Ecosia の `/privacy`、Swisscows の `/en`、Google の `/imghp` は対象外。各正常 fixture について、似たホストと `/privacy` の不一致をテストする。ホストの部分一致、パスの前方一致、検索語のない URL は許さない。

HTTP／HTTPS の URL に認証情報や非標準ポートがある場合も対象外とする。未対応ホストは閉じない。You.com の旧 `/search?q=` は現行の公式な消費者向け検索結果 URL を確認できなかったため、今回の対象から除外した。企業向け、チャット、API ページを検索結果として推測しない。

## URL の確認元

2026-10-03 に以下の公式情報を確認した。ルールはこの固定 fixture の範囲を扱い、サービス側の変更に自動追従しない。

- [Mozilla の現行検索設定](https://firefox.settings.services.mozilla.com/v1/buckets/main/collections/search-config-v2/records)：Google、Bing、Yahoo! JAPAN、Baidu、DuckDuckGo、Startpage、Ecosia、Naver の検索テンプレート。Baidu の `/s` は [公式検索フォーム](https://www.baidu.com/)でも確認した。
- [Yahoo の OpenSearch](https://search.yahoo.com/opensearch.xml)、[Brave の OpenSearch](https://search.brave.com/opensearch.xml)、[Yandex の OpenSearch](https://yandex.com/opensearch.xml)：各サービス配信の検索 URL テンプレート。
- [Google Scholar の公式ヘルプ](https://scholar.google.com/intl/en/scholar/help.html)：検索 URL の例。
- [DuckDuckGo のパラメーター説明](https://duckduckgo.com/duckduckgo-help-pages/settings/params)、[Dogpile の設定説明](https://www.dogpile.com/about)、[Swisscows の設定説明](https://swisscows.com/de/standardsuche-verwenden)：検索語と URL の指定。
- [Startpage の検索文字列説明](https://support.startpage.com/hc/en-us/articles/4520913488148-Search-strings)：`query` パラメーター。Mozilla が配信する `q` 形式も対象とする。

Google の国別ホストは既存の明示的な許可リストを保持する。新しい `google.*` ホストを推測して追加しない。[Google は国別ドメインから google.com へのリダイレクトを公表している](https://blog.google/products-and-platforms/products/search/country-code-top-level-domains/)ため、国別 fixture は既存タブへの互換扱いであり、現在の最終配信先を保証するものではない。
