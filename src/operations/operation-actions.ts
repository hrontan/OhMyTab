import { type ScopeType, myBrowser, type TabType, type WindowType } from "../browser/browser-api";
import { createWindow, focusWindow, getTab, getTabs, moveTabs, reloadTab, removeTabs } from "../browser/api";
import { tabs2TabIds, getDomain, compareTitle, compareURL } from "./misc";
import { minMoveOperations } from "./lcs";
import { OrderedSequence } from "./ordered-sequence";
import { isSameTabSession } from "./tab-session";
import { RX_LOCAL, RX_SEARCH_ENGINE, SYSTEM_PAGE_RULE } from "../rules/regex";
import type { SortKeyType, SettingType } from "../settings/setting";
import { compileURLRules } from "../rules/url-rules";
import { duplicateTabIds, parseProtectedDomains, protectionReasons } from "./tab-protection";
import { matchingWorkflowRules } from "../workflows/workflow-rules";
import { workflowExecutionRules } from "../workflows/workflow-execution";
import { pendingUrl } from "./operation-plan";
import type { OperationActionContext, OperationOutcome, OperationWork, PerformOperation } from "./operation-context";

type OperationActionDependencies = {
  getOperation: () => OperationActionContext;
  perform: PerformOperation;
  recheckPreviewMutation: () => Promise<void>;
  recordOutcome: (ids: number[], outcome: OperationOutcome) => void;
  recordClosedTabs: (tabs: TabType[], containers: boolean) => void;
};

