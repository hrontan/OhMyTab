import type { OperationContext, OperationOutcome, OperationWork } from "./operation-context";
import { createOperationActions } from "./operation-actions";
import { createWorkflowExecutionGuard, workflowExecutionRules, workflowProtectionTarget } from "../workflows/workflow-execution";
import { myBrowser, type TabType, type WindowType } from "../browser/browser-api";
import { flashIconBadge } from "../background/badge";
import { getActiveTab, getActiveWindow, getTab, getTabs, getWindows } from "../browser/api";
import { getDetailedMenuTarget, recoverDetailedMenuTarget } from "../background/contextmenu";
import { tabs2TabIds } from "./misc";
import { RX_SEARCH_ENGINE, SYSTEM_PAGE_RULE } from "../rules/regex";
import { type SettingType, getSetting } from "../settings/setting";
import { captureTabSession, isSameTabSession } from "./tab-session";
import { PREVIEW_TTL_MS, isLivePreview, previewFingerprint, previewRow, type PreviewPlan } from "./operation-plan";
import { matchingWorkflowRules } from "../workflows/workflow-rules";
import { readWorkflowStore } from "../workflows/workflow-storage";
import { internalWorkflowTab, workflowOrigin, workflowContainers } from "../workflows/workflow-origin";
import { WorkflowError, type WorkflowExecution, type WorkflowInput, type WorkflowInspection, type WorkflowRow } from "../workflows/workflow-types";
import { UndoBuffer, normalDefaultSession, type UndoEntry, type RestoreResult } from "./undo";

export type OperationRuntimeEffects = {
  refreshBadge: () => Promise<void>;
  onSettled: () => Promise<void>;
};
type MenuInvocation = {
  settingsSnapshot: SettingType | undefined;
  detailedTarget: ReturnType<typeof getDetailedMenuTarget>;
  recoverTarget: boolean;
  isReady: () => boolean;
};

