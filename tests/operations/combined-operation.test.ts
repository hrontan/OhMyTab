import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { installSettingsBrowser } from "../helpers/settings-browser.ts";
import type { BrowserTarget } from "../helpers/browser.ts";
import type { PreviewPlan } from "../../src/operations/operation-plan.ts";
import type { UndoEntry } from "../../src/operations/undo.ts";

type Reply = { ok: boolean; status?: string; plan?: PreviewPlan; entries?: UndoEntry[]; restored?: number };
type Receiver = (message: unknown, sender: chrome.runtime.MessageSender, reply: (value: Reply) => void) => unknown;
const target = process.env.TEST_BROWSER as BrowserTarget;
let mock: ReturnType<typeof installSettingsBrowser>;
let tabs: chrome.tabs.Tab[];
let receiver: Receiver;
let baselineListeners: unknown[][];
let titles: string[];
let groupErrors: string[];
let nextId: number;
const makeTab = (id: number, url: string, extra: Partial<chrome.tabs.Tab> = {}): chrome.tabs.Tab => ({
  id, url, windowId: 1, index: id - 1, active: id === 1, pinned: false,
  incognito: false, groupId: -1, highlighted: false, selected: false, discarded: false,
  autoDiscardable: true, lastAccessed: 0, frozen: false, ...(target === "firefox" ? { cookieStoreId: "firefox-default" } : {}), ...extra,
});
const group = vi.fn(async (details: { tabIds: number[]; groupId?: number; createProperties?: { windowId?: number } }) => {
  // Native tabs.group rejects nonexistent IDs; this seam never selects product targets.
  for (const id of details.tabIds) if (!tabs.some(tab => tab.id === id)) {
    groupErrors.push("No tab with id: " + id); throw new Error(groupErrors.at(-1));
  }
  const id = details.groupId ?? Math.max(19, ...groups.keys()) + 1;
  for (const tab of tabs.filter(tab => details.tabIds.includes(tab.id!))) tab.groupId = id;
  return id;
});
const ungroup = vi.fn(async (_ids: number[]) => {});
let groups: Map<number, chrome.tabGroups.TabGroup>;
const updateGroup = vi.fn(async (id: number, patch: Partial<chrome.tabGroups.TabGroup>) => {
  const current = groups.get(id) ?? { id, windowId: 1, title: "", color: "grey" as const, collapsed: false, shared: false };
  groups.set(id, { ...current, ...patch }); return groups.get(id)!;
});
const create = vi.fn(async (details: { url: string; windowId: number; index?: number; active?: boolean }) => {
  const tab = makeTab(nextId++, details.url, { windowId: details.windowId, index: details.index ?? tabs.length, active: details.active ?? true });
  if (tab.active) tabs.filter(t => t.windowId === tab.windowId).forEach(t => { t.active = false; });
  tabs.push(tab); return { ...tab };
});
beforeEach(() => {
  vi.resetModules(); group.mockClear(); ungroup.mockClear(); updateGroup.mockClear(); create.mockClear();
  mock = installSettingsBrowser(target); titles = []; groupErrors = []; nextId = 90;
  tabs = [makeTab(1, "https://same.example/request"), makeTab(2, "https://same.example/dup", { groupId: 7 }),
    makeTab(3, "https://same.example/member", { groupId: 7 }), makeTab(4, "https://same.example/dup"),
    makeTab(5, "https://same.example/control"), makeTab(6, "https://same.example/control"),
    makeTab(7, "https://same.example/control", { pinned: true }),
    makeTab(8, "https://same.example/control", { incognito: true }),
    makeTab(9, "https://same.example/control", { windowId: 2 })];
  groups = new Map([[7, { id: 7, windowId: 1, title: "Owned protected group", color: "blue", collapsed: false, shared: false }]]);
  Object.assign(mock.data, { preview_before: false, glue: false, depclean: true, sorttab: false, refresh: false,
    grouping: true, grouping_min: 2, protect_groups: true, duplicate_keep: "last", currentonly: true,
    comclose: false, closelocal: false, rxclose: false, urlmatch: false, iconbadge: false,
    contextmenu1: false, contextmenu2: false, contextmenu3: false, contextmenu4: false });
  Object.assign(mock.runtime, { id: "fixture", getURL: (name: string) => "https://extension.test/" + name,
    onMessage: { addListener: vi.fn((fn: Receiver) => { receiver = fn; }) } });
  mock.api.tabs.query.mockImplementation(async value => {
    const q = value as chrome.tabs.QueryInfo;
    return structuredClone(tabs.filter(tab => (q.windowId == null || tab.windowId === q.windowId) &&
      (!q.currentWindow || tab.windowId === 1) && (!q.active || tab.active) &&
      (q.pinned == null || tab.pinned === q.pinned) && (q.groupId == null || tab.groupId === q.groupId)));
  });
  mock.api.tabs.get.mockImplementation(async id => {
    const tab = tabs.find(tab => tab.id === id); if (!tab) throw new Error("No tab with id: " + id);
    return { ...tab, id, status: "complete" };
  });
  mock.api.tabs.remove.mockImplementation(async ids => { tabs = tabs.filter(tab => !ids.includes(tab.id!)); });
  Object.assign(mock.api.tabs, { group, ungroup, create });
  mock.api.windows.getLastFocused.mockResolvedValue({ id: 1, type: "normal", focused: true, alwaysOnTop: false, incognito: false });
  mock.api.windows.getAll.mockResolvedValue([1, 2].map(id => ({ id, type: "normal", incognito: false } as chrome.windows.Window)));
  Object.assign(mock.api, { tabGroups: { query: vi.fn(async (q: { windowId: number }) => [...groups.values()].filter(g =>
    g.windowId === q.windowId && tabs.some(tab => tab.groupId === g.id))), update: updateGroup, move: vi.fn(async () => {}) },
    i18n: { getMessage: (key: string, values: string[] = []) => [key, ...values].join(":") } });
  mock.api.action.setTitle.mockImplementation(async details => { titles.push((details as { title: string }).title); });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function action() {
  await import("../../src/background/background.ts");
  baselineListeners = [...mock.runtime.onMessage.addListener.mock.calls];
  await mock.clicked.emit();
}
async function message(type: string, keys?: string[]) {
  const preview = tabs.find(tab => tab.url?.includes("preview.html?token="));
  const token = preview?.url && new URL(preview.url).searchParams.get("token");
  const url = type.startsWith("undo:") ? "https://extension.test/undo.html" : preview!.url!;
  return new Promise<Reply>(resolve => receiver({ type, token, keys }, { id: "fixture", url,
    tab: makeTab(99, url) }, resolve));
}
function preserved() {
  expect(tabs.filter(tab => tab.groupId === 7).map(tab => tab.id)).toEqual([2, 3]);
  expect(groups.get(7)).toEqual({ id: 7, windowId: 1, title: "Owned protected group", color: "blue", collapsed: false, shared: false });
  for (const id of [1, 2, 3, 4, 6, 7, 8, 9]) expect(tabs.some(tab => tab.id === id)).toBe(true);
  expect(group.mock.calls.flatMap(([d]) => d.tabIds)).not.toEqual(expect.arrayContaining([2, 3]));
  for (const id of [2, 3, 7, 8, 9]) expect(group.mock.calls.flatMap(([d]) => d.tabIds)).not.toContain(id);
}
test("combined dedup then grouping never sends the closed ID to native group", async () => {
  await action();
  expect(mock.api.tabs.remove).toHaveBeenCalledExactlyOnceWith([5]);
  expect(tabs.some(tab => tab.id === 5)).toBe(false); preserved();
  expect(groupErrors).toEqual([]);
  if (target === "chrome") expect(group).toHaveBeenCalledWith({ tabIds: [1, 4, 6], createProperties: { windowId: 1 }, groupId: undefined });
  else expect(group).not.toHaveBeenCalled();
  expect(titles.at(-1)).toBe(target === "chrome" ? "operationResult:4:4:0:0:0" : "operationResult:1:1:0:0:0");
  const undo = await message("undo:get"); expect(undo.entries).toMatchObject([{ url: "https://same.example/control", index: 4, windowId: 1 }]);
  expect(undo.entries).toHaveLength(1);
  const restored = await message("undo:restore", undo.entries!.map(entry => entry.key));
  expect(restored.restored).toBe(1); expect(create).toHaveBeenLastCalledWith({ windowId: 1, url: "https://same.example/control", index: 4, active: false });
});
test("preview lists the closed ID only for closure, then confirmation groups original remaining IDs", async () => {
  mock.data.preview_before = true; await action(); const planned = (await message("preview:get")).plan!;
  expect(mock.api.tabs.remove).not.toHaveBeenCalled(); expect(group).not.toHaveBeenCalled();
  expect(planned.targets.find(tab => tab.id === 5)?.reasons).toEqual(["duplicate"]);
  if (target === "chrome") expect(planned.targets.filter(tab => tab.reasons.includes("group")).map(tab => tab.id)).toEqual([1, 4, 6]);
  expect(await message("preview:confirm")).toMatchObject({ ok: true, status: "complete" });
  expect(mock.api.tabs.remove).toHaveBeenCalledExactlyOnceWith([5]); expect(groupErrors).toEqual([]); preserved();
  for (const id of group.mock.calls.flatMap(([d]) => d.tabIds)) expect(planned.targets.map(tab => tab.id)).toContain(id);
});
test("new tab after preview invalidates the entire plan without enlarging targets", async () => {
  mock.data.preview_before = true; await action(); tabs.push(makeTab(12, "https://same.example/control"));
  expect(await message("preview:confirm")).toMatchObject({ ok: false, status: "stale" });
  expect(mock.api.tabs.remove).not.toHaveBeenCalled(); expect(group).not.toHaveBeenCalled();
});
test("partial removal retires only confirmed closed IDs and retains failed survivors", async () => {
  tabs.push(makeTab(10, "https://same.example/control"));
  mock.api.tabs.remove.mockImplementationOnce(async ids => { tabs = tabs.filter(tab => tab.id !== ids[0]); throw new Error("Partial native removal"); });
  await action(); expect(mock.api.tabs.remove).toHaveBeenCalledExactlyOnceWith([5, 6]);
  expect(tabs.some(tab => tab.id === 5)).toBe(false); expect(tabs.some(tab => tab.id === 6)).toBe(true);
  expect(groupErrors).toEqual([]); for (const [call] of group.mock.calls) expect(call.tabIds).not.toContain(5);
  if (target === "chrome") expect(group.mock.calls.flatMap(([call]) => call.tabIds)).toContain(6);
  expect(titles.at(-1)).toBe(target === "chrome" ? "operationResult:5:4:1:0:1" : "operationResult:2:1:1:0:1");
  const undo = await message("undo:get"); expect(undo.entries).toHaveLength(1); expect(undo.entries![0]!.index).toBe(4);
});
test("failed requery never invents closure success or an undo record", async () => {
  mock.api.tabs.remove.mockImplementationOnce(async () => {
    mock.api.tabs.query.mockRejectedValueOnce(new Error("verify unavailable"));
    mock.api.tabs.query.mockRejectedValueOnce(new Error("undo verification unavailable"));
    throw new Error("Native removal failed");
  });
  await action(); expect(tabs.some(tab => tab.id === 5)).toBe(true); expect(titles.at(-1)).toContain(":0:1:2");
  const listener = (mock.runtime as typeof mock.runtime & { onMessage: { addListener: ReturnType<typeof vi.fn> } }).onMessage.addListener;
  // Workflow messages are permanent; no lazy undo/preview handler may be added.
  expect(listener.mock.calls).toEqual(baselineListeners);
  const respond = vi.fn();
  for (const [handler] of listener.mock.calls) handler({ type: "undo:get" }, { id: "fixture", url: "https://extension.test/undo.html", tab: makeTab(99, "https://extension.test/undo.html") }, respond);
  expect(respond).not.toHaveBeenCalled();
  if (target === "chrome") expect(group.mock.calls.flatMap(([call]) => call.tabIds)).toContain(5);
});

test.each([-1, 7])("grouping below threshold only ungroups existing members: group %s", async groupId => {
  Object.assign(mock.data, { depclean: false, protect_groups: false, grouping_min: 2 });
  tabs = [makeTab(1, "https://single.example/", { groupId })];
  await action();
  expect(group).not.toHaveBeenCalled();
  if (target === "chrome" && groupId !== -1) expect(ungroup).toHaveBeenCalledExactlyOnceWith([1]);
  else expect(ungroup).not.toHaveBeenCalled();
});

test("already grouped members do not send an empty group request", async () => {
  Object.assign(mock.data, { depclean: false, protect_groups: false, grouping_min: 2 });
  tabs = [makeTab(1, "https://same.example/one", { groupId: 7 }), makeTab(2, "https://same.example/two", { groupId: 7 })];
  await action();
  expect(group).not.toHaveBeenCalled();
  expect(ungroup).not.toHaveBeenCalled();
});

function mergedFixture() {
  Object.assign(mock.data, { glue: true, depclean: true, sorttab: true, sortkey: "url", currentonly: false,
    grouping: true, grouping_min: 2, protect_groups: false, protect_domains: "protected.example" });
  tabs = [makeTab(6, "https://pinned.example/", { pinned: true, index: 0 }),
    makeTab(1, "https://zeta.example/z", { index: 1 }), makeTab(2, "https://alpha.example/a", { index: 2 }),
    makeTab(3, "https://alpha.example/a", { windowId: 2, index: 0 }),
    makeTab(4, "https://alpha.example/b", { windowId: 3, index: 0 }),
    makeTab(5, "https://zeta.example/a", { windowId: 3, index: 1 }),
    makeTab(7, "https://protected.example/", { windowId: 4, index: 0 }),
    makeTab(8, "https://private.example/", { windowId: 5, index: 0, incognito: true })];
  if (target === "firefox") tabs.push({ ...makeTab(9, "https://container.example/", { windowId: 6, index: 0 }), cookieStoreId: "firefox-container-2" } as chrome.tabs.Tab);
  groups.clear();
  const reindex = () => {
    for (const windowId of new Set(tabs.map(tab => tab.windowId))) {
      tabs.filter(tab => tab.windowId === windowId).sort((a, b) => a.index - b.index).forEach((tab, index) => { tab.index = index; });
    }
  };
  const query = mock.api.tabs.query.getMockImplementation()!;
  mock.api.tabs.query.mockImplementation(async value => {
    const q = value as chrome.tabs.QueryInfo;
    if (q.windowId != null && !tabs.some(tab => tab.windowId === q.windowId)) throw new Error("Window closed");
    return query(value);
  });
  mock.api.windows.getAll.mockImplementation(async () => [...new Set(tabs.map(tab => tab.windowId))].map(id =>
    ({ id, type: "normal", incognito: tabs.find(tab => tab.windowId === id)!.incognito } as chrome.windows.Window)));
  Object.assign(mock.api.tabs, { move: vi.fn(async (ids: number[], details: chrome.tabs.MoveProperties): Promise<chrome.tabs.Tab[]> => {
    const moving = ids.map(id => tabs.find(tab => tab.id === id)!);
    if (moving.some(tab => !tab || tab.pinned)) throw new Error("Unavailable move target");
    const rest = tabs.filter(tab => tab.windowId === details.windowId && !ids.includes(tab.id!)).sort((a, b) => a.index - b.index);
    const index = details.index === -1 ? rest.length : details.index;
    rest.splice(index, 0, ...moving);
    rest.forEach((tab, position) => { tab.windowId = details.windowId!; tab.index = position; });
    reindex();
    return structuredClone(moving);
  }) });
  mock.api.tabs.remove.mockImplementation(async ids => { tabs = tabs.filter(tab => !ids.includes(tab.id!)); reindex(); });
  return { reindex };
}
function expectMerged() {
  expect(tabs.filter(tab => tab.windowId === 1).sort((a, b) => a.index - b.index).map(tab => tab.id)).toEqual([6, 3, 4, 5, 1]);
  expect(mock.api.tabs.remove).toHaveBeenCalledExactlyOnceWith([2]);
  expect(mock.api.windows.create).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
  expect(tabs.some(tab => tab.windowId === 2 || tab.windowId === 3)).toBe(false);
  for (const id of [6, 7, 8, ...(target === "firefox" ? [9] : [])]) {
    expect(mock.api.tabs.move.mock.calls.flatMap(([ids]) => ids)).not.toContain(id);
    expect(group.mock.calls.flatMap(([details]) => details.tabIds)).not.toContain(id);
  }
  if (target === "chrome") {
    expect(group.mock.calls.map(([details]) => details.tabIds)).toEqual([[1, 5], [3, 4]]);
    expect([...groups.values()].map(value => ({ title: value.title, collapsed: value.collapsed }))).toEqual([
      { title: "zeta.example", collapsed: true }, { title: "alpha.example", collapsed: true }]);
    expect(tabs.find(tab => tab.id === 3)?.groupId).toBe(tabs.find(tab => tab.id === 4)?.groupId);
    expect(tabs.find(tab => tab.id === 1)?.groupId).toBe(tabs.find(tab => tab.id === 5)?.groupId);
    expect(tabs.find(tab => tab.id === 1)?.groupId).not.toBe(tabs.find(tab => tab.id === 3)?.groupId);
  }
  expect(titles.at(-1)?.split(":").slice(-2)).toEqual(["0", "0"]);
}
test("merged windows use surviving current indices for dedup, URL sorting and grouping threshold", async () => {
  mergedFixture(); await action(); expectMerged();
});
test("merged preview preserves original rows and confirms every downstream eligible ID", async () => {
  mergedFixture(); mock.data.preview_before = true; await action();
  const planned = (await message("preview:get")).plan!;
  expect(planned.targets.find(tab => tab.id === 4)?.windowId).toBe(3);
  expect(planned.originWindowId).toBe(1); expect(planned.windowIds).toEqual([1, 2, 3, 4]);
  if (target === "chrome") expect(planned.targets.filter(tab => tab.reasons.includes("group")).map(tab => tab.id)).toEqual([1, 3, 4, 5]);
  expect(mock.api.tabs.move).not.toHaveBeenCalled(); expect(mock.api.tabs.remove).not.toHaveBeenCalled();
  create.mockClear();
  expect(await message("preview:confirm")).toMatchObject({ ok: true, status: "complete" });
  tabs = tabs.filter(tab => !tab.url?.includes("preview.html?token=")); expectMerged();
});
test("merged survivors exclude new and disappeared tabs after a partial native move", async () => {
  mergedFixture(); const move = mock.api.tabs.move.getMockImplementation()!;
  mock.api.tabs.move.mockImplementationOnce(async (_ids, details) => {
    await move([3], details); tabs = tabs.filter(tab => tab.id !== 4);
    tabs.push(makeTab(10, "https://alpha.example/new", { index: 4 }));
    throw new Error("Partial move");
  });
  await action();
  expect(mock.api.tabs.remove).toHaveBeenCalledExactlyOnceWith([2]);
  expect(tabs.filter(tab => tab.windowId === 1).sort((a, b) => a.index - b.index).map(tab => tab.id)).toEqual([6, 3, 1, 10]);
  expect(tabs.find(tab => tab.id === 5)?.windowId).toBe(3);
  for (const id of [4, 10]) expect(group.mock.calls.flatMap(([details]) => details.tabIds)).not.toContain(id);
  expect(group).not.toHaveBeenCalled(); expect(tabs.some(tab => tab.id === 4)).toBe(false);
  expect(titles.at(-1)?.split(":").at(-1)).toBe("1"); expect(create).not.toHaveBeenCalled();
});
test("failed post-merge query stops downstream work without inventing closure success", async () => {
  mergedFixture(); const move = mock.api.tabs.move.getMockImplementation()!;
  mock.api.tabs.move.mockImplementationOnce(async (ids, details) => {
    const result = await move(ids, details); mock.api.tabs.query.mockRejectedValueOnce(new Error("Refresh unavailable")); return result;
  });
  await action();
  expect(mock.api.tabs.remove).not.toHaveBeenCalled(); expect(group).not.toHaveBeenCalled();
  expect(tabs.some(tab => tab.id === 2)).toBe(true); expect(create).not.toHaveBeenCalled();
  expect(titles.at(-1)).toBe("operationFailed:3:3:0:0:0");
});
test("merge geometry refresh preserves the captured active duplicate keeper", async () => {
  mergedFixture(); mock.data.duplicate_keep = "active"; tabs.find(tab => tab.id === 1)!.url = "https://alpha.example/a";
  const move = mock.api.tabs.move.getMockImplementation()!;
  mock.api.tabs.move.mockImplementationOnce(async (ids, details) => {
    const result = await move(ids, details); tabs.forEach(tab => { tab.active = tab.id === 3; }); return result;
  });
  await action();
  expect(mock.api.tabs.remove).toHaveBeenCalledExactlyOnceWith([2, 3]);
  expect(tabs.some(tab => tab.id === 1)).toBe(true);
});