export const createOperationActions = ({ getOperation, perform, recheckPreviewMutation, recordOutcome, recordClosedTabs }: OperationActionDependencies) => {
const operationTabs = (scope: ScopeType) => {
  operationWindows(scope);
  return getOperation().tabs.filter(tab => scope === "all" || tab.windowId === getOperation().window.id);
};
const operationWindows = (scope: ScopeType) => {
  const windows = scope === "win" ? [getOperation().window] : getOperation().windows;
  for (const window of windows) if (window.id != null) getOperation().scopeWindows.add(window.id);
  return windows;
};
const operationURL = (url: string): URL => {
  const urls = getOperation().urls;
  if (!urls.has(url)) urls.set(url, new URL(url));
  return urls.get(url)!;
};
const operationDomain = (url: string | undefined): string => {
  const key = url ?? "";
  const domains = getOperation().domains;
  if (!domains.has(key)) domains.set(key, getDomain(key, operationURL));
  return domains.get(key)!;
};
const operationDomainMatch = (url: string | undefined, domain: string, detailed = false): boolean => {
  const host = operationDomain(url);
  return !!host && !!domain && (host === domain || (detailed && host.endsWith(`.${domain}`)));
};
const operationMove = (ids: number[], window: WindowType, index = -1, reason = "move") =>
  perform(ids, () => moveTabs(ids, window, index), tab => tab != null && tab.windowId === window.id && (index === -1 || tab.index === index), reason);
const applyProtection = (setting: SettingType) => {
  const domains = parseProtectedDomains(setting.protect_domains);
  getOperation().keeper = setting.duplicate_keep;
  getOperation().tabs = getOperation().tabs.filter(tab => {
    const reasons = protectionReasons(tab, setting, domains, operationDomain);
    if (!reasons.length) return true;
    if (tab.id != null) getOperation().excluded.set(tab.id, reasons);
    if ("groupId" in tab && tab.groupId != null && tab.groupId >= 0) getOperation().protectedGroups.add(tab.groupId);
    return false;
  });
};
const extractDuplicatedTabIds = (tabs: TabType[]): number[] =>
  duplicateTabIds(tabs, getOperation().keeper, getOperation().active?.id);

const extractRXMatchTabIds = (tabs: TabType[], rx: Pick<RegExp, "test">): number[] =>
  tabs2TabIds(tabs.filter((tab) => tab.url && rx.test(tab.url)));

const extractSameDomainTabIds = (
  tabs: TabType[],
  target: TabType
): number[] => {
  const targetDomain = operationDomain(target.url);
  return tabs2TabIds(tabs.filter((tab) => operationDomainMatch(tab.url, targetDomain)));
};

const extractEndWithGivenDomainTabIds = (
  tabs: TabType[],
  domain: string
): number[] => {
  return tabs2TabIds(tabs.filter((tab) => operationDomainMatch(tab.url, domain, true)));
};

/// #if BROWSER === "chrome"
// Edge refuses to remove the focused window's active new tab ("Cannot remove
// NTP tab."), so hand activation to the nearest surviving tab first. Other
// tabs keep the browser's own choice of the next active tab.
// Browser-reported URLs are already normalized; avoid another URL parse here.
const edgeNewTab = (url = "") => url.startsWith("edge://newtab/") || url.startsWith("https://ntp.msn.com/");
const activateSurvivingTab = async (ids: number[]) => {
  try {
    const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const closing = new Set(ids);
    if (active?.id == null || !closing.has(active.id) || !edgeNewTab(active.url)) return;
    const survivors = (await chrome.tabs.query({ windowId: active.windowId }))
      .filter(tab => tab.id != null && !closing.has(tab.id)).sort((a, b) => a.index - b.index);
    const next = survivors.find(tab => tab.index > active.index) ?? survivors.at(-1);
    if (next) await chrome.tabs.update(next.id!, { active: true });
  } catch {
    // Removal still runs and reports its own outcome.
  }
};
/// #endif

const closeTabs = async (
  scope: ScopeType,
  extractor: (tabs: TabType[]) => number[],
  reason: string | ((id: number) => string[]) = "sameDomain",
) => {
  const tabs = operationTabs(scope);
  let ids = extractor(tabs);
  if (ids.length) {
    // Targets were chosen from captured URLs. A tab that navigated since, or is
    // still navigating, is no longer that page and may now be protected.
    const planned = new Map(tabs.map(tab => [tab.id, tab.url]));
    const live = new Map((await myBrowser.tabs.query({ windowType: "normal" })).map(tab => [tab.id, tab]));
    const unchanged = ids.filter(id => {
      const tab = live.get(id), pending = tab && pendingUrl(tab);
      return tab == null || (tab.url === planned.get(id) && (pending == null || pending === tab.url));
    });
    if (unchanged.length !== ids.length && getOperation().allowedIds) throw new Error("Preview changed before closure");
    ids = unchanged;
  }
  let captured: TabType[] = [];
  const removed = await perform(ids, async () => {
    captured = (await Promise.all(ids.map(async id => {
      try { return await getTab(id); } catch { return undefined; }
    }))).filter((tab): tab is TabType => tab != null);
    await recheckPreviewMutation();
    /// #if BROWSER === "chrome"
    await activateSurvivingTab(ids);
    /// #endif
    await removeTabs(ids);
  }, tab => tab == null, reason);
  if (getOperation().planning) {
    // Original targets remain in the preview rows, but later steps see the
    // simulated post-close population rather than grouping planned closures.
    const plannedClosures = new Set(ids);
    getOperation().tabs = getOperation().tabs.filter(tab => !plannedClosures.has(tab.id!));
    for (const id of ids) getOperation().closed.add(id);
    return;
  }
  if (ids.length) {
    try {
      // Include pinned tabs: becoming pinned is not evidence of successful closure.
      const remaining = await myBrowser.tabs.query({ windowType: "normal" });
      const present = new Set(remaining.map(tab => tab.id));
      // Judge this close by its own result: an earlier failed move of the same tab must not hide it.
      const closedIds = new Set(ids.filter(id => !present.has(id) && removed.has(id)));
      // Firefox resolves tabs.remove() when a beforeunload prompt keeps the page open.
      const kept = ids.filter(id => present.has(id) && removed.has(id));
      for (const id of kept) getOperation().outcomes.set(id, "failed");
      if (kept.length) getOperation().errors++;
      getOperation().tabs = getOperation().tabs.filter(tab => !closedIds.has(tab.id!));
      for (const id of closedIds) getOperation().closed.add(id);
      const closed = captured.filter(tab => tab.id != null && closedIds.has(tab.id));
      recordClosedTabs(closed, getOperation().session.containers);
    } catch { getOperation().errors++; }
  }
};

const glueTabs = async () => {
  const windows = getOperation().windows;
  if (windows.length < 2) return;
  const tabs = operationTabs("all");
  if (tabs.length === 0) return;

  const currentWindow = getOperation().window;
  await operationMove(
    tabs2TabIds(tabs.filter((tab) => tab.windowId != currentWindow.id)),
    currentWindow, -1, "glue"
  );
  const operation = getOperation();
  if (operation.planning) {
    // Simulate only geometry; preview rows and duplicate keeper flags retain
    // the original capture, including each tab's source window.
    let index = Math.max(-1, ...tabs.filter(tab => tab.windowId === currentWindow.id).map(tab => tab.index)) + 1;
    operation.tabs = tabs.map(tab => tab.windowId === currentWindow.id ? { ...tab } :
      { ...tab, windowId: currentWindow.id!, index: index++, ...("groupId" in tab ? { groupId: -1 } : {}) });
  } else {
    // A partial move can leave survivors in several windows or close a source
    // window. Observe those positions without admitting any newly opened ID.
    const live = new Map((await getTabs({ scope: "all" }))
      .filter(tab => tab.id != null && isSameTabSession(tab, operation.session))
      .map(tab => [tab.id!, tab]));
    operation.tabs = tabs.flatMap(tab => {
      const current = tab.id == null ? undefined : live.get(tab.id);
      return current == null ? [] : [{ ...tab, windowId: current.windowId, index: current.index,
        ...("groupId" in current ? { groupId: current.groupId } : {}) }];
    });
  }
  const survivingWindows = new Set(operation.tabs.map(tab => tab.windowId));
  operation.windows = windows.filter(window => survivingWindows.has(window.id!));
};

const RELOAD_CONCURRENCY = 4;
const RELOAD_WAIT_MS = 5000;
const RELOAD_POLL_MS = 250;
const waitForLoad = async (id: number) => {
  const deadline = Date.now() + RELOAD_WAIT_MS;
  while (Date.now() < deadline) {
    try {
      if ((await getTab(id)).status === "complete") return;
    } catch {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, RELOAD_POLL_MS));
  }
};
// Loading every discarded tab at once can stall the browser, so a few load at a
// time; a slow page releases its slot after RELOAD_WAIT_MS.
const refreshTabs = async (scope: ScopeType) => {
  const tabs = operationTabs(scope);
  const ids = tabs2TabIds(tabs.filter((tab) => tab.discarded));
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(getOperation().allowedIds ? 1 : RELOAD_CONCURRENCY, ids.length) }, async () => {
    while (next < ids.length) {
      const id = ids[next++]!;
      // The API resolves when loading starts; the page's own title and status updates
      // belong to this step, so the confirmed snapshot is refreshed only after loading.
      await perform([id], async () => { await reloadTab(id); await waitForLoad(id); }, undefined, "reload");
    }
  }));
};

