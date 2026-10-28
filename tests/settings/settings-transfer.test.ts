import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { installBrowserMock, type BrowserTarget } from "../helpers/browser.ts";
const target = process.env.TEST_BROWSER as BrowserTarget;
let mock: ReturnType<typeof installBrowserMock>;
let ruleStorageKey: string;
let importSnapshotKey: string;
let runtime: { lastError?: { message: string } };
beforeEach(() => {
  vi.resetModules(); mock = installBrowserMock(target); runtime = {};
  Object.assign(mock.api, { runtime });
  let queue = Promise.resolve();
  vi.stubGlobal("navigator", { locks: { request: (_name: string, operation: () => Promise<unknown>) => {
    const next = queue.then(operation); queue = next.then(() => {}, () => {}); return next;
  } } });
});
afterEach(() => vi.unstubAllGlobals());
async function modules() {
  ({ ruleStorageKey } = await import("../../src/settings/rule-storage-state.ts"));
  ({ importSnapshotKey } = await import("../../src/settings/settings-import-recovery.ts"));
  return { transfer: await import("../../src/settings/settings-transfer.ts"), setting: await import("../../src/settings/setting.ts"), storage: await import("../../src/settings/rule-storage.ts") };
}
function reject(callback?: (...args: never[]) => unknown) {
  if (target === "firefox") return Promise.reject(new Error("injected storage failure"));
  runtime.lastError = { message: "injected storage failure" }; callback?.(); delete runtime.lastError; return undefined;
}

function expectOriginalLocal(original: Record<string, unknown>) {
  const marker = mock.localData.ohmytab_settings_import_v1 as Record<string, unknown>;
  expect(marker).toEqual({ version: 1, committed: expect.any(String) });
  expect(Object.keys(marker).sort()).toEqual(["committed", "version"]);
  expect(Object.fromEntries(Object.entries(mock.localData).filter(([key]) => key !== "ohmytab_settings_import_v1"))).toEqual(original);
}

test("versioned round trip exports only known settings, including protection; runtime/history/storage metadata excluded", async () => {
  Object.assign(mock.data, { glue: false, urlmatch: true, urlmatch_pattern: "*secret.test*", protect_domains: "private.test", grouping: true, grouping_min: 7, tabs: [{ url: "https://history.test" }], undo: "runtime", previewToken: "secret", extra: 123 });
  const { transfer, setting } = await modules();
  const output = await transfer.exportSettingsJSON(), parsed = JSON.parse(output);
  expect(Object.keys(parsed)).toEqual(["format", "version", "settings"]);
  expect(Object.keys(parsed.settings).sort()).toEqual(Object.keys(setting.defaultSetting).sort());
  expect(parsed.settings.protect_domains).toBe("private.test");
  expect(parsed.settings.grouping).toBe(true);
  expect(transfer.parseSettingsJSON(output)).toEqual(parsed.settings);
  for (const secret of ["history.test", "previewToken", "storageMode", "undo", "tabs"] ) expect(output).not.toContain(secret);
});

test.each([
  ["old version", (v: Record<string, unknown>) => ({ ...v, version: 0 })],
  ["unknown version", (v: Record<string, unknown>) => ({ ...v, version: 2 })],
  ["wrong format", (v: Record<string, unknown>) => ({ ...v, format: "other" })],
  ["extra root key", (v: Record<string, unknown>) => ({ ...v, state: {} })],
  ["missing root key", (v: Record<string, unknown>) => ({ settings: v.settings })],
  ["unknown setting", (v: Record<string, unknown>) => ({ ...v, settings: { ...(v.settings as object), surprise: true } })],
  ["missing protection", (v: Record<string, unknown>) => { const settings = { ...(v.settings as Record<string, unknown>) }; delete settings.protect_domains; return { ...v, settings }; }],
  ["invalid bool", (v: Record<string, unknown>) => ({ ...v, settings: { ...(v.settings as object), glue: "false" } })],
  ["invalid enum", (v: Record<string, unknown>) => ({ ...v, settings: { ...(v.settings as object), duplicate_keep: "first" } })],
  ["invalid integer", (v: Record<string, unknown>) => ({ ...v, settings: { ...(v.settings as object), grouping_min: 2.5 } })],
  ["conflicting pair", (v: Record<string, unknown>) => ({ ...v, settings: { ...(v.settings as object), glue: true, currentonly: true } })],
  ["broken enabled pattern", (v: Record<string, unknown>) => ({ ...v, settings: { ...(v.settings as object), urlmatch: true, urlmatch_pattern: "[" } })],
  ["invalid protected domain", (v: Record<string, unknown>) => ({ ...v, settings: { ...(v.settings as object), protect_domains: "https://private.test" } })],
] as const)("rejects %s before storage writes", async (_name, change) => {
  const { transfer, setting } = await modules();
  const payload = change({ format: "ohmytab-settings", version: 1, settings: setting.defaultSetting });
  expect(() => transfer.parseSettingsJSON(JSON.stringify(payload))).toThrow();
  expect(mock.api.storage.sync.set).not.toHaveBeenCalled(); expect(mock.api.storage.local.set).not.toHaveBeenCalled();
});

