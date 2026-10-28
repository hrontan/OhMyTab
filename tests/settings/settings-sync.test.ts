import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { installSettingsBrowser } from "../helpers/settings-browser.ts";
import { createOptionsDocument } from "../helpers/options-dom.ts";
import type { BrowserTarget } from "../helpers/browser.ts";

const target = process.env.TEST_BROWSER as BrowserTarget;
let mock: ReturnType<typeof installSettingsBrowser>;
beforeEach(() => { vi.resetModules(); mock = installSettingsBrowser(target); Object.assign(mock.data, { glue: false, depclean: true, sorttab: true, refresh: true, iconbadge: false }); });
afterEach(() => vi.unstubAllGlobals());

async function options() {
  const { defaultSetting } = await import("../../src/settings/setting.ts");
  const dom = createOptionsDocument(Object.keys(defaultSetting));
  vi.stubGlobal("document", dom.document);
  await import("../../src/options/options.ts");
  await dom.load();
  mock.contextMenus.removeAll.mockClear();
  mock.api.tabs.query.mockClear();
  return dom;
}

test("three delayed changes serialize/coalesce and old completion cannot roll back inputs", async () => {
  const dom = await options();
  dom.elements.depclean!.checked = false;
  const first = dom.form.dispatch("change");
  await vi.waitFor(() => expect(mock.writes).toHaveLength(1));
  dom.elements.sorttab!.checked = false;
  const second = dom.form.dispatch("change");
  dom.elements.refresh!.checked = false;
  const third = dom.form.dispatch("change");
  await Promise.resolve();
  expect(mock.writes).toHaveLength(1);
  mock.writes[0]!.resolve();
  await vi.waitFor(() => expect(mock.writes).toHaveLength(2));
  expect(dom.elements.sorttab!.checked).toBe(false);
  expect(dom.elements.refresh!.checked).toBe(false);
  mock.writes[1]!.resolve();
  await Promise.all([first, second, third]);
  expect(mock.data).toMatchObject({ depclean: false, sorttab: false, refresh: false });
  expect(dom.elements.depclean!.checked).toBe(false);
  expect(dom.elements.sorttab!.checked).toBe(false);
  expect(dom.elements.refresh!.checked).toBe(false);
});

test("clean external changes update controls, unknown/local/noop changes do nothing", async () => {
  const dom = await options();
  await mock.external({ sortkey: "title", grouping_min: 9 });
  expect(dom.elements.sortkey!.value).toBe("title");
  expect(dom.elements.grouping_min!.value).toBe("9");
  expect(dom.status.textContent).toContain("settingsExternalChanged");
  await mock.external({ sortkey: "url" }, "local");
  await mock.external({ unrelated: true });
  expect(dom.elements.sortkey!.value).toBe("title");
  expect(mock.writes).toHaveLength(0);
  expect(mock.contextMenus.removeAll).not.toHaveBeenCalled();
  expect(mock.api.tabs.query).not.toHaveBeenCalled();
});

test("dirty field wins with conflict notice; external clean fields are preserved by patch save", async () => {
  const dom = await options();
  dom.elements.protect_domains!.value = "draft.example";
  const save = dom.form.dispatch("change");
  await vi.waitFor(() => expect(mock.writes).toHaveLength(1));
  await mock.external({ sortkey: "title", protect_domains: "remote.example" });
  expect(dom.elements.sortkey!.value).toBe("title");
  expect(dom.elements.protect_domains!.value).toBe("draft.example");
  expect(dom.status.textContent).toContain("settingsExternalConflict");
  mock.writes[0]!.resolve();
  await save;
  expect(mock.data).toMatchObject({ sortkey: "title", protect_domains: "draft.example" });
  expect(dom.elements.protect_domains!.value).toBe("draft.example");
});

test("failed oldest save cannot erase newest draft and newer save recovers", async () => {
  const dom = await options();
  dom.elements.sortkey!.value = "title";
  const first = dom.form.dispatch("change");
  await vi.waitFor(() => expect(mock.writes).toHaveLength(1));
  dom.elements.protect_domains!.value = "draft.example";
  const next = dom.form.dispatch("change");
  mock.writes[0]!.reject("quota");
  await vi.waitFor(() => expect(mock.writes).toHaveLength(2));
  mock.writes[1]!.resolve();
  await Promise.all([first, next]);
  expect(mock.data).toMatchObject({ sortkey: "title", protect_domains: "draft.example" });
  expect(dom.status.textContent).toBe("settingsSaved");
});

