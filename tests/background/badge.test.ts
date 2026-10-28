import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { installSettingsBrowser, controlledEvent } from "../helpers/settings-browser.ts";
import type { BrowserTarget } from "../helpers/browser.ts";

const target = process.env.TEST_BROWSER as BrowserTarget;
let mock: ReturnType<typeof installSettingsBrowser>;
let tabs: chrome.tabs.Tab[];
let events: Record<string, ReturnType<typeof controlledEvent<unknown[]>>>;
// The browser shows a tab's own text, else its window's (Firefox), else the global one.
let globalText: string;
let tabTexts: Map<number, string>;
let windowTexts: Map<number, string>;
const shown = (id: number) => {
  const item = tabs.find(t => t.id === id);
  return tabTexts.get(id) ?? (item ? windowTexts.get(item.windowId) : undefined) ?? globalText;
};
const shownAll = () => tabs.filter(t => t.id != null).map(t => [t.id, shown(t.id!)]);
function tab(id: number, windowId: number, pinned = false): chrome.tabs.Tab {
  return { id, windowId, pinned, index: id, active: false, highlighted: false,
    incognito: false, selected: false, discarded: false, autoDiscardable: true,
    groupId: -1, lastAccessed: 0, frozen: false, url: "https://example.com/" };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  vi.resetModules();
  mock = installSettingsBrowser(target);
  Object.assign(mock.data, { iconbadge: true, iconbadgescope: "all" });
  tabs = [tab(1, 1, true), tab(2, 1), tab(3, 2, true)];
  globalText = ""; tabTexts = new Map(); windowTexts = new Map();
  events = Object.fromEntries(["onCreated", "onRemoved", "onMoved", "onDetached", "onAttached", "onUpdated", "onReplaced"].map(name => [name, controlledEvent<unknown[]>()]));
  Object.assign(mock.api.tabs, events);
  mock.api.tabs.query.mockImplementation(async (query: unknown) => {
    const q = query as { pinned?: boolean; active?: boolean; windowId?: number };
    return tabs.filter(t => [1, 2].includes(t.windowId) && (q.pinned == null || t.pinned === q.pinned) && (!q.active || t.active) && (q.windowId == null || t.windowId === q.windowId)).map(t => ({ ...t }));
  });
  mock.api.windows.getAll.mockImplementation(async () => [1, 2].map(id => ({ id, tabs: tabs.filter(t => t.windowId === id) } as chrome.windows.Window)));
  mock.api.action.setBadgeText.mockImplementation((details: unknown) => {
    const d = details as { tabId?: number; windowId?: number; text: string | null };
    const map = d.tabId != null ? tabTexts : d.windowId != null ? windowTexts : undefined;
    const key = d.tabId ?? d.windowId!;
    if (!map) globalText = d.text ?? "";
    else if (d.text === null) map.delete(key);
    else map.set(key, d.text);
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const textCalls = () => mock.api.action.setBadgeText.mock.calls.length;

test("all scope shows the pinned-inclusive total with one global call, OFF clears it", async () => {
  const { setIconBadge } = await import("../../src/background/badge.ts");
  await setIconBadge(true, "all");
  expect(shownAll()).toEqual([[1, "3"], [2, "3"], [3, "3"]]);
  const calls = textCalls();
  await setIconBadge(true, "all");
  expect(textCalls()).toBe(calls);
  await setIconBadge(false, "win");
  expect(shownAll()).toEqual([[1, ""], [2, ""], [3, ""]]);
  expect(textCalls()).toBe(calls + 1);
});
test("window scope uses the same pinned-inclusive population for counting and display", async () => {
  const { setIconBadge } = await import("../../src/background/badge.ts");
  await setIconBadge(true, "win");
  expect(shownAll()).toEqual([[1, "2"], [2, "2"], [3, "1"]]);
});
test("window scope writes only values that changed", async () => {
  const { setIconBadge } = await import("../../src/background/badge.ts");
  await setIconBadge(true, "win");
  const calls = textCalls();
  await setIconBadge(true, "win");
  expect(textCalls()).toBe(calls);
  tabs.push(tab(4, 2));
  await setIconBadge(true, "win");
  expect(shownAll()).toEqual([[1, "2"], [2, "2"], [3, "2"], [4, "2"]]);
  // Chrome sets the two tabs of window 2; Firefox sets window 2 once.
  expect(textCalls() - calls).toBe(target === "chrome" ? 2 : 1);
});
test("texts left on tabs by earlier versions are cleared once", async () => {
  tabTexts.set(1, "9"); tabTexts.set(2, "9"); tabTexts.set(3, "");
  const { setIconBadge } = await import("../../src/background/badge.ts");
  await setIconBadge(true, "all");
  expect(shownAll()).toEqual([[1, "3"], [2, "3"], [3, "3"]]);
  const calls = textCalls();
  await setIconBadge(true, "all");
  expect(textCalls()).toBe(calls);
});
test("a new background lifetime restores what was shown from session storage", async () => {
  const session = new Map<string, unknown>();
  Object.assign(mock.api.storage, { session: {
    get: vi.fn(async (key: string) => (session.has(key) ? { [key]: structuredClone(session.get(key)) } : {})),
    set: vi.fn(async (items: Record<string, unknown>) => { for (const [key, value] of Object.entries(items)) session.set(key, structuredClone(value)); }),
  } });
  await (await import("../../src/background/badge.ts")).setIconBadge(true, "win");
  vi.resetModules();
  const calls = textCalls();
  await (await import("../../src/background/badge.ts")).setIconBadge(true, "win");
  expect(textCalls()).toBe(calls);
  expect(shownAll()).toEqual([[1, "2"], [2, "2"], [3, "1"]]);
});
test("badge API completion is awaited for both text and color", async () => {
  const text = deferred(), color = deferred();
  mock.api.action.setBadgeText.mockImplementationOnce(() => text.promise);
  mock.api.action.setBadgeBackgroundColor.mockImplementationOnce(() => color.promise);
  const { setIconBadge } = await import("../../src/background/badge.ts");
  let done = false;
  const work = setIconBadge(true, "all").then(() => { done = true; });
  await vi.waitFor(() => expect(mock.api.action.setBadgeText).toHaveBeenCalled());
  expect(done).toBe(false);
  text.resolve(); await Promise.resolve(); expect(done).toBe(false);
  color.resolve(); await work; expect(done).toBe(true);
});
test("a synchronous badge failure is isolated and the next pass repairs it", async () => {
  mock.api.action.setBadgeText.mockImplementationOnce(() => { throw new Error("badge unavailable"); });
  const { setIconBadge } = await import("../../src/background/badge.ts");
  await setIconBadge(true, "all");
  expect(console.log).toHaveBeenCalledWith("setIconBadgeImpl", expect.any(Error));
  await setIconBadge(true, "all");
  expect(shown(2)).toBe("3");
  await setIconBadge(false, "all"); expect(shown(1)).toBe("");
});
test("background recounts on count-changing events only", async () => {
  await import("../../src/background/background.ts");
  for (const name of ["onCreated", "onRemoved", "onDetached", "onAttached"]) expect(events[name]!.listeners.length).toBeGreaterThan(0);
  expect(events.onMoved!.listeners.length).toBe(0);
  await events.onUpdated!.emit(2, { title: "loading" }, tabs[1]);
  expect(mock.api.action.setBadgeText).not.toHaveBeenCalled();
  if (target === "chrome") expect(events.onReplaced!.listeners.length).toBeGreaterThan(0);
});
test("events arriving during a delayed query converge to the latest state", async () => {
  await import("../../src/background/background.ts");
  const gate = deferred();
  mock.api.tabs.query.mockImplementationOnce(async () => { const old = tabs.map(t => ({ ...t })); await gate.promise; return old; });
  const first = events.onCreated!.emit();
  await vi.waitFor(() => expect(mock.api.tabs.query).toHaveBeenCalled());
  tabs.push(tab(4, 2));
  const last = events.onCreated!.emit();
  gate.resolve(); await Promise.all([first, last]);
  expect(shownAll().map(([, text]) => text)).toEqual(["4", "4", "4", "4"]);
});
test("asynchronous rejection waits for other started APIs and recovers", async () => {
  const gate = deferred();
  mock.api.action.setBadgeText.mockImplementationOnce(() => Promise.reject(new Error("text failed")));
  mock.api.action.setBadgeBackgroundColor.mockImplementationOnce(() => gate.promise);
  const { setIconBadge } = await import("../../src/background/badge.ts");
  let done = false;
  const work = setIconBadge(true, "all").then(() => { done = true; });
  await vi.waitFor(() => expect(mock.api.action.setBadgeText).toHaveBeenCalled());
  expect(done).toBe(false); gate.resolve(); await work;
  expect(console.log).toHaveBeenCalledWith("setIconBadgeImpl", expect.any(Error));
  await setIconBadge(true, "all"); expect(shown(2)).toBe("3");
  await setIconBadge(false, "all"); expect(shown(1)).toBe("");
});
test.each(["all", "win"] as const)("normal-window policy, missing IDs and empty population terminate for %s", async scope => {
  tabs.push(tab(4, 99));
  const noId = tab(5, 1); delete noId.id; tabs.push(noId);
  const { setIconBadge } = await import("../../src/background/badge.ts");
  await setIconBadge(true, scope);
  expect(shown(1)).toBe(scope === "all" ? "4" : "3");
  expect(tabTexts.has(4)).toBe(false);
  expect(mock.api.tabs.query).toHaveBeenCalledWith({ windowType: "normal" });
  tabs = []; await setIconBadge(true, scope); await setIconBadge(false, scope);
});
test.each(["all", "win"] as const)("ON to OFF clears pinned badges after %s display", async scope => {
  const { setIconBadge } = await import("../../src/background/badge.ts");
  await setIconBadge(true, scope); await setIconBadge(false, scope);
  expect(shownAll()).toEqual([[1, ""], [2, ""], [3, ""]]);
  expect(tabTexts.size + windowTexts.size).toBe(0);
});
test("actual create/remove/detach/attach events converge across windows", async () => {
  mock.data.iconbadgescope = "win";
  await import("../../src/background/background.ts");
  tabs.push(tab(4, 1)); await events.onCreated!.emit(tabs[3]);
  expect(shown(1)).toBe("3"); expect(shown(3)).toBe("1");
  tabs = tabs.filter(t => t.id !== 2); await events.onRemoved!.emit(2, { windowId: 1 });
  expect(shown(1)).toBe("2");
  tabs.find(t => t.id === 4)!.windowId = 2;
  await events.onDetached!.emit(4, { oldWindowId: 1 });
  await events.onAttached!.emit(4, { newWindowId: 2 });
  expect(shown(1)).toBe("1"); expect(shown(4)).toBe("2"); expect(shown(3)).toBe("2");
});
test("query failure releases worker and a new event succeeds", async () => {
  await import("../../src/background/background.ts");
  mock.api.tabs.query.mockRejectedValueOnce(new Error("query failed"));
  await events.onCreated!.emit();
  expect(console.error).toHaveBeenCalledWith("updateIconBadge", expect.any(Error));
  await events.onCreated!.emit(); expect(shown(1)).toBe("3");
});
test("a queued event is retained when an earlier pass fails", async () => {
  await import("../../src/background/background.ts");
  const gate = deferred();
  mock.api.tabs.query.mockImplementationOnce(async () => { await gate.promise; throw new Error("query failed"); });
  const first = events.onCreated!.emit();
  await vi.waitFor(() => expect(mock.api.tabs.query).toHaveBeenCalledTimes(1));
  tabs.push(tab(4, 2)); const last = events.onCreated!.emit();
  gate.resolve(); await Promise.all([first, last]); expect(shown(4)).toBe("4");
});
test("many added events coalesce, latest zero finishes and subsequent population updates", async () => {
  await import("../../src/background/background.ts");
  const gate = deferred();
  mock.api.tabs.query.mockImplementationOnce(async () => { const old = [...tabs]; await gate.promise; return old; });
  const first = events.onCreated!.emit();
  await vi.waitFor(() => expect(mock.api.tabs.query).toHaveBeenCalledTimes(1));
  const pending = Array.from({ length: 12 }, () => events.onCreated!.emit());
  tabs = []; gate.resolve(); await Promise.all([first, ...pending]);
  expect(mock.api.tabs.query).toHaveBeenCalledTimes(2);
  tabs = [tab(9, 1, true)]; await events.onCreated!.emit(); expect(shown(9)).toBe("1");
});
test("settings scope and OFF during delayed API work are awaited and reflect latest values", async () => {
  await import("../../src/background/background.ts");
  const gate = deferred();
  mock.api.action.setBadgeBackgroundColor.mockImplementationOnce(() => gate.promise);
  const first = events.onCreated!.emit();
  await vi.waitFor(() => expect(shown(1)).toBe("3"));
  let done = false;
  const setting = mock.external({ iconbadgescope: "win" }).then(() => { done = true; });
  await Promise.resolve(); expect(done).toBe(false);
  gate.resolve(); await Promise.all([first, setting]);
  expect(shown(1)).toBe("2"); expect(shown(3)).toBe("1");
  await mock.external({ iconbadge: false }); expect(shownAll().map(([, text]) => text)).toEqual(["", "", ""]);
});
test("a notice marks one tab briefly and then restores its count", async () => {
  vi.useFakeTimers();
  mock.data.iconbadgescope = "win";
  const { setIconBadge, flashIconBadge } = await import("../../src/background/badge.ts");
  await setIconBadge(true, "win");
  const restored = vi.fn(() => setIconBadge(true, "win"));
  await flashIconBadge(2, restored);
  expect(shown(2)).toBe("!"); expect(shown(1)).toBe("2");
  await vi.advanceTimersByTimeAsync(2000);
  expect(restored).toHaveBeenCalledOnce();
  expect(shownAll()).toEqual([[1, "2"], [2, "2"], [3, "1"]]);
});


test.each(["all", "win"] as const)("pin and unpin ordinary tabs retain inclusive count and display for %s", async scope => {
  mock.data.iconbadgescope = scope;
  await import("../../src/background/background.ts");
  await events.onCreated!.emit(tabs[1]);
  const expected = scope === "all" ? [[1, "3"], [2, "3"], [3, "3"]] : [[1, "2"], [2, "2"], [3, "1"]];
  expect(shownAll()).toEqual(expected);
  tabs[1]!.pinned = true;
  await events.onUpdated!.emit(2, { pinned: true }, { ...tabs[1]!, active: true });
  expect(shownAll()).toEqual(expected);
  tabs[1]!.pinned = false;
  await events.onUpdated!.emit(2, { pinned: false }, { ...tabs[1]!, active: true });
  expect(shownAll()).toEqual(expected);
  tabs.push(tab(4, 1));
  await events.onCreated!.emit(tabs[3]);
  expect(shownAll()).toEqual(scope === "all" ? [[1, "4"], [2, "4"], [3, "4"], [4, "4"]] : [[1, "3"], [2, "3"], [3, "1"], [4, "3"]]);
});
