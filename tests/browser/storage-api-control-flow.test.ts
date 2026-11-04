import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { installBrowserMock, type BrowserTarget } from "../helpers/browser.ts";

const target = process.env.TEST_BROWSER as BrowserTarget;
let mock: ReturnType<typeof installBrowserMock>;
let runtime: { lastError?: { message: string } };
beforeEach(() => {
  vi.resetModules();
  mock = installBrowserMock(target);
  runtime = {};
  Object.assign(mock.api, { runtime });
});
afterEach(() => vi.unstubAllGlobals());

for (const area of ["sync", "local"] as const) {
  test(area + " wrappers preserve defaults, exact keys, values and deletion boundaries", async () => {
    const api = await import("../../src/browser/browser-api.ts");
    const data = area === "sync" ? mock.data : mock.localData;
    const other = area === "sync" ? mock.localData : mock.data;
    Object.assign(data, { kept: "before", unrelated: "retain" });
    Object.assign(other, { kept: "other-area" });
    expect(await api.getStorage({ kept: "fallback", absent: false }, area)).toEqual({ kept: "before", absent: false });
    await expect(api.setStorage({ kept: "after" }, area)).resolves.toBeUndefined();
    expect(await api.getStorageKeys(["kept", "missing"], area)).toEqual({ kept: "after" });
    await expect(api.removeStorage(["kept"], area)).resolves.toBeUndefined();
    expect(data).toEqual({ unrelated: "retain" });
    expect(other).toEqual({ kept: "other-area" });
    const otherApi = mock.api.storage[area === "sync" ? "local" : "sync"];
    expect(otherApi.get).not.toHaveBeenCalled();
    expect(otherApi.set).not.toHaveBeenCalled();
    expect(otherApi.remove).not.toHaveBeenCalled();
  });
  for (const operation of ["get", "keys", "set", "remove"] as const) {
    test(area + " " + operation + " rejects the browser error without touching the other area", async () => {
      const api = await import("../../src/browser/browser-api.ts");
      const storage = mock.api.storage[area];
      const message = area + " " + operation + " unavailable";
      const callbackFailure = (callback: () => void) => {
        runtime.lastError = { message };
        try { callback(); } finally { delete runtime.lastError; }
      };
      if (operation === "get" || operation === "keys") {
        storage.get.mockImplementationOnce((_keys, callback) => {
          if (target === "firefox") return Promise.reject<Record<string, unknown>>(new Error(message));
          callbackFailure(() => callback?.({}));
          return undefined;
        });
      } else {
        storage[operation].mockImplementationOnce((_values, callback) => {
          if (target === "firefox") return Promise.reject<void>(new Error(message));
          callbackFailure(() => callback?.());
          return undefined;
        });
      }
      const work = operation === "get" ? api.getStorage({ kept: false }, area)
        : operation === "keys" ? api.getStorageKeys(["kept"], area)
        : operation === "set" ? api.setStorage({ kept: true }, area)
        : api.removeStorage(["kept"], area);
      await expect(work).rejects.toThrow(message);
      const other = mock.api.storage[area === "sync" ? "local" : "sync"];
      expect(other.get).not.toHaveBeenCalled();
      expect(other.set).not.toHaveBeenCalled();
      expect(other.remove).not.toHaveBeenCalled();
    });
  }
}
