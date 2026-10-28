import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { installBrowserMock, type BrowserTarget } from "../helpers/browser.ts";
const target = process.env.TEST_BROWSER as BrowserTarget;
beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
const domains = ["a.b.c.d.example.com", "b.c.d.example.com", "c.d.example.com", "d.example.com", "example.com"];
function installMenuBrowser() {
  const mock = installBrowserMock(target);
  const tabs: chrome.tabs.Tab[] = [
    ...domains.map((domain, index) => ({ id: index + 1, url: `https://${domain}/`, windowId: 1, pinned: false })),
    { id: 6, url: "https://example.com/elsewhere", windowId: 2, pinned: false },
    { id: 7, url: "https://example.com/pinned", windowId: 1, pinned: true },
    { id: 8, url: "https://notexample.com/", windowId: 1, pinned: false },
  ].map((tab, index) => ({
    index, active: index === 0, highlighted: false, incognito: false, ...(target === "firefox" ? { cookieStoreId: "firefox-default" } : {}), selected: false,
    discarded: false, autoDiscardable: true, lastAccessed: 0, frozen: false, groupId: -1, title: String(index), ...tab,
  }));
  let active: chrome.tabs.Tab | undefined = tabs[0];
  const event = () => ({ addListener: vi.fn() });
  const activated = { addListener: vi.fn<(callback: () => Promise<void>) => void>() };
  const clicked = { addListener: vi.fn<(callback: (info: { menuItemId: string }, tab?: chrome.tabs.Tab) => Promise<void>) => void>() };
  const display = new Map<string, { title?: string; visible?: boolean }>();
  const create = vi.fn((details: { id?: string; title?: string; visible?: boolean; type?: string }, callback?: () => void) => {
    if (details.id) display.set(details.id, details);
    queueMicrotask(() => callback?.());
    return details.id;
  });
  const update = vi.fn(async (id: string, details: { title?: string; visible?: boolean }) => { display.set(id, { ...display.get(id), ...details }); });
  Object.assign(mock.api.tabs, { onCreated: event(), onMoved: event(), onDetached: event(), onAttached: event(), onUpdated: event(), onRemoved: event(), onActivated: activated });
  Object.assign(mock.api.windows, { onFocusChanged: event() });
  Object.assign(mock.api.action, { onClicked: event() });
  Object.assign(mock.api, {
    contextMenus: { onClicked: clicked, create, update, removeAll: vi.fn(async () => { display.clear(); }) },
    commands: { onCommand: event() }, runtime: { onInstalled: event(), onStartup: event(), onMessage: event() },
    i18n: { getMessage: vi.fn((key: string) => key) },
  });
  mock.api.tabs.query.mockImplementation(async (value) => {
    const query = value as { currentWindow?: boolean; pinned?: boolean; active?: boolean };
    if (query.active) return active && !active.pinned ? [structuredClone(active)] : [];
    return structuredClone(tabs.filter(tab =>
      (!query.currentWindow || tab.windowId === 1) &&
      (query.pinned == null || tab.pinned === query.pinned),
    ));
  });
  mock.api.windows.getAll.mockResolvedValue(
    [...new Set(tabs.map(tab => tab.windowId))].map(id => ({
      id, type: "normal" as const, incognito: false, focused: id === 1, alwaysOnTop: false,
      tabs: tabs.filter(tab => tab.windowId === id).map(tab => ({ ...tab })),
    })),
  );
  mock.api.windows.create.mockImplementation(async () => ({ id: 3 }));
  Object.assign(mock.data, {
    glue: false, depclean: false, sorttab: false, refresh: false, comclose: false,
    closelocal: false, rxclose: false, grouping: false, iconbadge: false, urlmatch: false,
    contextmenu1: true, contextmenu1advanced: true, contextmenu1scope: "win",
    contextmenu4: true, contextmenu4advanced: true, contextmenu4scope: "all",
  });
  return { ...mock, activated, clicked, create, update, display, tabs,
    setActive: (tab: chrome.tabs.Tab | undefined) => { active = tab; }, active: () => active };
}
async function activation(mock: ReturnType<typeof installMenuBrowser>) {
  const callback = mock.activated.addListener.mock.calls[0]?.[0];
  expect(callback).toBeTypeOf("function");
  await callback?.();
}

test("all ten generated detail IDs use their own operation label and scope", async () => {
  const mock = installMenuBrowser();
  const menus = await import("../../src/background/contextmenu.ts");
  await menus.initializeContextMenus();
  for (const action of ["close", "extract"]) {
    for (let level = 0; level < 5; level++) {
      const id = `ohmytab_${action}_l${level}`;
      expect(mock.display.get(id)?.title).toContain(action === "close" ? "text6" : "text7");
      expect(mock.display.get(id)?.title).toContain(action === "close" ? "text0_0" : "text0_1");
    }
  }
});

