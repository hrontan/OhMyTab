# Store listing (English)

## Name

OhMyTab

## Summary

Consolidate open tabs into one window, remove duplicates, and sort by URL or title.

## Description

Tidy up scattered tabs in one click.
Click the OhMyTab toolbar button to instantly run every tab-management action you have enabled on the options page.

■ One-click actions (via toolbar button)
• Merge eligible tabs from the same session into one window
• Close duplicate tabs with the same URL
• Sort tabs by URL or page title
• Close system pages, search engine results, and local files
• Close tabs matching specific URL patterns (one glob pattern per line; regular expressions not supported)
• Reload tabs discarded by the browser to save memory
• Group tabs from the same domain into automatically named, collapsed tab groups (Chromium-based browsers only)
• Limit operations strictly to the current window

■ Right-click menu actions
• Close tabs from the same domain
• Move tabs from the same domain to a new window
• Merge tabs into one window
• Move the current tab to a new window
• Target specific subdomain levels to close or move their tabs
• Run a saved workflow (after reviewing its target tabs)

■ Saved workflows
On the options page, save named workflows (up to 20) that combine a window scope, operations, and URL conditions (hostname, hostname including subdomains, contained text, or URL glob). Run a saved workflow from a page's right-click menu under "Workflow: name". A confirmation page always opens first, and no tabs change until you confirm. You can also inspect the target tabs of a workflow you are editing before saving it. Saved workflows are stored only in this browser and are not included in browser sync or JSON backups.

■ Tab count badge
Display the number of open tabs, either in total or per window, directly on the extension icon.

■ Keyboard shortcuts
Assign custom shortcut keys to main actions via your browser's extension shortcut settings.

■ Operation results and status
Hover over the extension icon to view a tooltip with the results of your last action. If a request is skipped (e.g., because another action is currently running), the icon will display a red "!" badge.

■ Protection, preview, and undo
• Protection: Pinned tabs are always ignored. Operations never cross between normal and private windows, and strictly respect Firefox containers. You can also protect specific domains, tabs playing audio, and tabs in existing groups.
• Priority: Protection rules take priority. When removing duplicates, the extension keeps the last eligible tab in the list by default, but you can configure it to prefer the currently active tab.
• Preview (confirmation): Off by default. When enabled, you can review targeted tabs and the reasons for closing them before confirming (canceling leaves tabs untouched). Preview data is held in memory for up to 60 seconds and clears immediately if the background process stops or restarts.
• Undo: The extension temporarily remembers your most recent tab-closing action in normal windows (HTTP/HTTPS only, up to 50 tabs) for up to 5 minutes, allowing you to restore them. It is kept in memory only, so a background stop or restart can remove it earlier. Tabs are reopened in their original window via their URLs, meaning form inputs and individual tab history are not restored.

■ Settings and JSON backup
You can choose to save your URL patterns locally on your device (Local) or sync them across devices (Sync). Other configurations, including protected domains, remain in browser sync. If removing the old sync copy fails after switching to Local, a copy may remain in sync; explicit removal does not erase the sync provider's backups or copies on other devices.
You can export or import settings as a JSON file (version 1, max 64 KiB, UTF-8), and you will be prompted to review imported settings before they apply (canceling keeps your current settings). Exported JSON files do not include your storage location preference, browsing history, or preview/undo data.

■ Privacy
Tab URLs and titles are processed entirely locally for tab management, previews, and the undo function. OhMyTab does not send any data to external developer servers. However, if browser sync is used, settings like URL patterns and protected domains (which may contain sensitive information) are synced via your browser account. Please be mindful of where you sync or share your JSON backups. Restored or reloaded tabs perform standard network requests to their respective websites.

Supported browsers: Chrome 123 or later, Firefox 112 or later (desktop). Microsoft Edge and Brave (desktop) also work with the Chrome build (tested on versions based on Chromium 156; sync between devices untested).

## Category

- Chrome Web Store: Productivity › Tools
- Firefox Add-ons: Tabs
