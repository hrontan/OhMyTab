export type TabType = chrome.tabs.Tab | browser.tabs.Tab;
export type WindowType = chrome.windows.Window | browser.windows.Window;
type KeyValueMap = Record<string, unknown>;
export type StorageArea = "sync" | "local";
let myBrowser: typeof chrome | typeof browser;
/// #if BROWSER === "chrome"
myBrowser = chrome;
/// #else
myBrowser = browser;
/// #endif

export const getStorage = async <KVMap extends KeyValueMap>(defaults: KVMap, area: StorageArea = "sync"): Promise<KVMap> => {
  let result: KVMap;
  /// #if BROWSER === "chrome"
  result = await new Promise<KVMap>((resolve, reject) => {
    chrome.storage[area].get(defaults, data => {
      const error = chrome.runtime?.lastError;
      if (error) reject(new Error(error.message || "Storage read failed"));
      else resolve(data as KVMap);
    });
  });
  /// #else
  result = await browser.storage[area].get(defaults) as KVMap;
  /// #endif
  return result;
};
export const setStorage = async (values: KeyValueMap, area: StorageArea = "sync"): Promise<void> => {
  /// #if BROWSER === "chrome"
  await new Promise<void>((resolve, reject) => {
    chrome.storage[area].set(values, () => {
      const error = chrome.runtime?.lastError;
      if (error) reject(new Error(error.message || "Storage write failed"));
      else resolve();
    });
  });
  /// #else
  await browser.storage[area].set(values);
  /// #endif
};
export const removeStorage = async (keys: string[], area: StorageArea = "sync"): Promise<void> => {
  /// #if BROWSER === "chrome"
  await new Promise<void>((resolve, reject) => {
    chrome.storage[area].remove(keys, () => {
      const error = chrome.runtime?.lastError;
      if (error) reject(new Error(error.message || "Storage removal failed"));
      else resolve();
    });
  });
  /// #else
  await browser.storage[area].remove(keys);
  /// #endif
};
export const getStorageKeys = async (keys: string[], area: StorageArea = "sync"): Promise<Record<string, unknown>> => {
  let result: Record<string, unknown>;
  /// #if BROWSER === "chrome"
  result = await new Promise<Record<string, unknown>>((resolve, reject) => {
    chrome.storage[area].get(keys, data => {
      const error = chrome.runtime?.lastError;
      if (error) reject(new Error(error.message || "Storage read failed"));
      else resolve(data);
    });
  });
  /// #else
  result = await browser.storage[area].get(keys);
  /// #endif
  return result;
};
export { myBrowser };

export type ScopeType = "win" | "all";
