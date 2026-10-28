import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { installSettingsBrowser, controlledEvent } from "../helpers/settings-browser.ts";
import type { BrowserTarget } from "../helpers/browser.ts";

const target = process.env.TEST_BROWSER as BrowserTarget;
let mock: ReturnType<typeof installSettingsBrowser>;
let tabs: chrome.tabs.Tab[];
let focus: number;
let commands: ReturnType<typeof controlledEvent<[string]>>;
let titles: string[];
function tab(id: number, windowId: number, url = "https://duplicate.example/"): chrome.tabs.Tab {
  return { id, windowId, url, index: id, pinned: false, active: id === 1 || id === 3,
    highlighted: false, incognito: false, ...(target === "firefox" ? { cookieStoreId: "firefox-default" } : {}), selected: false, discarded: false,
    autoDiscardable: true, groupId: -1, lastAccessed: 0, frozen: false };
}
function gate() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => {
  vi.resetModules(); mock = installSettingsBrowser(target); focus = 1;
  tabs = [tab(1, 1), tab(2, 1), tab(3, 2), tab(4, 2)]; titles = [];
  Object.assign(mock.data, { glue: false, depclean: true, sorttab: false, refresh: false, comclose: false, closelocal: false, rxclose: false, grouping: false, iconbadge: false, urlmatch: false, currentonly: true });
  commands = controlledEvent<[string]>(); Object.assign(mock.api, { commands: { onCommand: commands }, i18n: { getMessage: (key: string, substitutions?: string[]) => [key, ...(substitutions ?? [])].join(":") } });
  Object.assign(mock.api.action, { setTitle: vi.fn(async (d: { title: string }) => { titles.push(d.title); }) });
  mock.api.tabs.query.mockImplementation(async (value: unknown) => {
    const q = value as { windowId?: number; currentWindow?: boolean; active?: boolean; pinned?: boolean };
    return structuredClone(tabs.filter(t => (!q.currentWindow || t.windowId === focus) && (q.windowId == null || t.windowId === q.windowId) && (!q.active || t.active) && (q.pinned == null || t.pinned === q.pinned)));
  });
  mock.api.windows.getLastFocused.mockImplementation(async () => ({ id: focus, type: "normal" as const, focused: true, alwaysOnTop: false, incognito: false }));
  mock.api.windows.getAll.mockImplementation(async () => [1, 2].map(id => ({ id, type: "normal" } as chrome.windows.Window)));
  mock.api.tabs.remove.mockImplementation(async ids => { tabs = tabs.filter(t => !ids.includes(t.id!));
    for (const id of new Set(tabs.map(t => t.windowId))) {
      if (!tabs.some(t => t.windowId === id && t.active)) tabs.find(t => t.windowId === id)!.active = true;
    } });
  vi.spyOn(console, "log").mockImplementation(() => {}); vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test("API query failure rejects instead of pretending a successful empty population", async () => {
  const { getTabs } = await import("../../src/browser/api.ts");
  mock.api.tabs.query.mockRejectedValueOnce(new Error("private https://secret.example/token"));
  await expect(getTabs({ scope: "all" })).rejects.toThrow();
  expect(console.log).not.toHaveBeenCalled();
});
test("duplicate shortcut awaits removal and reports result", async () => {
  await import("../../src/background/background.ts"); const wait = gate();
  mock.api.tabs.remove.mockImplementationOnce(async () => { await wait.promise; });
  let done = false; const run = commands.emit("08_execute_option2").then(() => { done = true; });
  await vi.waitFor(() => expect(mock.api.tabs.remove).toHaveBeenCalled());
  expect(done).toBe(false); wait.resolve(); await run;
  expect(titles.at(-1)).toContain("operationResult");
});
test("button shortcut and menu concurrent entries do not overlap mutation", async () => {
  await import("../../src/background/background.ts"); const wait = gate();
  mock.api.tabs.remove.mockImplementationOnce(async () => { await wait.promise; });
  const first = mock.clicked.emit(); await vi.waitFor(() => expect(mock.api.tabs.remove).toHaveBeenCalledTimes(1));
  const second = commands.emit("08_execute_option2");
  const third = mock.menuClicked.emit({ menuItemId: "ohmytab_close_tabs", editable: false }, tabs[0]!);
  await Promise.all([second, third]); expect(mock.api.tabs.remove).toHaveBeenCalledTimes(1);
  wait.resolve(); await first;
});
test("focus changes while settings are loading cannot change initial window targets", async () => {
  await import("../../src/background/background.ts"); const wait = gate();
  const impl = mock.api.storage.sync.get.getMockImplementation()!;
  mock.api.storage.sync.get.mockImplementationOnce((defaults, callback) => {
    if (target === "chrome") { void wait.promise.then(() => { impl(defaults, callback); }); return; }
    return wait.promise.then(() => ({ ...defaults, ...mock.data }));
  });
  const run = mock.clicked.emit(); focus = 2; wait.resolve(); await run;
  expect(mock.api.tabs.remove).toHaveBeenCalledExactlyOnceWith([1]);
});
test("partial removal and private API rejection are visible without raw URL logging", async () => {
  await import("../../src/background/background.ts");
  mock.data.depclean = false; mock.data.comclose = true;
  tabs[0]!.url = "about:blank"; tabs[1]!.url = "about:newtab";
  mock.api.tabs.remove.mockImplementationOnce(async ids => { tabs = tabs.filter(t => t.id !== ids[0]);
    tabs.find(t => t.windowId === focus)!.active = true; throw new Error("https://secret.example/token"); });
  await mock.clicked.emit();
  expect(titles.at(-1)).toContain("operationResult:2:1:1:0");
  expect(JSON.stringify([...vi.mocked(console.log).mock.calls, ...vi.mocked(console.error).mock.calls])).not.toContain("secret.example");
  await mock.clicked.emit(); expect(mock.api.tabs.remove).toHaveBeenCalledTimes(2);
});

test.each(["button", "command", "menu"])("%s holds the shared execution state until APIs complete", async entry => {
  await import("../../src/background/background.ts"); const wait = gate();
  mock.api.tabs.remove.mockImplementationOnce(async () => { await wait.promise; });
  const run = entry === "button" ? mock.clicked.emit() : entry === "command" ? commands.emit("08_execute_option2") : mock.menuClicked.emit({ menuItemId: "ohmytab_close_tabs", editable: false }, tabs[0]!);
  await vi.waitFor(() => expect(mock.api.tabs.remove).toHaveBeenCalledTimes(1));
  await Promise.all([mock.clicked.emit(), commands.emit("08_execute_option2"), mock.menuClicked.emit({ menuItemId: "ohmytab_close_tabs", editable: false }, tabs[0]!)]);
  expect(mock.api.tabs.remove).toHaveBeenCalledTimes(1); expect(titles).toContain("operationBusy");
  wait.resolve(); await run; expect(titles.at(-1)).toContain("operationResult");
});
test("menu scope uses the actual clicked window instead of last focus", async () => {
  await import("../../src/background/background.ts");
  await mock.menuClicked.emit({ menuItemId: "ohmytab_close_tabs", editable: false }, tabs[2]!);
  expect(mock.api.tabs.remove).toHaveBeenCalledExactlyOnceWith([3, 4]);
});
test("pinned clicked tabs cannot be extracted by the current-tab menu", async () => {
  await import("../../src/background/background.ts"); tabs[0]!.pinned = true;
  await mock.menuClicked.emit({ menuItemId: "ohmytab_extract_tab", editable: false }, tabs[0]!);
  expect(mock.api.windows.create).not.toHaveBeenCalled();
});
test("new tabs after capture never enlarge the target set", async () => {
  await import("../../src/background/background.ts"); const wait = gate();
  const impl = mock.api.storage.sync.get.getMockImplementation()!;
  mock.api.storage.sync.get.mockImplementationOnce((defaults, callback) => {
    if (target === "chrome") { void wait.promise.then(() => { impl(defaults, callback); }); return; }
    return wait.promise.then(() => ({ ...defaults, ...mock.data }));
  });
  const run = mock.clicked.emit();
  await vi.waitFor(() => expect(mock.api.storage.sync.get).toHaveBeenCalled());
  tabs.push(tab(5, 1)); wait.resolve(); await run;
  expect(mock.api.tabs.remove).toHaveBeenCalledExactlyOnceWith([1]);
});
test("partial move reports confirmed destinations and keeps the original target window", async () => {
  await import("../../src/background/background.ts");
  mock.api.tabs.move.mockImplementationOnce(async (ids, details: unknown) => {
    const d = details as { windowId: number }; focus = 2;
    tabs.find(t => t.id === ids[0])!.windowId = d.windowId;
    throw new Error("private movement failure https://secret.example/");
  });
  await commands.emit("02_execute_option1");
  expect(mock.api.tabs.move).toHaveBeenCalledExactlyOnceWith([3, 4], { windowId: 1, index: -1 });
  expect(titles.at(-1)).toContain("operationResult:2:1:1:0:1");
  expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain("secret.example");
});
test("disappearance during removal is confirmed without retargeting a replacement tab", async () => {
  await import("../../src/background/background.ts"); mock.data.depclean = false; mock.data.comclose = true;
  tabs[0]!.url = "about:blank"; tabs[1]!.url = "about:newtab";
  mock.api.tabs.remove.mockImplementationOnce(async () => {
    tabs = tabs.filter(t => t.id !== 1); tabs.push(tab(7, 1, "about:blank")); throw new Error("tab disappeared");
  });
  await mock.clicked.emit(); expect(titles.at(-1)).toContain("operationResult:2:1:1:0:1");
  expect(mock.api.tabs.remove).toHaveBeenCalledExactlyOnceWith([1, 2]); expect(tabs.some(t => t.id === 7)).toBe(true);
});
test("failed verification reports unknown rather than invented successful counts", async () => {
  await import("../../src/background/background.ts"); mock.data.depclean = false; mock.data.comclose = true;
  tabs[0]!.url = "about:blank"; tabs[1]!.url = "about:newtab";
  mock.api.tabs.remove.mockImplementationOnce(async () => { mock.api.tabs.query.mockRejectedValueOnce(new Error("verification failed")); throw new Error("remove failed"); });
  await mock.clicked.emit(); expect(titles.at(-1)).toContain("operationResult:2:0:0:2:1");
});
test("capture failure and notification failure release state for subsequent execution", async () => {
  await import("../../src/background/background.ts"); mock.api.tabs.query.mockRejectedValueOnce(new Error("query failed"));
  await mock.clicked.emit(); expect(titles.at(-1)).toContain("operationFailed"); expect(mock.api.tabs.remove).not.toHaveBeenCalled();
  mock.api.action.setTitle.mockRejectedValueOnce(new Error("title failed"));
  await mock.clicked.emit(); expect(mock.api.tabs.remove).toHaveBeenCalledTimes(1);
  await commands.emit("08_execute_option2"); expect(titles.at(-1)).toContain("operationResult");
});
test.each(["move", "remove", "reload", "focus"])("%s API rejects safely instead of hiding failure", async method => {
  const api = await import("../../src/browser/api.ts");
  const error = new Error("https://secret.example/token");
  let work: Promise<unknown>;
  if (method === "move") { mock.api.tabs.move.mockRejectedValueOnce(error); work = api.moveTabs([1], { id: 2 } as chrome.windows.Window); }
  else if (method === "remove") { mock.api.tabs.remove.mockRejectedValueOnce(error); work = api.removeTabs([1]); }
  else if (method === "reload") { mock.api.tabs.reload.mockRejectedValueOnce(error); work = api.reloadTab(1); }
  else { mock.api.windows.update.mockRejectedValueOnce(error); work = api.focusWindow({ id: 1 } as chrome.windows.Window); }
  await expect(work).rejects.toThrow(); expect(console.log).not.toHaveBeenCalled();
});

test("a request refused while busy marks the tab it came from", async () => {
  await import("../../src/background/background.ts"); const wait = gate();
  mock.api.tabs.remove.mockImplementationOnce(async () => { await wait.promise; });
  const run = mock.clicked.emit();
  await vi.waitFor(() => expect(mock.api.tabs.remove).toHaveBeenCalledTimes(1));
  await mock.menuClicked.emit({ menuItemId: "ohmytab_close_tabs", editable: false }, tabs[2]!);
  expect(mock.api.action.setBadgeText).toHaveBeenCalledWith({ tabId: 3, text: "!" });
  wait.resolve(); await run;
});

test("discarded tabs reload a few at a time and each waits for its load", async () => {
  Object.assign(mock.data, { depclean: false, refresh: true, currentonly: false });
  tabs = Array.from({ length: 10 }, (_, i) => ({ ...tab(i + 1, 1), discarded: true }));
  let loading = 0, peak = 0;
  const loads = new Map<number, number>();
  mock.api.tabs.reload.mockImplementation(async (id: number) => { loading++; peak = Math.max(peak, loading); loads.set(id, 2); });
  Object.assign(mock.api.tabs, { get: vi.fn(async (id: number) => {
    const left = loads.get(id) ?? 0;
    if (left > 0) { loads.set(id, left - 1); return { id, status: "loading" }; }
    loading--; loads.delete(id); return { id, status: "complete" };
  }) });
  vi.useFakeTimers();
  await import("../../src/background/background.ts");
  const run = mock.clicked.emit();
  await vi.runAllTimersAsync(); await run;
  vi.useRealTimers();
  expect(mock.api.tabs.reload).toHaveBeenCalledTimes(10);
  expect(peak).toBe(4);
  expect(titles.at(-1)).toContain("operationResult:10:10:0:0");
});

test("tab events during an operation do not recount or update menus until it ends", async () => {
  Object.assign(mock.data, { iconbadge: true });
  await import("../../src/background/background.ts"); const wait = gate();
  mock.api.tabs.remove.mockImplementationOnce(async () => { await wait.promise; });
  const run = mock.clicked.emit();
  await vi.waitFor(() => expect(mock.api.tabs.remove).toHaveBeenCalledTimes(1));
  mock.api.tabs.query.mockClear(); mock.contextMenus.update.mockClear();
  await Promise.all([mock.created.emit(), mock.activated.emit()]);
  expect(mock.api.tabs.query).not.toHaveBeenCalled();
  expect(mock.contextMenus.update).not.toHaveBeenCalled();
  wait.resolve(); await run;
  expect(mock.api.tabs.query).toHaveBeenCalledWith({ windowType: "normal" });
  expect(mock.api.tabs.query).toHaveBeenCalledWith(expect.objectContaining({ active: true }));
});

test("T11-C1 partial removal counts a pinned survivor as failed and never retargets it", async () => {
  await import("../../src/background/background.ts");
  Object.assign(mock.data, { depclean: false, comclose: true });
  tabs[0]!.url = "about:blank"; tabs[1]!.url = "about:newtab";
  const alreadyPinned = { ...tab(5, 1, "about:blank"), pinned: true, active: false };
  tabs.push(alreadyPinned);
  mock.api.tabs.remove.mockImplementationOnce(async ids => {
    tabs = tabs.filter(item => item.id !== ids[0]);
    tabs.find(item => item.id === 2)!.pinned = true;
    tabs.push({ ...tab(7, 1, "about:blank"), active: false });
    throw new Error("partial removal");
  });
  await mock.clicked.emit();
  console.info("T11-C1 pinned-survivor observation", { result: titles.at(-1), removedIds: mock.api.tabs.remove.mock.calls, survivingIds: tabs.map(item => item.id), survivorPinned: tabs.find(item => item.id === 2)?.pinned });
  expect(titles.at(-1)).toBe("operationResult:2:1:1:0:1");
  expect(mock.api.tabs.remove).toHaveBeenCalledExactlyOnceWith([1, 2]);
  expect(mock.api.tabs.move).not.toHaveBeenCalled();
  expect(tabs.find(item => item.id === 2)?.pinned).toBe(true);
  expect(tabs.some(item => item.id === 5)).toBe(true);
  expect(tabs.some(item => item.id === 7)).toBe(true);
});

test("T11-C1 unverifiable partial deletion stays unknown, including a pinned survivor", async () => {
  await import("../../src/background/background.ts");
  Object.assign(mock.data, { depclean: false, comclose: true });
  tabs[0]!.url = "about:blank"; tabs[1]!.url = "about:newtab";
  mock.api.tabs.remove.mockImplementationOnce(async ids => {
    tabs = tabs.filter(item => item.id !== ids[0]); tabs.find(item => item.id === 2)!.pinned = true;
    mock.api.tabs.query.mockRejectedValueOnce(new Error("verification unavailable"));
    throw new Error("partial removal");
  });
  await mock.clicked.emit();
  expect(titles.at(-1)).toBe("operationResult:2:0:0:2:1");
  expect(mock.api.tabs.remove).toHaveBeenCalledExactlyOnceWith([1, 2]);
  expect(tabs.find(item => item.id === 2)?.pinned).toBe(true);
});
test("T11-C1 partial move verifies a now-pinned target at its destination without extra operations", async () => {
  await import("../../src/background/background.ts");
  tabs.push({ ...tab(5, 2), pinned: true, active: false });
  mock.api.tabs.move.mockImplementationOnce(async (ids, details: unknown) => {
    const destination = (details as { windowId: number }).windowId;
    tabs.find(item => item.id === ids[0])!.windowId = destination;
    tabs.find(item => item.id === ids[0])!.pinned = true;
    throw new Error("partial move");
  });
  await commands.emit("02_execute_option1");
  expect(titles.at(-1)).toBe("operationResult:2:1:1:0:1");
  expect(mock.api.tabs.move).toHaveBeenCalledExactlyOnceWith([3, 4], { windowId: 1, index: -1 });
  expect(mock.api.tabs.remove).not.toHaveBeenCalled();
  expect(tabs.find(item => item.id === 5)?.windowId).toBe(2);
});

test("missing created window records extraction failure without focusing an undefined window", async () => {
  await import("../../src/background/background.ts");
  Object.assign(mock.api.windows, { create: vi.fn(async () => undefined) });
  await mock.menuClicked.emit({ menuItemId: "ohmytab_extract_tab", editable: false }, tabs[0]!);
  expect(mock.api.windows.create).toHaveBeenCalledTimes(1);
  expect(mock.api.windows.update).not.toHaveBeenCalled();
  expect(titles.at(-1)).toContain("operationResult:1:0:1:0:1");
});
