# OhMyTab

English / [日本語](usage-ja.md) / [中文 (简体)](usage-zh_CN.md)

## Installation

To load a local build, follow [development](development.ja.md#ビルドと拡張機能の読み込み): load `dist_chrome/` as an unpacked Chrome extension, or select `dist_firefox/manifest.json` as a temporary Firefox add-on. These local loading steps do not publish the extension.

OhMyTab provides eight main tab-management functions.

1. Merge tabs from multiple windows into one window.
2. Close duplicate tabs with the same URL.
3. Sort tabs by page title or URL.
4. Close system pages and supported search-result pages.
5. Show the total tab count or a count per window.
6. Add context-menu actions to close tabs of the same domain, extract them into a new window, merge windows, or extract the current tab. Detailed menus select a subdomain level.
7. Create domain-based tab groups (Chrome only).
8. Close tabs whose URLs match glob patterns.

Enable global operations on the options page. Global URL rules use one glob per line, trim surrounding whitespace, ignore empty lines and match any rule (OR). They are not regular expressions. Enabled rules allow at most 100 nonempty lines, 1024 UTF-16 code units per trimmed line and 8192 stored bytes including JSON encoding and the key. Invalid enabled rules stop bulk actions before mutation.

## Saved workflows

Use **Saved workflows** on the options page to keep named cleanup procedures separate from global settings.

1. Choose **New**, enter a workflow name, and add named URL rules. Each rule has an enabled switch. Enabled rules match with OR; empty conditions are invalid.
2. Choose a match mode: **Hostname** accepts `example.com`; **Include subdomains (host only)** also matches `news.example.com`, but not `evil-example.com` or a domain written in a query. **Contains literal text** is case-sensitive. **URL glob** uses the existing wildcard syntax and substring-match behavior, not regular expressions.
3. Choose operations and scope: **Right-clicked tab's window** or **All windows in the origin session**. Merge requires all windows. Matching rules select tabs to close; duplicate removal, sorting, merging, reloading and other selected operations can affect other eligible tabs in that scope.
4. Open **Target URL conditions** to edit rules. Conditions start collapsed, including saved rules. Invalid conditions open this section and receive focus when saving.
5. Choose **Save** explicitly. Select a saved workflow to load it, or use **Load selected workflow** to reload the saved content. The selection survives reloading this options tab. Edit and save, duplicate or delete as needed.

To inspect the current valid draft, choose **Inspect edited workflow**, or **Inspect this rule** beside a rule. Ordinary editing does not inspect tabs automatically. In **Inspect workflow targets**, explicitly choose an **Origin tab**, then **Inspect targets**. If no origin is available, open options alongside an ordinary page in the same window and browsing session, then reopen the dialog. Current tab protections apply. Whole-workflow inspection only shows targets; run the full workflow after saving it through the page context menu.

Single-rule inspection uses the selected rule, including a rule disabled in the workflow. This exception applies to this explicit inspection and single-rule close. The single-rule close affects only that rule’s targets, without running the workflow’s other operations. For a valid unsaved draft, first inspect, then select **Use this unsaved rule to proceed to confirmation**. Choose **Preview closing only this rule’s targets** to open a fresh preview, review its targets, and confirm there to close tabs. Inspection alone never closes tabs.

Inspection results expire after 60 seconds. Tab changes can make the displayed results stale; inspect again before proceeding. Editing the draft, changing the origin, inspection mode or selected rule, changing saved workflows or protection settings, or closing the inspection dialog invalidates the related confirmation too. Keep the inspection dialog open and unchanged while reviewing the separate preview. That preview has its own validity checks and expiry; the inspection’s 60-second limit does not extend it.

Run a saved workflow from the context menu of the page you want to use as the origin: **Workflow: name** → target preview → confirm. Workflow rows appear alongside the other OhMyTab operations; the browser may group extension items under its own extension-name menu. This context-menu execution uses only saved content. The clicked tab and window stay the origin; stale menu revisions are rejected. Menus update after save/delete and remain safe after a background restart.

Saved workflow execution requires confirmation even if global preview is off. Review the confirmation before running; cancel leaves work tabs unchanged. Current global protection and duplicate-keeper settings apply at execution time. Pinned tabs, other private/container sessions and all of this extension's pages are excluded. If the origin moves, closes or becomes unavailable, reopen the page context menu and review again; there is no fallback to another window or session. Firefox grouping is unsupported. Firefox container confirmation fails closed if the preview page does not share the origin's container; no operation runs in that case.

Drafts are not autosaved. When switching away from edits, choose **Keep draft** or **Discard and continue**. Save failures and concurrent changes retain the draft and show conflict choices. **Use saved version** discards the current edits and loads the saved data without writing. **Overwrite with my edits** checks the latest saved version and explicitly saves the retained edits over it; changes are not merged automatically. If the saved workflow was deleted, overwrite is unavailable and the edits remain on screen. For a new unsaved workflow, **Save these edits** saves it as a new workflow, while **Use saved version** discards it and reloads the saved list. These choices appear only during a conflict or an unconfirmed save.

**Copy global URL rules** appends the existing patterns as enabled glob rules; **Copy global operations** copies operations and scope into the draft. These explicit copies, selection and execution never write global settings. Icons, shortcuts and the existing operation menus continue to use global settings.

Saved workflows persist in this browser's local storage across browser restarts. They do not sync and are excluded from settings JSON version 1; there is no separate workflow import/export. Limits are 20 workflows, 100 rules per workflow, 80 UTF-16 code units per name, 1024 per condition, and 256 KiB for the encoded store including its key. The existing global URL-rule limits are separate.

## Protection, confirmation and recovery

Operations exclude pinned tabs and never cross the requesting tab's normal/private boundary. Firefox also keeps each cookie-store/container separate. Unknown origin-session metadata stops the operation. Domain, audio and existing-group protection take priority over duplicate selection; the default keeps the last eligible duplicate, with an optional active-tab preference.

Global actions have an optional preview, off by default. It shows target IDs, reasons, exclusions and window scope before confirmation. Cancel changes no work tabs; confirmation revalidates the original plan and never adds unplanned IDs. One in-memory plan lasts at most 60 seconds and can disappear earlier when the background stops or restarts.

Undo records only confirmed closed, eligible HTTP(S) tabs in the normal/default session. It keeps the latest eligible batch, up to 50 tabs for at most 5 minutes, in memory only; background suspension or restart can remove it earlier. It reopens URLs in the original existing window, not form data, browsing history or groups. Private/container and unsupported URLs are excluded.

## Settings and privacy

Settings normally use browser sync storage. For global settings, only the URL-rule toggle and pattern text can be switched to local storage; protection domains and other settings still sync. Switching to local may leave a sync copy if removal fails or another device changes it. The UI reports residue and offers explicit removal; it cannot erase provider backups or copies on other devices.

Versioned JSON export/import covers 28 known settings (`ohmytab-settings`, version 1, at most 64 KiB UTF-8). Review and confirm before applying; cancel preserves settings. Storage mode, tab history, preview/undo records and recovery data are not exported. Firefox retains shared Chrome grouping preferences. URL patterns and protected domains can contain sensitive information: check browser-sync destinations and JSON sharing.

Desktop targets are Chrome 123+ and Firefox 112+; grouping is unavailable in Firefox. Microsoft Edge and Brave (desktop) use the Chrome build with the same features; they were tested on versions based on Chromium 156, and sync between devices is untested. These declarations are distinct from minimum-version or complete release validation. See [browser support](browser-support.ja.md), [development and validation limits](development.ja.md), [operation boundaries](domain-operations.ja.md) and [settings details](settings-sync.ja.md) (Japanese).

Global URL controls and their storage selector, tab protection and the duplicate keeper are grouped inside the closed **Advanced features** section. Existing values are preserved; an enabled notice remains visible outside. Saving to `storage.sync` confirms a write to browser sync storage only, not transfer to another device. Chrome, Edge and Brave require the same browser and extension ID, compatible profiles and enabled browser sync settings; cross-browser sync is not guaranteed. `local` stays in this profile. Edge and Brave device sync has not been tested.

Automatic execution when quitting is unsupported: [runtime.onSuspend](https://developer.chrome.com/docs/extensions/reference/api/runtime#event-onSuspend) describes event-page unloading and does not guarantee asynchronous completion. Run the saved workflow from the page context menu and confirm its preview before quitting.

[Microsoft Edge API support](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/api-support) · [Edge sync](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-enterprise-sync) · [Brave Sync FAQ](https://support.brave.com/hc/en-us/articles/360047642371-Sync-FAQ)
