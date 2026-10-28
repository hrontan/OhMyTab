import { myBrowser } from "../browser/browser-api";
import { type SettingType, applySetting, constructSetting, defaultSetting } from "../settings/setting";

export const createOptionsForm = ({ isSaving }: { isSaving: () => boolean }) => {
const localizeHtmlPage = () => {
  const obj = document.querySelector("html");
  if (obj == null) return;
  const valStrH = obj.innerHTML.toString();
  const valNewH = valStrH.replace(/__MSG_(\w+)__/g, (_, v1) =>
    v1 ? myBrowser.i18n.getMessage(v1) : ""
  );
  if (valNewH != valStrH) obj.innerHTML = valNewH;
  const locale = myBrowser.i18n.getMessage("optionsLanguage");
  obj.setAttribute("lang", /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(locale) ? locale : "en");
};

const getVal = <T extends keyof SettingType>(key: T): SettingType[T] => {
  const elm = document.querySelector<HTMLInputElement>(`#${key}`);
  if (elm === null) return defaultSetting[key];

  if (typeof defaultSetting[key] === "boolean") {
    return elm.checked as SettingType[T];
  } else if (typeof defaultSetting[key] === "number") {
    return Number(elm.value) as SettingType[T];
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
    key === "protect_domains" ||
    key === "duplicate_keep" ||
    key === "urlmatch_pattern"
  ) {
    elm.value = value;
  }
};

const updateInputAvailability = (setting: SettingType) => {
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

const restoreSettingToInput = (setting: SettingType) => {
  applySetting(setting, setVal);
  updateInputAvailability(setting);
};

type StatusState = "idle" | "info" | "saving" | "saved" | "failed" | "unsaved";
let statusState: StatusState = "idle";
const showStatus = (message: string, retry?: () => Promise<void>, state: StatusState = message ? "info" : "idle") => {
  const status = document.querySelector<HTMLElement>("#status");
  if (!status) return;
  const busy = state === "saving" || (state === "info" && isSaving());
  statusState = busy ? "saving" : state;
  status.replaceChildren();
  status.setAttribute("role", retry ? "alert" : "status");
  status.setAttribute("aria-live", retry ? "assertive" : "polite");
  status.setAttribute("aria-atomic", "true");
  status.setAttribute("aria-busy", busy ? "true" : "false");
  status.setAttribute("data-state", statusState);
  status.textContent = busy && state === "info"
    ? `${message} ${myBrowser.i18n.getMessage("settingsSaving")}` : message;
  if (retry) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = myBrowser.i18n.getMessage("settingsRetry");
    button.addEventListener("click", retry);
    status.appendChild(button);
  }
};

const showFailure = (key: string, error: unknown, retry: () => Promise<void>) => {
  const detail = error instanceof Error ? error.message : String(error);
  showStatus(`${myBrowser.i18n.getMessage(key)} ${detail}`, retry, "failed");
};

const restoreBrowserAvailability = () => {
  let groupingAvailable = true;
  /// #if BROWSER === "firefox"
  groupingAvailable = false;
  /// #endif
  document.querySelectorAll<HTMLElement>(".forChromeInverse").forEach(element => { element.hidden = groupingAvailable; });
  document.querySelectorAll<HTMLElement>(".forChrome").forEach(group => {
    group.hidden = !groupingAvailable;
    group.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input, select").forEach(control => {
      control.disabled = !groupingAvailable;
    });
  });
};

return { localizeHtmlPage, getVal, getSettingFromInput, setVal, updateInputAvailability, restoreSettingToInput, showStatus, showFailure,
  getStatusState: () => statusState, restoreBrowserAvailability };
};
