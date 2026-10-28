import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { installBrowserMock, type BrowserTarget } from "../helpers/browser.ts";
const target = process.env.TEST_BROWSER as BrowserTarget;
let mock: ReturnType<typeof installBrowserMock>;
let ruleStorageKey: string;
let runtime: { lastError?: { message: string } };
beforeEach(() => {
  vi.resetModules();
  mock = installBrowserMock(target);
  runtime = {};
  Object.assign(mock.api, { runtime });
  let queue = Promise.resolve();
  vi.stubGlobal("navigator", { locks: { request: (_name: string, operation: () => Promise<unknown>) => {
    const next = queue.then(operation); queue = next.then(() => {}, () => {}); return next;
  } } });
});
afterEach(() => vi.unstubAllGlobals());
const rules = { urlmatch: true, urlmatch_pattern: "  *example.test*\n*second.test*  " };
function fail(area: "local" | "sync", operation: "get" | "set" | "remove") {
  const method = mock.api.storage[area][operation];
  method.mockImplementationOnce(((_value: unknown, callback?: (value?: unknown) => void) => {
    if (target === "firefox") return Promise.reject(new Error("injected " + area + " " + operation));
    runtime.lastError = { message: "injected " + area + " " + operation };
    callback?.({}); delete runtime.lastError; return undefined;
  }) as never);
}
async function module() {
  ({ ruleStorageKey } = await import("../../src/settings/rule-storage-state.ts"));
  return import("../../src/settings/rule-storage.ts");
}

test("existing sync rules are inherited read-only; unrelated raw preferences survive both migrations", async () => {
  Object.assign(mock.data, rules, { grouping: true, grouping_min: 7, protect_domains: "private.test", extra: "keep" });
  const old = structuredClone(mock.data);
  const storage = await module();
  expect(await storage.readRules()).toEqual(rules);
  expect(mock.api.storage.local.set).not.toHaveBeenCalled();
  expect(await storage.switchRuleStorage("local")).toEqual({ mode: "local", syncResidual: false });
  expect(await storage.readRules()).toEqual(rules);
  expect(mock.data).toEqual({ grouping: true, grouping_min: 7, protect_domains: "private.test", extra: "keep" });
  expect(mock.localData[ruleStorageKey]).toEqual({ mode: "local", rules });
  expect(await storage.switchRuleStorage("sync")).toEqual({ mode: "sync", syncResidual: false });
  expect(mock.data).toEqual(old);
  expect(mock.localData[ruleStorageKey]).toEqual({ mode: "sync" });
});

test("destination staging failure leaves original sync authoritative and never removes it", async () => {
  Object.assign(mock.data, rules);
  fail("local", "set");
  const storage = await module();
  await expect(storage.switchRuleStorage("local")).rejects.toThrow("injected");
  expect(await storage.readRules()).toEqual(rules);
  expect(mock.data).toEqual(rules);
  expect(mock.api.storage.sync.remove).not.toHaveBeenCalled();
});

test("failed destination readback keeps sync selected and source intact", async () => {
  Object.assign(mock.data, rules);
  const original = mock.api.storage.local.set.getMockImplementation()!;
  mock.api.storage.local.set.mockImplementationOnce(((values: unknown, callback?: () => void) => {
    const result = original(values as Record<string, unknown>, callback);
    fail("local", "get"); return result;
  }) as never);
  const storage = await module();
  await expect(storage.switchRuleStorage("local")).rejects.toThrow("injected");
  expect((await storage.getRuleStorageStatus()).mode).toBe("sync");
  expect(mock.data).toEqual(rules);
  expect(mock.api.storage.sync.remove).not.toHaveBeenCalled();
});

test("old sync removal failure reports local plus residual; explicit retry removes only two keys", async () => {
  Object.assign(mock.data, rules, { grouping: true });
  fail("sync", "remove");
  const storage = await module();
  expect(await storage.switchRuleStorage("local")).toEqual({ mode: "local", syncResidual: true });
  expect(await storage.readRules()).toEqual(rules);
  expect(mock.data.urlmatch_pattern).toBe(rules.urlmatch_pattern);
  expect(await storage.removeSyncRules()).toEqual({ mode: "local", syncResidual: false });
  expect(mock.data).toEqual({ grouping: true });
});

