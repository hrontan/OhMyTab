import { sendRuntimeMessage } from "../browser/message-transport";
import { myBrowser } from "../browser/browser-api";

export const message = (key: string): string => myBrowser.i18n.getMessage(key);
export const setText = (selector: string, value: string): void => {
  const element = document.querySelector(selector);
  if (element) element.textContent = value;
};
export const initializePageText = (titleKey: string): void => {
  const locale = message("optionsLanguage");
  document.documentElement.lang = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(locale) ? locale : "en";
  document.querySelectorAll<HTMLElement>("[data-message]").forEach(element => { element.textContent = message(element.dataset.message!); });
  document.title = message(titleKey);
};
export const sendPageRequest = (request: object, unavailableMessage: string): Promise<unknown> =>
  sendRuntimeMessage(request, error => error.message || unavailableMessage);