test.each(["{broken", "null", "[]", '"string"', '{"format":"ohmytab-settings","version":1,"settings":{"__proto__":{}}}', "x".repeat(65537), "界".repeat(24000)])("rejects corrupt, unknown, prototype and overlarge text", async text => {
  const { transfer } = await modules(); expect(() => transfer.parseSettingsJSON(text)).toThrow();
});

test("sync import commits all supported settings, preserves extra keys and unsupported raw Firefox fields", async () => {
  Object.assign(mock.data, { grouping: true, grouping_min: 7, extra: "keep" });
  const { transfer, setting, storage } = await modules();
  const before = await setting.getSetting();
  const candidate = { ...before, glue: false, protect_domains: "safe.test", protect_audible: true, urlmatch: true, urlmatch_pattern: "*import.test*", grouping: false, grouping_min: 3 };
  await transfer.importSettings(candidate, before);
  expect(await setting.getSetting()).toMatchObject({ ...candidate, grouping: false, grouping_min: target === "firefox" ? 7 : 3 });
  expect(mock.data.extra).toBe("keep");
  expect(mock.localData[importSnapshotKey]).toEqual({ version: 1, committed: expect.any(String) });
  expect(await storage.getRuleStorageStatus()).toEqual({ mode: "sync", syncResidual: false });
  if (target === "firefox") expect(mock.data).toMatchObject({ grouping: true, grouping_min: 7 });
});

test("local import preserves selected mode, exports effective local rule, and leaves sync rules absent", async () => {
  Object.assign(mock.data, { glue: false, urlmatch: true, urlmatch_pattern: "*old.test*", protect_domains: "old.test" });
  const { transfer, setting, storage } = await modules(); await storage.switchRuleStorage("local");
  const before = await setting.getSetting();
  await transfer.importSettings({ ...before, urlmatch_pattern: "*new.test*", protect_domains: "new.test" }, before);
  expect((await storage.getRuleStorageStatus()).mode).toBe("local");
  expect(mock.data.urlmatch_pattern).toBeUndefined();
  expect((await setting.getSetting()).protect_domains).toBe("new.test");
  expect(JSON.parse(await transfer.exportSettingsJSON()).settings.urlmatch_pattern).toBe("*new.test*");
});

test("stale reviewed snapshot refuses before any write", async () => {
  const { transfer, setting } = await modules(); const before = await setting.getSetting();
  mock.data.protect_audible = true;
  await expect(transfer.importSettings({ ...before, protect_domains: "new.test" }, before)).rejects.toThrow("changed");
  expect(mock.api.storage.local.set).not.toHaveBeenCalled(); expect(mock.api.storage.sync.set).not.toHaveBeenCalled();
});

test("sync write failure restores exact original raw settings and removes temporary snapshot", async () => {
  Object.assign(mock.data, { grouping: true, grouping_min: 7, extra: "keep", glue: false });
  const { transfer, setting } = await modules(); const before = await setting.getSetting(), raw = structuredClone(mock.data), local = structuredClone(mock.localData);
  mock.api.storage.sync.set.mockImplementationOnce(((_values: unknown, callback?: () => void) => reject(callback)) as never);
  await expect(transfer.importSettings({ ...before, protect_domains: "new.test" }, before)).rejects.toThrow("injected");
  expect(mock.data).toEqual(raw); expectOriginalLocal(local); expect(await setting.getSetting()).toEqual(before);
});

