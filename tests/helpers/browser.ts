import { vi } from "vitest";

export type BrowserTarget = "chrome" | "firefox";
type Values = Record<string, unknown>;

export function createBrowserMock(target: BrowserTarget) {
  const data: Values = {};
  const localData: Values = {};
  const makeStorage = (data: Values) => ({
    get: vi.fn((defaults: Values | string[], callback?: (values: Values) => void) => {
      const values = Array.isArray(defaults)
        ? Object.fromEntries(defaults.filter(key => Object.hasOwn(data, key)).map(key => [key, data[key]]))
        : Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, Object.hasOwn(data, key) ? data[key] : fallback]));
      if (target === "chrome") {
        callback?.(values);
        return;
      }
      return Promise.resolve(values);
    }),
    set: vi.fn((values: Values, callback?: () => void) => {
      Object.assign(data, values);
      if (target === "chrome") {
        callback?.();
        return;
      }
      return Promise.resolve();
    }),
    remove: vi.fn((keys: string[], callback?: () => void) => {
      for (const key of keys) delete data[key];
      if (target === "chrome") { callback?.(); return; }
      return Promise.resolve();
    }),
  });
  const storage = makeStorage(data);
  const local = makeStorage(localData);
  const api = {
    storage: { sync: storage, local, onChanged: { addListener: vi.fn() } },
    tabs: {
      query: vi.fn(async (_query: unknown): Promise<chrome.tabs.Tab[]> => []),
      move: vi.fn(async (_ids: number[], _details: unknown) => []),
      remove: vi.fn(async (_ids: number[]) => {}),
      reload: vi.fn(async (_id: number) => {}),
      get: vi.fn(async (id: number) => ({ id, status: "complete" })),
      onReplaced: { addListener: vi.fn() },
    },
    windows: {
      getAll: vi.fn(async (_details: unknown): Promise<chrome.windows.Window[]> => []),
      getLastFocused: vi.fn(async (_details: unknown) => ({ id: 1, type: "normal" } as chrome.windows.Window)),
      create: vi.fn(async (_details: unknown) => ({ id: 1 })),
      update: vi.fn(async (_id: number, _details: unknown) => ({ id: 1 })),
    },
    action: {
      setTitle: vi.fn(async (_details: unknown) => {}),
      setBadgeText: vi.fn((_details: unknown) => {}),
      setBadgeBackgroundColor: vi.fn((_details: unknown) => {}),
    },
  };
  return { api, data, localData };
}

export function installBrowserMock(target: BrowserTarget) {
  const mock = createBrowserMock(target);
  vi.stubGlobal("chrome", target === "chrome" ? mock.api : undefined);
  vi.stubGlobal("browser", target === "firefox" ? mock.api : undefined);
  return mock;
}