test("unrelated local save does not recreate menus or query badges", async () => {
  const dom = await options();
  dom.elements.protect_domains!.value = "local.example";
  const save = dom.form.dispatch("change");
  await vi.waitFor(() => expect(mock.writes).toHaveLength(1));
  mock.writes[0]!.resolve();
  await save;
  expect(mock.contextMenus.removeAll).not.toHaveBeenCalled();
  expect(mock.api.tabs.query).not.toHaveBeenCalled();
});

test("dirty currentonly survives external glue during delayed registered save", async () => {
  const dom = await options();
  dom.elements.currentonly!.checked = true;
  const save = dom.form.dispatch("change");
  await vi.waitFor(() => expect(mock.writes).toHaveLength(1));
  await mock.external({ glue: true });
  const notice = dom.status.textContent;
  mock.writes[0]!.resolve();
  await save;
  const { getSetting } = await import("../../src/settings/setting.ts");
  const stored = await getSetting();
  console.info("coupled-conflict observation", JSON.stringify({
    raw: { glue: mock.data.glue, currentonly: mock.data.currentonly },
    normalized: { glue: stored.glue, currentonly: stored.currentonly },
    form: { glue: dom.elements.glue!.checked, currentonly: dom.elements.currentonly!.checked }, notice,
  }));
  expect({ glue: stored.glue, currentonly: stored.currentonly }).toEqual({ glue: false, currentonly: true });
  expect(dom.elements.glue!.checked).toBe(false);
  expect(dom.elements.currentonly!.checked).toBe(true);
  expect(notice).toContain("settingsExternalConflict");
});

test.each([
  ["glue", "currentonly", "before-write"],
  ["glue", "currentonly", "pending-write"],
  ["currentonly", "glue", "before-write"],
  ["currentonly", "glue", "pending-write"],
] as const)("dirty %s keeps its pair through external %s at %s", async (local, external, order) => {
  const dom = await options();
  dom.elements[local]!.checked = true;
  const save = dom.form.dispatch("change");
  if (order === "pending-write") await vi.waitFor(() => expect(mock.writes).toHaveLength(1));
  await mock.external({ [external]: true });
  const notice = dom.status.textContent;
  expect(dom.elements[local]!.checked).toBe(true);
  expect(dom.elements[external]!.checked).toBe(false);
  await vi.waitFor(() => expect(mock.writes).toHaveLength(1));
  expect(mock.writes[0]!.values).toMatchObject({ [local]: true, [external]: false });
  mock.writes[0]!.resolve();
  await save;
  expect(mock.data).toMatchObject({ [local]: true, [external]: false });
  expect(dom.elements[local]!.checked).toBe(true);
  expect(dom.elements[external]!.checked).toBe(false);
  expect(notice).toContain("settingsExternalConflict");
});

test.each(["glue", "currentonly"] as const)("failed %s pair save retains conflict draft and explicit retry writes both", async local => {
  const external = local === "glue" ? "currentonly" : "glue";
  const dom = await options();
  dom.elements[local]!.checked = true;
  const save = dom.form.dispatch("change");
  await vi.waitFor(() => expect(mock.writes).toHaveLength(1));
  await mock.external({ [external]: true });
  expect(dom.status.textContent).toContain("settingsExternalConflict");
  mock.writes[0]!.reject("quota/rate limit");
  await save;
  expect(dom.elements[local]!.checked).toBe(true);
  expect(dom.elements[external]!.checked).toBe(false);
  expect(mock.data[external]).toBe(true);
  expect(dom.status.textContent).toContain("settingsSaveFailed");
  const retry = dom.status.children.find(element => element.type === "button")!;
  const retried = retry.dispatch("click");
  await vi.waitFor(() => expect(mock.writes).toHaveLength(2));
  expect(mock.writes[1]!.values).toMatchObject({ [local]: true, [external]: false });
  mock.writes[1]!.resolve();
  await retried;
  expect(mock.data).toMatchObject({ [local]: true, [external]: false });
  expect(dom.status.textContent).toBe("settingsSaved");
});

test.each(["glue", "currentonly"] as const)("external pair becomes authoritative after %s draft has been confirmed", async local => {
  const external = local === "glue" ? "currentonly" : "glue";
  const dom = await options();
  dom.elements[local]!.checked = true;
  const save = dom.form.dispatch("change");
  await vi.waitFor(() => expect(mock.writes).toHaveLength(1));
  mock.writes[0]!.resolve();
  await save;
  await mock.external({ [local]: false, [external]: true });
  expect(dom.elements[local]!.checked).toBe(false);
  expect(dom.elements[external]!.checked).toBe(true);
  expect(dom.status.textContent).toContain("settingsExternalChanged");
  expect(mock.writes).toHaveLength(1);
});

