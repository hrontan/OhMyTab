import { myBrowser, type TabType } from "../browser/browser-api";
import { getTab, getWindows } from "../browser/api";
import { captureTabSession, isSameTabSession } from "../operations/tab-session";
import { WorkflowError, type Origin } from "./workflow-types";
export const workflowContainers = () => {
  let containers = false;
  /// #if BROWSER === "firefox"
  containers = true;
  /// #endif
  return containers;
};
export const internalWorkflowTab = (tab: TabType) => !!tab.url?.startsWith(myBrowser.runtime.getURL(""));
export const workflowOptionsTab = async (tabId: number): Promise<TabType> => {
  const tab = await getTab(tabId), windows = await getWindows();
  if (tab.url !== myBrowser.runtime.getURL("options.html") || !windows.some(window => window.id === tab.windowId && window.type === "normal" && window.incognito === tab.incognito) || typeof tab.incognito !== "boolean" || (workflowContainers() && !("cookieStoreId" in tab && tab.cookieStoreId))) throw new WorkflowError("unavailable");
  return tab;
};
export const workflowOrigin = async (origin: Origin, optionsTabId?: number, expected?: TabType): Promise<TabType> => {
  const tab = await getTab(origin.tabId), windows = await getWindows();
  const window = windows.find(window => window.id === origin.windowId && window.type === "normal");
  if (!window || tab.windowId !== origin.windowId || window.incognito !== tab.incognito || internalWorkflowTab(tab) || typeof tab.incognito !== "boolean") throw new WorkflowError("unavailable");
  const session = captureTabSession(tab, window, workflowContainers());
  if (session.containers && !session.store) throw new WorkflowError("unavailable");
  if (optionsTabId != null) {
    const options = await workflowOptionsTab(optionsTabId);
    if (options.windowId !== origin.windowId || !isSameTabSession(options, session)) throw new WorkflowError("unavailable");
  }
  if (expected && (!isSameTabSession(expected, session) || expected.windowId !== origin.windowId || expected.url !== tab.url)) throw new WorkflowError("stale");
  return tab;
};
