import { myBrowser, setIconBadge } from "./api";
import { initializeContextMenus } from "./contextmenu";
import {
  type SettingType,
  applySetting,
  constructSetting,
  defaultSetting,
  fixSetting,
  getSetting,
  setSetting,
} from "./setting";

const localizeHtmlPage = () => {
  const obj = document.querySelector("html");
  if (obj == null) return;
  const valStrH = obj.innerHTML.toString();
  const valNewH = valStrH.replace(/__MSG_(\w+)__/g, (_, v1) =>
    v1 ? myBrowser.i18n.getMessage(v1) : ""
  );
  if (valNewH != valStrH) obj.innerHTML = valNewH;
};

const getVal = <T extends keyof SettingType>(key: T): SettingType[T] => {
  const elm = document.querySelector<HTMLInputElement>(`#${key}`);
  if (elm === null) return defaultSetting[key];

  if (typeof defaultSetting[key] === "boolean") {
    return elm.checked as SettingType[T];
  } else if (typeof defaultSetting[key] === "number") {
    return parseInt(elm.value) as SettingType[T];
  } else if (key === "sortkey") {
    return (elm.value === "url" ? "url" : "title") as SettingType[T];
  } else if (
    key === "iconbadgescope" ||
    key === "contextmenu1scope" ||
    key === "contextmenu4scope"
  ) {
    return (elm.value === "win" ? "win" : "all") as SettingType[T];
  } else {
    return elm.value as SettingType[T];
  }
};

const getSettingFromInput = () => constructSetting(getVal);

const setVal = <T extends keyof SettingType>(key: T, value: SettingType[T]) => {
  const elm = document.querySelector<HTMLInputElement>(`#${key}`);
  if (elm === null) return;
  if (typeof value === "boolean") {
    elm.checked = value;
  } else if (typeof value === "number") {
    elm.value = value.toString();
  } else if (
    key === "sortkey" ||
    key === "iconbadgescope" ||
    key === "contextmenu1scope" ||
    key === "contextmenu4scope" ||
    key === "urlmatch_pattern"
  ) {
    elm.value = value;
  }
};

const restoreSettingToInput = (setting: SettingType) => {
  applySetting(setting, setVal);
  const input_currentonly =
    document.querySelector<HTMLInputElement>("#currentonly");
  if (input_currentonly != null) input_currentonly.disabled = setting.glue;
  const input_glue = document.querySelector<HTMLInputElement>("#glue");
  if (input_glue != null) input_glue.disabled = setting.currentonly;
  const input_contextmenu1advanced = document.querySelector<HTMLInputElement>(
    "#contextmenu1advanced"
  );
  const input_urlmatch_pattern =
    document.querySelector<HTMLInputElement>("#urlmatch_pattern");

  if (input_contextmenu1advanced != null) {
    input_contextmenu1advanced.disabled = !setting.contextmenu1;
  }
  const input_contextmenu4advanced = document.querySelector<HTMLInputElement>(
    "#contextmenu4advanced"
  );
  if (input_contextmenu4advanced != null) {
    input_contextmenu4advanced.disabled = !setting.contextmenu4;
  }
  if (input_urlmatch_pattern != null) {
    input_urlmatch_pattern.disabled = !setting.urlmatch;
  }
};

const saveSetting = async () => {
  const fixedSetting = fixSetting(getSettingFromInput());
  await setSetting(fixedSetting);
  restoreSettingToInput(fixedSetting);
  await setIconBadge(fixedSetting.iconbadge, fixedSetting.iconbadgescope);
  await initializeContextMenus();
};

const restoreSetting = async () => {
  const fixedSetting = fixSetting(await getSetting());
  restoreSettingToInput(fixedSetting);
  await setIconBadge(fixedSetting.iconbadge, fixedSetting.iconbadgescope);
};

document.addEventListener("DOMContentLoaded", async () => {
  localizeHtmlPage();
  await restoreSetting();
  const form = document.querySelector("form");
  if (form != null) form.addEventListener("change", saveSetting);

  /// #if BROWSER === "firefox"

  const elmsForChrome = document.querySelectorAll(".forChrome");
  elmsForChrome.forEach((elem) => {
    elem.classList.add("hidden");
  });

  /// #endif
});
