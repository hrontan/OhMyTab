import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { installSettingsBrowser } from "../helpers/settings-browser";
import type { BrowserTarget } from "../helpers/browser";
import type { WorkflowRuntime } from "../../src/workflows/workflow-service";
import type { WorkflowStore } from "../../src/workflows/workflow-types";
import { draft } from "./fixtures";

const target = process.env.TEST_BROWSER as BrowserTarget;
let mock: ReturnType<typeof installSettingsBrowser>;
const tab = { id: 7, windowId: 4, incognito: false, url: "https://example.com/", ...(target === "firefox" ? { cookieStoreId: "firefox-default" } : {}) } as chrome.tabs.Tab;
const store = (): WorkflowStore => ({ version: 1, revision: 3, workflows: [{ ...draft(), id: "22222222-2222-4222-8222-222222222222", revision: 2 }] });
beforeEach(() => {
  vi.resetModules(); mock = installSettingsBrowser(target);
  Object.assign(mock.runtime, { getURL: (path: string) => "chrome-extension://fixture/" + path });
  mock.localData.saved_workflows_v1 = store();
  mock.api.tabs.get.mockImplementation(async id => ({ ...tab, id, status: "complete" }));
  mock.api.windows.getAll.mockResolvedValue([{ id: 4, type: "normal", incognito: false }] as chrome.windows.Window[]);
});
afterEach(() => vi.unstubAllGlobals());
const runtime = () => ({ previewWorkflow: vi.fn(async () => ({ ok: true, status: "preview" })), noticeNotExecuted: vi.fn(async () => {}) });

test("saved menu binds clicked origin and both revisions, including after worker restart", async () => {
  let menu = await import("../../src/workflows/workflow-menu");
  const saved = store(), id = menu.workflowMenuId(saved, saved.workflows[0]!);
  vi.resetModules(); menu = await import("../../src/workflows/workflow-menu");
  const run = runtime();
  await expect(menu.previewWorkflowMenu(id, tab, run as unknown as WorkflowRuntime)).resolves.toMatchObject({ ok: true, status: "preview" });
  expect(run.previewWorkflow).toHaveBeenCalledWith({ origin: { tabId: 7, windowId: 4 }, draft: draft(), source: { kind: "saved", id: saved.workflows[0]!.id, storeRevision: 3, workflowRevision: 2 } });
  expect(mock.api.tabs.remove).not.toHaveBeenCalled();
});

test("updated, deleted or malformed displayed IDs never select newer saved content", async () => {
  const menu = await import("../../src/workflows/workflow-menu"), saved = store();
  const id = menu.workflowMenuId(saved, saved.workflows[0]!), run = runtime();
  for (const next of [{ ...saved, revision: 4 }, { ...saved, workflows: [{ ...saved.workflows[0]!, revision: 3 }] }, { ...saved, workflows: [] }]) {
    mock.localData.saved_workflows_v1 = next;
    await expect(menu.previewWorkflowMenu(id, tab, run as unknown as WorkflowRuntime)).resolves.toMatchObject({ ok: false, status: "conflict" });
  }
  await menu.previewWorkflowMenu("ohmytab_workflow:bad", tab, run as unknown as WorkflowRuntime);
  expect(run.previewWorkflow).not.toHaveBeenCalled();
});

test("missing tab, moved window, changed private/container metadata and extension pages fail closed", async () => {
  const menu = await import("../../src/workflows/workflow-menu"), saved = store(), run = runtime();
  const id = menu.workflowMenuId(saved, saved.workflows[0]!);
  await expect(menu.previewWorkflowMenu(id, undefined, run as unknown as WorkflowRuntime)).resolves.toMatchObject({ ok: false, status: "unavailable" });
  for (const next of [{ ...tab, windowId: 5 }, { ...tab, incognito: true }, { ...tab, url: "chrome-extension://fixture/options.html" }, ...(target === "firefox" ? [{ ...tab, cookieStoreId: "firefox-container-1" }] : [])]) {
    mock.api.tabs.get.mockResolvedValue({ ...next, id: next.id!, status: "complete" });
    await expect(menu.previewWorkflowMenu(id, tab, run as unknown as WorkflowRuntime)).resolves.toMatchObject({ ok: false });
  }
  expect(run.previewWorkflow).not.toHaveBeenCalled();
});
