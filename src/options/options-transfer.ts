import { parseSettingsJSON, exportSettingsJSON, importSettings, recoverImport } from "../settings/settings-transfer";
import { hasPendingImport } from "../settings/settings-import-recovery";
import { getRuleStorageStatus, switchRuleStorage, removeSyncRules } from "../settings/rule-storage";
import { myBrowser } from "../browser/browser-api";
import { type SettingType, defaultSetting, getSetting, type SettingKey } from "../settings/setting";
import type { createOptionsSaveController } from "./options-save";

export const createOptionsTransferController = (save: ReturnType<typeof createOptionsSaveController>) => {
let storageBusy = false;
async function reflectRuleStorage() {
  const select = document.querySelector<HTMLSelectElement>("#rule_storage");
  const status = document.querySelector<HTMLElement>("#rule_storage_status");
  const cleanup = document.querySelector<HTMLButtonElement>("#rule_storage_cleanup");
  if (!select || !status || !cleanup) return;
  const current = await getRuleStorageStatus();
  select.value = current.mode;
  select.disabled = storageBusy || !globalThis.navigator?.locks;
  cleanup.hidden = !current.syncResidual;
  cleanup.disabled = storageBusy;
  status.textContent = myBrowser.i18n.getMessage(!globalThis.navigator?.locks ? "ruleStorageUnavailable" : current.syncResidual ? "ruleStorageResidual" : current.mode === "local" ? "ruleStorageLocalReady" : "ruleStorageSyncReady");
}
async function changeRuleStorage(removeOnly = false) {
  if (storageBusy || transferBusy) return;
  const select = document.querySelector<HTMLSelectElement>("#rule_storage");
  const status = document.querySelector<HTMLElement>("#rule_storage_status");
  if (!select || !status) return;
  const requested = select.value === "local" ? "local" : "sync";
  storageBusy = true;
  select.disabled = true;
  status.setAttribute("aria-busy", "true");
  status.textContent = myBrowser.i18n.getMessage("ruleStorageMoving");
  try {
    save.captureDraft(false);
    const worker = save.awaitSettled();
    if (worker) await worker;
    if (save.hasDirty()) await save.saveSetting();
    if (save.hasDirty()) throw new Error(myBrowser.i18n.getMessage("ruleStorageDraftPending"));
    if (removeOnly) await removeSyncRules();
    else await switchRuleStorage(requested);
  } catch (error) {
    await reflectRuleStorage().catch(() => {});
    status.textContent = myBrowser.i18n.getMessage("ruleStorageFailed") + " " + (error instanceof Error ? error.message : String(error));
    status.setAttribute("role", "alert");
    return;
  } finally {
    storageBusy = false;
    select.disabled = !globalThis.navigator?.locks;
    status.setAttribute("aria-busy", "false");
  }
  status.setAttribute("role", "status");
  await reflectRuleStorage();
}

let transferBusy = false;
let reviewedImport: { values: SettingType; before: SettingType; text: string; revision: number; external: number; mode: string } | undefined;
const transferElement = <T extends HTMLElement>(id: string) => document.querySelector<T>("#" + id);
function transferStatus(key: string, error?: unknown) {
  const status = transferElement<HTMLElement>("settings_transfer_status");
  if (!status) return;
  status.setAttribute("role", error ? "alert" : "status");
  status.setAttribute("aria-busy", String(transferBusy));
  status.textContent = myBrowser.i18n.getMessage(key) + (error ? " " + (error instanceof Error ? error.message : String(error)) : "");
}
function clearImportReview() {
  reviewedImport = undefined;
  const panel = transferElement<HTMLElement>("settings_import_review");
  if (panel) panel.hidden = true;
}
async function reflectImportRecovery() {
  const button = transferElement<HTMLButtonElement>("settings_import_recover");
  if (!button) return;
  button.hidden = !await hasPendingImport();
  button.disabled = transferBusy;
  if (!button.hidden) transferStatus("settingsImportRecovery");
}
async function transferReady(ownBusy = false) {
  if (storageBusy || transferBusy && !ownBusy) throw new Error(myBrowser.i18n.getMessage("settingsTransferBusy"));
  const worker = save.awaitSettled();
    if (worker) await worker;
  save.captureDraft(false);
  if (save.hasDirty()) throw new Error(myBrowser.i18n.getMessage("settingsTransferDraft"));
  if (await hasPendingImport()) throw new Error(myBrowser.i18n.getMessage("settingsImportRecovery"));
}
async function exportSettings() {
  try {
    await transferReady();
    const input = transferElement<HTMLTextAreaElement>("settings_json");
    if (!input) return;
    input.value = await exportSettingsJSON();
    clearImportReview();
    transferStatus("settingsExportReady");
  } catch (error) { transferStatus("settingsTransferFailed", error); }
}
async function reviewSettingsImport() {
  clearImportReview();
  try {
    await transferReady();
    const input = transferElement<HTMLTextAreaElement>("settings_json");
    const panel = transferElement<HTMLElement>("settings_import_review");
    const content = transferElement<HTMLElement>("settings_import_content");
    if (!input || !panel || !content) return;
    const values = parseSettingsJSON(input.value);
    const before = await getSetting();
    const mode = (await getRuleStorageStatus()).mode;
    reviewedImport = { values, before, text: input.value, revision: save.getRevisionSnapshot().inputRevision, external: save.getRevisionSnapshot().externalRevision, mode };
    content.replaceChildren();
    for (const key of Object.keys(defaultSetting) as SettingKey[]) {
      const term = document.createElement("dt"), description = document.createElement("dd");
      const control = document.querySelector<HTMLElement>("#" + key);
      term.textContent = control?.getAttribute("aria-label") || document.querySelector<HTMLLabelElement>('label[for="' + key + '"]')?.textContent || key;
      description.textContent = JSON.stringify(before[key]) + " → " + JSON.stringify(values[key]);
      content.appendChild(term); content.appendChild(description);
    }
    panel.hidden = false;
    transferStatus("settingsImportReviewReady");
  } catch (error) { transferStatus("settingsTransferFailed", error); }
}
async function confirmSettingsImport() {
  if (transferBusy || storageBusy) return;
  transferBusy = true;
  const reviewed = reviewedImport;
  try {
    await transferReady(true);
    if (!reviewed || transferElement<HTMLTextAreaElement>("settings_json")?.value !== reviewed.text ||
        reviewed.revision !== save.getRevisionSnapshot().inputRevision || reviewed.external !== save.getRevisionSnapshot().externalRevision ||
        (await getRuleStorageStatus()).mode !== reviewed.mode) throw new Error(myBrowser.i18n.getMessage("settingsImportStale"));
    transferBusy = true;
    transferStatus("settingsImportApplying");
    await importSettings(reviewed.values, reviewed.before);
    clearImportReview();
    await save.restoreSetting();
    transferStatus("settingsImportDone");
  } catch (error) { clearImportReview(); transferStatus("settingsTransferFailed", error); }
  finally {
    transferBusy = false;
    transferElement<HTMLElement>("settings_transfer_status")?.setAttribute("aria-busy", "false");
    await reflectImportRecovery().catch(() => {});
  }
}

const cancelSettingsImport = () => { if (!transferBusy) { clearImportReview(); transferStatus("settingsImportCancelled"); } };
const recoverSettingsImport = async () => {
    if (transferBusy) return;
    transferBusy = true;
    try { await recoverImport(); await save.restoreSetting(); transferStatus("settingsImportRecovered"); }
    catch (error) { transferStatus("settingsTransferFailed", error); }
    finally { transferBusy = false; transferElement<HTMLElement>("settings_transfer_status")?.setAttribute("aria-busy", "false"); await reflectImportRecovery().catch(() => {}); }
};
const onStorageChanged = () => { if (!storageBusy) void reflectRuleStorage().catch(() => {}); };
return { transferElement, reflectRuleStorage, changeRuleStorage, clearImportReview, reflectImportRecovery, exportSettings, reviewSettingsImport, confirmSettingsImport, cancelSettingsImport, recoverSettingsImport, onStorageChanged };
};
