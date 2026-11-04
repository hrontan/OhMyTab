import { afterEach, beforeEach, expect, test, vi } from "vitest";

class Element {
  value = ""; hidden = true; textContent = ""; disabled = false; children: Element[] = []; attributes: Record<string, string> = {};
  setAttribute(key: string, value: string) { this.attributes[key] = value; }
  getAttribute(key: string) { return this.attributes[key] ?? null; }
  replaceChildren() { this.children = []; }
  appendChild(child: Element) { this.children.push(child); return child; }
}
const flush = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };
let nodes: Record<string, Element>;
let importSettings: ReturnType<typeof vi.fn>;
let readSetting: () => Promise<Record<string, unknown>>;
let pending = false;
let ruleStatus: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.resetModules();
  nodes = Object.fromEntries(["settings_json", "settings_import_review", "settings_import_content", "settings_transfer_status", "settings_import_recover"].map(id => [id, new Element()]));
  vi.stubGlobal("document", { querySelector: (selector: string) => nodes[selector.slice(1)] ?? null, createElement: () => new Element() });
  importSettings = vi.fn(async () => {});
  readSetting = async () => ({ protect_audible: false });
  vi.doMock("../../src/browser/browser-api", () => ({ myBrowser: { i18n: { getMessage: (key: string) => key } } }));
  vi.doMock("../../src/settings/settings-transfer", () => ({
    parseSettingsJSON: (text: string) => JSON.parse(text), exportSettingsJSON: vi.fn(), importSettings, recoverImport: vi.fn(),
  }));
  pending = false;
  vi.doMock("../../src/settings/settings-import-recovery", () => ({ hasPendingImport: async () => pending, importSnapshotKey: "ohmytab_settings_import_v1" }));
  ruleStatus = vi.fn(async () => ({ mode: "local" }));
  vi.doMock("../../src/settings/rule-storage", () => ({ getRuleStorageStatus: ruleStatus, switchRuleStorage: vi.fn(), removeSyncRules: vi.fn() }));
  vi.doMock("../../src/settings/setting", () => ({ defaultSetting: { protect_audible: false }, getSetting: () => readSetting() }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.doUnmock("../../src/browser/browser-api"); vi.doUnmock("../../src/settings/settings-transfer");
  vi.doUnmock("../../src/settings/settings-import-recovery"); vi.doUnmock("../../src/settings/rule-storage"); vi.doUnmock("../../src/settings/setting"); });
async function controller() {
  const { createOptionsTransferController } = await import("../../src/options/options-transfer.ts");
  const save = { awaitSettled: () => undefined, captureDraft: () => {}, hasDirty: () => false, getRevisionSnapshot: () => ({ inputRevision: 0, externalRevision: 0 }), restoreSetting: async () => {} };
  return createOptionsTransferController(save as never);
}

test("replacing the JSON while a review reads settings retires that review", async () => {
  const transfer = await controller();
  let release!: () => void;
  readSetting = () => new Promise(resolve => { release = () => resolve({ protect_audible: false }); });
  nodes.settings_json!.value = JSON.stringify({ protect_audible: false });
  const review = transfer.reviewSettingsImport(); await flush();
  nodes.settings_json!.value = JSON.stringify({ protect_audible: true }); transfer.clearImportReview();
  readSetting = async () => ({ protect_audible: false }); release(); await review;
  expect(nodes.settings_import_review!.hidden).toBe(true);
  await transfer.confirmSettingsImport();
  expect(importSettings).not.toHaveBeenCalled();
});

test("a confirmed import carries the reviewed rule storage mode", async () => {
  const transfer = await controller();
  nodes.settings_json!.value = JSON.stringify({ protect_audible: true });
  await transfer.reviewSettingsImport(); expect(nodes.settings_import_review!.hidden).toBe(false);
  await transfer.confirmSettingsImport();
  expect(importSettings).toHaveBeenCalledWith({ protect_audible: true }, { protect_audible: false }, "local");
});

test("recovery started or finished in another options page updates the recovery button", async () => {
  const transfer = await controller(); const recover = nodes.settings_import_recover!;
  pending = true; transfer.onStorageChanged({ ohmytab_settings_import_v1: { newValue: {} } }, "local"); await flush();
  expect(recover.hidden).toBe(false);
  pending = false; transfer.onStorageChanged({ ohmytab_settings_import_v1: { newValue: {} } }, "local"); await flush();
  expect(recover.hidden).toBe(true);
});

test("only rule-storage keys refresh the rule-storage status", async () => {
  const transfer = await controller();
  Object.assign(nodes, { rule_storage: new Element(), rule_storage_status: new Element(), rule_storage_cleanup: new Element() });
  transfer.onStorageChanged({ ohmytabBadge: { newValue: {} } }, "session");
  transfer.onStorageChanged({ glue: { newValue: true } }, "sync");
  transfer.onStorageChanged({ saved_workflows_v1: { newValue: {} } }, "local");
  await flush();
  expect(ruleStatus).not.toHaveBeenCalled();
  transfer.onStorageChanged({ urlmatch_pattern: { newValue: "x" } }, "sync"); await flush();
  transfer.onStorageChanged({ ohmytab_url_rules_v1: { newValue: {} } }, "local"); await flush();
  expect(ruleStatus).toHaveBeenCalledTimes(2);
});
