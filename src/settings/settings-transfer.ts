/// #if BROWSER === "firefox"
import { getStorageKeys } from "../browser/browser-api";
/// #endif
import { defaultSetting, getSetting, type SettingType } from "./setting";
import { applySettingsImport, hasPendingImport, recoverSettingsImport } from "./settings-import-recovery";
import { compileURLRules, urlRuleStorageBytes, URL_RULE_LIMITS } from "../rules/url-rules";
import { parseProtectedDomains } from "../operations/tab-protection";

export const SETTINGS_JSON_MAX_BYTES = 65536;
const keys = Object.keys(defaultSetting) as (keyof SettingType)[];
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
function exactKeys(value: Record<string, unknown>, expected: string[]) {
  return Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
}
export function parseSettingsJSON(text: string): SettingType {
  if (text.length > SETTINGS_JSON_MAX_BYTES || new TextEncoder().encode(text).length > SETTINGS_JSON_MAX_BYTES) throw new Error("Settings JSON exceeds 64 KiB");
  const data: unknown = JSON.parse(text);
  if (!object(data) || !exactKeys(data, ["format", "version", "settings"]) || data.format !== "ohmytab-settings" || data.version !== 1 || !object(data.settings)) throw new Error("Unsupported settings format/version");
  const values = data.settings;
  if (!exactKeys(values, keys)) throw new Error("Settings contain unknown or missing keys");
  for (const key of keys) {
    const value = values[key];
    if (typeof value !== typeof defaultSetting[key]) throw new Error("Invalid setting type: " + key);
    if (key === "sortkey" && value !== "url" && value !== "title" ||
        key === "duplicate_keep" && value !== "last" && value !== "active" ||
        ["iconbadgescope", "contextmenu1scope", "contextmenu4scope"].includes(key) && value !== "all" && value !== "win") throw new Error("Invalid setting value: " + key);
    if (key === "grouping_min" && !(typeof value === "number" && Number.isInteger(value) && value >= 2 && value <= 10)) throw new Error("Invalid grouping threshold");
    if (new TextEncoder().encode(JSON.stringify(value)).length + key.length > 8192) throw new Error("Setting exceeds storage item limit: " + key);
  }
  if (values.glue && values.currentonly) throw new Error("Conflicting glue/currentonly settings");
  if (urlRuleStorageBytes(values.urlmatch_pattern as string) > URL_RULE_LIMITS.storageBytes) throw new Error("URL rules exceed storage limit");
  if (values.urlmatch) compileURLRules(values.urlmatch_pattern as string);
  parseProtectedDomains(values.protect_domains as string);
  return Object.fromEntries(keys.map(key => [key, values[key]])) as SettingType;
}

export async function exportSettingsJSON() {
  if (await hasPendingImport()) throw new Error("Recover the interrupted settings import before exporting");
  const values = { ...await getSetting() };
  /// #if BROWSER === "firefox"
  const raw = await getStorageKeys(["grouping", "grouping_min"]);
  if (typeof raw.grouping === "boolean") values.grouping = raw.grouping;
  if (typeof raw.grouping_min === "number" && Number.isInteger(raw.grouping_min) && raw.grouping_min >= 2 && raw.grouping_min <= 10) values.grouping_min = raw.grouping_min;
  /// #endif
  const text = JSON.stringify({ format: "ohmytab-settings", version: 1, settings: values }, null, 2);
  parseSettingsJSON(text);
  return text;
}
export async function importSettings(values: SettingType, reviewedBefore: SettingType) {
  // Revalidate a captured candidate rather than trusting a caller's object.
  const candidate = parseSettingsJSON(JSON.stringify({ format: "ohmytab-settings", version: 1, settings: values }));
  let selected = [...keys];
  /// #if BROWSER === "firefox"
  selected = selected.filter(key => key !== "grouping" && key !== "grouping_min");
  /// #endif
  await applySettingsImport(candidate, reviewedBefore, getSetting, selected);
}
export const recoverImport = () => recoverSettingsImport(keys);
