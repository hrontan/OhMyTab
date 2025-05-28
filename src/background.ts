import {
  type ScopeType,
  createWindow,
  focusWindow,
  getActiveTab,
  getActiveWindow,
  getTabs,
  getWindows,
  moveTabs,
  myBrowser,
  reloadTab,
  removeTabs,
  setIconBadge,
  type TabType,
} from "./api";
import {
  type ContextMenuItemIdType,
  initializeContextMenus,
  updateContextMenus,
} from "./contextmenu";
import {
  removeUndefined,
  tabs2TabIds,
  getDomain,
  compareTitle,
  compareURL,
  getDomainsByLevelWithoutPublicSuffix,
} from "./misc";
import { minMoveOperations } from "./lcs";
import { RX_LOCAL, RX_SEARCH_ENGINE, RX_SYSTEM, RX_SYSTEM2 } from "./regex";
import { type SortKeyType, getSetting } from "./setting";
import { isMatch } from "picomatch";

const extractDuplicatedTabIds = (
  tabs: TabType[],
  ignoreParameter = false
): number[] => {
  const tabData = tabs.map((tab) => ({
    id: tab.id,
    url: tab.url ?? "",
    url_no_param: tab.url?.split("?")[0] ?? "",
    url_length: tab.url?.length ?? 0,
  }));
  const tabDataForRemove = tabData.filter((cTab, i) =>
    tabData
      .slice(i + 1)
      .reduce(
        (prev, tab) =>
          (ignoreParameter
            ? cTab.url_no_param === tab.url_no_param &&
              cTab.url_length > tab.url_length
            : cTab.url === tab.url) || prev,
        false
      )
  );

  return removeUndefined(tabDataForRemove.map((tab) => tab.id));
};

const extractRXMatchTabIds = (tabs: TabType[], rx: RegExp): number[] =>
  tabs2TabIds(tabs.filter((tab) => tab.url && rx.test(tab.url)));

const extractGlobMatchTabIds = (tabs: TabType[], glob: string): number[] =>
  tabs2TabIds(
    tabs.filter((tab) => isMatch(tab.url ?? "", glob, { contains: true }))
  );

const extractSameDomainTabIds = (
  tabs: TabType[],
  target: TabType
): number[] => {
  if (target.url == null) return [];
  const targetDomain = getDomain(target.url);
  return tabs2TabIds(
    tabs.filter((tab) => tab.url && getDomain(tab.url) === targetDomain)
  );
};

const extractEndWithGivenDomainTabIds = (
  tabs: TabType[],
  domain: string
): number[] => {
  return tabs2TabIds(
    tabs.filter((tab) => tab.url && getDomain(tab.url).endsWith(domain))
  );
};

const closeTabs = async (
  scope: ScopeType,
  extractor: (tabs: TabType[]) => number[]
) => {
  const tabs = await getTabs({ scope });
  const ids = extractor(tabs);
  await removeTabs(ids);
};

const glueTabs = async () => {
  const windows = await getWindows();
  if (windows.length < 2) return;
  const tabs = await getTabs({ scope: "all" });
  if (tabs.length < 2) return;

  const currentWindow = await getActiveWindow();
  await moveTabs(
    tabs2TabIds(tabs.filter((tab) => tab.windowId != currentWindow.id)),
    currentWindow
  );
};

const refreshTabs = async (scope: ScopeType) => {
  const tabs = await getTabs({ scope });
  const ids = tabs2TabIds(tabs.filter((tab) => tab.discarded));
  await Promise.all(ids.map((id) => reloadTab(id)));
};

const moveCurrentTabToNewWindow = async () => {
  const activeTab = await getActiveTab();
  if (activeTab == null || activeTab.id == null) return;
  const newWindow = await createWindow(activeTab.id);
  await focusWindow(newWindow);
};

const moveTabsToNewWindow = async (
  scope: ScopeType,
  extractor: (tabs: TabType[]) => number[]
) => {
  const activeTab = await getActiveTab();
  if (activeTab == null) return;

  const tabs = await getTabs({ scope });
  const ids = extractor(tabs);
  if (ids.length > 0) {
    const tab1Id = ids.pop();
    const newWindow = await createWindow(tab1Id);
    if (newWindow.id == null) return;
    if (ids.length > 0) await moveTabs(ids, newWindow);
    await focusWindow(newWindow);
  }
};

const sortTabs = async (scope: ScopeType, method: SortKeyType) => {
  const windows =
    scope === "win" ? [await getActiveWindow()] : await getWindows();

  for (const window of windows) {
    const windowId = window.id;
    if (windowId == null) continue;
    const tabs = (await getTabs({ windowId, groupId: -1 })).filter(
      (tab) => tab.id != null
    );
    const sortedByIndexTabs = tabs.sort((a, b) => a.index - b.index);

    const sortedByIndexTabIds = tabs2TabIds(sortedByIndexTabs);

    const sortedTabs = tabs.sort(
      method === "title" ? compareTitle : compareURL
    );
    const sortedTabIds = tabs2TabIds(sortedTabs);
    const moveOperations = minMoveOperations(sortedByIndexTabIds, sortedTabIds);
    const indexStart = sortedByIndexTabs[0]?.index ?? 0;
    for (const op of moveOperations) {
      await moveTabs([op.value], window, op.to + indexStart);
    }
  }
};