test("input event marks the pair before save and foreign settings cannot discard the draft", async () => {
  const dom = await options();
  dom.elements.currentonly!.checked = true;
  await dom.form.dispatch("input");
  await mock.external({ glue: true, grouping_min: 8 });
  expect(dom.elements.currentonly!.checked).toBe(true);
  expect(dom.elements.glue!.checked).toBe(false);
  expect(dom.elements.grouping_min!.value).toBe("8");
  expect(dom.status.textContent).toContain("settingsExternalConflict");
  expect(mock.writes).toHaveLength(0);
  const save = dom.form.dispatch("change");
  await vi.waitFor(() => expect(mock.writes).toHaveLength(1));
  mock.writes[0]!.resolve();
  await save;
  expect(mock.data).toMatchObject({ glue: false, currentonly: true, grouping_min: 8 });
});

test("newest pair edit stays dirty through an older acknowledgement and repeated foreign changes", async () => {
  const dom = await options();
  dom.elements.currentonly!.checked = true;
  const first = dom.form.dispatch("change");
  await vi.waitFor(() => expect(mock.writes).toHaveLength(1));
  dom.elements.currentonly!.checked = false;
  dom.elements.glue!.checked = true;
  const latest = dom.form.dispatch("change");
  await mock.external({ glue: false, currentonly: true });
  mock.writes[0]!.resolve();
  await vi.waitFor(() => expect(mock.writes).toHaveLength(2));
  expect(dom.elements.glue!.checked).toBe(true);
  expect(dom.elements.currentonly!.checked).toBe(false);
  await mock.external({ glue: false, currentonly: true });
  mock.writes[1]!.resolve();
  await Promise.all([first, latest]);
  expect(mock.data).toMatchObject({ glue: true, currentonly: false });
  expect(dom.elements.glue!.checked).toBe(true);
  expect(dom.elements.currentonly!.checked).toBe(false);
});

test("duplicate identical changes do not overlap or duplicate writes", async () => {
  const dom = await options();
  dom.elements.sortkey!.value = "title";
  const first = dom.form.dispatch("change");
  await vi.waitFor(() => expect(mock.writes).toHaveLength(1));
  const duplicate = dom.form.dispatch("change");
  mock.writes[0]!.resolve();
  await Promise.all([first, duplicate]);
  expect(mock.writes).toHaveLength(1);
  expect(mock.data.sortkey).toBe("title");
  expect(dom.elements.sortkey!.value).toBe("title");
});

test("older external read completion cannot overwrite the newest controls", async () => {
  const dom = await options();
  let release!: () => void;
  mock.api.storage.sync.get.mockImplementationOnce((defaults, callback) => {
    const captured = { ...defaults, ...mock.data };
    if (target === "chrome") { release = () => callback?.(captured); return undefined; }
    return new Promise<Record<string, unknown>>(resolve => { release = () => resolve(captured); });
  });
  const old = mock.external({ sortkey: "title" });
  await mock.external({ sortkey: "url" });
  expect(dom.elements.sortkey!.value).toBe("url");
  release();
  await old;
  expect(dom.elements.sortkey!.value).toBe("url");
});

const tab = (id: number, windowId: number, active = false): chrome.tabs.Tab => ({
  id, windowId, active, index: id, url: "https://a.example.com/page", pinned: false,
  highlighted: false, incognito: false, ...(target === "firefox" ? { cookieStoreId: "firefox-default" } : {}), selected: false, discarded: false,
  autoDiscardable: true, groupId: -1, lastAccessed: 0, frozen: false,
});
async function background() {
  const tabs = [tab(1, 1, true), tab(2, 2), tab(3, 1)];
  mock.api.windows.getAll.mockResolvedValue(
    [...new Set(tabs.map(tab => tab.windowId))].map(id => ({
      id, type: "normal" as const, incognito: false, focused: id === 1, alwaysOnTop: false,
      tabs: tabs.filter(tab => tab.windowId === id).map(tab => ({ ...tab })),
    })),
  );
  mock.api.tabs.query.mockImplementation(async value => {
    const query = value as chrome.tabs.QueryInfo;
    return tabs.filter(item => (!query.active || item.active) && (!query.currentWindow || item.windowId === 1));
  });
  Object.assign(mock.data, { contextmenu1: true, contextmenu1advanced: true, contextmenu1scope: "win" });
  await import("../../src/background/background.ts");
  await mock.installed.emit();
  mock.contextMenus.removeAll.mockClear();
  mock.api.tabs.query.mockClear();
  return tabs[0]!;
}