const moveCurrentTabToNewWindow = async () => {
  operationWindows("win");
  const activeTab = getOperation().active;
  if (activeTab == null || activeTab.id == null || activeTab.pinned ||
    !getOperation().tabs.some(tab => tab.id === activeTab.id)) return;
  await perform([activeTab.id], async () => {
    const newWindow = await createWindow(activeTab.id, getOperation().session.incognito);
    if (newWindow == null) throw new Error("Window creation failed");
    await focusWindow(newWindow);
  }, undefined, "extract");
};

const moveTabsToNewWindow = async (
  scope: ScopeType,
  extractor: (tabs: TabType[]) => number[]
) => {
  const activeTab = getOperation().active;
  if (activeTab == null) return;

  const tabs = operationTabs(scope);
  const ids = extractor(tabs);
  if (getOperation().planning) { await perform(ids, async () => {}, undefined, "extract"); return; }
  if (ids.length > 0) {
    // Open the window with the first tab and append the rest, keeping the strip order.
    const [tab1Id, ...rest] = ids as [number, ...number[]];
    let newWindow: WindowType | undefined;
    await perform([tab1Id], async () => { newWindow = await createWindow(tab1Id, getOperation().session.incognito); });
    if (newWindow?.id == null) {
      recordOutcome(rest, "failed"); return;
    }
    if (rest.length > 0) await operationMove(rest, newWindow);
    try { await focusWindow(newWindow); } catch { getOperation().errors++; }
  }
};

