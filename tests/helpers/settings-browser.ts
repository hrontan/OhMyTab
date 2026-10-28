import { vi } from "vitest";
import { installBrowserMock, type BrowserTarget } from "./browser.ts";

type Changes = Record<string, { oldValue?: unknown; newValue?: unknown }>;
export function controlledEvent<Args extends unknown[]>() {
  const listeners: ((...args: Args) => unknown)[] = [];
  return {
    addListener: vi.fn((listener: (...args: Args) => unknown) => { listeners.push(listener); }),
    async emit(...args: Args) { await Promise.all(listeners.map(listener => listener(...args))); },
    listeners,
  };
}

export function installSettingsBrowser(target: BrowserTarget) {
  const mock = installBrowserMock(target);
  const changed = controlledEvent<[Changes, string]>();
  const clicked = controlledEvent<[]>();
  const menuClicked = controlledEvent<[chrome.contextMenus.OnClickData, chrome.tabs.Tab]>();
  const installed = controlledEvent<[]>();
  const activated = controlledEvent<[]>();
  const updated = controlledEvent<[]>();
  const created = controlledEvent<[]>();
  const menus = new Map<string, Record<string, unknown>>();
  const notifications: Promise<void>[] = [];
  const writes: { values: Record<string, unknown>; resolve: () => void; reject: (message: string) => void }[] = [];
  const started = controlledEvent<[]>();
  const messages = controlledEvent<[unknown, chrome.runtime.MessageSender, (value: unknown) => void]>();
  const runtime: { lastError?: { message: string }; onInstalled: typeof installed; onStartup: typeof started; onMessage: typeof messages; id: string; getURL: (path: string) => string } = { onInstalled: installed, onStartup: started, onMessage: messages, id: "fixture", getURL: path => "chrome-extension://fixture/" + path };
  const contextMenus = {
    onClicked: menuClicked,
    removeAll: vi.fn(async () => { menus.clear(); }),
    // Like the browsers, create() returns the ID and reports through its callback.
    create: vi.fn((menu: { id: string }, callback?: () => void) => {
      menus.set(menu.id, { ...menu });
      queueMicrotask(() => callback?.());
      return menu.id;
    }),
    update: vi.fn(async (id: string, details: Record<string, unknown>) => {
      const current = menus.get(id);
      if (!current) throw new Error("menu not created");
      Object.assign(current, details);
    }),
  };
  Object.assign(mock.api.storage, { onChanged: changed });
  Object.assign(mock.api.tabs, { onCreated: created, onMoved: controlledEvent<[]>(), onDetached: controlledEvent<[]>(), onAttached: controlledEvent<[]>(), onUpdated: updated, onRemoved: controlledEvent<[]>(), onActivated: activated });
  Object.assign(mock.api.windows, { onFocusChanged: controlledEvent<[]>() });
  Object.assign(mock.api.action, { onClicked: clicked });
  Object.assign(mock.api, { contextMenus, commands: { onCommand: controlledEvent<[string]>() }, runtime, i18n: { getMessage: (key: string) => key } });
  mock.api.storage.sync.set.mockImplementation((values, callback) => {
    let complete!: () => void;
    let fail!: (error: Error) => void;
    const pending = new Promise<void>((resolve, reject) => { complete = resolve; fail = reject; });
    writes.push({ values: { ...values }, resolve() {
      const changes = Object.fromEntries(Object.entries(values).filter(([key, value]) => mock.data[key] !== value).map(([key, value]) => [key, { oldValue: mock.data[key], newValue: value }]));
      Object.assign(mock.data, values);
      notifications.push(changed.emit(changes, "sync"));
      if (target === "chrome") callback?.();
      complete();
    }, reject(message) {
      if (target === "chrome") { runtime.lastError = { message }; callback?.(); delete runtime.lastError; complete(); }
      else fail(new Error(message));
    } });
    return target === "firefox" ? pending : undefined;
  });
  return {
    ...mock, runtime, changed, clicked, menuClicked, installed, started, activated, updated, created, contextMenus, menus, writes,
    async external(values: Record<string, unknown>, area = "sync") {
      const changes = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { oldValue: mock.data[key], newValue: value }]));
      if (area === "sync") Object.assign(mock.data, values);
      await changed.emit(changes, area);
    },
    async flushNotifications() { await Promise.all(notifications); },
  };
}
