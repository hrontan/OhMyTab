import { getStorageKeys, setStorage } from "../browser/browser-api";
import { revision, strictObject, uuid, validateWorkflowDraft, workflowName } from "./workflow-rules";
import { WorkflowError, type WorkflowDraft, type WorkflowStore } from "./workflow-types";
export const WORKFLOW_STORAGE_KEY = "saved_workflows_v1";
export type WorkflowMutation = { type: "create"; draft: WorkflowDraft } |
  { type: "update"; id: string; expectedWorkflowRevision: number; draft: WorkflowDraft } |
  { type: "duplicate"; id: string; expectedWorkflowRevision: number; name: string } |
  { type: "delete"; id: string; expectedWorkflowRevision: number };
export const validateWorkflowStore = (input: unknown): WorkflowStore => {
  const store = strictObject(input, ["version", "revision", "workflows"]);
  if (store.version !== 1 || !Array.isArray(store.workflows) || store.workflows.length > 20) throw new WorkflowError("invalid");
  const ids = new Set<string>();
  const workflows = store.workflows.map((value: unknown) => {
    const row = strictObject(value, ["id", "revision", "name", "scope", "rules", "operations"]), id = uuid(row.id), rev = revision(row.revision);
    if (!rev || ids.has(id.toLowerCase())) throw new WorkflowError("invalid");
    ids.add(id.toLowerCase());
    const draft = validateWorkflowDraft({ name: row.name, scope: row.scope, rules: row.rules, operations: row.operations });
    for (const rule of draft.rules) {
      if (ids.has(rule.id.toLowerCase())) throw new WorkflowError("invalid");
      ids.add(rule.id.toLowerCase());
    }
    return { ...draft, id, revision: rev };
  });
  const result: WorkflowStore = { version: 1, revision: revision(store.revision), workflows };
  if (new TextEncoder().encode(JSON.stringify({ [WORKFLOW_STORAGE_KEY]: result })).length > 262144) throw new WorkflowError("invalid");
  return result;
};
export const readWorkflowStore = async (): Promise<WorkflowStore> => {
  try {
    const value = (await getStorageKeys([WORKFLOW_STORAGE_KEY], "local"))[WORKFLOW_STORAGE_KEY];
    return value === undefined ? { version: 1, revision: 0, workflows: [] } : validateWorkflowStore(value);
  } catch (error) { if (error instanceof WorkflowError) throw error; throw new WorkflowError("failed"); }
};
let queue: Promise<unknown> = Promise.resolve();
export const mutateWorkflowStore = (expectedRevision: number, mutation: WorkflowMutation): Promise<WorkflowStore> => {
  const work = queue.then(async () => {
    revision(expectedRevision);
    const before = await readWorkflowStore();
    if (before.revision !== expectedRevision) throw new WorkflowError("conflict");
    if (before.revision === Number.MAX_SAFE_INTEGER) throw new WorkflowError("failed");
    const workflows = [...before.workflows];
    if (mutation.type === "create") {
      const draft = validateWorkflowDraft(mutation.draft);
      workflows.push({ ...draft, id: crypto.randomUUID(), revision: 1, rules: draft.rules.map(rule => ({ ...rule, id: crypto.randomUUID() })) });
    } else {
      const index = workflows.findIndex(row => row.id === uuid(mutation.id)), current = workflows[index];
      if (!current || current.revision !== revision(mutation.expectedWorkflowRevision)) throw new WorkflowError("conflict");
      if (mutation.type === "delete") workflows.splice(index, 1);
      else if (mutation.type === "duplicate") workflows.push({ ...current, name: workflowName(mutation.name), id: crypto.randomUUID(), revision: 1, rules: current.rules.map(rule => ({ ...rule, id: crypto.randomUUID() })) });
      else {
        if (current.revision === Number.MAX_SAFE_INTEGER) throw new WorkflowError("failed");
        workflows[index] = { ...validateWorkflowDraft(mutation.draft), id: current.id, revision: current.revision + 1 };
      }
    }
    const intended = validateWorkflowStore({ version: 1, revision: before.revision + 1, workflows });
    try {
      await setStorage({ [WORKFLOW_STORAGE_KEY]: intended }, "local");
      const actual = await readWorkflowStore();
      if (JSON.stringify(actual) !== JSON.stringify(intended)) throw new WorkflowError("failed");
      return actual;
    } catch { throw new WorkflowError("failed"); }
  });
  queue = work.catch(() => undefined);
  return work;
};