const sortTabs = async (scope: ScopeType, method: SortKeyType) => {
  const windows = operationWindows(scope);

  const isUngrouped = (tab: TabType) => !("groupId" in tab) || tab.groupId == null || tab.groupId === -1;
  const originalIds = new Set(tabs2TabIds(getOperation().tabs));
  for (const window of windows) {
    const windowId = window.id;
    if (windowId == null) continue;
    let physical = new OrderedSequence<TabType>([]);
    let sortable = new OrderedSequence<TabType>([]);
    let byId = new Map<number, TabType>();
    let base = 0;
    const loadWindowTabs = async () => {
      const tabs = (await getTabs({ windowId })).sort((a, b) => a.index - b.index);
      base = tabs[0]?.index ?? 0;
      physical = new OrderedSequence(tabs);
      const targets = tabs.filter(tab =>
        tab.id != null && originalIds.has(tab.id) && !tab.pinned && isUngrouped(tab)
      );
      sortable = new OrderedSequence(targets);
      byId = new Map(targets.map(tab => [tab.id!, tab]));
    };

    const sortedByIndexTabs = getOperation().tabs.filter(tab =>
      tab.windowId === windowId && tab.id != null && !tab.pinned && isUngrouped(tab)
    ).sort((a, b) => a.index - b.index);
    const sortedByIndexTabIds = tabs2TabIds(sortedByIndexTabs);
    const sortedTabs = [...sortedByIndexTabs].sort(
      method === "title" ? compareTitle : (a, b) => compareURL(a, b, operationURL)
    );
    const sortedTabIds = tabs2TabIds(sortedTabs);
    const moveOperations = minMoveOperations(sortedByIndexTabIds, sortedTabIds);
    if (getOperation().planning) {
      // The browser still has the pre-glue layout during a dry run.
      for (const op of moveOperations) await perform([op.value], async () => {}, undefined, "sort");
      continue;
    }

    if (moveOperations.length > 0) await loadWindowTabs();
    for (const op of moveOperations) {
      // Indices change after each move and can have grouped gaps.
      // Insert beside an ungrouped neighbour, never into a group's interior.
      const moving = byId.get(op.value);
      if (moving == null) { recordOutcome([op.value], "failed"); continue; }
      const from = sortable.rank(moving);
      const to = Math.min(op.to, sortable.length - 1);
      // Select in the order after removing the moving tab without rebuilding it.
      const successor = sortable.at(to + (to >= from ? 1 : 0));
      const last = sortable.at(sortable.length - (from === sortable.length - 1 ? 2 : 1));
      const movingIndex = base + physical.rank(moving);
      const successorIndex = successor == null ? undefined : base + physical.rank(successor);
      const lastIndex = last == null ? undefined : base + physical.rank(last);
      const index = successorIndex != null
        ? successorIndex - (movingIndex < successorIndex ? 1 : 0)
        : lastIndex != null
          ? lastIndex + (movingIndex > lastIndex ? 1 : 0)
          : movingIndex;
      if (movingIndex === index) continue;
      const errors = getOperation().errors;
      await operationMove([op.value], window, index, "sort");
      if (getOperation().errors === errors) {
        physical.move(moving, index - base);
        sortable.move(moving, to);
      }
      else await loadWindowTabs();
    }
  }
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
      const key = operationDomain(url);
      // Only web pages have a domain; never collect system or local pages into an untitled group.
      if (!key) return group;
      const members = group.get(key) ?? [];
      members.push({ id, currentGroupId });
      group.set(key, members);
      return group;
    },
    new Map<string, { id: number; currentGroupId: number }[]>()
  );
};

