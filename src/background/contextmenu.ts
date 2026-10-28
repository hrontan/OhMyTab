import { myBrowser, type ScopeType } from "../browser/browser-api";
import { getDomainsByLevelWithoutPublicSuffix } from "../operations/misc";
import { readWorkflowStore } from "../workflows/workflow-storage";
import { workflowMenuId } from "../workflows/workflow-menu";
import { getSetting, type SettingType } from "../settings/setting";

type DetailLevel = 0 | 1 | 2 | 3 | 4;
export type ContextMenuItemIdType =
  | "ohmytab_close_tabs"
  | "ohmytab_extract_tabs"
  | "ohmytab_glue_windows"
  | "ohmytab_extract_tab"
  | `ohmytab_${"close" | "extract"}_l${DetailLevel}`;

const detailActions = [
  { action: "close", enabled: "contextmenu1", advanced: "contextmenu1advanced", scope: "contextmenu1scope", label: "text6" },
  { action: "extract", enabled: "contextmenu4", advanced: "contextmenu4advanced", scope: "contextmenu4scope", label: "text7" },
] as const;
const detailDefinitions = detailActions.flatMap(action =>
  Array.from({ length: 5 }, (_, level) => ({
    ...action, level, id: `ohmytab_${action.action}_l${level}` as ContextMenuItemIdType,
  })),
);
type DetailedMenuTarget = { action: "close" | "extract"; scope: ScopeType; domain: string };
const publishedTargets = new Map<string, DetailedMenuTarget>();
const rowsPublished = new Set<string>();
// What each detail row currently shows, so unchanged rows are not updated again.
const rowsShown = new Map<string, { title: string; visible: boolean }>();
export const getDetailedMenuTarget = (id: string | number) => publishedTargets.get(String(id));
// An unloaded event page or service worker loses publishedTargets while its menu
// rows stay displayed. Until this lifetime publishes rows, rebuild the clicked
// row from the tab it was opened on, as drainMenuUpdates would have published it.
export const canRecoverDetailedMenuTarget = (id: string | number) => !rowsPublished.has(String(id));
export const recoverDetailedMenuTarget = (
  id: string | number, setting: SettingType, url: string | undefined,
): DetailedMenuTarget | undefined => {
  const definition = detailDefinitions.find(item => item.id === String(id));
  if (!definition || !setting[definition.enabled] || !setting[definition.advanced]) return undefined;
  const domain = getDomainsByLevelWithoutPublicSuffix(url).slice(0, 5)[definition.level];
  return domain ? { action: definition.action, scope: setting[definition.scope], domain } : undefined;
};

type Menu = { id: string; title: string; visible: boolean };
const scopeLabel = (scope: ScopeType) => myBrowser.i18n.getMessage(scope === "win" ? "text0_0" : "text0_1");
const detailMenus = (setting: SettingType, domains: string[]): Menu[] =>
  detailDefinitions.map(definition => {
    const domain = domains[definition.level];
    return {
      id: definition.id,
      title: myBrowser.i18n.getMessage(definition.label) +
        (domain ? ` [(*.)${domain}]` : " [ ]") + scopeLabel(setting[definition.scope]),
      visible: Boolean(setting[definition.enabled] && setting[definition.advanced] && domain),
    };
  });

// create() returns the ID synchronously and reports failures only through
// runtime.lastError in its callback, even where other menu calls return Promises.
const createMenu = (properties: { parentId?: string; id: string; title?: string; visible?: boolean; type?: "separator"; contexts: ["all"] }) =>
  new Promise<void>((resolve, reject) => {
    myBrowser.contextMenus.create(properties, () => {
      const error = myBrowser.runtime.lastError;
      if (error) reject(new Error(error.message || "Menu creation failed"));
      else resolve();
    });
  });

export const initializeContextMenus = async (initialSetting?: SettingType): Promise<boolean> => {
  try {
    await myBrowser.contextMenus.removeAll();
    publishedTargets.clear();
    rowsShown.clear();
    for (const definition of detailDefinitions) rowsPublished.add(definition.id);
    const setting = initialSetting ?? await getSetting();
    const details = detailMenus(setting, []);
    const menus: (Menu | { id: string; type: "separator" })[] = [
      { id: "ohmytab_extract_tab", title: myBrowser.i18n.getMessage("text4"), visible: setting.contextmenu3 },
      { id: "ohmytab_glue_windows", title: myBrowser.i18n.getMessage("text3"), visible: setting.contextmenu2 },
      ...(setting.contextmenu1 ? [{ id: "ohmytab_separator0", type: "separator" as const }] : []),
      { id: "ohmytab_close_tabs", title: myBrowser.i18n.getMessage("text2") + scopeLabel(setting.contextmenu1scope), visible: setting.contextmenu1 },
      ...details.slice(0, 5),
      ...(setting.contextmenu4 ? [{ id: "ohmytab_separator1", type: "separator" as const }] : []),
      { id: "ohmytab_extract_tabs", title: myBrowser.i18n.getMessage("text5") + scopeLabel(setting.contextmenu4scope), visible: setting.contextmenu4 },
      ...details.slice(5),
    ];
    // Create fixed detail IDs hidden even for disabled features, so subsequent
    // updates can hide/show rows without referring to nonexistent menu IDs.
    let success = true;
    await Promise.all(menus.map(async menu => {
      try {
        await createMenu({ ...menu, contexts: ["all"] });
        if ("title" in menu) rowsShown.set(menu.id, { title: menu.title, visible: menu.visible });
      } catch (error) {
        success = false;
        console.log("createContextMenu", error);
      }
    }));
    const store = await readWorkflowStore();
    if (store.workflows.length) {
      for (const saved of store.workflows) await createMenu({ id: workflowMenuId(store, saved), title: myBrowser.i18n.getMessage("workflowMenuPrefix") + saved.name, contexts: ["all"] });
    }
    return success;
  } catch (error) {
    console.log("initializeContextMenus failed", error);
    return false;
  }
};

let pendingDomains: string[] | undefined;
let updateWorker: Promise<void> | undefined;
const drainMenuUpdates = async () => {
  try {
    while (pendingDomains !== undefined) {
      const domains = pendingDomains;
      pendingDomains = undefined;
      try {
        const setting = await getSetting();
        if (pendingDomains !== undefined) continue;
        const menus = detailMenus(setting, domains);
        await Promise.all(menus.map(async (menu, index) => {
          try {
            const shown = rowsShown.get(menu.id);
            if (shown?.title !== menu.title || shown.visible !== menu.visible) {
              rowsShown.delete(menu.id);
              await myBrowser.contextMenus.update(menu.id, { title: menu.title, visible: menu.visible });
              rowsShown.set(menu.id, { title: menu.title, visible: menu.visible });
            }
            const definition = detailDefinitions[index]!;
            const domain = domains[definition.level];
            rowsPublished.add(menu.id);
            if (menu.visible && domain) {
              publishedTargets.set(menu.id, { action: definition.action, scope: setting[definition.scope], domain });
            } else {
              publishedTargets.delete(menu.id);
            }
          } catch (error) {
            // A failed update retains the target of its still-displayed row.
            console.log("updateContextMenu", error);
          }
        }));
      } catch (error) {
        console.log("updateContextMenus failed", error);
      }
    }
  } finally {
    updateWorker = undefined;
  }
};

export const updateContextMenus = (domains: string[]): Promise<void> => {
  pendingDomains = domains.slice(0, 5);
  updateWorker ??= drainMenuUpdates();
  return updateWorker;
};
