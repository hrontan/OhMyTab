import { getStorage, setStorage, type ScopeType } from "./api";

export type SortKeyType = "url" | "title";

export type SettingType = {
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
};

export const defaultSetting: SettingType = {
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
};

export const getSetting = () => getStorage(defaultSetting);

export const setSetting = (setting: SettingType) => setStorage(setting);

export const constructSetting = (
  getter: <T extends keyof SettingType>(
    propertyName: T
  ) => SettingType[T] | undefined
): SettingType => {
  return Object.fromEntries(
    Object.entries(defaultSetting).map(([key, init_value]) => {
      return [key, getter(key as keyof SettingType) ?? init_value];
    })
  ) as SettingType;
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
  if (setting.glue) setting.currentonly = false;
  return setting;
};