const groupingTabs = async (scope: ScopeType, grouping_min: number) => {
  const windows = operationWindows(scope);

  for (const window of windows) {
    const windowId = window.id;
    if (windowId == null) continue;
    const tabs = operationTabs(scope).filter(tab => tab.windowId === windowId &&
      !("groupId" in tab && getOperation().protectedGroups.has(tab.groupId ?? -1))) as chrome.tabs.Tab[];
    const targetedGroups = new Map<number, number[]>();
    for (const tab of tabs) {
      if (tab.groupId !== -1 && tab.id != null) {
        const ids = targetedGroups.get(tab.groupId) ?? [];
        ids.push(tab.id);
        targetedGroups.set(tab.groupId, ids);
      }
    }
    const groups = groupByURL(tabs);
    // A dry run cannot see the groups it would create or dissolve, so the order check
    // below runs on the old layout; once anything changes, plan every reorder.
    let changed = false;
    for (const [key, members] of groups) {
      let group = members;
      if (group.length < grouping_min) {
        // Ungrouping tabs that are in no group only fires needless tab events.
        const grouped = group.filter(el => el.currentGroupId !== -1).map(el => el.id);
        const [first, ...rest] = grouped;
        if (first != null) {
          changed = true;
          await perform(grouped, () => chrome.tabs.ungroup([first, ...rest]), undefined, "ungroup");
        }
      } else {
        let targetTabGroupId =
          arithmetic_mode(group.map((el) => el.currentGroupId)) ?? -1;
        let existingMembers: number[] = [];
        if (targetTabGroupId != -1) {
          // Judge the group after this run's closures, simulated or real, so planning and execution agree.
          const tabsInTargetTabGroup = ((await getTabs({
            groupId: targetTabGroupId,
          })) as chrome.tabs.Tab[]).filter(tab => tab.id == null || !getOperation().closed.has(tab.id));
          existingMembers = tabsInTargetTabGroup.map(tab => tab.id).filter((id): id is number => id != null);
          const targetTabGroupDomain =
            arithmetic_mode(
              tabsInTargetTabGroup.map((tab) => operationDomain(tab.url))
            ) ?? "";
          if (targetTabGroupDomain != key) {
            targetTabGroupId = -1;
          }
        }
        if (targetTabGroupId != -1) {
          group = group.filter((el) => el.currentGroupId != targetTabGroupId);
        }
        const [first, ...rest] = group.map(el => el.id);
        if (first == null) continue;
        changed = true;
        // Joining an existing group updates it, so confirmation must cover its members too.
        if (getOperation().planning && targetTabGroupId != -1) await perform(existingMembers, async () => {}, undefined, "group");

        await perform(group.map(el => el.id), async () => {
          if (getOperation().allowedIds && targetTabGroupId !== -1) {
            const members = await getTabs({ groupId: targetTabGroupId });
            if (members.some(tab => tab.id == null || !getOperation().allowedIds!.has(tab.id))) throw new Error("Unplanned group member");
          }
          const groupId = await chrome.tabs.group({
            tabIds: [first, ...rest],
            createProperties:
              targetTabGroupId == -1 ? { windowId: window.id } : undefined,
            groupId: targetTabGroupId == -1 ? undefined : targetTabGroupId,
          });
          if (groupId == null) throw new Error("Group creation failed");
          const ids = targetedGroups.get(groupId) ?? [];
          for (const member of group) ids.push(member.id);
          targetedGroups.set(groupId, ids);
          if (getOperation().allowedIds) {
            const members = await getTabs({ groupId });
            if (members.some(tab => tab.id == null || !getOperation().allowedIds!.has(tab.id))) throw new Error("Unplanned group member");
          }
          await chrome.tabGroups.update(groupId, {
            collapsed: true,
            title: key,
          });
        }, undefined, "group");
      }
    }
    const tabGroups = (await chrome.tabGroups.query({ windowId }))
      .sort(compareTitle)
      .reverse();
    const windowTabs = (await chrome.tabs.query({ windowId })).sort((a, b) => a.index - b.index);
    const pinnedCount = windowTabs.filter(tab => tab.pinned).length;
    // Moved groups end up first in title order. When they already are, moving
    // them again would only shuffle the tab strip.
    const movedGroups = tabGroups.filter(tabGroup => (targetedGroups.get(tabGroup.id) ?? []).length > 0);
    const leadingGroups: number[] = [];
    for (const tab of windowTabs.filter(tab => !tab.pinned)) {
      if (leadingGroups.at(-1) !== tab.groupId) leadingGroups.push(tab.groupId);
    }
    const ordered = movedGroups.map(tabGroup => tabGroup.id).reverse();
    if (!(getOperation().planning && changed) && ordered.every((id, position) => leadingGroups[position] === id)) continue;

    for (const tabGroup of tabGroups) {
      const ids = targetedGroups.get(tabGroup.id) ?? [];
      await perform(ids, async () => {
        if (getOperation().allowedIds) {
          const members = await getTabs({ groupId: tabGroup.id });
          if (members.some(tab => tab.id == null || !getOperation().allowedIds!.has(tab.id))) throw new Error("Unplanned group member");
        }
        await chrome.tabGroups.move(tabGroup.id, { index: pinnedCount });
      }, undefined, "groupOrder");
    }
  }
};