describe.each(["close", "extract"] as const)("%s levels", action => {
  test.each([0, 1, 2, 3, 4])("level %i display matches clicked domain and scope", async level => {
    const mock = installMenuBrowser();
    await import("../../src/background/background.ts");
    await activation(mock);
    const id = `ohmytab_${action}_l${level}`;
    const display = mock.display.get(id);
    expect(display?.visible).toBe(true);
    expect(display?.title).toContain(domains[level]);
    expect(display?.title).toContain(action === "close" ? "text6" : "text7");
    expect(display?.title).toContain(action === "close" ? "text0_0" : "text0_1");
    // Change active domain and saved scope after publication. Clicking the
    // displayed row must retain its published domain and operation scope.
    const other = mock.tabs[7]!;
    mock.setActive(other);
    Object.assign(mock.data, { contextmenu1scope: "all", contextmenu4scope: "win" });
    const callback = mock.clicked.addListener.mock.calls[0]?.[0];
    await callback?.({ menuItemId: id }, other);
    const selected = action === "close" ? mock.api.tabs.remove.mock.calls.flatMap(([ids]) => ids) : [
      ...mock.api.windows.create.mock.calls.map(([details]) => (details as { tabId: number }).tabId),
      ...mock.api.tabs.move.mock.calls.flatMap(([ids]) => ids),
    ];
    const expected = [1, 2, 3, 4, 5].slice(0, level + 1);
    if (action === "extract" && level === 4) expected.push(6);
    expect(selected.sort((a, b) => a - b)).toEqual(expected);
  });
});

test.each(["ohmytab_close_l10", "ohmytab_extract_l20", "ohmytab_close_l4extra", "ohmytab_extract_l-1", "ohmytab_flush_a0"])("unrecognized detail ID %s is inert", async id => {
  const mock = installMenuBrowser();
  await import("../../src/background/background.ts");
  await activation(mock);
  await mock.clicked.addListener.mock.calls[0]?.[0]({ menuItemId: id }, mock.active());
  expect(mock.api.tabs.remove).not.toHaveBeenCalled();
  expect(mock.api.windows.create).not.toHaveBeenCalled();
  expect(mock.api.tabs.move).not.toHaveBeenCalled();
});

test.each(["pinned", "missing", "no-url", "query-error"])("%s transition recovers on normal tab", async kind => {
  const mock = installMenuBrowser();
  await import("../../src/background/background.ts");
  await activation(mock);
  const tab = mock.tabs[0]!;
  if (kind === "pinned") mock.setActive({ ...tab, pinned: true });
  if (kind === "missing") mock.setActive(undefined);
  if (kind === "no-url") { const { url: _url, ...withoutURL } = tab; mock.setActive(withoutURL); }
  if (kind === "query-error") mock.api.tabs.query.mockRejectedValueOnce(new Error("query failed"));
  await activation(mock);
  expect(mock.display.get("ohmytab_close_l0")?.visible).toBe(false);
  mock.setActive(tab);
  await activation(mock);
  expect(mock.display.get("ohmytab_close_l0")?.visible).toBe(true);
  expect(mock.display.get("ohmytab_close_l0")?.title).toContain(domains[0]);
});

test("updateContextMenus awaits every delayed child update", async () => {
  const mock = installMenuBrowser();
  const gate = deferred();
  mock.update.mockImplementation(async (id, details) => { await gate.promise; mock.display.set(id, details); });
  const { updateContextMenus } = await import("../../src/background/contextmenu.ts");
  let finished = false;
  const pending = updateContextMenus(domains).then(() => { finished = true; });
  await vi.waitFor(() => expect(mock.update).toHaveBeenCalledTimes(10));
  expect(finished).toBe(false);
  gate.resolve();
  await pending;
  expect(finished).toBe(true);
});

test("newest requested domain wins when an older update is delayed", async () => {
  const mock = installMenuBrowser();
  const gate = deferred();
  mock.update.mockImplementation(async (id, details) => {
    if (details.title?.includes("old.example.com")) await gate.promise;
    mock.display.set(id, details);
  });
  const { updateContextMenus } = await import("../../src/background/contextmenu.ts");
  const old = updateContextMenus(["old.example.com"]);
  await vi.waitFor(() => expect(mock.update).toHaveBeenCalled());
  const latest = updateContextMenus(["new.example.com"]);
  for (let tick = 0; tick < 8; tick++) await Promise.resolve();
  gate.resolve();
  await Promise.all([old, latest]);
  expect(mock.display.get("ohmytab_close_l0")?.title).toContain("new.example.com");
});

test("active-tab request arriving during a delayed query is not dropped", async () => {
  const mock = installMenuBrowser();
  const gate = deferred();
  const stale = { ...mock.tabs[0]!, url: "https://old.example.com/" };
  mock.api.tabs.query.mockImplementationOnce(async () => { await gate.promise; return [stale]; });
  await import("../../src/background/background.ts");
  const first = activation(mock);
  await vi.waitFor(() => expect(mock.api.tabs.query).toHaveBeenCalled());
  mock.setActive({ ...stale, url: "https://new.example.com/" });
  const latest = activation(mock);
  gate.resolve();
  await Promise.all([first, latest]);
  expect(mock.display.get("ohmytab_close_l0")?.title).toContain("new.example.com");
  expect(mock.update.mock.calls.every(([, details]) => !details.title?.includes("old.example.com"))).toBe(true);
});

