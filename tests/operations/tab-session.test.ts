import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { installSettingsBrowser, controlledEvent } from "../helpers/settings-browser.ts";
import type { BrowserTarget } from "../helpers/browser.ts";
import { captureTabSession, isSameTabSession } from "../../src/operations/tab-session.ts";
import { getDomainsByLevelWithoutPublicSuffix, isDomainMatch } from "../../src/operations/misc.ts";

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

test.each(["button", "command", "menu"])("%s never closes tabs from the opposite privacy boundary", async entry => {
  await import("../../src/background/background.ts");
  if (entry === "button") await mock.clicked.emit();
  else if (entry === "command") await commands.emit("08_execute_option2");
  else await mock.menuClicked.emit({ menuItemId: "ohmytab_close_tabs", editable: false }, tabs[0]!);
  expect(mock.api.tabs.remove).toHaveBeenCalledExactlyOnceWith(entry === "menu" ? [1, 2] : [1]);
});

test("clicked private origin wins over a focused normal window for menu scope and extraction", async () => {
  await import("../../src/background/background.ts");
  await mock.menuClicked.emit({ menuItemId: "ohmytab_close_tabs", editable: false }, tabs[2]!);
  expect(mock.api.tabs.remove).toHaveBeenCalledExactlyOnceWith([3, 4]);
  mock.api.windows.create.mockResolvedValueOnce({ id: 8 });
  await mock.menuClicked.emit({ menuItemId: "ohmytab_extract_tab", editable: false }, tabs[2]!);
  expect(mock.api.windows.create).toHaveBeenCalledWith({ tabId: 3, incognito: true });
});

test("glue only moves tabs from the captured privacy and container session", async () => {
  tabs.push(makeTab(5, 4, false, "firefox-container-2"));
  await import("../../src/background/background.ts"); await commands.emit("02_execute_option1");
  expect(mock.api.tabs.move).toHaveBeenCalledExactlyOnceWith(target === "firefox" ? [2] : [2, 5], { windowId: 1, index: -1 });
});

test.runIf(target === "firefox")("duplicate cleanup and domain menus preserve other containers", async () => {
  tabs = [makeTab(1, 1), makeTab(2, 1), makeTab(3, 1, false, "firefox-container-2"), makeTab(4, 1, false, "firefox-container-2")];
  await import("../../src/background/background.ts"); await commands.emit("08_execute_option2");
  expect(mock.api.tabs.remove).toHaveBeenCalledExactlyOnceWith([1]);
  mock.api.tabs.remove.mockClear();
  await mock.menuClicked.emit({ menuItemId: "ohmytab_close_tabs", editable: false }, tabs[2]!);
  expect(mock.api.tabs.remove).toHaveBeenCalledExactlyOnceWith([3, 4]);
});

test.runIf(target === "firefox")("unknown origin container refuses mutation visibly and a later known request can run", async () => {
  delete tabs[0]!.cookieStoreId;
  await import("../../src/background/background.ts"); await mock.clicked.emit();
  expect(mock.api.tabs.remove).not.toHaveBeenCalled();
  expect(mock.api.tabs.move).not.toHaveBeenCalled();
  expect(mock.api.action.setTitle.mock.calls.map(([d]) => (d as { title: string }).title)).toContain("operationFailed");
  tabs[0]!.cookieStoreId = "firefox-default";
  await mock.clicked.emit(); expect(mock.api.tabs.remove).toHaveBeenCalledExactlyOnceWith([1]);
});

test.runIf(target === "firefox")("a candidate without container metadata is excluded instead of assumed default", async () => {
  delete tabs[1]!.cookieStoreId; tabs.push(makeTab(5, 1));
  await import("../../src/background/background.ts"); await mock.clicked.emit();
  expect(mock.api.tabs.remove).toHaveBeenCalledExactlyOnceWith([1]);
});

test("query permission failure is reported without mutation and does not retain the operation lock", async () => {
  await import("../../src/background/background.ts");
  mock.api.tabs.query.mockRejectedValueOnce(new Error("permission unavailable"));
  await mock.clicked.emit(); expect(mock.api.tabs.remove).not.toHaveBeenCalled();
  await mock.clicked.emit(); expect(mock.api.tabs.remove).toHaveBeenCalledExactlyOnceWith([1]);
});

test("session matching rejects unknown privacy metadata and never treats missing container as default", () => {
  const session = captureTabSession(makeTab(1, 1), { incognito: false } as chrome.windows.Window, true);
  expect(isSameTabSession(makeTab(2, 1), session)).toBe(true);
  expect(isSameTabSession(makeTab(3, 1, true), session)).toBe(false);
  expect(isSameTabSession(makeTab(4, 1, false, "other"), session)).toBe(false);
  const unknown = { ...makeTab(5, 1), incognito: undefined } as unknown as SessionTab;
  expect(isSameTabSession(unknown, session)).toBe(false);
  expect(() => captureTabSession(undefined, {} as chrome.windows.Window, true)).toThrow("session unavailable");
});

test("PRIVATE suffix keeps github.io tenants separate in detailed domain choices", () => {
  expect(getDomainsByLevelWithoutPublicSuffix("https://a.foo.github.io/")).toEqual(["a.foo.github.io", "foo.github.io"]);
  expect(getDomainsByLevelWithoutPublicSuffix("https://github.io/")).toEqual([]);
  expect(isDomainMatch("https://bar.github.io/", "foo.github.io", true)).toBe(false);
});