/// #endif

const actionWork: OperationWork = async (setting) => {
  applyProtection(setting);
  const scope: ScopeType = setting.currentonly ? "win" : "all";
  let urlRules: ReturnType<typeof compileURLRules> = [];
  if (setting.urlmatch) {
    try {
      urlRules = compileURLRules(setting.urlmatch_pattern);
    } catch {
      console.error("URL rules invalid");
      throw new Error("URL rules invalid");
    }
  }

  if (setting.glue) await glueTabs();

  if (
    setting.comclose ||
    setting.closelocal ||
    setting.rxclose ||
    setting.depclean ||
    setting.urlmatch || !!getOperation().workflow
  ) {
    const reasons = new Map<number, string[]>();
    await closeTabs(scope, (tabs) => {
      const tabs_sys = setting.comclose
        ? extractRXMatchTabIds(tabs, SYSTEM_PAGE_RULE)
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

      const workflow = getOperation().workflow;
      const workflowRules = workflow ? workflowExecutionRules(workflow) : [];
      const tabs_workflow = workflow ? tabs2TabIds(tabs.filter(tab => matchingWorkflowRules(tab.url, workflowRules).length)) : [];
      const tabs_regmatched = setting.urlmatch
        ? tabs2TabIds(tabs.filter((tab) => urlRules.some(rule => rule.test(tab.url ?? ""))))
        : [];

      for (const [reason, ids] of [["system", tabs_sys], ["local", tabs_local], ["search", tabs_search_engine], ["duplicate", tabs_duplicated], ["urlRule", [...tabs_regmatched, ...tabs_workflow]]] as const) {
        for (const id of ids) reasons.set(id, [...(reasons.get(id) ?? []), reason]);
      }
      const tabsToClose = Array.from(
        new Set([
          ...tabs_sys,
          ...tabs_local,
          ...tabs_search_engine,
          ...tabs_duplicated,
          ...tabs_regmatched, ...tabs_workflow,
        ])
      );
      return tabsToClose;
    }, id => reasons.get(id) ?? []);
  }

  if (setting.sorttab) await sortTabs(scope, setting.sortkey);

  /// #if BROWSER === "chrome"

  if (setting.grouping) {
    await groupingTabs(scope, setting.grouping_min);
  }

  /// #endif

  if (setting.refresh) await refreshTabs(scope);

};
return { actionWork, applyProtection, closeTabs, glueTabs, sortTabs, refreshTabs, moveCurrentTabToNewWindow, moveTabsToNewWindow, extractDuplicatedTabIds, extractRXMatchTabIds, extractSameDomainTabIds, extractEndWithGivenDomainTabIds, operationDomain };
};
