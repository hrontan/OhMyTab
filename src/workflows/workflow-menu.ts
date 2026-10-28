import type { TabType } from "../browser/browser-api";
import type { WorkflowRuntime } from "./workflow-service";
import { readWorkflowStore } from "./workflow-storage";
import { workflowOrigin } from "./workflow-origin";
import { WorkflowError, type WorkflowStore, type SavedWorkflow } from "./workflow-types";

const prefix = "ohmytab_workflow:";
export const workflowMenuId = (store: WorkflowStore, saved: SavedWorkflow) =>
  `${prefix}${store.revision}:${saved.id}:${saved.revision}`;
export const isWorkflowMenu = (id: string | number) => String(id).startsWith(prefix);

/** The displayed revisions survive worker unload; never resolve an old row to new content. */
export const previewWorkflowMenu = async (id: string | number, tab: TabType | undefined, runtime: WorkflowRuntime) => {
  try {
    if (tab?.id == null || tab.windowId == null) throw new WorkflowError("unavailable");
    const store = await readWorkflowStore();
    const saved = store.workflows.find(row => workflowMenuId(store, row) === id);
    if (!saved) throw new WorkflowError("conflict");
    const origin = { tabId: tab.id, windowId: tab.windowId };
    await workflowOrigin(origin, undefined, tab);
    const { id: savedId, revision, ...draft } = saved;
    return await runtime.previewWorkflow({ origin, draft, source: { kind: "saved", id: savedId, storeRevision: store.revision, workflowRevision: revision } });
  } catch (error) {
    if (tab) await runtime.noticeNotExecuted(error instanceof WorkflowError && error.status === "conflict" ? "workflowError_conflict" : "workflowError_unavailable", tab);
    return { ok: false as const, status: error instanceof WorkflowError ? error.status : "failed" };
  }
};