test("remote change before cleanup is preserved and explicitly flagged", async () => {
  Object.assign(mock.data, rules);
  const original = mock.api.storage.local.set.getMockImplementation()!;
  mock.api.storage.local.set.mockImplementation(((values: Record<string, unknown>, callback?: () => void) => {
    const result = original(values, callback);
    const record = Object.values(values)[0] as { mode?: string };
    if (record.mode === "local") mock.data.urlmatch_pattern = "*remote-new*";
    return result;
  }) as never);
  const storage = await module();
  expect(await storage.switchRuleStorage("local")).toEqual({ mode: "local", syncResidual: true });
  expect(await storage.readRules()).toEqual(rules);
  expect(mock.data.urlmatch_pattern).toBe("*remote-new*");
  expect(mock.api.storage.sync.remove).not.toHaveBeenCalled();
});

test.each(["set", "get"] as const)("local to sync %s failure preserves complete local snapshot", async operation => {
  Object.assign(mock.data, rules);
  const storage = await module(); await storage.switchRuleStorage("local");
  const snapshot = structuredClone(mock.localData);
  fail("sync", operation);
  await expect(storage.switchRuleStorage("sync")).rejects.toThrow("injected");
  expect(mock.localData).toEqual(snapshot);
  expect(await storage.readRules()).toEqual(rules);
});

test("selector write failure after sync copy preserves local authority and both copies", async () => {
  Object.assign(mock.data, rules);
  const storage = await module(); await storage.switchRuleStorage("local");
  fail("local", "set");
  await expect(storage.switchRuleStorage("sync")).rejects.toThrow("injected");
  expect((await storage.getRuleStorageStatus()).mode).toBe("local");
  expect(await storage.readRules()).toEqual(rules);
  expect(mock.data).toEqual(rules);
});

test("settings write routes only URL fields locally, preserves unsupported grouping raw prefs", async () => {
  Object.assign(mock.data, rules, { grouping: true, grouping_min: 7 });
  const storage = await module(); await storage.switchRuleStorage("local");
  const setting = await import("../../src/settings/setting.ts");
  await setting.setSetting({ ...await setting.getSetting(), urlmatch_pattern: "*draft*", depclean: false }, ["urlmatch_pattern", "depclean"]);
  expect((await setting.getSetting()).urlmatch_pattern).toBe("*draft*");
  expect(mock.data).toEqual({ grouping: true, grouping_min: 7, depclean: false });
  expect(setting.getChangedSettingKeys({ [ruleStorageKey]: { newValue: mock.localData[ruleStorageKey] } }, "local")).toEqual(["urlmatch", "urlmatch_pattern"]);
});

test("same-origin queued save after migration uses the committed destination", async () => {
  Object.assign(mock.data, rules);
  const storage = await module();
  await Promise.all([storage.switchRuleStorage("local"), storage.writeRuleSettings({ urlmatch_pattern: "*queued*" })]);
  expect(await storage.readRules()).toEqual({ ...rules, urlmatch_pattern: "*queued*" });
  expect(mock.data.urlmatch_pattern).toBeUndefined();
});

test("missing lock API refuses migration/local writes while preserving ordinary sync operations", async () => {
  Object.assign(mock.data, rules);
  const storage = await module();
  vi.stubGlobal("navigator", {});
  await expect(storage.switchRuleStorage("local")).rejects.toThrow("Web Locks");
  await storage.writeRuleSettings({ depclean: false });
  expect(await storage.readRules()).toEqual(rules);
  mock.localData[ruleStorageKey] = { mode: "local", rules };
  await expect(storage.writeRuleSettings({ urlmatch_pattern: "*no*" })).rejects.toThrow("Web Locks");
  expect(await storage.readRules()).toEqual(rules);
});

test("explicit cleanup is forbidden while sync is authoritative", async () => {
  Object.assign(mock.data, rules);
  await expect((await module()).removeSyncRules()).rejects.toThrow("Switch");
  expect(mock.data).toEqual(rules);
});


test("read catches sync-to-local cutover between selector and sync get without waiting on writer lock", async () => {
  Object.assign(mock.data, rules);
  const storage = await module();
  const original = mock.api.storage.sync.get.getMockImplementation()!;
  mock.api.storage.sync.get.mockImplementationOnce(((values: Record<string, unknown>, callback?: (value: Record<string, unknown>) => void) => {
    mock.localData[ruleStorageKey] = { mode: "local", rules };
    delete mock.data.urlmatch; delete mock.data.urlmatch_pattern;
    return original(values, callback);
  }) as never);
  expect(await storage.readRules()).toEqual(rules);
});

test("unrelated sync write remains available when local rules exist and lock API is absent", async () => {
  const storage = await module();
  mock.localData[ruleStorageKey] = { mode: "local", rules };
  vi.stubGlobal("navigator", {});
  await storage.writeRuleSettings({ depclean: false });
  expect(mock.data.depclean).toBe(false);
  expect(await storage.readRules()).toEqual(rules);
});
