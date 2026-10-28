import { myBrowser } from "../browser/browser-api";
import { compileURLRules } from "../rules/url-rules";
import { parseProtectedDomains } from "../operations/tab-protection";
import { type SettingType, defaultSetting, fixSetting, getSetting, setSetting, getChangedSettingKeys, type SettingKey } from "../settings/setting";
import type { createOptionsForm } from "./options-form";

export const createOptionsSaveController = (view: ReturnType<typeof createOptionsForm>) => {
const { getVal, getSettingFromInput, setVal, updateInputAvailability, restoreSettingToInput, showStatus, showFailure } = view;
let observedInput: SettingType = { ...defaultSetting };
let savedSetting: SettingType = { ...defaultSetting };
let inputRevision = 0;
let externalRevision = 0;
const dirtyVersions = new Map<SettingKey, number>();
type SaveRequest = { revision: number; draft: SettingType; versions: Map<SettingKey, number> };
let pendingSave: SaveRequest | undefined;
let saveWorker: Promise<void> | undefined;
let inFlightValues: Partial<SettingType> | undefined;

const drainSaves = async () => {
  try {
    while (pendingSave) {
      const request = pendingSave;
      pendingSave = undefined;
      try {
        const stored = await getSetting();
        const keys = [...request.versions.keys()].filter(key => dirtyVersions.has(key));
        const values = Object.fromEntries(keys.map(key => [key, request.draft[key]]));
        const fixedSetting = fixSetting({ ...stored, ...values });
        parseProtectedDomains(fixedSetting.protect_domains);
        if (fixedSetting.urlmatch) compileURLRules(fixedSetting.urlmatch_pattern);
        const acknowledged = new Set(keys);
        if (acknowledged.has("glue") && fixedSetting.glue) acknowledged.add("currentonly");
        inFlightValues = Object.fromEntries([...acknowledged].map(key => [key, fixedSetting[key]]));
        if (keys.length) await setSetting(fixedSetting, keys);
        savedSetting = fixSetting({ ...savedSetting, ...inFlightValues });
        for (const key of keys) {
          if (dirtyVersions.get(key) === request.versions.get(key)) dirtyVersions.delete(key);
        }
        if (request.revision === inputRevision && dirtyVersions.size === 0) {
          // Confirm only this request's fields, never replace the whole form.
          const confirmed = new Set([...request.versions.keys(), ...acknowledged]);
          if (confirmed.has("glue") && fixedSetting.glue) confirmed.add("currentonly");
          for (const key of confirmed) setVal(key, fixedSetting[key]);
          observedInput = getSettingFromInput();
          updateInputAvailability(observedInput);
          showStatus(myBrowser.i18n.getMessage("settingsSaved"), undefined, "saved");
        }
      } catch (error) {
        if (!pendingSave && request.revision === inputRevision) {
          showFailure("settingsSaveFailed", error, saveSetting);
        }
      } finally {
        inFlightValues = undefined;
      }
    }
  } finally {
    saveWorker = undefined;
    if (view.getStatusState() === "saving" && dirtyVersions.size) {
      showStatus(myBrowser.i18n.getMessage("settingsUnsaved"), undefined, "unsaved");
    }
  }
};

const captureDraft = (saveRequested: boolean): SettingType => {
  const draft = getSettingFromInput();
  const changed = (Object.keys(defaultSetting) as SettingKey[])
    .filter(key => !Object.is(getVal(key), observedInput[key]));
  if (saveRequested || changed.length) inputRevision++;
  for (const key of changed) dirtyVersions.set(key, inputRevision);
  // Normalization couples these fields. Own and acknowledge the local pair,
  // including its unchanged half, until this version is successfully saved.
  if (changed.includes("glue") || changed.includes("currentonly")) {
    dirtyVersions.set("glue", inputRevision);
    dirtyVersions.set("currentonly", inputRevision);
  }
  observedInput = draft;
  return draft;
};

const saveSetting = (): Promise<void> => {
  const draft = captureDraft(true);
  showStatus(myBrowser.i18n.getMessage("settingsSaving"), undefined, "saving");
  pendingSave = { revision: inputRevision, draft, versions: new Map(dirtyVersions) };
  saveWorker ??= drainSaves();
  return saveWorker;
};

const reflectExternalSetting = async (
  changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, area: string
) => {
  const keys = getChangedSettingKeys(changes, area);
  if (!keys.length) return;
  if (keys.every(key => inFlightValues && Object.is(changes[key]?.newValue, inFlightValues[key]))) return;
  const revision = ++externalRevision;
  try {
    const setting = await getSetting();
    if (revision !== externalRevision) return;
    savedSetting = setting;
    const conflict = keys.some(key => dirtyVersions.has(key) &&
      !Object.is(setting[key], observedInput[key]));
    for (const key of Object.keys(defaultSetting) as SettingKey[]) {
      if (!dirtyVersions.has(key)) setVal(key, setting[key]);
    }
    observedInput = getSettingFromInput();
    updateInputAvailability(observedInput);
    showStatus(myBrowser.i18n.getMessage(conflict ? "settingsExternalConflict" : "settingsExternalChanged"));
  } catch (error) {
    showFailure("settingsLoadFailed", error, restoreSetting);
  }
};

const restoreSetting = async () => {
  let fixedSetting: SettingType;
  try {
    let revision: number;
    do {
      revision = externalRevision;
      fixedSetting = await getSetting();
    } while (revision !== externalRevision);
  } catch (error) {
    showFailure("settingsLoadFailed", error, restoreSetting);
    return;
  }
  savedSetting = fixedSetting;
  if (dirtyVersions.size) {
    for (const key of Object.keys(defaultSetting) as SettingKey[]) {
      if (!dirtyVersions.has(key)) setVal(key, fixedSetting[key]);
    }
    updateInputAvailability(getSettingFromInput());
  } else {
    restoreSettingToInput(fixedSetting);
  }
  observedInput = getSettingFromInput();
  try {
    parseProtectedDomains(fixedSetting.protect_domains);
    if (fixedSetting.urlmatch) compileURLRules(fixedSetting.urlmatch_pattern);
    showStatus("");
  } catch (error) {
    showFailure("settingsSaveFailed", error, saveSetting);
  }
};

return { captureDraft, saveSetting, reflectExternalSetting, restoreSetting,
  awaitSettled: () => saveWorker,
  isSaving: () => saveWorker != null,
  hasDirty: () => dirtyVersions.size > 0,
  getRevisionSnapshot: () => ({ inputRevision, externalRevision }),
};
};