// One instance per background lifetime; construction does not register events.
export const createOperationRuntime = (effects: OperationRuntimeEffects) => {
const { invalidateDraft: invalidateWorkflowDraft, bindDraft: bindWorkflowDraft, validateSource: validateWorkflowSource } = createWorkflowExecutionGuard();
let operationRunning = false;
let operation: OperationContext | undefined;
const showOperation = async (key: string, counts: number[] = []) => {
  try {
    await myBrowser.action.setTitle({ title: myBrowser.i18n.getMessage(key, counts.map(String)) });
  } catch {
    // Reporting failure must not retain the operation lock or expose API data.
  }
};
const recordOutcome = (ids: number[], outcome: OperationOutcome) => {
  for (const id of ids) {
    const previous = operation?.outcomes.get(id);
    if (previous !== "failed" && previous !== "unknown") operation?.outcomes.set(id, outcome);
  }
};
const capturedTabs = () => operation?.workflow ? myBrowser.tabs.query({ windowType: "normal" }) as Promise<TabType[]> : getTabs({ scope: "all" });
const confirmedTabs = async () => (await capturedTabs()).filter(tab =>
  isSameTabSession(tab, operation!.session) && !ownedOperationTab(tab));
const recheckPreviewMutation = async () => {
  const snapshot = operation!.confirmedSnapshot;
  if (!snapshot) return;
  if (operation!.invalidated) throw new Error("Preview invalidated during execution");
  if (operation!.workflow) await validateWorkflowSource(operation!.workflow, operation!.active);
  const setting = await getSetting(), tabs = await confirmedTabs();
  if (operation!.workflow) await validateWorkflowSource(operation!.workflow, operation!.active);
  if (previewFingerprint(tabs, [], setting, operation!.active!) !==
      previewFingerprint(snapshot.tabs, [], snapshot.setting, operation!.active!)) {
    operation!.invalidated = true; throw new Error("Preview changed before mutation");
  }
};
const acknowledgePreviewMutation = async (ids: number[]) => {
  const snapshot = operation!.confirmedSnapshot;
  if (!snapshot) return;
  const tabs = await confirmedTabs(), expectedIds = new Set(tabs2TabIds(snapshot.tabs));
  const untouched = (items: TabType[]) => items.filter(tab => !ids.includes(tab.id!)).map(tab => ({ ...tab, index: 0 }));
  // Own mutations can shift other tabs' indices, but must not absorb a new ID,
  // changed protection/session/URL, or moved unrelated tab into the next step.
  if (tabs.some(tab => tab.id == null || !expectedIds.has(tab.id)) ||
      previewFingerprint(untouched(tabs), [], snapshot.setting, operation!.active!) !==
      previewFingerprint(untouched(snapshot.tabs), [], snapshot.setting, operation!.active!)) {
    operation!.invalidated = true; throw new Error("Preview changed during mutation");
  }
  snapshot.tabs = tabs;
};
const perform = async (
  ids: number[], work: () => Promise<unknown>,
  verify?: (tab: TabType | undefined, id: number) => boolean,
  reason: string | ((id: number) => string[]) = "action",
) => {
  if (!ids.length) return;
  if (operation?.planning) {
    for (const id of ids) {
      const reasons = operation.planned.get(id) ?? new Set<string>();
      for (const value of typeof reason === "string" ? [reason] : reason(id)) reasons.add(value);
      operation.planned.set(id, reasons);
    }
    return;
  }
  if (operation?.allowedIds && ids.some(id => !operation!.allowedIds!.has(id))) throw new Error("Unplanned tab ID");
  await recheckPreviewMutation();
  try {
    await work();
    await acknowledgePreviewMutation(ids);
    recordOutcome(ids, "success");
  } catch {
    if (operation) operation.errors++;
    if (!verify) { recordOutcome(ids, "failed"); return; }
    try {
      // Verification observes all normal tabs, including targets pinned after capture.
      // This broader read never expands the IDs passed to a mutation.
      const current = await myBrowser.tabs.query({ windowType: "normal" });
      for (const id of ids) recordOutcome([id], verify(current.find(tab => tab.id === id), id) ? "success" : "failed");
    } catch { recordOutcome(ids, "unknown"); }
  }
};
// A request that is not executed must be visible: the title alone shows only on hover.
const noticeNotExecuted = async (key: string, tab?: TabType) => {
  await showOperation(key);
  try {
    const tabId = (tab ?? await getActiveTab())?.id;
    if (tabId != null) await flashIconBadge(tabId, effects.refreshBadge);
  } catch {
    // The title still reports the request.
  }
};
type PendingPreview = { plan: PreviewPlan; fingerprint: string; origin: TabType; activeIds: Set<number>; work: OperationWork; workflow?: WorkflowExecution };
let pendingPreview: PendingPreview | undefined;
let previewMessagesRegistered = false;
const ownedOperationTab = (tab: TabType) => {
  if (operation?.workflow) return internalWorkflowTab(tab);
  return ["preview.html", "undo.html"].some(name => {
    const page = myBrowser.runtime.getURL?.(name);
    return page != null && tab.url?.split("?")[0] === page;
  });
};

const undoBuffer = new UndoBuffer();
const restoreClosedEntry = async (entry: UndoEntry): Promise<RestoreResult> => {
  let creating = false;
  try {
    const windows = await getWindows();
    const target = windows.find(window => window.id === entry.windowId);
    if (!target || target.incognito !== false || (target.type != null && target.type !== "normal")) return "failed";
    const tabs = await myBrowser.tabs.query({ windowId: entry.windowId });
    creating = true;
    // Supplying cookieStoreId would require Firefox's cookies permission.
    // Only normal/default entries are retained; omitted store uses native default.
    const created = await myBrowser.tabs.create({ windowId: entry.windowId, url: entry.url, index: Math.min(entry.index, tabs.length), active: false });
    if (created?.id == null) return "unknown";
    const current = await getTab(created.id);
    let containers = false;
    /// #if BROWSER === "firefox"
    containers = true;
    /// #endif
    return current.windowId === entry.windowId && normalDefaultSession(current, containers) ? "restored" : "unknown";
  } catch { return creating ? "unknown" : "failed"; }
};

const registerOperationMessages = () => {
  if (previewMessagesRegistered) return;
  previewMessagesRegistered = true;
  myBrowser.runtime.onMessage.addListener((message: unknown, sender, respond) => {
    const request = message as { type?: unknown; token?: unknown; keys?: unknown } | null;
    if (request && ["undo:get", "undo:delete", "undo:clear", "undo:restore"].includes(String(request.type))) {
      let containers = false;
      /// #if BROWSER === "firefox"
      containers = true;
      /// #endif
      if (sender.id !== myBrowser.runtime.id || sender.url !== myBrowser.runtime.getURL("undo.html") ||
          !normalDefaultSession(sender.tab, containers)) { respond({ ok: false, status: "unavailable" }); return; }
      if (request.type === "undo:get") { respond({ ok: true, ...undoBuffer.read() }); return; }
      const keys = request.keys;
      if (request.type !== "undo:clear" && (!Array.isArray(keys) || keys.length > 50 || keys.some(key => typeof key !== "string"))) {
        respond({ ok: false, status: "invalid" }); return;
      }
      if (operationRunning || undoBuffer.busy) { respond({ ok: false, status: "busy" }); return; }
      if (request.type !== "undo:restore") {
        undoBuffer.remove(request.type === "undo:clear" ? undefined : keys as string[]);
        respond({ ok: true, ...undoBuffer.read() }); return;
      }
      operationRunning = true;
      void (async () => {
        try { const result = await undoBuffer.restore(keys as string[], restoreClosedEntry); respond({ ok: true, ...result, ...undoBuffer.read() }); }
        catch { respond({ ok: false, status: "failed" }); }
        finally {
          operationRunning = false;
          await effects.onSettled();
        }
      })();
      return true;
    }
    if (!request || !["preview:get", "preview:cancel", "preview:confirm"].includes(String(request.type))) return;
    const saved = pendingPreview;
    const expected = saved && myBrowser.runtime.getURL("preview.html") + "?token=" + saved.plan.token;
    if (!saved || sender.id !== myBrowser.runtime.id || sender.url !== expected ||
        sender.tab?.windowId !== saved.plan.originWindowId || sender.tab.incognito !== saved.origin.incognito || (saved.workflow && workflowContainers() && (!("cookieStoreId" in sender.tab) || !("cookieStoreId" in saved.origin) || sender.tab.cookieStoreId !== saved.origin.cookieStoreId)) || !isLivePreview(saved.plan, request.token)) {
      respond({ ok: false, status: "expired" }); return;
    }
    if (request.type === "preview:get") { respond({ ok: true, plan: saved.plan }); return; }
    // Consume synchronously, before any await: double-confirm and cancel races
    // cannot execute the same plan twice. No plan is persisted across restart.
    pendingPreview = undefined;
    if (request.type === "preview:cancel") { respond({ ok: true, status: "cancelled" }); return; }
    void runOperation(saved.work, saved.origin, saved).then(status => respond({ ok: status === "complete", status }),
      () => respond({ ok: false, status: "failed" }));
    return true;
  });
};
const runOperation = async (work: OperationWork, clickedTab?: TabType, confirmation?: PendingPreview, workflow = confirmation?.workflow, inspect?: (value: WorkflowInspection) => void) => {
  if (operationRunning) { await noticeNotExecuted("operationBusy", clickedTab); return "busy"; }
  operationRunning = true;
  let failed = false;
  let previewCreated = false;
  let result = "complete";
  try {
    if (workflow) await validateWorkflowSource(workflow, confirmation?.origin);
    // Start all capture calls before awaiting settings or any mutation.
    let focusedWindow: Promise<WindowType | undefined>;
    /// #if BROWSER === "firefox"
    // An explicit clicked origin must not depend on an unrelated popup focus.
    focusedWindow = clickedTab?.windowId == null ? getActiveWindow() : Promise.resolve(undefined);
    /// #else
    focusedWindow = workflow ? Promise.resolve(undefined) : getActiveWindow();
    /// #endif
    const [window, tabs, windows, active] = await Promise.all([
      focusedWindow, workflow ? myBrowser.tabs.query({ windowType: "normal" }) as Promise<TabType[]> : getTabs({ scope: "all" }), getWindows(),
      clickedTab ? Promise.resolve({ ...clickedTab }) : getActiveTab(true),
    ]);
    const originWindow = clickedTab?.windowId == null ? window :
      windows.find(candidate => candidate.id === clickedTab.windowId) ??
        (window && { ...window, id: clickedTab.windowId });
    if (!originWindow) throw new Error("Operation origin unavailable");
    /// #if BROWSER === "firefox"
    if (originWindow.type !== "normal") throw new Error("Normal operation origin unavailable");
    /// #endif
    let containers = false;
    /// #if BROWSER === "firefox"
    containers = true;
    /// #endif
    const session = captureTabSession(active, originWindow, containers);
    let scopedTabs = tabs.filter(tab => isSameTabSession(tab, session) && !(workflow ? internalWorkflowTab(tab) : ownedOperationTab(tab)));
    const scopedWindowIds = new Set(scopedTabs.map(tab => tab.windowId));
    let scopedWindows = windows.filter(candidate =>
      (scopedWindowIds.has(candidate.id ?? -1) || candidate.id === originWindow.id) &&
      (candidate.incognito == null || candidate.incognito === session.incognito));
    operation = { window: { ...originWindow, incognito: session.incognito },
      tabs: scopedTabs, windows: scopedWindows, active, session, excluded: new Map(),
      protectedGroups: new Set(), keeper: "last", outcomes: new Map(),
      domains: new Map(), urls: new Map(), errors: 0, planning: false, scopeWindows: new Set(), planned: new Map(),
      allowedIds: confirmation ? new Set(confirmation.plan.targets.map(tab => tab.id)) : undefined,
      confirmedSnapshot: undefined, invalidated: false, workflow };
    if (containers && !session.store) {
      operation.errors++;
      await noticeNotExecuted("operationFailed", active);
      return "failed";
    }
    const setting = await getSetting();
    let fingerprint: string | undefined;
    if (confirmation || setting.preview_before || workflow) {
      if (!active?.id || ownedOperationTab(active) || originWindow.id == null) throw new Error("Preview origin unavailable");
      const [currentOrigin, currentTabs, currentWindows] = await Promise.all([getTab(active.id), capturedTabs(), getWindows()]);
      scopedTabs = currentTabs.filter(tab => isSameTabSession(tab, session) && !ownedOperationTab(tab));
      const ids = new Set(scopedTabs.map(tab => tab.windowId));
      scopedWindows = currentWindows.filter(candidate => (ids.has(candidate.id ?? -1) || candidate.id === originWindow.id) && (candidate.incognito == null || candidate.incognito === session.incognito));
      operation.tabs = scopedTabs; operation.windows = scopedWindows;
      if (!isSameTabSession(currentOrigin, session)) throw new Error("Preview origin session changed");
      fingerprint = previewFingerprint(scopedTabs, scopedWindows, setting, currentOrigin);
      if (confirmation && (!isLivePreview(confirmation.plan, confirmation.plan.token) || fingerprint !== confirmation.fingerprint)) {
        failed = true; return "stale";
      }
    }
    if (confirmation) {
      operation.confirmedSnapshot = { tabs: scopedTabs.map(tab => ({ ...tab })), setting };
      operation.tabs = scopedTabs.map(tab => ({ ...tab, active: confirmation.activeIds.has(tab.id!) }));
    }
    operation.planning = (setting.preview_before || !!workflow) && !confirmation;
    const originalTabs = [...operation.tabs];
    if (!inspect) await showOperation("operationRunning");
    await work(workflow ? { ...setting, ...workflow.draft.operations, ...(workflow.source.kind === "draft-rule" && workflow.source.ruleId ? { glue: false, depclean: false, sorttab: false, refresh: false, comclose: false, rxclose: false, closelocal: false, grouping: false } : {}), currentonly: workflow.draft.scope === "win", urlmatch: false, urlmatch_pattern: "", preview_before: true } : setting);
    if (operation.planning) {
      const plan: PreviewPlan = { token: crypto.randomUUID(), expiresAt: Date.now() + PREVIEW_TTL_MS,
        originId: active!.id!, originWindowId: originWindow.id!, windowIds: [...operation.scopeWindows].sort((a,b) => a-b),
        targets: originalTabs.filter(tab => tab.id != null && operation!.planned.has(tab.id)).map(tab => previewRow(tab, [...operation!.planned.get(tab.id!)!])),
        excluded: originalTabs.filter(tab => tab.id != null && operation!.excluded.has(tab.id)).map(tab => previewRow(tab, operation!.excluded.get(tab.id!)!)) };
      if (workflow) {
        const rules = workflowExecutionRules(workflow);
        const row = (value: typeof plan.targets[number]): WorkflowRow => {
          const matches = matchingWorkflowRules(value.url, rules);
          return { ...value, ruleIds: matches.map(rule => rule.id), ruleNames: matches.map(rule => rule.name) };
        };
        const scoped = originalTabs.filter(tab => workflow.draft.scope === "all" || tab.windowId === workflow.origin.windowId);
        const candidates = scoped.filter(tab => matchingWorkflowRules(tab.url, rules).length);
        const relevant = new Set([...candidates.map(tab => tab.id), ...plan.targets.map(tab => tab.id)]);
        // Protection rows include only rule candidates or tabs selected by another enabled action.
        const other = workflow.source.kind === "saved" || !workflow.source.ruleId;
        const protectedTargets = plan.excluded.filter(tab => relevant.has(tab.id) || (other && workflowProtectionTarget(originalTabs.find(item => item.id === tab.id)!, workflow, setting, originalTabs)));
        plan.excluded = protectedTargets;
        Object.assign(plan, { targets: plan.targets.map(row), excluded: protectedTargets.map(row) });
        if (inspect) { inspect({ candidateCount: candidates.length, targetCount: plan.targets.length, excludedCount: plan.excluded.length, targets: plan.targets.map(row), excluded: plan.excluded.map(row) }); return "inspected"; }
        if (!plan.targets.length) return "empty";
        await validateWorkflowSource(workflow, active);
      }
      pendingPreview = { ...(workflow ? { workflow } : {}), plan, fingerprint: fingerprint!, origin: { ...active! }, activeIds: new Set(originalTabs.filter(tab => tab.active).map(tab => tab.id!)), work };
      registerOperationMessages();
      try {
        const created = await myBrowser.tabs.create({ windowId: originWindow.id, url: myBrowser.runtime.getURL("preview.html") + "?token=" + plan.token });
        if (workflow && (created.windowId !== originWindow.id || !isSameTabSession(created, session))) { pendingPreview = undefined; return "unavailable"; }
      }
      catch (error) { pendingPreview = undefined; throw error; }
      previewCreated = true; result = "preview";
    }
  } catch (error) {
    failed = true; result = error instanceof WorkflowError ? error.status : "failed";
  } finally {
    const outcomes = Array.from(operation?.outcomes.values() ?? []);
    if (operation?.errors) result = "failed";
    if (!inspect) await showOperation(failed ? "operationFailed" : previewCreated ? "previewPending" : "operationResult", [
      outcomes.length, outcomes.filter(v => v === "success").length,
      outcomes.filter(v => v === "failed").length, outcomes.filter(v => v === "unknown").length,
      operation?.errors ?? (failed ? 1 : 0),
    ]);
    operation = undefined;
    operationRunning = false;
    // Badge and menu updates wait during an operation; apply its result once.
    if (!inspect) await effects.onSettled();
  }
  return result;
};

const { actionWork, applyProtection, closeTabs, glueTabs, sortTabs, refreshTabs, moveCurrentTabToNewWindow, moveTabsToNewWindow, extractDuplicatedTabIds, extractRXMatchTabIds, extractSameDomainTabIds, extractEndWithGivenDomainTabIds, operationDomain } = createOperationActions({
  getOperation: () => {
    if (!operation) throw new Error("Operation context unavailable");
    return operation;
  },
  perform, recheckPreviewMutation, recordOutcome,
  recordClosedTabs: (tabs, containers) => {
    if (undoBuffer.record(tabs, containers)) registerOperationMessages();
  },
});
const handleAction = (clickedTab?: TabType) => runOperation(actionWork, clickedTab);

const handleCommand = (command: string) => runOperation(async (setting) => {
  applyProtection(setting);
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
    const activeTab = operation!.active;
    if (activeTab != null) {
      await moveTabsToNewWindow(setting.contextmenu4scope, (tabs) =>
        extractSameDomainTabIds(tabs, activeTab)
      );
    }
  } else if (command === "07_execute_option5") {
    await closeTabs(scope, (tabs) => extractRXMatchTabIds(tabs, SYSTEM_PAGE_RULE), "system");
  } else if (command === "08_execute_option2") {
    await closeTabs(scope, (tabs) => extractDuplicatedTabIds(tabs), "duplicate");
  } else if (command === "09_execute_option7") {
    await closeTabs(scope, (tabs) => extractRXMatchTabIds(tabs, RX_SEARCH_ENGINE), "search");
  } else if (command === "10_execute_option9_d") {
    const activeTab = operation!.active;
    if (activeTab == null) return;
    await closeTabs(setting.contextmenu1scope, (tabs) =>
      extractSameDomainTabIds(tabs, activeTab)
    );
  }

});

