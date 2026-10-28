import { createOperationRuntime } from "../operations/operation-runtime";
import { isWorkflowMenu, previewWorkflowMenu } from "../workflows/workflow-menu";
import { registerWorkflowMessages } from "../workflows/workflow-service";
import { createBackgroundReflection } from "./background-reflection";
import { myBrowser, type TabType } from "../browser/browser-api";
import { canRecoverDetailedMenuTarget, getDetailedMenuTarget } from "./contextmenu";

const reflection = createBackgroundReflection({ isOperationRunning: () => operations.isRunning() });
const operations = createOperationRuntime({
  refreshBadge: reflection.updateIconBadge,
  onSettled: reflection.onOperationSettled,
});
registerWorkflowMessages(operations);

myBrowser.storage.onChanged.addListener(reflection.onSettingsChanged);

/* register event */

// Only these events change tab counts; updates, moves and focus never do.
myBrowser.tabs.onCreated.addListener(() => reflection.updateIconBadge());
myBrowser.tabs.onDetached.addListener(() => reflection.updateIconBadge());
myBrowser.tabs.onAttached.addListener(() => reflection.updateIconBadge());
myBrowser.tabs.onRemoved.addListener(() => reflection.updateIconBadge());
/// #if BROWSER === "chrome"
// A replaced tab gets a new ID without its tab-specific badge.
chrome.tabs.onReplaced.addListener(() => reflection.updateIconBadge());
/// #endif

myBrowser.action.onClicked.addListener(operations.handleAction);

myBrowser.contextMenus.onClicked.addListener(async (info, activeTab) => {
  if (isWorkflowMenu(info.menuItemId)) {
    await previewWorkflowMenu(info.menuItemId, activeTab, operations);
    return;
  }
  if (activeTab == null) return;
  if (!reflection.isMenuReady()) {
    // A row shown under replaced or failed settings must not run.
    reflection.retryMenuInitialization();
    await operations.noticeNotExecuted("menuNotReady", activeTab);
    return;
  }
  const detailedTarget = getDetailedMenuTarget(info.menuItemId);
  const recoverTarget = detailedTarget == null && canRecoverDetailedMenuTarget(info.menuItemId);
  // After an unload the snapshot is gone; the stored settings are then the ones
  // displayed, because any later change wakes the page and recreates the menus.
  const menuSnapshot = reflection.getMenuSnapshot();
  await operations.handleContextMenu(info, activeTab, {
    settingsSnapshot: menuSnapshot, detailedTarget, recoverTarget,
    isReady: reflection.isMenuReady,
  });
});

myBrowser.commands.onCommand.addListener(operations.handleCommand);

myBrowser.tabs.onActivated.addListener(() => reflection.updateFlushContextMenus());
// Loading, title and favicon updates fire constantly; only the shown tab's
// address or pin state changes the domain rows.
myBrowser.tabs.onUpdated.addListener((_tabId: number, change: { url?: string | undefined; pinned?: boolean | undefined }, tab: TabType) => {
  if (tab.active && (change.url !== undefined || change.pinned !== undefined)) return reflection.updateFlushContextMenus();
  return undefined;
});
myBrowser.tabs.onRemoved.addListener(() => reflection.updateFlushContextMenus());
myBrowser.windows.onFocusChanged.addListener(() => reflection.updateFlushContextMenus());

myBrowser.runtime.onInstalled.addListener(() => reflection.reflectSettings(true, false));
// Rebuild menus each browser start instead of relying on menu persistence.
myBrowser.runtime.onStartup.addListener(() => reflection.reflectSettings(true, false));
