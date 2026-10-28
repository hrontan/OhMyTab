import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { installSettingsBrowser, controlledEvent } from "../helpers/settings-browser.ts";
import type { BrowserTarget } from "../helpers/browser.ts";
import { duplicateTabIds, parseProtectedDomains, protectionReasons } from "../../src/operations/tab-protection.ts";

type SessionTab = chrome.tabs.Tab & { cookieStoreId?: string };
const target = process.env.TEST_BROWSER as BrowserTarget;
let mock: ReturnType<typeof installSettingsBrowser>;
let tabs: SessionTab[];
let focused: number;
let commands: ReturnType<typeof controlledEvent<[string]>>;
const makeTab = (id: number, windowId: number, incognito = false, cookieStoreId = "firefox-default"): SessionTab => ({
  id, windowId, incognito, cookieStoreId, index: id - 1, active: id === 1,
  pinned: false, highlighted: false, selected: false, discarded: false,
  autoDiscardable: true, lastAccessed: 0, frozen: false, groupId: -1, url: "https://same.example/", title: String(id),
});
beforeEach(() => {
  vi.resetModules(); mock = installSettingsBrowser(target); focused = 1;
  tabs = [makeTab(1, 1), makeTab(2, 2), makeTab(3, 3, true), makeTab(4, 3, true)];
  commands = controlledEvent<[string]>(); Object.assign(mock.api, { commands: { onCommand: commands } });
  Object.assign(mock.data, { glue: false, depclean: true, sorttab: false, refresh: false,
    grouping: false, iconbadge: false, urlmatch: false, currentonly: false,
    contextmenu1scope: "all", contextmenu4scope: "all" });
  mock.api.tabs.query.mockImplementation(async value => {
    const q = value as { windowId?: number; active?: boolean; currentWindow?: boolean; pinned?: boolean };
    return structuredClone(tabs.filter(t => (q.windowId == null || t.windowId === q.windowId) &&
      (!q.currentWindow || t.windowId === focused) && (!q.active || t.active) &&
      (q.pinned == null || t.pinned === q.pinned)));
  });
  mock.api.windows.getLastFocused.mockImplementation(async () => ({ id: focused, type: "normal" as const, focused: true, alwaysOnTop: false,
    incognito: tabs.find(t => t.windowId === focused)?.incognito ?? false }));
  mock.api.windows.getAll.mockImplementation(async () => [...new Set(tabs.map(t => t.windowId))].map(id =>
    ({ id, type: "normal", incognito: tabs.find(t => t.windowId === id)!.incognito }) as chrome.windows.Window));
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });


test("protection reasons compose before duplicate keeper and preserve last by default", async () => {
  const { defaultSetting } = await import("../../src/settings/setting.ts");
  const first = { ...makeTab(1, 1), audible: true, pinned: true, groupId: 9 };
  const setting = { ...defaultSetting, protect_audible: true, protect_groups: true };
  expect(protectionReasons(first, setting, ["same.example"])).toEqual(["pinned", "protected-domain", "audible", "existing-group"]);
  const list = [makeTab(1, 1), makeTab(2, 1), makeTab(3, 1)];
  expect(duplicateTabIds(list, "last")).toEqual([1, 2]);
  list[1]!.active = true;
  expect(duplicateTabIds(list, "active", 1)).toEqual([2, 3]);
  expect(duplicateTabIds(list, "active", 99)).toEqual([1, 3]);
  list.forEach(t => { t.active = false; });
  expect(duplicateTabIds(list, "active")).toEqual([1, 2]);
});

test("domain protection uses exact hostname and label-boundary descendants", async () => {
  const { defaultSetting } = await import("../../src/settings/setting.ts");
  const names = parseProtectedDomains(" EXAMPLE.com.\n\nfoo.github.io");
  expect(names).toEqual(["example.com", "foo.github.io"]);
  expect(protectionReasons({ ...tabs[0]!, url: "https://a.example.com/" }, defaultSetting, names)).toEqual(["protected-domain"]);
  expect(protectionReasons({ ...tabs[0]!, url: "https://notexample.com/" }, defaultSetting, names)).toEqual([]);
  expect(protectionReasons({ ...tabs[0]!, url: "https://bar.github.io/" }, defaultSetting, names)).toEqual([]);
});

test.each(["https://example.com", "*.example.com", "example.com/path", "example.com:443", "a b.com"])(
  "invalid protected hostname %s is rejected", value => { expect(() => parseProtectedDomains(value)).toThrow("hostname"); }
);
test("protection lists have bounded size and never silently drop invalid entries", () => {
  expect(() => parseProtectedDomains("a".repeat(4097))).toThrow("4096");
  expect(() => parseProtectedDomains(Array(101).fill("a.com").join("\n"))).toThrow("100");
  expect(() => parseProtectedDomains("ok.example\nhttps://bad.example")).toThrow("line 2");
});