test("an update API rejection does not block later successful publication", async () => {
  const mock = installMenuBrowser();
  await import("../../src/background/background.ts");
  mock.update.mockRejectedValueOnce(new Error("update failed"));
  await activation(mock);
  await activation(mock);
  expect(mock.display.get("ohmytab_close_l0")?.visible).toBe(true);
});

test("active-tab request arriving during child API updates publishes the final domain", async () => {
  const mock = installMenuBrowser();
  const gate = deferred();
  mock.update.mockImplementation(async (id, details) => {
    if (details.title?.includes(domains[0]!)) await gate.promise;
    mock.display.set(id, details);
  });
  await import("../../src/background/background.ts");
  const first = activation(mock);
  await vi.waitFor(() => expect(mock.update).toHaveBeenCalledTimes(10));
  mock.setActive({ ...mock.tabs[0]!, url: "https://final.example.net/" });
  const latest = activation(mock);
  gate.resolve();
  await Promise.all([first, latest]);
  expect(mock.display.get("ohmytab_close_l0")?.title).toContain("final.example.net");
});

test("storage API failure releases the update worker for the next request", async () => {
  const mock = installMenuBrowser();
  const { updateContextMenus } = await import("../../src/background/contextmenu.ts");
  mock.api.storage.sync.get.mockImplementationOnce(() => { throw new Error("storage failed"); });
  await updateContextMenus(["failed.example.com"]);
  await updateContextMenus(["working.example.com"]);
  expect(mock.display.get("ohmytab_close_l0")?.title).toContain("working.example.com");
});

test("a hidden detail row has no actionable published target", async () => {
  const mock = installMenuBrowser();
  await import("../../src/background/background.ts");
  await activation(mock);
  mock.data.contextmenu1advanced = false;
  mock.data.contextmenu4advanced = false;
  await activation(mock);
  await mock.clicked.addListener.mock.calls[0]?.[0]({ menuItemId: "ohmytab_close_l0" }, mock.active());
  await mock.clicked.addListener.mock.calls[0]?.[0]({ menuItemId: "ohmytab_extract_l0" }, mock.active());
  expect(mock.api.tabs.remove).not.toHaveBeenCalled();
  expect(mock.api.windows.create).not.toHaveBeenCalled();
});

test("a failed row update retains its displayed domain and scope for clicks", async () => {
  const mock = installMenuBrowser();
  await import("../../src/background/background.ts");
  await activation(mock);
  mock.update.mockImplementation(async (id, details) => {
    if (id === "ohmytab_close_l0" && details.title?.includes("new.example.net")) throw new Error("row failed");
    mock.display.set(id, details);
  });
  const newTab = { ...mock.tabs[0]!, url: "https://new.example.net/" };
  mock.setActive(newTab);
  mock.data.contextmenu1scope = "all";
  await activation(mock);
  expect(mock.display.get("ohmytab_close_l0")?.title).toContain(domains[0]);
  expect(mock.display.get("ohmytab_close_l0")?.title).toContain("text0_0");
  await mock.clicked.addListener.mock.calls[0]?.[0]({ menuItemId: "ohmytab_close_l0" }, newTab);
  expect(mock.api.tabs.remove).toHaveBeenCalledWith([1]);
});

test("turning advanced menus off hides old visible rows", async () => {
  const mock = installMenuBrowser();
  const { updateContextMenus } = await import("../../src/background/contextmenu.ts");
  await updateContextMenus(domains);
  mock.data.contextmenu1advanced = false;
  mock.data.contextmenu4advanced = false;
  await updateContextMenus(domains);
  expect([...mock.display.values()].filter(item => item.visible)).toHaveLength(0);
});

test("saved workflows share the native operation level and refresh revision IDs after storage changes", async () => {
  const mock = installMenuBrowser();
  const saved = { id: "22222222-2222-4222-8222-222222222222", revision: 1, name: "Example", scope: "win", rules: [], operations: { glue: false, depclean: false, sorttab: false, sortkey: "url", refresh: false, comclose: false, rxclose: false, closelocal: false, grouping: false, grouping_min: 4 } };
  mock.localData.saved_workflows_v1 = { version: 1, revision: 1, workflows: [saved] };
  const menus = await import("../../src/background/contextmenu.ts");
  await menus.initializeContextMenus();
  const rows = mock.create.mock.calls.map(([row]) => row);
  const workflow = rows.find(row => row.id?.startsWith("ohmytab_workflow:"))!;
  expect(workflow).toBeDefined(); expect(workflow).not.toHaveProperty("parentId");
  expect(workflow.title).toBe("workflowMenuPrefixExample");
  expect(rows.some(row => row.id === "ohmytab_workflows")).toBe(false);
  expect(rows.find(row => row.id === "ohmytab_extract_tab")).not.toHaveProperty("parentId");
  mock.localData.saved_workflows_v1 = { version: 1, revision: 2, workflows: [{ ...saved, revision: 2 }] };
  await menus.initializeContextMenus();
  const updated = mock.create.mock.calls.at(-1)![0];
  expect(updated.id).not.toBe(workflow.id); expect(updated).not.toHaveProperty("parentId");
});
