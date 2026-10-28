import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { controlledEvent, installSettingsBrowser } from "../helpers/settings-browser.ts";
import type { BrowserTarget } from "../helpers/browser.ts";

const target = process.env.TEST_BROWSER as BrowserTarget;
type SessionTab = chrome.tabs.Tab & { cookieStoreId: string };
let mock: ReturnType<typeof installSettingsBrowser>;
let action: ReturnType<typeof controlledEvent<[chrome.tabs.Tab]>>;
let command: ReturnType<typeof controlledEvent<[string]>>;
let tabs: SessionTab[];
const normal = { id: 1, type: "normal", incognito: false } as chrome.windows.Window;
const popup = { id: 9, type: "popup", incognito: false } as chrome.windows.Window;
const tab = (id: number, windowId = 1): SessionTab => ({
  id, windowId, index: id - 1, active: id === 1, pinned: false, highlighted: false,
  selected: false, incognito: false, discarded: false, autoDiscardable: true,
  lastAccessed: 0, frozen: false, groupId: -1, cookieStoreId: "firefox-default",
  url: "https://same.example/", title: String(id),
});

const createTab = vi.fn(async (_details: unknown) => tab(100));

beforeEach(() => {
  vi.resetModules();
  mock = installSettingsBrowser(target);
  createTab.mockClear();
  Object.assign(mock.api.tabs, { create: createTab });
  action = controlledEvent<[chrome.tabs.Tab]>();
  command = controlledEvent<[string]>();
  Object.assign(mock.api.action, { onClicked: action });
  Object.assign(mock.api, { commands: { onCommand: command } });
  tabs = [tab(1), tab(2)];
  Object.assign(mock.data, {
    glue: false, depclean: true, sorttab: false, refresh: false, grouping: false,
    comclose: false, closelocal: false, rxclose: false, iconbadge: false,
    urlmatch: false, preview_before: false, currentonly: false, contextmenu1scope: "all",
  });
  // Fixtures supply API results. Origin selection and refusal remain product work.
  mock.api.windows.getLastFocused.mockResolvedValue(normal);
  mock.api.windows.getAll.mockResolvedValue([normal]);
  mock.api.tabs.query.mockImplementation(async value => {
    const q = value as { active?: boolean; pinned?: boolean; windowId?: number };
    return structuredClone(tabs.filter(t => (!q.active || t.active) &&
      (q.pinned == null || t.pinned === q.pinned) && (q.windowId == null || q.windowId === t.windowId)));
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function expectNoWork() {
  expect(mock.api.tabs.remove).not.toHaveBeenCalled();
  expect(mock.api.tabs.move).not.toHaveBeenCalled();
  expect(createTab).not.toHaveBeenCalled();
  expect(mock.api.windows.create).not.toHaveBeenCalled();
  expect(mock.api.storage.sync.set).not.toHaveBeenCalled();
  expect(mock.api.storage.local.set).not.toHaveBeenCalled();
  expect(mock.writes).toHaveLength(0);
}

test.each(["toolbar", "keyboard", "menu"])("%s normal origin keeps the selected IDs", async entry => {
  await import("../../src/background/background.ts");
  if (entry === "toolbar") await action.emit(tabs[0]!);
  else if (entry === "keyboard") await command.emit("08_execute_option2");
  else await mock.menuClicked.emit({ menuItemId: "ohmytab_close_tabs", editable: false }, tabs[0]!);
  expect(mock.api.tabs.remove).toHaveBeenCalledExactlyOnceWith(entry === "menu" ? [1, 2] : [1]);
});

test("window getter retains Chrome arguments and uses only supported Firefox arguments", async () => {
  const { getActiveWindow } = await import("../../src/browser/api.ts");
  expect(await getActiveWindow()).toEqual(normal);
  expect(mock.api.windows.getLastFocused).toHaveBeenCalledExactlyOnceWith(
    target === "chrome" ? { windowTypes: ["normal"], populate: true } : { populate: true },
  );
});

test.runIf(target === "firefox").each(["toolbar", "keyboard", "menu"])(
  "%s popup origin performs no work, then accepts a normal request", async entry => {
    mock.api.windows.getLastFocused.mockResolvedValue(popup);
    const popupTab = tab(9, 9);
    const originalSettings = structuredClone(mock.data);
    await import("../../src/background/background.ts");
    if (entry === "toolbar") await action.emit(popupTab);
    else if (entry === "keyboard") await command.emit("08_execute_option2");
    else await mock.menuClicked.emit({ menuItemId: "ohmytab_close_tabs", editable: false }, popupTab);
    expectNoWork();
    expect(mock.data).toEqual(originalSettings);
    expect(mock.api.action.setTitle.mock.calls.map(([details]) =>
      (details as { title: string }).title)).toContain("operationFailed");
    mock.api.windows.getLastFocused.mockResolvedValue(normal);
    await action.emit(tabs[0]!);
    expect(mock.api.tabs.remove).toHaveBeenCalledExactlyOnceWith([1]);
  },
);

test.runIf(target === "firefox").each(["toolbar", "menu"])(
  "%s clicked normal origin does not query unrelated popup focus", async entry => {
    mock.api.windows.getLastFocused.mockRejectedValue(new Error("unrelated focus unavailable"));
    await import("../../src/background/background.ts");
    if (entry === "toolbar") await action.emit(tabs[0]!);
    else await mock.menuClicked.emit({ menuItemId: "ohmytab_close_tabs", editable: false }, tabs[0]!);
    expect(mock.api.windows.getLastFocused).not.toHaveBeenCalled();
    expect(mock.api.tabs.remove).toHaveBeenCalledExactlyOnceWith(entry === "menu" ? [1, 2] : [1]);
  },
);

test.runIf(target === "firefox").each(["unknown", "api failure"])(
  "%s origin metadata fails without work and releases the guard", async kind => {
    if (kind === "unknown") mock.api.windows.getLastFocused.mockResolvedValue({ id: 1, incognito: false } as chrome.windows.Window);
    else mock.api.windows.getLastFocused.mockRejectedValue(new Error("window query failed"));
    await import("../../src/background/background.ts");
    await command.emit("08_execute_option2");
    expectNoWork();
    mock.api.windows.getLastFocused.mockResolvedValue(normal);
    await command.emit("08_execute_option2");
    expect(mock.api.tabs.remove).toHaveBeenCalledExactlyOnceWith([1]);
  },
);
