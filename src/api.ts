export type TabType = chrome.tabs.Tab | browser.tabs.Tab;

export type WindowType = chrome.windows.Window | browser.windows.Window;

type KeyValueMap = Record<string, string | boolean | number>;

let myBrowser: typeof chrome | typeof browser;
let getStorage: <KVMap extends KeyValueMap>(keyValue: KVMap) => Promise<KVMap>;
let setStorage: <KVMap extends KeyValueMap>(keyValue: KVMap) => Promise<void>;

/// #if BROWSER === "chrome"
myBrowser = chrome;
getStorage = async <KVMap extends KeyValueMap>(keyValue: KVMap) => {
  return new Promise<KVMap>(
    (resolve: (items: KVMap) => void, reject: (reason: unknown) => void) => {
      try {
        chrome.storage.sync.get(keyValue, (data) => resolve(data as KVMap));
      } catch (e) {
        reject(e);
      }
    }
  );
};
setStorage = async <KVMap extends KeyValueMap>(keyValue: KVMap) => {
  return new Promise<void>(
    (resolve: () => void, reject: (reason: unknown) => void) => {
      try {
        chrome.storage.sync.set(keyValue, resolve);
      } catch (e) {
        reject(e);
      }
    }
  );
};
/// #else
myBrowser = browser;
getStorage = async <KVMap extends KeyValueMap>(keyValue: KVMap) =>
  (await browser.storage.sync.get(keyValue)) as KVMap;
setStorage = async <KVMap extends KeyValueMap>(keyValue: KVMap) =>
  await browser.storage.sync.set(keyValue);
/// #endif

export { myBrowser, getStorage, setStorage };

export const getActiveTab = async () =>
  (
    await myBrowser.tabs.query({
      active: true,
      windowType: "normal",
      pinned: false,
      currentWindow: true,
    })
  )[0] as TabType | undefined;

export type ScopeType = "win" | "all";

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
  } catch (e) {
    console.log("getTab", e);
    return [];
  }
};

export const moveTabs = async (
  tabIds: number[],
  window: WindowType,
  index: number = -1
) => {
  try {
    await myBrowser.tabs.move(tabIds, { windowId: window.id, index });
  } catch (e) {
    console.log(e);
  }
};

export const removeTabs = async (tabIds: number[]) => {
  try {
    await myBrowser.tabs.remove(tabIds);
  } catch (e) {
    console.log("removeTabs", e);
  }
};

export const reloadTab = async (tabId: number) => {
  try {
    await myBrowser.tabs.reload(tabId);
  } catch (e) {
    console.log("reloadTab", e);
  }
};

export const getActiveWindow = () =>
  myBrowser.windows.getLastFocused({
    windowTypes: ["normal"],
    populate: true,
  });

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

export const createWindow = (tabId?: number) =>
  myBrowser.windows.create(tabId ? { tabId } : {});

export const focusWindow = async (window: WindowType) => {
  if (window.id == null) return;
  try {
    await myBrowser.windows.update(window.id, { focused: true });
  } catch (e) {
    console.log("focusWindow", e);
  }
};

const setIconBadgeImpl = async (tabs: TabType[], text: string) =>
  await Promise.all(
    tabs.map((tab) => {
      if (tab.id != null) {
        try {
          myBrowser.action.setBadgeText({
            text,
            tabId: tab.id,
          });
          myBrowser.action.setBadgeBackgroundColor({
            color: "#8cb6f7",
            tabId: tab.id,
          });
        } catch (e) {
          console.log("setIconBadgeImpl", e);
        }
      }
    })
  );

export const setIconBadge = async (isEnable: boolean, scope: ScopeType) => {
  if (!isEnable || scope === "all") {
    const tabs = (await getTabs({ scope: "all" })) ?? [];
    const text = isEnable ? tabs.length.toString() : "";
    await setIconBadgeImpl(tabs, text);
  } else {
    const windows = await getWindows();
    await Promise.all(
      windows.map((window) => {
        const tabs = window.tabs ?? [];
        const text = tabs.length.toString();
        return setIconBadgeImpl(tabs, text);
      })
    );
  }
};
