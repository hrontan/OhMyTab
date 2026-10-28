import type { TabType } from "../browser/browser-api";
import type { SettingType } from "../settings/setting";
import { duplicateTabIds } from "../operations/tab-protection";
import { RX_LOCAL, RX_SEARCH_ENGINE, SYSTEM_PAGE_RULE } from "../rules/regex";
import { compileWorkflowRules } from "./workflow-rules";
import { readWorkflowStore } from "./workflow-storage";
import { workflowOrigin, workflowOptionsTab } from "./workflow-origin";
import { WorkflowError, type WorkflowExecution, type WorkflowInput } from "./workflow-types";

export const workflowExecutionRules = (execution: WorkflowExecution) => {
  const selected = execution.source.kind === "draft-rule" ? execution.source.ruleId : "";
  return compileWorkflowRules(selected ? execution.draft.rules.filter(rule => rule.id === selected).map(rule => ({ ...rule, enabled: true })) : execution.draft.rules);
};
export const workflowProtectionTarget = (tab: TabType, execution: WorkflowExecution, setting: SettingType, tabs: TabType[]) => {
  if (execution.draft.scope === "win" && tab.windowId !== execution.origin.windowId) return false;
  const op = execution.draft.operations;
  return op.sorttab || (op.glue && tab.windowId !== execution.origin.windowId) || (op.refresh && tab.discarded) ||
    (op.grouping && !!tab.url?.startsWith("http")) || (op.comclose && SYSTEM_PAGE_RULE.test(tab.url ?? "")) ||
    (op.rxclose && RX_SEARCH_ENGINE.test(tab.url ?? "")) || (op.closelocal && RX_LOCAL.test(tab.url ?? "")) ||
    (op.depclean && duplicateTabIds(tabs, setting.duplicate_keep, execution.origin.tabId).includes(tab.id!));
};

export const createWorkflowExecutionGuard = () => {
const drafts = new Map<string, { revision: number; canonical?: string }>();
const draftKey = (tabId: number, editorId: string) => tabId + ":" + editorId;
const invalidateDraft = (input: { optionsTabId: number; editorId: string; draftRevision: number }) => {
  const key = draftKey(input.optionsTabId, input.editorId), previous = drafts.get(key);
  if (previous && input.draftRevision < previous.revision) throw new WorkflowError("stale");
  if (!previous || input.draftRevision > previous.revision) drafts.set(key, { revision: input.draftRevision });
};
const bindDraft = (input: WorkflowInput) => {
  invalidateDraft(input);
  const state = drafts.get(draftKey(input.optionsTabId, input.editorId))!, canonical = JSON.stringify({ draft: input.draft, origin: input.origin, ruleId: input.ruleId ?? "", storeRevision: input.expectedStoreRevision });
  if (state.canonical && state.canonical !== canonical) throw new WorkflowError("stale");
  state.canonical = canonical;
  return canonical;
};
const validateSource = async (execution: WorkflowExecution, expected?: TabType) => {
  const source = execution.source;
  await workflowOrigin(execution.origin, source.kind === "draft-rule" ? source.optionsTabId : undefined, expected);
  if (source.kind === "saved") {
    const store = await readWorkflowStore(), saved = store.workflows.find(item => item.id === source.id);
    if (store.revision !== source.storeRevision || saved?.revision !== source.workflowRevision ||
        JSON.stringify(saved && { name: saved.name, scope: saved.scope, rules: saved.rules, operations: saved.operations }) !== JSON.stringify(execution.draft)) throw new WorkflowError("stale");
  } else {
    await workflowOptionsTab(source.optionsTabId);
    if ((await readWorkflowStore()).revision !== source.storeRevision) throw new WorkflowError("stale");
    const state = drafts.get(draftKey(source.optionsTabId, source.editorId));
    if (!state || state.revision !== source.draftRevision || state.canonical !== source.canonicalDraft) throw new WorkflowError("stale");
  }
};
return { invalidateDraft, bindDraft, validateSource };
};