test.each(["ohmytab_close_tabs", "ohmytab_close_l1"])("external scope labels agree with actual %s click targets", async id => {
  const active = await background();
  await mock.external({ contextmenu1scope: "all" });
  expect(mock.menus.get(id)?.title).toContain("text0_1");
  await mock.menuClicked.emit({ menuItemId: id, editable: false }, active);
  expect(mock.api.tabs.remove).toHaveBeenCalledExactlyOnceWith([1, 2, 3]);
});

test("unrelated/noop/non-sync storage events do not rebuild menus or badges", async () => {
  await background();
  await mock.external({ sortkey: "title", grouping_min: 8, unknown: "value" });
  await mock.external({ contextmenu1scope: "all" }, "local");
  await mock.external({ contextmenu1scope: "win", iconbadge: false });
  expect(mock.contextMenus.removeAll).not.toHaveBeenCalled();
  expect(mock.api.tabs.query).not.toHaveBeenCalled();
});

test("reinitialization awaits children and newest sync request wins, clicks cannot use partial scope", async () => {
  const active = await background();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  mock.contextMenus.create.mockImplementationOnce((menu, callback) => {
    void gate.then(() => { mock.menus.set(menu.id, { ...menu }); callback?.(); });
    return menu.id;
  });
  const first = mock.external({ contextmenu1scope: "all" });
  await vi.waitFor(() => expect(mock.contextMenus.removeAll).toHaveBeenCalledTimes(1));
  await mock.menuClicked.emit({ menuItemId: "ohmytab_close_tabs", editable: false }, active);
  expect(mock.api.tabs.remove).not.toHaveBeenCalled();
  const newest = mock.external({ contextmenu1scope: "win" });
  release();
  await Promise.all([first, newest]);
  expect(mock.menus.get("ohmytab_close_tabs")?.title).toContain("text0_0");
  expect(mock.menus.get("ohmytab_close_l1")?.title).toContain("text0_0");
  await mock.menuClicked.emit({ menuItemId: "ohmytab_close_l1", editable: false }, active);
  expect(mock.api.tabs.remove).toHaveBeenCalledExactlyOnceWith([1, 3]);
});

test("failed menu generation blocks clicks until a subsequent successful reflection", async () => {
  const active = await background();
  vi.spyOn(console, "log").mockImplementation(() => {});
  // create() does not reject; it reports failures only through runtime.lastError.
  mock.contextMenus.create.mockImplementationOnce((menu, callback) => {
    queueMicrotask(() => {
      mock.runtime.lastError = { message: "API unavailable" };
      callback?.();
      delete mock.runtime.lastError;
    });
    return menu.id;
  });
  await mock.external({ contextmenu1scope: "all" });
  await mock.menuClicked.emit({ menuItemId: "ohmytab_close_tabs", editable: false }, active);
  expect(mock.api.tabs.remove).not.toHaveBeenCalled();
  await mock.external({ contextmenu1advanced: false });
  await mock.menuClicked.emit({ menuItemId: "ohmytab_close_tabs", editable: false }, active);
  expect(mock.api.tabs.remove).toHaveBeenCalledExactlyOnceWith([1, 2, 3]);
});

async function wokenBackground() {
  const tabs = [tab(1, 1, true), tab(2, 2), tab(3, 1)];
  mock.api.windows.getAll.mockResolvedValue(
    [...new Set(tabs.map(tab => tab.windowId))].map(id => ({
      id, type: "normal" as const, incognito: false, focused: id === 1, alwaysOnTop: false,
      tabs: tabs.filter(tab => tab.windowId === id).map(tab => ({ ...tab })),
    })),
  );
  mock.api.tabs.query.mockImplementation(async value => {
    const query = value as chrome.tabs.QueryInfo;
    return tabs.filter(item => (!query.active || item.active) && (!query.currentWindow || item.windowId === 1));
  });
  Object.assign(mock.data, { contextmenu1: true, contextmenu1advanced: true, contextmenu1scope: "win" });
  // A restarted page or worker keeps the previous lifetime's rows but none of its state.
  for (const action of ["close", "extract"]) {
    for (let level = 0; level < 5; level++) mock.menus.set(`ohmytab_${action}_l${level}`, { id: `ohmytab_${action}_l${level}` });
  }
  await import("../../src/background/background.ts");
  return tabs[0]!;
}