const handleContextMenu = async (info: { menuItemId: string | number }, activeTab: TabType, invocation: MenuInvocation) => {
  const { settingsSnapshot: menuSnapshot, detailedTarget, recoverTarget } = invocation;
  await runOperation(async (setting) => {
  applyProtection(setting);
  const origin = operation!.active;
  const menuItemId = info.menuItemId;
  if (origin == null || !invocation.isReady()) return;
  const menuSetting = menuSnapshot ?? setting;

  if (menuItemId === "ohmytab_close_tabs") {
    // Close Tabs (Same Domain)
    await closeTabs(menuSetting.contextmenu1scope, (tabs) =>
      extractSameDomainTabIds(tabs, origin)
    );
  } else if (menuItemId === "ohmytab_extract_tabs") {
    // Extract Tabs (Same Domain);
    await moveTabsToNewWindow(menuSetting.contextmenu4scope, (tabs) =>
      extractSameDomainTabIds(tabs, origin)
    );
  } else if (menuItemId === "ohmytab_glue_windows") {
    // Glue Windows
    await glueTabs();
  } else if (menuItemId === "ohmytab_extract_tab") {
    // Extract Tab
    await moveCurrentTabToNewWindow();
  } else {
    const target = detailedTarget ??
      (recoverTarget ? recoverDetailedMenuTarget(menuItemId, menuSetting, origin.url) : undefined);
    if (target && !origin.pinned && operationDomain(origin.url)) {
      const extract = (tabs: TabType[]) => extractEndWithGivenDomainTabIds(tabs, target.domain);
      if (target.action === "close") await closeTabs(target.scope, extract);
      else await moveTabsToNewWindow(target.scope, extract);
    }
  }

  }, activeTab);
};

