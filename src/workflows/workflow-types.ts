export type WorkflowScope = "win" | "all";
export type WorkflowCondition = { kind: "host"; value: string; includeSubdomains: boolean } | { kind: "contains"; value: string } | { kind: "glob"; value: string };
export type WorkflowRule = { id: string; name: string; enabled: boolean; condition: WorkflowCondition };
export type WorkflowOperations = {
  glue: boolean; depclean: boolean; sorttab: boolean; sortkey: "url" | "title";
  refresh: boolean; comclose: boolean; rxclose: boolean; closelocal: boolean;
  grouping: boolean; grouping_min: number;
};
export type WorkflowDraft = { name: string; scope: WorkflowScope; rules: WorkflowRule[]; operations: WorkflowOperations };
export type SavedWorkflow = WorkflowDraft & { id: string; revision: number };
export type WorkflowStore = { version: 1; revision: number; workflows: SavedWorkflow[] };
export type DraftIdentity = { editorId: string; draftRevision: number };
export type Origin = { tabId: number; windowId: number };
export type WorkflowRow = { id: number; windowId: number; title: string; url: string; ruleIds: string[]; ruleNames: string[]; reasons: string[] };
export type WorkflowInspection = { candidateCount: number; targetCount: number; excludedCount: number; targets: WorkflowRow[]; excluded: WorkflowRow[] };
export type WorkflowErrorStatus = "invalid" | "unavailable" | "conflict" | "failed" | "busy" | "stale" | "unsupported";
export type WorkflowFailure = { ok: false; status: WorkflowErrorStatus; field?: string; ruleId?: string };
export type WorkflowReply = WorkflowFailure | { ok: true; store: WorkflowStore } |
  { ok: true; windowId: number; origins: Array<Origin & { title: string; url: string }> } |
  { ok: true; editorId: string; draftRevision: number; inspection: WorkflowInspection } |
  { ok: true; status: "preview" | "empty" } | { ok: true };
export class WorkflowError extends Error {
  constructor(public status: WorkflowErrorStatus, public field?: string, public ruleId?: string) { super(status); }
}
export type WorkflowExecution = {
  origin: Origin;
  source: { kind: "saved"; id: string; storeRevision: number; workflowRevision: number } |
    { kind: "draft-rule"; optionsTabId: number; editorId: string; draftRevision: number; ruleId: string; canonicalDraft: string; storeRevision: number };
  draft: WorkflowDraft;
};
export type WorkflowInput = DraftIdentity & { optionsTabId: number; origin: Origin; draft: WorkflowDraft; ruleId?: string; expectedStoreRevision: number };
export type WorkflowRequest =
 | { type: "workflow:list" | "workflow:context" }
 | { type: "workflow:create"; expectedRevision: number; draft: WorkflowDraft }
 | { type: "workflow:update"; expectedRevision: number; id: string; expectedWorkflowRevision: number; draft: WorkflowDraft }
 | { type: "workflow:duplicate"; expectedRevision: number; id: string; expectedWorkflowRevision: number; name: string }
 | { type: "workflow:delete"; expectedRevision: number; id: string; expectedWorkflowRevision: number }
 | ({ type: "workflow:draft-changed" } & DraftIdentity)
 | ({ type: "workflow:inspect" | "workflow:preview-rule"; origin: Origin; draft: WorkflowDraft; ruleId?: string; expectedStoreRevision: number } & DraftIdentity)
 | { type: "workflow:preview-saved"; origin: Origin; id: string; expectedRevision: number; expectedWorkflowRevision: number };
