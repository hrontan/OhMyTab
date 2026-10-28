import { readRules, writeRuleSettings } from "./rule-storage";
import { ruleStorageKey } from "./rule-storage-state";
import { readImportObservation, importSnapshotKey } from "./settings-import-recovery";
import { getStorage, type ScopeType } from "../browser/browser-api";

export type SortKeyType = "url" | "title";

export type SettingType = {
  preview_before: boolean;
  glue: boolean;
  depclean: boolean;
  sorttab: boolean;
  sortkey: SortKeyType;
  refresh: boolean;
  comclose: boolean;
  iconbadge: boolean;
  iconbadgescope: ScopeType;
  rxclose: boolean;
  currentonly: boolean;
  contextmenu1: boolean;
  contextmenu1scope: ScopeType;
  contextmenu1advanced: boolean;
  contextmenu2: boolean;
  contextmenu3: boolean;
  contextmenu4: boolean;
  contextmenu4scope: ScopeType;
  contextmenu4advanced: boolean;
  closelocal: boolean;
  grouping: boolean;
  grouping_min: number;
  urlmatch: boolean;
  urlmatch_pattern: string;
  protect_domains: string;
  protect_audible: boolean;
  protect_groups: boolean;
  duplicate_keep: "last" | "active";
};

export const defaultSetting: SettingType = {
  preview_before: false,
  glue: true,
  depclean: true,
  sorttab: true,
  sortkey: "url",
  refresh: true,
  comclose: false,
  iconbadge: false,
  iconbadgescope: "all",
  rxclose: false,
  currentonly: false,
  contextmenu1: false,
  contextmenu1scope: "win",
  contextmenu1advanced: false,
  contextmenu2: false,
  contextmenu3: true,
  contextmenu4: false,
  contextmenu4scope: "win",
  contextmenu4advanced: false,
  closelocal: false,
  grouping: false,
  grouping_min: 4,
  urlmatch: false,
  urlmatch_pattern: "",
  protect_domains: "",
  protect_audible: false,
  protect_groups: false,
  duplicate_keep: "last",
};

export const normalizeSetting = (input: unknown): SettingType => {
  const source = input !== null && typeof input === "object"
    ? input as Record<string, unknown>
    : {};
  const result = Object.fromEntries(
    Object.entries(defaultSetting).map(([key, fallback]) => {
      const value = source[key];
      let valid = typeof value === typeof fallback;
      if (key === "duplicate_keep") valid = value === "last" || value === "active";
      if (key === "sortkey") valid = value === "url" || value === "title";
      if (key === "iconbadgescope" || key === "contextmenu1scope" || key === "contextmenu4scope") {
        valid = value === "win" || value === "all";
      }
      if (key === "grouping_min") {
        valid = typeof value === "number" && Number.isFinite(value) &&
          Number.isInteger(value) && value >= 2 && value <= 10;
      }
      return [key, valid ? value : fallback];
    })
  ) as SettingType;
  if (result.glue) result.currentonly = false;
  /// #if BROWSER === "firefox"
  // Shared storage may contain a Chrome preference; Firefox never enables it.
  result.grouping = false;
  /// #endif
  return result;
};

export const getSetting = async () => {
  for (;;) {
    const first = await readImportObservation();
    if (first.pending) return normalizeSetting(first.pending.before);
    const current = { ...await getStorage(defaultSetting), ...await readRules() };
    const last = await readImportObservation();
    if (last.pending) return normalizeSetting(last.pending.before);
    if (first.epoch === last.epoch) return normalizeSetting(current);
  }
};

export type SettingKey = keyof SettingType;
export const getChangedSettingKeys = (
  changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
  area: string
): SettingKey[] => area === "sync"
  ? Object.keys(defaultSetting).filter(key => changes[key] &&
    !Object.is(changes[key].oldValue, changes[key].newValue)) as SettingKey[]
  : area === "local" && changes[importSnapshotKey] ? Object.keys(defaultSetting) as SettingKey[]
  : area === "local" && changes[ruleStorageKey] ? ["urlmatch", "urlmatch_pattern"] : [];

export const setSetting = (setting: SettingType, keys?: SettingKey[]) => {
  const normalized = normalizeSetting(setting);
  const selected = new Set(keys ?? Object.keys(normalized) as SettingKey[]);
  /// #if BROWSER === "firefox"
  // Do not overwrite the Chrome preference while saving unrelated Firefox fields.
  selected.delete("grouping");
  selected.delete("grouping_min");
  /// #endif
  if (!selected.size) return Promise.resolve();
  if (selected.has("glue") && normalized.glue) selected.add("currentonly");
  return writeRuleSettings(Object.fromEntries([...selected].map(key => [key, normalized[key]])));
};

export const constructSetting = (
  getter: <T extends keyof SettingType>(
    propertyName: T
  ) => SettingType[T] | undefined
): SettingType => {
  return normalizeSetting(Object.fromEntries(
    Object.entries(defaultSetting).map(([key, init_value]) => {
      return [key, getter(key as keyof SettingType) ?? init_value];
    })
  ));
};

export const applySetting = (
  setting: SettingType,
  evalFunc: <T extends keyof SettingType>(
    propertyName: T,
    value: SettingType[T]
  ) => void
) => {
  Object.entries(setting).forEach(([key, value]) => {
    evalFunc(key as keyof SettingType, value);
  });
};

export const fixSetting = (setting: SettingType): SettingType => {
  return normalizeSetting(setting);
};
