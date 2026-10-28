import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { installSettingsBrowser, controlledEvent } from "../helpers/settings-browser";
import type { BrowserTarget } from "../helpers/browser";
import { draft } from "../workflows/fixtures";

const target = process.env.TEST_BROWSER as BrowserTarget;
beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());
type Reply = { ok: boolean; status?: string; plan?: { targets: { id: number }[] } };

function setup(pattern: string, options: boolean) {
  const mock = installSettingsBrowser(target);
  const tab = (id: number, url: string, extra: Partial<chrome.tabs.Tab> = {}) => ({
    id, url, title: String(id), windowId: 1, index: id, active: id === 1, pinned: false,
    incognito: false, groupId: -1, discarded: false,
    ...(target === "firefox" ? { cookieStoreId: "firefox-default" } : {}), ...extra,
  }) as chrome.tabs.Tab;
  let tabs = [tab(1, "https://example.com/"), tab(2, "https://duplicate.test/"), tab(3, "https://duplicate.test/"),
    tab(4, "about:blank"), tab(5, "https://www.google.com/search?q=test"), tab(6, "https://example.com/other"),
    tab(7, "https://example.com/pinned", { pinned: true }), tab(8, "https://example.com/elsewhere", { windowId: 2 }),
    ...(options ? [tab(80, mock.runtime.getURL("options.html"))] : [])];
  Object.assign(mock.data, { glue: false, depclean: true, sorttab: false, refresh: false, comclose: false,
    closelocal: false, rxclose: false, grouping: false, iconbadge: false, urlmatch: false,
    urlmatch_pattern: pattern, currentonly: true, preview_before: false, protect_domains: "",
    contextmenu1: true, contextmenu1advanced: true, contextmenu1scope: "win" });
  Object.assign(mock.api.tabs, { onReplaced: controlledEvent<[]>() });
  mock.api.tabs.query.mockImplementation(async value => {
    const q = value as chrome.tabs.QueryInfo;
    return tabs.filter(t => (!q.currentWindow || t.windowId === 1) && (q.windowId == null || t.windowId === q.windowId) &&
      (q.pinned == null || t.pinned === q.pinned) && (!q.active || t.active)).map(t => ({ ...t }));
  });
  mock.api.tabs.get.mockImplementation(async id => {
    const found = tabs.find(t => t.id === id);
    if (!found) throw Error("Missing tab");
    return { ...found, id, status: "complete" };
  });
  mock.api.tabs.remove.mockImplementation(async ids => { tabs = tabs.filter(t => !ids.includes(t.id!)); });
  mock.api.windows.getAll.mockResolvedValue([1, 2].map(id => ({ id, type: "normal", incognito: false, tabs: tabs.filter(t => t.windowId === id) })) as chrome.windows.Window[]);
  const create = vi.fn(async (details: { url: string; windowId: number }) => {
    tabs.forEach(t => { t.active = false; });
    const item = tab(90, details.url, { active: true, windowId: details.windowId });
    tabs.push(item); return item;
  });
  Object.assign(mock.api.tabs, { create });
  const send = (message: unknown, sender: chrome.runtime.MessageSender) => new Promise<Reply>(resolve => {
    for (const receiver of mock.runtime.onMessage.listeners) receiver(message, sender, value => resolve(value as Reply));
  });
  return { ...mock, create, send, tabs: () => tabs, origin: tabs[0]! };
}

const entries = ["icon", "duplicate-shortcut", "system-shortcut", "search-shortcut", "normal-close-menu", "detail-close-menu", "saved-workflow"] as const;
test.each(entries.flatMap(entry => ["[", "x".repeat(65_537)].map(pattern => ({ entry, pattern, length: pattern.length }))))("URL-OFF isolates $entry from invalid global pattern length $length", async ({ entry, pattern }) => {
    vi.resetModules();
    const mock = setup(pattern, entry === "saved-workflow");
    const compiler = vi.spyOn(await import("../../src/rules/url-rules"), "compileURLRules");
    await import("../../src/background/background");
    let expected: number[];
    if (entry === "icon") { await mock.clicked.emit(); expected = [2]; }
    else if (entry.endsWith("shortcut")) {
      const command = entry === "duplicate-shortcut" ? "08_execute_option2" : entry === "system-shortcut" ? "07_execute_option5" : "09_execute_option7";
      const commands = (mock.api as unknown as { commands: unknown }).commands as { onCommand: ReturnType<typeof controlledEvent<[string]>> };
      await commands.onCommand.emit(command);
      expected = entry === "duplicate-shortcut" ? [2] : entry === "system-shortcut" ? [4] : [5];
    } else if (entry.endsWith("menu")) {
      await mock.installed.emit();
      await mock.activated.emit();
      await mock.menuClicked.emit({ menuItemId: entry === "normal-close-menu" ? "ohmytab_close_tabs" : "ohmytab_close_l0" } as chrome.contextMenus.OnClickData, mock.origin);
      expected = [1, 6];
    } else {
      const saved = { ...draft(), id: "22222222-2222-4222-8222-222222222222", revision: 1 };
      mock.localData.saved_workflows_v1 = { version: 1, revision: 1, workflows: [saved] };
      const reply = await mock.send({ type: "workflow:preview-saved", id: saved.id, expectedRevision: 1, expectedWorkflowRevision: 1, origin: { tabId: 1, windowId: 1 } },
        { id: "fixture", url: mock.runtime.getURL("options.html"), tab: mock.tabs().find(t => t.id === 80)! });
      expect(reply, entry).toEqual({ ok: true, status: "preview" });
      const previewURL = mock.create.mock.calls.at(-1)![0].url;
      const sender = { id: "fixture", url: previewURL, tab: mock.tabs().find(t => t.id === 90)! };
      const token = new URL(previewURL).searchParams.get("token");
      expect((await mock.send({ type: "preview:get", token }, sender)).plan!.targets.map(t => t.id), entry).toEqual([1, 6]);
      expect(await mock.send({ type: "preview:confirm", token }, sender), entry).toMatchObject({ ok: true, status: "complete" });
      expected = [1, 6];
    }
    expect(mock.api.tabs.remove.mock.calls.flatMap(([ids]) => ids).sort((a, b) => a - b), entry).toEqual(expected);
    expect(mock.tabs().filter(t => [7, 8].includes(t.id!)).map(t => t.id), entry).toEqual([7, 8]);
    expect(compiler, entry).not.toHaveBeenCalled();
    compiler.mockRestore();
});
