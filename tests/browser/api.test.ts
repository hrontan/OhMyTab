import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { installBrowserMock, type BrowserTarget } from "../helpers/browser.ts";

const target = process.env.TEST_BROWSER as BrowserTarget;
let mock: ReturnType<typeof installBrowserMock>;

beforeEach(() => {
  vi.resetModules();
  mock = installBrowserMock(target);
});
afterEach(() => vi.unstubAllGlobals());

test("the selected browser branch uses controllable tab query results", async () => {
  const tab: chrome.tabs.Tab = {
    id: 7, index: 0, windowId: 1, pinned: false, highlighted: false,
    active: true, incognito: false, selected: true, discarded: false,
    autoDiscardable: true, groupId: -1, lastAccessed: 0, frozen: false,
  };
  mock.api.tabs.query.mockResolvedValueOnce([tab]);
  const { myBrowser } = await import("../../src/browser/browser-api.ts");
  const { getActiveTab } = await import("../../src/browser/api.ts");
  expect(myBrowser).toBe(mock.api);
  expect(await getActiveTab()).toEqual(tab);
  expect(mock.api.tabs.query).toHaveBeenCalledWith({
    active: true, windowType: "normal", pinned: false, currentWindow: true,
  });
});

test("storage defaults and writes work through the browser-specific API", async () => {
  const { getStorage, setStorage } = await import("../../src/browser/browser-api.ts");
  expect(await getStorage({ enabled: false })).toEqual({ enabled: false });
  await setStorage({ enabled: true });
  expect(await getStorage({ enabled: false })).toEqual({ enabled: true });
  expect(mock.api.storage.sync.set).toHaveBeenCalledTimes(1);
});

test("the mock can inject storage failure without contacting a browser", async () => {
  const failure = new Error("storage unavailable");
  mock.api.storage.sync.get.mockImplementationOnce(() => { throw failure; });
  const { getStorage } = await import("../../src/browser/browser-api.ts");
  await expect(getStorage({ enabled: false })).rejects.toThrow(failure);
});