let lockUpdateIconBadge = false;
const updateIconBadge = async () => {
  if (lockUpdateIconBadge) return;
  lockUpdateIconBadge = true;
  const setting = await getSetting();
  await setIconBadge(setting.iconbadge, setting.iconbadgescope);
  lockUpdateIconBadge = false;
};

/// #if BROWSER === "chrome"
const countByData = <T>(ary: T[]): Map<T, number> =>
  ary.reduce(
    (dic: Map<T, number>, el) => dic.set(el, (dic.get(el) ?? 0) + 1),
    new Map<T, number>()
  );

const arithmetic_mode = <T>(ary: T[]) => {
  let id: T | undefined;
  let idVal = 0;
  countByData(ary).forEach((val, key) => {
    if (idVal < val) {
      id = key;
      idVal = val;
    }
  });
  return id;
};

const groupByURL = (tabs: chrome.tabs.Tab[]) => {
  return tabs.reduce(
    (group: Map<string, { id: number; currentGroupId: number }[]>, el) => {
      const url = el.url;
      const id = el.id;
      const currentGroupId = el.groupId;
      if (url == null || id == null) return group;
      const key = getDomain(url);
      group.set(key, [...(group.get(key) ?? []), { id, currentGroupId }]);
      return group;
    },
    new Map<string, { id: number; currentGroupId: number }[]>()
  );
};

const groupingTabs = async (scope: ScopeType, grouping_min: number) => {
  const windows =
    scope === "win" ? [await getActiveWindow()] : await getWindows();

  for (const window of windows) {
    const windowId = window.id;
    if (windowId == null) continue;
    const tabs = (await getTabs({ windowId })) as chrome.tabs.Tab[];
    const groups = groupByURL(tabs);
    for (let [key, group] of Array.from(groups)) {
      if (group.length < grouping_min) {
        try {
          await chrome.tabs.ungroup(group.map((el) => el.id));
        } catch (e) {
          console.log(e);
        }
      } else {
        // Use the tab group is already grouped.
        let targetTabGroupId =
          arithmetic_mode(group.map((el) => el.currentGroupId)) ?? -1;
        // Check if the existed tab group is grouped by the domain.
        if (targetTabGroupId != -1) {
          const tabsInTargetTabGroup = (await getTabs({
            groupId: targetTabGroupId,
          })) as chrome.tabs.Tab[];
          const targetTabGroupDomain =
            arithmetic_mode(
              tabsInTargetTabGroup.map((tab) => getDomain(tab.url ?? ""))
            ) ?? "";
          if (targetTabGroupDomain != key) {
            targetTabGroupId = -1;
          }
        }
        // Skip if there is no tab to move.
        if (targetTabGroupId != -1) {
          group = group.filter((el) => el.currentGroupId != targetTabGroupId);
        }
        if (group.length == 0) continue;

        try {
          const groupId = await chrome.tabs.group({
            tabIds: group.map((el) => el.id),
            createProperties:
              targetTabGroupId == -1 ? { windowId: window.id } : undefined,
            groupId: targetTabGroupId == -1 ? undefined : targetTabGroupId,
          });
          if (groupId == null) continue;
          await chrome.tabGroups.update(groupId, {
            collapsed: true,
            title: key,
          });
        } catch (e) {
          console.log(e);
        }
      }
    }
    const tabGroups = (await chrome.tabGroups.query({ windowId }))
      .sort(compareTitle)
      .reverse();
    const pinnedCount = (
      await chrome.tabs.query({
        windowId,
        pinned: true,
      })
    ).length;

    for (const tabGroup of tabGroups) {
      await chrome.tabGroups.move(tabGroup.id, { index: pinnedCount });
    }
  }
};

/// #endif
let lockUpdateContextMenus = false;
const updateFlushContextMenus = async () => {
  if (lockUpdateContextMenus) return;
  lockUpdateContextMenus = true;
  const tab = await getActiveTab();
  if (tab == null) return;
  const url = tab.url;
  if (url == null) return;
  const urls = getDomainsByLevelWithoutPublicSuffix(url);
  await updateContextMenus(urls);
  lockUpdateContextMenus = false;
};

/* register event */

myBrowser.tabs.onUpdated.addListener(updateIconBadge);
myBrowser.tabs.onRemoved.addListener(updateIconBadge);
myBrowser.windows.onFocusChanged.addListener(updateIconBadge);

