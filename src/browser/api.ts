import { myBrowser, type TabType, type WindowType, type ScopeType } from "./browser-api";

export const getActiveTab = async (includePinned = false) =>
  (
    await myBrowser.tabs.query({
      active: true,
      windowType: "normal",
      pinned: includePinned ? undefined : false,
      currentWindow: true,
    })
  )[0] as TabType | undefined;

function convertArray<X, T extends X, U extends X>(ary: T[] | U[]): X[] {
  return ary.map((v) => v);
}

// groupId is not supported in Firefox and is ignored.
export const getTabs = async (
  param: { windowId?: number; groupId?: number } | { scope: ScopeType }
) => {
  try {
    // prettier-ignore
    const tabs = await myBrowser.tabs.query({
      windowType: "normal",
      pinned: false,
      currentWindow: "scope" in param && param.scope === "win" ? true : undefined,
      windowId:
        "scope" in param 
        // #if BROWSER === "chrome"
        || (param.groupId != null && param.groupId != -1)
        // #endif
          ? undefined
          : param.windowId,
      // #if BROWSER === "chrome"
      groupId: "scope" in param ? undefined : param.groupId,
      // #endif
    });
    return convertArray<TabType, chrome.tabs.Tab, browser.tabs.Tab>(tabs);
  } catch {
    throw new Error("Tab query failed");
  }
};

export const moveTabs = async (
  tabIds: number[],
  window: WindowType,
  index: number = -1
) => {
  try {
    await myBrowser.tabs.move(tabIds, { windowId: window.id, index });
  } catch {
    throw new Error("Tab move failed");
  }
};

export const removeTabs = async (tabIds: number[]) => {
  try {
    await myBrowser.tabs.remove(tabIds);
  } catch {
    throw new Error("Tab removal failed");
  }
};

export const reloadTab = async (tabId: number) => {
  try {
    await myBrowser.tabs.reload(tabId);
  } catch {
    throw new Error("Tab reload failed");
  }
};

export const getActiveWindow = async () => {
  let window: WindowType;
  /// #if BROWSER === "chrome"
  window = await myBrowser.windows.getLastFocused({
    windowTypes: ["normal"],
    populate: true,
  });
  /// #else
  window = await myBrowser.windows.getLastFocused({ populate: true });
  if (window.type !== "normal") throw new Error("Normal operation window unavailable");
  /// #endif
  return window;
};

export const getWindows = async () => {
  const window = await myBrowser.windows.getAll({
    windowTypes: ["normal"],
    populate: true,
  });
  return convertArray<
    WindowType,
    chrome.windows.Window,
    browser.windows.Window
  >(window);
};

export const createWindow = (tabId?: number, incognito?: boolean) =>
  myBrowser.windows.create({ ...(tabId == null ? {} : { tabId }),
    ...(incognito == null ? {} : { incognito }) });

export const focusWindow = async (window: WindowType) => {
  if (window.id == null) return;
  try {
    await myBrowser.windows.update(window.id, { focused: true });
  } catch {
    throw new Error("Window focus failed");
  }
};

export const getTab = (tabId: number) => myBrowser.tabs.get(tabId) as Promise<TabType>;
