import { getSetting } from "../settings/setting";
import { myBrowser } from "../browser/browser-api";
import { initializeWorkflows } from "./options-workflows";
import { createOptionsForm } from "./options-form";
import { createOptionsSaveController } from "./options-save";
import { createOptionsTransferController } from "./options-transfer";

const view = createOptionsForm({ isSaving: () => save.isSaving() });
const save = createOptionsSaveController(view);
const transfer = createOptionsTransferController(save);

document.addEventListener("DOMContentLoaded", async () => {
  view.localizeHtmlPage();
  myBrowser.storage.onChanged.addListener(save.reflectExternalSetting);
  await save.restoreSetting();
  await transfer.reflectRuleStorage().catch(() => {});
  await transfer.reflectImportRecovery().catch(() => {});
  transfer.transferElement<HTMLTextAreaElement>("settings_json")?.addEventListener("input", event => { event.stopPropagation(); transfer.clearImportReview(); });
  transfer.transferElement<HTMLTextAreaElement>("settings_json")?.addEventListener("change", event => event.stopPropagation());
  transfer.transferElement<HTMLButtonElement>("settings_export")?.addEventListener("click", () => { void transfer.exportSettings(); });
  transfer.transferElement<HTMLButtonElement>("settings_import_review_button")?.addEventListener("click", () => { void transfer.reviewSettingsImport(); });
  transfer.transferElement<HTMLButtonElement>("settings_import_confirm")?.addEventListener("click", () => { void transfer.confirmSettingsImport(); });
  transfer.transferElement<HTMLButtonElement>("settings_import_cancel")?.addEventListener("click", transfer.cancelSettingsImport);
  transfer.transferElement<HTMLButtonElement>("settings_import_recover")?.addEventListener("click", transfer.recoverSettingsImport);
  document.querySelector("#rule_storage")?.addEventListener("change", event => {
    event.stopPropagation();
    void transfer.changeRuleStorage();
  });
  document.querySelector("#rule_storage_cleanup")?.addEventListener("click", () => { void transfer.changeRuleStorage(true); });
  myBrowser.storage.onChanged.addListener(transfer.onStorageChanged);
  const form = document.querySelector("form");
  if (form != null) {
    form.addEventListener("input", () => { save.captureDraft(false); });
    form.addEventListener("change", save.saveSetting);
  }

  const reflectAdvancedNotice = () => {
    const notice = document.querySelector<HTMLElement>("#urlmatch_enabled_notice");
    const enabled = document.querySelector<HTMLInputElement>("#urlmatch");
    if (notice && enabled) notice.hidden = !enabled.checked;
  };
  reflectAdvancedNotice();
  document.querySelector("#urlmatch")?.addEventListener("change", reflectAdvancedNotice);
  myBrowser.storage.onChanged.addListener(() => {
    void getSetting().then(setting => {
      const notice = document.querySelector<HTMLElement>("#urlmatch_enabled_notice");
      if (notice) notice.hidden = !setting.urlmatch;
    }).catch(() => {});
  });
  view.restoreBrowserAvailability();
  await initializeWorkflows();
});