test("local rule failure after successful sync write rolls both areas back without losing fields", async () => {
  Object.assign(mock.data, { glue: false, urlmatch: true, urlmatch_pattern: "*old.test*", protect_domains: "old.test" });
  const { transfer, setting, storage } = await modules(); await storage.switchRuleStorage("local");
  const before = await setting.getSetting(), raw = structuredClone(mock.data), local = structuredClone(mock.localData);
  const original = mock.api.storage.local.set.getMockImplementation()!; let failed = false;
  mock.api.storage.local.set.mockImplementation(((values: Record<string, unknown>, callback?: () => void) => {
    if (!failed && values[ruleStorageKey]) { failed = true; return reject(callback); }
    return original(values, callback);
  }) as never);
  await expect(transfer.importSettings({ ...before, protect_domains: "new.test", urlmatch_pattern: "*new.test*" }, before)).rejects.toThrow();
  expect(mock.data).toEqual(raw); expectOriginalLocal(local); expect(await setting.getSetting()).toEqual(before);
});

test("rollback failure retains original effective settings across module restart, blocks ordinary saves, and explicit recovery restores raw values", async () => {
  Object.assign(mock.data, { glue: false, urlmatch: true, urlmatch_pattern: "*old.test*", protect_domains: "old.test" });
  let { transfer, setting, storage } = await modules(); await storage.switchRuleStorage("local");
  const before = await setting.getSetting(), raw = structuredClone(mock.data), local = structuredClone(mock.localData);
  const originalLocal = mock.api.storage.local.set.getMockImplementation()!, originalSync = mock.api.storage.sync.set.getMockImplementation()!;
  let failed = false;
  mock.api.storage.local.set.mockImplementation(((values: Record<string, unknown>, callback?: () => void) => {
    if (!failed && values[ruleStorageKey]) { failed = true; return reject(callback); } return originalLocal(values, callback);
  }) as never);
  mock.api.storage.sync.set.mockImplementation(((values: Record<string, unknown>, callback?: () => void) => {
    if (failed) return reject(callback); return originalSync(values, callback);
  }) as never);
  await expect(transfer.importSettings({ ...before, protect_domains: "new.test", urlmatch_pattern: "*new.test*" }, before)).rejects.toThrow("Recovery");
  expect(mock.data.protect_domains).toBe("new.test");
  expect(await setting.getSetting()).toEqual(before);
  expect(await (await import("../../src/settings/settings-import-recovery.ts")).hasPendingImport()).toBe(true);
  await expect(setting.setSetting({ ...before, depclean: false }, ["depclean"])).rejects.toThrow("Recover");
  await expect(storage.switchRuleStorage("sync")).rejects.toThrow("Recover");
  await expect(transfer.exportSettingsJSON()).rejects.toThrow("Recover");
  vi.resetModules(); ({ transfer, setting, storage } = await modules());
  expect(await setting.getSetting()).toEqual(before);
  mock.api.storage.local.set.mockImplementation(originalLocal); mock.api.storage.sync.set.mockImplementation(originalSync);
  await transfer.recoverImport();
  expect(mock.data).toEqual(raw); expectOriginalLocal(local);
  expect(await (await import("../../src/settings/settings-import-recovery.ts")).hasPendingImport()).toBe(false); expect(await setting.getSetting()).toEqual(before);
});

test("concurrent normal save queues behind import and retains its own explicitly changed field", async () => {
  const { transfer, setting } = await modules(); const before = await setting.getSetting();
  await Promise.all([transfer.importSettings({ ...before, protect_domains: "import.test" }, before), setting.setSetting({ ...before, depclean: false }, ["depclean"])]);
  expect(await setting.getSetting()).toMatchObject({ protect_domains: "import.test", depclean: false });
});


test("a reader spanning a complete import cannot combine old settings with new rules", async () => {
  Object.assign(mock.data, { glue: false, urlmatch: true, urlmatch_pattern: "*old.test*", protect_domains: "old.test" });
  const { transfer, setting, storage } = await modules(); await storage.switchRuleStorage("local");
  const before = await setting.getSetting();
  const candidate = { ...before, protect_domains: "new.test", urlmatch_pattern: "*new.test*" };
  mock.api.storage.sync.get.mockImplementationOnce(((defaults: Record<string, unknown>, callback?: (value: Record<string, unknown>) => void) => {
    const captured = { ...defaults, ...mock.data };
    const commit = transfer.importSettings(candidate, before);
    if (target === "chrome") { void commit.then(() => callback?.(captured)); return undefined; }
    return commit.then(() => captured);
  }) as never);
  expect(await setting.getSetting()).toEqual(candidate);
});