test.each(["button", "command", "menu"])("%s applies the same protection exclusions", async entry => {
  tabs = [makeTab(1, 1), makeTab(2, 1), makeTab(3, 1), makeTab(4, 1), makeTab(5, 1), makeTab(6, 1)];
  tabs[0]!.audible = true;
  tabs[3]!.groupId = 9;
  tabs[4]!.url = "https://protected.example/";
  tabs[5]!.pinned = true;
  Object.assign(mock.data, { protect_audible: true, protect_groups: true, protect_domains: "protected.example" });
  await import("../../src/background/background.ts");
  if (entry === "button") await mock.clicked.emit();
  else if (entry === "command") await commands.emit("08_execute_option2");
  else await mock.menuClicked.emit({ menuItemId: "ohmytab_close_tabs", editable: false }, tabs[0]!);
  expect(mock.api.tabs.remove).toHaveBeenCalledExactlyOnceWith(entry === "menu" ? [2, 3] : [2]);
});

test("active preference changes keeper only among eligible session tabs", async () => {
  tabs = [makeTab(1, 1), makeTab(2, 1), makeTab(3, 1)];
  Object.assign(mock.data, { duplicate_keep: "active" });
  await import("../../src/background/background.ts"); await commands.emit("08_execute_option2");
  expect(mock.api.tabs.remove).toHaveBeenCalledExactlyOnceWith([2, 3]);
  mock.api.tabs.remove.mockClear(); mock.data.protect_audible = true; tabs[0]!.audible = true;
  await commands.emit("08_execute_option2");
  expect(mock.api.tabs.remove).toHaveBeenCalledExactlyOnceWith([2]);
});

test.each(["button", "command", "menu"])("%s does not move a protected tab", async entry => {
  tabs = [makeTab(1, 1), makeTab(2, 2), makeTab(3, 2)];
  tabs[0]!.audible = true; tabs[1]!.audible = true;
  Object.assign(mock.data, { protect_audible: true, glue: true, depclean: false });
  await import("../../src/background/background.ts");
  if (entry === "button") await mock.clicked.emit();
  else if (entry === "command") await commands.emit("02_execute_option1");
  else await mock.menuClicked.emit({ menuItemId: "ohmytab_glue_windows", editable: false }, tabs[0]!);
  expect(mock.api.tabs.move).toHaveBeenCalledExactlyOnceWith([3], { windowId: 1, index: -1 });
});

test("protected current-tab extraction is refused without creating a window", async () => {
  mock.data.protect_domains = "same.example";
  await import("../../src/background/background.ts");
  await mock.menuClicked.emit({ menuItemId: "ohmytab_extract_tab", editable: false }, tabs[0]!);
  await commands.emit("05_execute_option11_d");
  expect(mock.api.windows.create).not.toHaveBeenCalled();
});

test("invalid stored domain rules fail before mutations and corrected rules recover", async () => {
  mock.data.protect_domains = "https://invalid.example";
  await import("../../src/background/background.ts"); await mock.clicked.emit();
  expect(mock.api.tabs.remove).not.toHaveBeenCalled(); expect(mock.api.tabs.move).not.toHaveBeenCalled();
  mock.data.protect_domains = ""; await mock.clicked.emit();
  expect(mock.api.tabs.remove).toHaveBeenCalledExactlyOnceWith([1]);
});

test("settings normalize new fields and the registered form saves and rejects invalid rules", async () => {
  const { defaultSetting, normalizeSetting } = await import("../../src/settings/setting.ts");
  expect(normalizeSetting({ duplicate_keep: "unknown", protect_audible: "yes" })).toMatchObject({
    duplicate_keep: "last", protect_audible: false, protect_groups: false, protect_domains: "",
  });
  const { createOptionsDocument } = await import("../helpers/options-dom.ts");
  const dom = createOptionsDocument(Object.keys(defaultSetting)); vi.stubGlobal("document", dom.document);
  mock.api.storage.sync.set.mockImplementation((values, callback) => {
    Object.assign(mock.data, values); if (target === "chrome") { callback?.(); return; }
    return Promise.resolve();
  });
  await import("../../src/options/options.ts"); await dom.load();
  dom.elements.protect_audible!.checked = true;
  dom.elements.protect_groups!.checked = true;
  dom.elements.protect_domains!.value = "example.com";
  dom.elements.duplicate_keep!.value = "active";
  await dom.form.dispatch("change");
  expect(mock.data).toMatchObject({ protect_audible: true, protect_groups: true, protect_domains: "example.com", duplicate_keep: "active" });
  const saved = structuredClone(mock.data);
  dom.elements.protect_domains!.value = "https://invalid.example";
  await dom.form.dispatch("change");
  expect(mock.data).toEqual(saved); expect(dom.status.textContent).toContain("settingsSaveFailed");
});

test.runIf(target === "chrome")("group movement never carries a protected member along", async () => {
  tabs = [makeTab(1, 1), makeTab(2, 1), makeTab(3, 1)];
  tabs[0]!.groupId = 7; tabs[0]!.audible = true; tabs[1]!.groupId = 7;
  Object.assign(mock.data, { protect_audible: true, grouping: true, grouping_min: 4, depclean: false });
  const groups = { query: vi.fn(async () => [{ id: 7, title: "same.example" }]),
    update: vi.fn(async () => {}), move: vi.fn(async () => {}) };
  const ungroup = vi.fn(async () => {}); const group = vi.fn(async () => 8);
  Object.assign(mock.api, { tabGroups: groups }); Object.assign(mock.api.tabs, { ungroup, group });
  await import("../../src/background/background.ts"); await mock.clicked.emit();
  expect(groups.move).not.toHaveBeenCalled(); expect(ungroup).not.toHaveBeenCalled(); expect(group).not.toHaveBeenCalled();
});
