import { getActiveTab } from "../browser/api";
import { setIconBadge } from "./badge";
import { initializeContextMenus, updateContextMenus } from "./contextmenu";
import { getDomainsByLevelWithoutPublicSuffix } from "../operations/misc";
import { type SettingType, getSetting, getChangedSettingKeys } from "../settings/setting";

export const createBackgroundReflection = ({ isOperationRunning }: { isOperationRunning: () => boolean }) => {
let menuUpdateDeferred = false;

let iconBadgeWorker: Promise<void> | undefined;
let iconBadgeRevision = 0;
const updateIconBadge = (): Promise<void> => {
  // runOperation applies the final state when it finishes.
  if (isOperationRunning()) return Promise.resolve();
  iconBadgeRevision++;
  iconBadgeWorker ??= (async () => {
    try {
      let completedRevision = 0;
      while (completedRevision !== iconBadgeRevision) {
        const revision = iconBadgeRevision;
        try {
          const setting = await getSetting();
          await setIconBadge(setting.iconbadge, setting.iconbadgescope);
        } catch {
          console.error("updateIconBadge", new Error("Badge update failed"));
        }
        completedRevision = revision;
      }
    } finally {
      iconBadgeWorker = undefined;
    }
  })();
  return iconBadgeWorker;
};

let menuUpdateRevision = 0;
let menuUpdateWorker: Promise<void> | undefined;
let menuReinitializing = false;
let menuSettingsReady = true;
let publishedMenuSettings: SettingType | undefined;
let settingsReflectionWorker: Promise<void> | undefined;
const MENU_RETRY_MS = 10000;
let lastMenuRetry = 0;
// A failed menu generation is retried on later events instead of staying broken.
const retryMenuInitialization = () => {
  if (menuSettingsReady || menuReinitializing || Date.now() - lastMenuRetry < MENU_RETRY_MS) return;
  lastMenuRetry = Date.now();
  void reflectSettings(true, false);
};
const updateFlushContextMenus = (): Promise<void> => {
  retryMenuInitialization();
  if (isOperationRunning()) {
    menuUpdateDeferred = true;
    return Promise.resolve();
  }
  menuUpdateRevision++;
  if (menuReinitializing) return settingsReflectionWorker ?? Promise.resolve();
  menuUpdateWorker ??= (async () => {
    try {
      let completedRevision = 0;
      while (completedRevision !== menuUpdateRevision) {
        const revision = menuUpdateRevision;
        let domains: string[] = [];
        try {
          const tab = await getActiveTab();
          domains = tab && !tab.pinned ? getDomainsByLevelWithoutPublicSuffix(tab.url) : [];
        } catch (error) {
          console.log("updateFlushContextMenus", error);
        }
        if (revision !== menuUpdateRevision) continue;
        await updateContextMenus(domains);
        completedRevision = revision;
      }
    } finally {
      menuUpdateWorker = undefined;
    }
  })();
  return menuUpdateWorker;
};

const menuSettingKeys = new Set([
  "contextmenu1", "contextmenu1scope", "contextmenu1advanced", "contextmenu2",
  "contextmenu3", "contextmenu4", "contextmenu4scope", "contextmenu4advanced",
]);
let pendingMenuReflection = false;
let pendingBadgeReflection = false;
const reflectSettings = (menus: boolean, badge: boolean): Promise<void> => {
  pendingMenuReflection ||= menus;
  pendingBadgeReflection ||= badge;
  settingsReflectionWorker ??= (async () => {
    try {
      while (pendingMenuReflection || pendingBadgeReflection) {
        const updateMenus = pendingMenuReflection;
        const updateBadge = pendingBadgeReflection;
        pendingMenuReflection = false;
        pendingBadgeReflection = false;
        if (updateMenus) {
          menuReinitializing = true;
          menuSettingsReady = false;
          try {
            // Wait for T07's published rows before recreating their IDs.
            await menuUpdateWorker;
            const setting = await getSetting();
            if (await initializeContextMenus(setting)) {
              publishedMenuSettings = setting;
              menuSettingsReady = true;
            } else {
              lastMenuRetry = Date.now();
            }
          } finally {
            menuReinitializing = false;
          }
          await updateFlushContextMenus();
        }
        if (updateBadge) {
          await iconBadgeWorker;
          await updateIconBadge();
        }
      }
    } catch (error) {
      console.error("settings reflection", error);
    } finally {
      menuReinitializing = false;
      settingsReflectionWorker = undefined;
    }
  })();
  return settingsReflectionWorker;
};

const onOperationSettled = async () => {
    const menus = menuUpdateDeferred;
    menuUpdateDeferred = false;
    await Promise.all([updateIconBadge(), menus ? updateFlushContextMenus() : undefined]);
  };

const onSettingsChanged = (changes: Parameters<typeof getChangedSettingKeys>[0], area: Parameters<typeof getChangedSettingKeys>[1]) => {
  const keys = getChangedSettingKeys(changes, area);
  const menus = (area === "local" && "saved_workflows_v1" in changes) || keys.some(key => menuSettingKeys.has(key));
  const badge = keys.some(key => key === "iconbadge" || key === "iconbadgescope");
  if (menus || badge) return reflectSettings(menus, badge);
  return undefined;
};

return { updateIconBadge, updateFlushContextMenus, reflectSettings, onOperationSettled, onSettingsChanged, retryMenuInitialization,
  isMenuReady: () => !menuReinitializing && menuSettingsReady,
  getMenuSnapshot: () => publishedMenuSettings,
};
};
