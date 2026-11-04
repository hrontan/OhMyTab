import { myBrowser, type TabType } from "../browser/browser-api";
import { captureTabSession, isSameTabSession } from "../operations/tab-session";
import type { createOperationRuntime } from "../operations/operation-runtime";
import { mutateWorkflowStore, readWorkflowStore, WORKFLOW_STORAGE_KEY } from "./workflow-storage";
import { revision, strictObject, uuid, validateWorkflowDraft, workflowName } from "./workflow-rules";
import { internalWorkflowTab, workflowContainers, workflowOptionsTab, workflowOrigin } from "./workflow-origin";
import { WorkflowError, type Origin, type WorkflowInput } from "./workflow-types";
export type WorkflowRuntime = ReturnType<typeof createOperationRuntime>;
const identity = (value: unknown) => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new WorkflowError("invalid");
  return value;
};
const parseOrigin = (value: unknown): Origin => {
  const origin = strictObject(value, ["tabId", "windowId"]);
  return { tabId: identity(origin.tabId), windowId: identity(origin.windowId) };
};
const fields: Record<string, string[]> = {
  "workflow:list": [], "workflow:context": [],
  "workflow:create": ["expectedRevision", "draft"],
  "workflow:update": ["expectedRevision", "id", "expectedWorkflowRevision", "draft"],
  "workflow:duplicate": ["expectedRevision", "id", "expectedWorkflowRevision", "name"],
  "workflow:delete": ["expectedRevision", "id", "expectedWorkflowRevision"],
  "workflow:draft-changed": ["editorId", "draftRevision"],
  "workflow:inspect": ["editorId", "draftRevision", "origin", "draft", "ruleId", "expectedStoreRevision"],
  "workflow:preview-rule": ["editorId", "draftRevision", "origin", "draft", "ruleId", "expectedStoreRevision"],
  "workflow:preview-saved": ["origin", "id", "expectedRevision", "expectedWorkflowRevision"],
};
export const registerWorkflowMessages = (runtime: WorkflowRuntime): void => {
  myBrowser.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && WORKFLOW_STORAGE_KEY in changes) runtime.invalidateSavedWorkflows();
  });
  myBrowser.runtime.onMessage.addListener((message: unknown, sender, respond) => {
    if (!message || typeof message !== "object" || !("type" in message) || typeof message.type !== "string" || !message.type.startsWith("workflow:")) return;
    try {
      const keys = fields[message.type];
      if (!keys || new TextEncoder().encode(JSON.stringify(message)).length > 300000) throw new WorkflowError("invalid");
      const request = strictObject(message, ["type", ...keys]), type = message.type;
      if (keys.some(key => key !== "ruleId" && !(key in request))) throw new WorkflowError("invalid");
      if (sender.id !== myBrowser.runtime.id || sender.url !== myBrowser.runtime.getURL("options.html") || sender.tab?.id == null || sender.tab.windowId == null) throw new WorkflowError("unavailable");
      const optionsTabId = sender.tab.id, senderTab = sender.tab;
      // Invalidate immediately; debounce is exclusively a UI inspection concern.
      const draftIdentity = "editorId" in request ? { optionsTabId, editorId: uuid(request.editorId), draftRevision: revision(request.draftRevision) } : undefined;
      if (draftIdentity) runtime.invalidateWorkflowDraft(draftIdentity);
      const expectedRevision = "expectedRevision" in request ? revision(request.expectedRevision) : undefined;
      const expectedStoreRevision = "expectedStoreRevision" in request ? revision(request.expectedStoreRevision) : undefined;
      const id = "id" in request ? uuid(request.id) : undefined;
      const expectedWorkflowRevision = "expectedWorkflowRevision" in request ? revision(request.expectedWorkflowRevision) : undefined;
      const draft = "draft" in request ? validateWorkflowDraft(request.draft) : undefined;
      const origin = "origin" in request ? parseOrigin(request.origin) : undefined;
      const ruleId = "ruleId" in request ? uuid(request.ruleId) : undefined;
      if (type === "workflow:preview-rule" && !ruleId) throw new WorkflowError("invalid");
      const name = "name" in request ? workflowName(request.name) : undefined;
      void (async () => {
        try {
          const options = await workflowOptionsTab(optionsTabId);
          if (options.windowId !== senderTab.windowId || options.incognito !== senderTab.incognito || (workflowContainers() && (!("cookieStoreId" in senderTab) || !("cookieStoreId" in options) || senderTab.cookieStoreId !== options.cookieStoreId))) throw new WorkflowError("unavailable");
          if (origin) await workflowOrigin(origin, optionsTabId);
          if (type === "workflow:draft-changed") { respond({ ok: true }); return; }
          if (type === "workflow:list") { respond({ ok: true, store: await readWorkflowStore() }); return; }
          if (type === "workflow:context") {
            const session = captureTabSession(options, { incognito: options.incognito } as chrome.windows.Window, workflowContainers());
            const tabs = await myBrowser.tabs.query({ windowId: options.windowId });
            respond({ ok: true, windowId: options.windowId, origins: tabs.filter(tab => tab.id != null && tab.windowId === options.windowId && !internalWorkflowTab(tab as TabType) && isSameTabSession(tab as TabType, session)).map(tab => ({ tabId: tab.id, windowId: tab.windowId, title: tab.title ?? "", url: tab.url ?? "" })) }); return;
          }
          if (type === "workflow:inspect" || type === "workflow:preview-rule") {
            if ((await readWorkflowStore()).revision !== expectedStoreRevision) throw new WorkflowError("stale");
            const input: WorkflowInput = { ...draftIdentity!, origin: origin!, draft: draft!, expectedStoreRevision: expectedStoreRevision!, ...(ruleId ? { ruleId } : {}) };
            if (type === "workflow:inspect") respond({ ok: true, editorId: input.editorId, draftRevision: input.draftRevision, inspection: await runtime.inspectWorkflow(input) });
            else respond(await runtime.previewWorkflowRule({ ...input, ruleId: ruleId! }));
            return;
          }
          if (type === "workflow:preview-saved") {
            const store = await readWorkflowStore(), saved = store.workflows.find(row => row.id === id);
            if (store.revision !== expectedRevision || saved?.revision !== expectedWorkflowRevision || !saved) throw new WorkflowError("conflict");
            const { id: savedId, revision: savedRevision, ...savedDraft } = saved;
            respond(await runtime.previewWorkflow({ origin: origin!, draft: savedDraft, source: { kind: "saved", id: savedId, storeRevision: store.revision, workflowRevision: savedRevision } })); return;
          }
          const mutation = type === "workflow:create" ? { type: "create" as const, draft: draft! } : type === "workflow:update" ? { type: "update" as const, id: id!, expectedWorkflowRevision: expectedWorkflowRevision!, draft: draft! } : type === "workflow:duplicate" ? { type: "duplicate" as const, id: id!, expectedWorkflowRevision: expectedWorkflowRevision!, name: name! } : { type: "delete" as const, id: id!, expectedWorkflowRevision: expectedWorkflowRevision! };
          respond({ ok: true, store: await mutateWorkflowStore(expectedRevision!, mutation) });
        } catch (error) { respond(failure(error)); }
      })();
      return true;
    } catch (error) { respond(failure(error)); return; }
  });
};
const failure = (error: unknown) => error instanceof WorkflowError ? { ok: false, status: error.status, ...(error.field ? { field: error.field } : {}), ...(error.ruleId ? { ruleId: error.ruleId } : {}) } : { ok: false, status: "failed" };
