import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { installSettingsBrowser, controlledEvent } from "../helpers/settings-browser.ts";
import type { BrowserTarget } from "../helpers/browser.ts";
import { installSortBrowser } from "../helpers/sort-browser.ts";

const target = process.env.TEST_BROWSER as BrowserTarget;
let mock: ReturnType<typeof installSettingsBrowser>;
let tabs: chrome.tabs.Tab[];
let commands: ReturnType<typeof controlledEvent<[string]>>;
function tab(id: number, url: string, windowId = 1): chrome.tabs.Tab {
  return { id, url, windowId, index: id - 1, active: id === 1, pinned: false,
    highlighted: false, incognito: false, ...(target === "firefox" ? { cookieStoreId: "firefox-default" } : {}), selected: false, discarded: false,
    autoDiscardable: true, groupId: -1, lastAccessed: 0, frozen: false };
}
beforeEach(() => {
  vi.resetModules(); mock = installSettingsBrowser(target);
  tabs = Array.from({ length: 8 }, (_, i) => tab(i + 1, "https://same.example/path"));
  Object.assign(mock.data, { glue: false, depclean: false, sorttab: false, grouping: false,
    refresh: false, comclose: false, closelocal: false, rxclose: false, iconbadge: false,
    urlmatch: false, currentonly: true, contextmenu1scope: "all" });
  commands = controlledEvent<[string]>(); Object.assign(mock.api, { commands: { onCommand: commands } });
  mock.api.tabs.query.mockImplementation(async value => {
    const q = value as { currentWindow?: boolean; windowId?: number; active?: boolean; pinned?: boolean; groupId?: number };
    return structuredClone(tabs.filter(t => (!q.currentWindow || t.windowId === 1) &&
      (q.windowId == null || t.windowId === q.windowId) && (!q.active || t.active) &&
      (q.pinned == null || t.pinned === q.pinned) && (q.groupId == null || t.groupId === q.groupId)));
  });
  mock.api.windows.getAll.mockResolvedValue([1, 2].map(id => ({ id, type: "normal" } as chrome.windows.Window)));
  mock.api.tabs.remove.mockImplementation(async ids => { const removed = new Set(ids); tabs = tabs.filter(t => !removed.has(t.id!)); });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function countURLParses() {
  const OriginalURL = URL;
  let count = 0;
  vi.stubGlobal("URL", class extends OriginalURL {
    constructor(input: string | URL, base?: string | URL) { count++; super(input, base); }
  });
  return () => count;
}

test("same raw URL is parsed once within a domain operation, and the next operation is fresh", async () => {
  await import("../../src/background/background.ts"); const parses = countURLParses();
  await commands.emit("10_execute_option9_d");
  expect(mock.api.tabs.remove).toHaveBeenCalledExactlyOnceWith([1, 2, 3, 4, 5, 6, 7, 8]);
  expect(parses()).toBe(1);
  tabs = [tab(9, "https://same.example/path"), tab(1, "https://fresh.example/")];
  await commands.emit("10_execute_option9_d");
  expect(mock.api.tabs.remove).toHaveBeenLastCalledWith([1]);
  expect(parses()).toBe(3);
});

test.each(["", "not a URL", "file:///tmp/a"])("invalid domain %j is cached but never actionable", async url => {
  tabs = Array.from({ length: 8 }, (_, i) => tab(i + 1, url));
  await import("../../src/background/background.ts"); const parses = countURLParses();
  await commands.emit("10_execute_option9_d");
  expect(mock.api.tabs.remove).not.toHaveBeenCalled();
  expect(parses()).toBeLessThanOrEqual(1);
});

test.each([true, false])("duplicate scan preserves last occurrence, forward IDs and scope current=%s", async currentonly => {
  Object.assign(mock.data, { depclean: true, currentonly });
  tabs = [tab(1, "https://a.example/"), tab(2, "https://b.example/"), tab(3, "https://a.example/"),
    tab(4, "https://b.example/", 2), tab(5, "https://a.example/")];
  const pinned = tab(6, "https://a.example/"); pinned.pinned = true; tabs.push(pinned);
  await import("../../src/background/background.ts"); await mock.clicked.emit();
  const expected = currentonly ? [1, 3] : [1, 2, 3];
  expect(mock.api.tabs.remove).toHaveBeenCalledExactlyOnceWith(expected);
  expect(tabs.map(t => t.id)).toEqual(currentonly ? [2, 4, 5, 6] : [4, 5, 6]);
});

test("duplicate shortcut retains missing-ID last occurrence and treats absent URL as empty", async () => {
  tabs = [tab(1, ""), tab(2, "https://a.example/"), tab(3, "https://a.example/"), tab(4, "")];
  delete tabs[3]!.url; delete tabs[2]!.id;
  await import("../../src/background/background.ts"); await commands.emit("08_execute_option2");
  expect(mock.api.tabs.remove).toHaveBeenCalledExactlyOnceWith([1, 2]);
});

test("URL rules compile once per operation and changed rules are fresh; OFF does not compile", async () => {
  const rules = await import("../../src/rules/url-rules.ts"); const compile = vi.spyOn(rules, "compileURLRules");
  Object.assign(mock.data, { urlmatch: true, urlmatch_pattern: "https://same.example/*" });
  await import("../../src/background/background.ts"); await mock.clicked.emit();
  expect(compile).toHaveBeenCalledTimes(1); expect(mock.api.tabs.remove).toHaveBeenLastCalledWith([1, 2, 3, 4, 5, 6, 7, 8]);
  tabs = [tab(1, "https://same.example/path"), tab(2, "https://fresh.example/path")];
  mock.data.urlmatch_pattern = "https://fresh.example/*"; await mock.clicked.emit();
  expect(compile).toHaveBeenCalledTimes(2); expect(mock.api.tabs.remove).toHaveBeenLastCalledWith([2]);
  Object.assign(mock.data, { urlmatch: false, urlmatch_pattern: "@(invalid", depclean: true });
  tabs.push(tab(3, "https://same.example/path")); await mock.clicked.emit();
  expect(compile).toHaveBeenCalledTimes(2); expect(mock.api.tabs.remove).toHaveBeenLastCalledWith([1]);
});

test("URL sorting parses each URL once and a later sort reads changed URLs", async () => {
  const sorted = installSortBrowser(target, { 1: ["d", "c", "b", "a"].map((title, index) => ({ id: index + 1, title })) });
  Object.assign(sorted.data, { currentonly: true, sortkey: "url" });
  await import("../../src/background/background.ts"); const parses = countURLParses();
  const click = sorted.clicked.addListener.mock.calls[0]![0];
  await click();
  expect(sorted.state.get(1)?.map(t => t.id)).toEqual([4, 3, 2, 1]);
  expect(parses()).toBe(4);
  sorted.state.get(1)!.find(t => t.id === 1)!.url = "https://example.com/0";
  await click();
  expect(sorted.state.get(1)?.map(t => t.id)).toEqual([1, 4, 3, 2]);
  expect(parses()).toBe(8);
});

test("invalid sort URL remains a failed operation, rather than a cached successful selection", async () => {
  const sorted = installSortBrowser(target, { 1: [{ id: 1, title: "a", url: "invalid" }, { id: 2, title: "b" }] });
  Object.assign(sorted.data, { currentonly: true, sortkey: "url" });
  const title = vi.fn(async () => {}); Object.assign(sorted.api.action, { setTitle: title });
  Object.assign(sorted.api, { i18n: { getMessage: (key: string) => key } });
  await import("../../src/background/background.ts"); await sorted.clicked.addListener.mock.calls[0]![0]();
  expect(sorted.api.tabs.move).not.toHaveBeenCalled();
  expect(title).toHaveBeenLastCalledWith({ title: "operationFailed" });
});

if (target === "chrome") {
  test("group construction shares parsing and preserves member order, existing group and pinned offset", async () => {
    Object.assign(mock.data, { grouping: true, grouping_min: 2, sorttab: true, sortkey: "url" });
    for (const member of tabs.slice(3)) member.groupId = 42;
    const pinned = tab(9, "https://same.example/path"); pinned.pinned = true; tabs.push(pinned);
    const group = vi.fn(async (d: { tabIds: number[]; groupId?: number }) => d.groupId ?? 43);
    Object.assign(mock.api.tabs, { group, ungroup: vi.fn(async () => {}) });
    const move = vi.fn(async () => {});
    Object.assign(mock.api, { tabGroups: { update: vi.fn(async () => {}), query: vi.fn(async () => [{ id: 42, title: "same.example" }]), move } });
    await import("../../src/background/background.ts"); const parses = countURLParses(); await mock.clicked.emit();
    expect(parses()).toBe(1);
    expect(group).toHaveBeenCalledExactlyOnceWith({ tabIds: [1, 2, 3], createProperties: undefined, groupId: 42 });
    expect(move).toHaveBeenCalledExactlyOnceWith(42, { index: 1 });
  });

  test("grouping leaves tabs alone when groups are already formed and in order", async () => {
    Object.assign(mock.data, { grouping: true, grouping_min: 2 });
    tabs = [tab(1, "https://a.example/"), tab(2, "https://a.example/"), tab(3, "https://b.example/"), tab(4, "https://b.example/"), tab(5, "https://c.example/")];
    tabs.forEach(t => { t.groupId = t.url!.startsWith("https://a.") ? 41 : t.url!.startsWith("https://b.") ? 42 : -1; });
    const group = vi.fn(async (d: { tabIds: number[]; groupId?: number }) => d.groupId ?? 43);
    const ungroup = vi.fn(async () => {});
    Object.assign(mock.api.tabs, { group, ungroup });
    const move = vi.fn(async () => {});
    Object.assign(mock.api, { tabGroups: { update: vi.fn(async () => {}), query: vi.fn(async () => [{ id: 41, title: "a.example" }, { id: 42, title: "b.example" }]), move } });
    await import("../../src/background/background.ts"); await mock.clicked.emit();
    expect(group).not.toHaveBeenCalled();
    expect(ungroup).not.toHaveBeenCalled();
    expect(move).not.toHaveBeenCalled();
  });
}
