import { vi } from "vitest";
import { installBrowserMock, type BrowserTarget } from "./browser.ts";

export type SortTabInput = {
  id: number;
  title: string;
  url?: string;
  pinned?: boolean;
  groupId?: number;
};

export function installSortBrowser(target: BrowserTarget, input: Record<number, SortTabInput[]>, activeWindow = 1) {
  const mock = installBrowserMock(target);
  const state = new Map<number, chrome.tabs.Tab[]>(Object.entries(input).map(([windowId, tabs]) => [
    Number(windowId), tabs.map((tab, index) => ({
      id: tab.id, title: tab.title, url: tab.url ?? `https://example.com/${tab.title}`,
      pinned: tab.pinned ?? false, groupId: tab.groupId ?? -1,
      index, windowId: Number(windowId), active: false, highlighted: false,
      incognito: false, ...(target === "firefox" ? { cookieStoreId: "firefox-default" } : {}), selected: false, discarded: false, autoDiscardable: true, lastAccessed: 0, frozen: false,
    })),
  ]));
  const event = () => ({ addListener: vi.fn() });
  const clicked = { addListener: vi.fn<(callback: () => Promise<void>) => void>() };
  Object.assign(mock.api.tabs, { onCreated: event(), onMoved: event(), onDetached: event(), onAttached: event(), onUpdated: event(), onRemoved: event(), onActivated: event() });
  Object.assign(mock.api.windows, { onFocusChanged: event() });
  Object.assign(mock.api.action, { onClicked: clicked });
  Object.assign(mock.api, {
    contextMenus: { onClicked: event() }, commands: { onCommand: event() }, runtime: { onInstalled: event(), onStartup: event(), onMessage: event() },
  });

  const snapshotWindow = (id: number) => ({
    id, type: "normal" as const, focused: id === activeWindow, alwaysOnTop: false, incognito: false,
    tabs: structuredClone(state.get(id) ?? []),
  });
  mock.api.windows.getAll.mockImplementation(async () => [...state.keys()].map(snapshotWindow));
  mock.api.windows.getLastFocused.mockImplementation(async () => snapshotWindow(activeWindow));
  mock.api.tabs.query.mockImplementation(async (value) => {
    const query = value as { windowId?: number; currentWindow?: boolean; active?: boolean; pinned?: boolean; groupId?: number };
    const tabs = [...state.values()].flat().filter(tab =>
      (query.windowId == null || tab.windowId === query.windowId) &&
      (!query.currentWindow || tab.windowId === activeWindow) &&
      (query.pinned == null || tab.pinned === query.pinned) &&
      // Existing Firefox API adapter does not send the Chrome group filter.
      (target !== "chrome" || query.groupId == null || tab.groupId === query.groupId),
    );
    // A real focused window always has an active tab, even when the tested sortable set is empty.
    if (query.active && tabs.length === 0) return [{ id: -1000, windowId: activeWindow,
      index: 0, pinned: true, active: true, incognito: false,
      ...(target === "firefox" ? { cookieStoreId: "firefox-default" } : {}),
    } as chrome.tabs.Tab];
    return structuredClone(tabs);
  });
  mock.api.tabs.move.mockImplementation(async (ids, value) => {
    const details = value as { windowId: number; index: number };
    const tabs = state.get(details.windowId);
    if (!tabs || ids.length !== 1) throw new Error("Expected one same-window move");
    const from = tabs.findIndex(tab => tab.id === ids[0]);
    const moving = tabs[from];
    if (!moving || moving.pinned) throw new Error("Cannot move missing or pinned tab");
    const pinnedCount = tabs.filter(tab => tab.pinned).length;
    if (!Number.isInteger(details.index) || details.index < pinnedCount || details.index >= tabs.length) {
      throw new Error("Move index is outside the unpinned window range");
    }
    tabs.splice(from, 1);
    const left = tabs[details.index - 1];
    const right = tabs[details.index];
    // Insertion between members of one group joins that group. At its outer
    // boundary the moved tab is ungrouped, matching documented tabs.move rules.
    moving.groupId = left && right && left.groupId !== -1 && left.groupId === right.groupId ? left.groupId : -1;
    tabs.splice(details.index, 0, moving);
    tabs.forEach((tab, index) => { tab.index = index; });
    return [];
  });
  Object.assign(mock.data, {
    glue: false, depclean: false, sorttab: true, refresh: false, comclose: false,
    closelocal: false, rxclose: false, grouping: false, iconbadge: false, urlmatch: false,
  });
  return { ...mock, clicked, state };
}
