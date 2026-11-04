# Privacy practices / プライバシー説明文

Technical descriptions for store listings. English and Japanese describe the same implementation.

## Single purpose / 単一用途

Manage the browser's open tabs: merge eligible windows, close duplicate or selected unwanted tabs, sort, group in Chrome, show counts, review planned actions, and restore eligible recent closures.

開いているタブを管理します。対象ウィンドウの集約、重複・選択した不要タブの閉鎖、並べ替え、Chromeのグループ化、件数表示、操作前の確認、対象となる直近の閉鎖の復元を行います。

## Permission use / 権限の用途

| Permission | Use | 用途 |
| --- | --- | --- |
| `tabs` | Reads URLs, titles and tab metadata for selection, protection, sorting, preview and eligible undo. Restoring or reloading a page makes its normal website requests. | URL・タイトル・タブ情報を対象選択、保護、並べ替え、確認、対象閉鎖の復元に使います。復元・再読み込みでは通常のサイト通信が発生します。 |
| `contextMenus` | Adds menus for tab operations, including domain and subdomain selection. | ドメイン・サブドメインの選択を含むタブ操作メニューを追加します。 |
| `storage` | Saves settings in sync/local, keeps an import-recovery copy locally, and uses optional session storage for displayed badge values. | 設定をsync／local、取込み復旧用コピーをlocalへ保存し、利用可能なsession領域に表示済みバッジ値を記録します。 |
| `tabGroups` (Chrome only) | Creates and arranges domain-based groups while respecting protection. | 保護条件を維持してドメイン別グループを作成・配置します（Chromeのみ）。 |

No host permissions, cookie-reading permission, or remote executable code is added. All executable code is packaged in the extension.

ホスト権限、Cookie読取り権限、リモート実行コードは追加していません。実行コードは拡張機能に同梱します。

## Local processing and browser sync / 端末内処理とブラウザー同期

The extension has no developer-operated telemetry or data-collection endpoint. Tab data is processed in the browser. The browser provider may sync settings through the user's account; this can include URL patterns and protected domains. Only the URL-rule toggle and pattern text can be selected for local storage. Other settings remain in sync.

拡張機能独自のテレメトリーやデータ収集先はありません。タブ情報はブラウザー内で処理します。ブラウザー提供元が設定を利用者のアカウントへ同期する場合があり、URLパターンや保護ドメインも含まれます。localへ切り替えられるのはURLルールの有効・無効とパターン文字列の2項目だけで、他の設定はsyncに残ります。

A previous sync copy can remain after a failed migration cleanup. Explicit removal does not guarantee erasure of provider backups or other-device copies. Browser-provider sync behavior is separate from extension-operated collection.

移行後の除去に失敗すると旧syncコピーが残る場合があります。明示的に除去しても、提供元のバックアップや他端末のコピーまで消去する保証はありません。ブラウザー提供元の同期と、拡張機能独自の収集は区別します。

## Preview, undo and import recovery / 確認・復元・取込み復旧

Preview keeps one plan in memory for at most 60 seconds. Undo keeps the latest eligible normal/default HTTP(S) closure, at most 50 tabs for 5 minutes, in memory only. Background suspension or restart can erase either earlier. Private/nondefault-container and unsupported URLs are not recorded for undo. No form data or browsing-history list is restored.

確認内容はメモリに1件、最長60秒保持します。閉鎖の復元記録は通常・既定セッションの対象HTTP(S)タブの直近1回、最大50件・最長5分をメモリだけに保持します。いずれもバックグラウンド停止・再起動で早く消える場合があります。プライベート・非既定コンテナー・対象外URLは復元記録に含めず、フォームや閲覧履歴一覧は復元しません。

Import uses one local recovery copy of previous settings. Pending recovery keeps the original effective values and blocks new writes. Success or recovery removes confidential copy contents and leaves only an opaque generation marker. Settings JSON includes rules and protection settings, but excludes tab history, runtime/preview/undo records, storage mode and the recovery copy. Users choose where to save or share the JSON.

取込みでは元の設定の復旧用コピーをlocalに1件保持します。復旧待ちの間は元の有効値で動作し、新しい書込みを拒否します。成功・復旧後は機密内容を除去し、世代を区別する識別子だけを残します。設定JSONにはルール・保護設定を含みますが、閲覧履歴、実行中・確認・復元の記録、保存先、復旧用コピーは含めません。JSONの保存・共有先は利用者が選びます。