const workflowWork: OperationWork = async setting => {
  const execution = operation!.workflow!;
  if (execution.source.kind === "draft-rule" && execution.source.ruleId) {
    applyProtection(setting);
    const rules = workflowExecutionRules(execution);
    await closeTabs(execution.draft.scope, tabs => tabs2TabIds(tabs.filter(tab => matchingWorkflowRules(tab.url, rules).length)), "urlRule");
  } else await actionWork(setting);
};
const inspectWorkflow = async (input: WorkflowInput) => {
  if ((await readWorkflowStore()).revision !== input.expectedStoreRevision) throw new WorkflowError("stale");
  const canonicalDraft = bindWorkflowDraft(input);
  if (input.ruleId && !input.draft.rules.some(rule => rule.id === input.ruleId)) throw new WorkflowError("invalid", "rules", input.ruleId);
  const execution: WorkflowExecution = { origin: input.origin, draft: input.draft, source: { kind: "draft-rule", optionsTabId: input.optionsTabId, editorId: input.editorId, draftRevision: input.draftRevision, ruleId: input.ruleId ?? "", canonicalDraft, storeRevision: input.expectedStoreRevision } };
  if (!input.ruleId && workflowContainers() && input.draft.operations.grouping) throw new WorkflowError("unsupported");
  const origin = await workflowOrigin(input.origin, input.optionsTabId);
  let inspection: WorkflowInspection | undefined;
  const status = await runOperation(workflowWork, origin, undefined, execution, value => { inspection = value; });
  if (!inspection) throw new WorkflowError(status === "busy" ? "busy" : status === "stale" ? "stale" : "failed");
  await validateWorkflowSource(execution, origin);
  return inspection;
};
const previewWorkflow = async (execution: WorkflowExecution) => {
  if (execution.source.kind === "saved" && workflowContainers() && execution.draft.operations.grouping) throw new WorkflowError("unsupported");
  const origin = await workflowOrigin(execution.origin);
  const status = await runOperation(workflowWork, origin, undefined, execution);
  if (status !== "preview" && status !== "empty") throw new WorkflowError(["busy", "stale", "unavailable"].includes(status) ? status as "busy" | "stale" | "unavailable" : "failed");
  return { ok: true as const, status };
};
const previewWorkflowRule = async (input: WorkflowInput & { ruleId: string }) => {
  if ((await readWorkflowStore()).revision !== input.expectedStoreRevision) throw new WorkflowError("stale");
  const canonicalDraft = bindWorkflowDraft(input);
  if (!input.draft.rules.some(rule => rule.id === input.ruleId)) throw new WorkflowError("invalid", "rules", input.ruleId);
  await workflowOrigin(input.origin, input.optionsTabId);
  return previewWorkflow({ origin: input.origin, draft: input.draft, source: { kind: "draft-rule", optionsTabId: input.optionsTabId, editorId: input.editorId, draftRevision: input.draftRevision, ruleId: input.ruleId, canonicalDraft, storeRevision: input.expectedStoreRevision } });
};
const invalidateSavedWorkflows = () => { if (pendingPreview?.workflow) pendingPreview = undefined; };
return { handleAction, handleCommand, handleContextMenu, noticeNotExecuted, isRunning: () => operationRunning, inspectWorkflow, previewWorkflow, previewWorkflowRule, invalidateWorkflowDraft, invalidateSavedWorkflows };
};