test("a woken page recovers clicked detail rows from the stored settings", async () => {
  const active = await wokenBackground();
  await mock.menuClicked.emit({ menuItemId: "ohmytab_close_l1", editable: false }, active);
  expect(mock.api.tabs.remove).toHaveBeenCalledExactlyOnceWith([1, 3]);
  expect(mock.contextMenus.removeAll).not.toHaveBeenCalled();
});

test("a woken page does not recover rows hidden by the stored settings", async () => {
  const active = await wokenBackground();
  mock.data.contextmenu1advanced = false;
  await mock.menuClicked.emit({ menuItemId: "ohmytab_close_l1", editable: false }, active);
  await mock.menuClicked.emit({ menuItemId: "ohmytab_close_l4", editable: false }, active);
  expect(mock.api.tabs.remove).not.toHaveBeenCalled();
});

test("rows published in this lifetime are not overridden by recovery", async () => {
  const active = await wokenBackground();
  active.pinned = true;
  await mock.activated.emit();
  await mock.menuClicked.emit({ menuItemId: "ohmytab_close_l1", editable: false }, { ...active, pinned: false });
  expect(mock.api.tabs.remove).not.toHaveBeenCalled();
});

test("browser startup recreates the menus", async () => {
  await wokenBackground();
  await mock.started.emit();
  expect(mock.contextMenus.removeAll).toHaveBeenCalledOnce();
  expect(mock.menus.get("ohmytab_close_l1")?.title).toContain("[(*.)example.com]");
});

test("badge-only setting waits older render then applies latest state without recreating menus", async () => {
  await background();
  mock.data.iconbadge = true;
  let release!: () => void;
  const oldQuery = new Promise<chrome.tabs.Tab[]>(resolve => { release = () => resolve([tab(1, 1)]); });
  mock.api.tabs.query.mockImplementationOnce(() => oldQuery);
  const oldRender = mock.created.emit();
  await vi.waitFor(() => expect(mock.api.tabs.query).toHaveBeenCalled());
  const sync = mock.external({ iconbadge: false });
  release();
  await Promise.all([oldRender, sync]);
  const text = mock.api.action.setBadgeText.mock.calls.at(-1)?.[0] as { text: string };
  expect(text.text).toBe("");
  expect(mock.contextMenus.removeAll).not.toHaveBeenCalled();
});

test("a failed menu generation reports refused clicks and is retried by a later event", async () => {
  const active = await background();
  vi.spyOn(console, "log").mockImplementation(() => {});
  mock.contextMenus.create.mockImplementationOnce((menu, callback) => {
    queueMicrotask(() => { mock.runtime.lastError = { message: "API unavailable" }; callback?.(); delete mock.runtime.lastError; });
    return menu.id;
  });
  await mock.external({ contextmenu1scope: "all" });
  mock.contextMenus.removeAll.mockClear();
  await mock.menuClicked.emit({ menuItemId: "ohmytab_close_tabs", editable: false }, active);
  expect(mock.api.action.setTitle).toHaveBeenLastCalledWith({ title: "menuNotReady" });
  expect(mock.api.action.setBadgeText).toHaveBeenCalledWith({ tabId: 1, text: "!" });
  // Retries wait a while so a persistent failure does not loop.
  expect(mock.contextMenus.removeAll).not.toHaveBeenCalled();
  const now = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(now + 10_000);
  await mock.activated.emit();
  await vi.waitFor(() => expect(mock.contextMenus.removeAll).toHaveBeenCalledOnce());
  await vi.waitFor(async () => {
    await mock.menuClicked.emit({ menuItemId: "ohmytab_close_tabs", editable: false }, active);
    expect(mock.api.tabs.remove).toHaveBeenCalledExactlyOnceWith([1, 2, 3]);
  });
});

test("only an address or pin change of the shown tab updates the domain rows", async () => {
  const active = await background();
  mock.api.tabs.query.mockClear();
  const listener = mock.updated.listeners[0] as unknown as (id: number, change: object, tab: chrome.tabs.Tab) => unknown;
  await listener(1, { title: "new title" }, active);
  await listener(1, { status: "loading" }, active);
  await listener(2, { url: "https://b.example.com/" }, { ...active, id: 2, active: false });
  expect(mock.api.tabs.query).not.toHaveBeenCalled();
  await listener(1, { url: "https://b.example.com/" }, active);
  expect(mock.api.tabs.query).toHaveBeenCalledWith(expect.objectContaining({ active: true }));
});

test("unchanged domain rows are not updated again", async () => {
  await background();
  await mock.activated.emit();
  mock.contextMenus.update.mockClear();
  await mock.activated.emit();
  expect(mock.contextMenus.update).not.toHaveBeenCalled();
});