myBrowser.action.onClicked.addListener(async () => {
  const setting = await getSetting();
  const scope: ScopeType = setting.currentonly ? "win" : "all";

  if (setting.glue) await glueTabs();

  if (
    setting.comclose ||
    setting.closelocal ||
    setting.rxclose ||
    setting.depclean ||
    setting.urlmatch
  ) {
    await closeTabs(scope, (tabs) => {
      const tabs_sys = setting.comclose
        ? extractRXMatchTabIds(tabs, RX_SYSTEM)
        : [];
      const tabs_sys2 = setting.comclose
        ? extractRXMatchTabIds(tabs, RX_SYSTEM2)
        : [];
      const tabs_local = setting.closelocal
        ? extractRXMatchTabIds(tabs, RX_LOCAL)
        : [];
      const tabs_search_engine = setting.rxclose
        ? extractRXMatchTabIds(tabs, RX_SEARCH_ENGINE)
        : [];
      const tabs_duplicated = setting.depclean
        ? extractDuplicatedTabIds(tabs)
        : [];

      const tabs_regmatched = setting.urlmatch_pattern
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((rx) => extractGlobMatchTabIds(tabs, rx))
        .flat();

      const tabsToClose = Array.from(
        new Set([
          ...tabs_sys,
          ...tabs_sys2,
          ...tabs_local,
          ...tabs_search_engine,
          ...tabs_duplicated,
          ...tabs_regmatched,
        ])
      );
      return tabsToClose;
    });
  }

  if (setting.sorttab) await sortTabs(scope, setting.sortkey);

  /// #if BROWSER === "chrome"

  if (setting.grouping) {
    await groupingTabs(scope, setting.grouping_min);
  }

  /// #endif

  if (setting.refresh) await refreshTabs(scope);

  await updateIconBadge();
});

myBrowser.contextMenus.onClicked.addListener(async (info, activeTab) => {
  const setting = await getSetting();
  const menuItemId = info.menuItemId as ContextMenuItemIdType;
  if (activeTab == null) return;

  if (menuItemId === "ohmytab_close_tabs") {
    // Close Tabs (Same Domain)
    await closeTabs(setting.contextmenu1scope, (tabs) =>
      extractSameDomainTabIds(tabs, activeTab)
    );
  } else if (menuItemId === "ohmytab_extract_tabs") {
    // Extract Tabs (Same Domain);
    await moveTabsToNewWindow(setting.contextmenu4scope, (tabs) =>
      extractSameDomainTabIds(tabs, activeTab)
    );
  } else if (menuItemId === "ohmytab_glue_windows") {
    // Glue Windows
    await glueTabs();
  } else if (menuItemId === "ohmytab_extract_tab") {
    // Extract Tab
    await moveCurrentTabToNewWindow();
  } else if (menuItemId.startsWith("ohmytab_flush_a")) {
    const menuItemIdNum = parseInt(menuItemId.slice(-1));
    const urls = getDomainsByLevelWithoutPublicSuffix(activeTab.url ?? "");
    const targetUrl = urls[menuItemIdNum];
    if (targetUrl != null) {
      await closeTabs(setting.contextmenu1scope, (tabs) =>
        extractEndWithGivenDomainTabIds(tabs, targetUrl)
      );
    }
  } else if (menuItemId.startsWith("ohmytab_extract_l")) {
    const urls = getDomainsByLevelWithoutPublicSuffix(activeTab.url ?? "");
    const menuItemIdNum = parseInt(menuItemId.slice(-1));
    const targetUrl = urls[menuItemIdNum];
    if (targetUrl != null) {
      await moveTabsToNewWindow(setting.contextmenu4scope, (tabs) =>
        extractEndWithGivenDomainTabIds(tabs, targetUrl)
      );
    }
  }

  await updateIconBadge();
});

myBrowser.commands.onCommand.addListener(async (command) => {
  const setting = await getSetting();
  const scope = setting.currentonly ? "win" : "all";

  if (command === "02_execute_option1") {
    await glueTabs();
  } else if (command === "03_execute_option3") {
    await sortTabs(scope, setting.sortkey);
  } else if (command === "04_execute_option4") {
    await refreshTabs(scope);
  } else if (command === "05_execute_option11_d") {
    await moveCurrentTabToNewWindow();
  } else if (command === "06_execute_option12_d") {
    const activeTab = await getActiveTab();
    if (activeTab != null) {
      await moveTabsToNewWindow(setting.contextmenu4scope, (tabs) =>
        extractSameDomainTabIds(tabs, activeTab)
      );
    }
  } else if (command === "07_execute_option5") {
    closeTabs(scope, (tabs) => extractRXMatchTabIds(tabs, RX_SYSTEM));
  } else if (command === "08_execute_option2") {
    closeTabs(scope, (tabs) => extractDuplicatedTabIds(tabs));
  } else if (command === "09_execute_option7") {
    closeTabs(scope, (tabs) => extractRXMatchTabIds(tabs, RX_SEARCH_ENGINE));
  } else if (command === "10_execute_option9_d") {
    const activeTab = await getActiveTab();
    if (activeTab == null) return;
    await closeTabs(setting.contextmenu1scope, (tabs) =>
      extractSameDomainTabIds(tabs, activeTab)
    );
  }

  await updateIconBadge();
});

myBrowser.tabs.onActivated.addListener(updateFlushContextMenus);

myBrowser.tabs.onUpdated.addListener(updateFlushContextMenus);
myBrowser.tabs.onRemoved.addListener(updateFlushContextMenus);
myBrowser.windows.onFocusChanged.addListener(updateFlushContextMenus);

myBrowser.runtime.onInstalled.addListener(initializeContextMenus);
