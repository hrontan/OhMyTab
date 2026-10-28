import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { installSettingsBrowser } from "../helpers/settings-browser.ts";
import type { BrowserTarget } from "../helpers/browser.ts";
import type { WorkflowReply, WorkflowRequest, WorkflowStore } from "../../src/workflows/workflow-types.ts";

class Element {
  value = ""; open = false; checked = false; disabled = false; hidden = false; id = ""; type = "";
  dataset: Record<string, string> = {}; attributes: Record<string, string> = {};
  children: Element[] = []; ownText = ""; focused = false;
  parentElement?: Element;
  listeners: Record<string, (() => unknown)[]> = {}; onchange?: () => void;
  constructor(public tag: string) {}
  get textContent(): string { return this.ownText + this.children.map(child => child.textContent).join(""); }
  set textContent(value: string) { this.ownText = value; this.children = []; }
  appendChild(child: Element) { child.parentElement = this; this.children.push(child); return child; }
  replaceChildren() { this.children = []; this.ownText = ""; }
  setAttribute(key: string, value: string) { this.attributes[key] = value; }
  get isConnected(): boolean { return this.parentElement ? this.parentElement.children.includes(this) && this.parentElement.isConnected : this.id === "workflows"; }
  getClientRects(): object[] { if (this.hidden || (this.tag === "details" && !this.open)) return []; return this.parentElement?.getClientRects() ?? [{}]; }
  focus() { this.focused = true; }
  showModal() { this.open = true; }
  close() { this.open = false; }
  addEventListener(key: string, listener: () => unknown) { (this.listeners[key] ??= []).push(listener); }
  all(): Element[] { return [this, ...this.children.flatMap(child => child.all())]; }
  querySelector(selector: string): Element | undefined { return this.all().find(child => selector.startsWith("#") ? child.id === selector.slice(1) : child.tag === selector); }
  async dispatch(key: string) { this.listeners[key]?.forEach(listener => listener()); if (key === "change") this.onchange?.(); await flush(); }
}
const flush = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };
let mock: ReturnType<typeof installSettingsBrowser>;
beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); mock = installSettingsBrowser(process.env.TEST_BROWSER as BrowserTarget); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
async function editor(useTransport = false) {
  const root = new Element("section"); root.id = "workflows";
  vi.stubGlobal("getComputedStyle", () => ({ visibility: "visible" }));
  vi.stubGlobal("document", { querySelector: (selector: string) => root.querySelector(selector), createElement: (tag: string) => new Element(tag) });
  const store: WorkflowStore = { version: 1, revision: 0, workflows: [] };
  let failure: WorkflowReply | undefined;
  const messages: WorkflowRequest[] = [];
  let delayList = false;
  const listWaiting: ((reply: WorkflowReply) => void)[] = [];
  const request = vi.fn(async (input: WorkflowRequest): Promise<WorkflowReply> => {
    messages.push(structuredClone(input));
    if (input.type === "workflow:list") return delayList ? new Promise(resolve => listWaiting.push(resolve)) : { ok: true, store: structuredClone(store) };
    if (input.type === "workflow:draft-changed") return { ok: true };
    if (input.type === "workflow:context") return { ok: true, windowId: 1, origins: [{ tabId: 1, windowId: 1, title: "Origin", url: "https://keep.test" }] };
    if (input.type === "workflow:inspect") return { ok: true, editorId: input.editorId, draftRevision: input.draftRevision, inspection: { candidateCount: 1, targetCount: 1, excludedCount: 0, targets: [], excluded: [] } };
    if (input.type === "workflow:preview-rule") return { ok: true, status: "preview" };
    if (failure) return failure;
    if (input.type === "workflow:create") store.workflows.push({ ...structuredClone(input.draft), id: crypto.randomUUID(), revision: 1 });
    if (input.type === "workflow:update") store.workflows = store.workflows.map(item => item.id === input.id ? { ...structuredClone(input.draft), id: item.id, revision: item.revision + 1 } : item);
    if (input.type === "workflow:duplicate") { const source = store.workflows.find(item => item.id === input.id)!; store.workflows.push({ ...structuredClone(source), id: crypto.randomUUID(), name: input.name, revision: 1 }); }
    if (input.type === "workflow:delete") store.workflows = store.workflows.filter(item => item.id !== input.id);
    store.revision++; return { ok: true, store: structuredClone(store) };
  });
  const { initializeWorkflows } = await import("../../src/options/options-workflows.ts");
  if (useTransport) Object.assign(mock.runtime, { sendMessage: (input: WorkflowRequest, callback?: (reply: WorkflowReply) => void) => {
    const pending = request(input);
    if (process.env.TEST_BROWSER === "chrome") { void pending.then(reply => callback!(reply)); return; }
    return pending;
  } });
  await initializeWorkflows(useTransport ? undefined : request);
  const field = (id: string) => root.querySelector("#workflow_" + id)!;
  const click = async (key: string) => { const button = root.all().find(item => item.tag === "button" && item.ownText === key)!; expect(button).toBeDefined(); await button.dispatch("click"); };
  const fill = async (id: string, value: string) => { field(id).value = value; await field(id).dispatch("input"); };
  return { root, field, fill, click, messages, listWaiting, store: () => store, fail: (value?: WorkflowReply) => { failure = value; }, delayList: () => { delayList = true; } };
}
test("explicit CRUD, load, local-only data, and default-keep dirty choice", async () => {
  const ui = await editor();
  expect(ui.root.all().filter(item => item.type === "checkbox").every(item => !item.checked)).toBe(true);
  await ui.fill("name", "First");
  expect(ui.messages.at(-1)?.type).toBe("workflow:draft-changed");
  expect(ui.store().workflows).toHaveLength(0);
  await ui.click("workflowSave"); expect(ui.store().workflows[0]?.name).toBe("First");
  await ui.fill("name", "Unsaved");
  expect(ui.root.all().some(item => item.ownText === "workflowRunSaved")).toBe(false);
  await ui.click("workflowLoad"); expect(ui.field("name").value).toBe("Unsaved"); await ui.click("workflowKeep");
  await ui.click("workflowNew"); expect(ui.field("name").value).toBe("Unsaved"); await ui.click("workflowKeep");
  await ui.click("workflowNew"); await ui.click("workflowDiscard");
  ui.field("list").value = ui.store().workflows[0]!.id; await ui.field("list").dispatch("change"); expect(ui.field("name").value).toBe("First");
  await ui.fill("name", "Edited"); await ui.click("workflowSave"); expect(ui.store().workflows[0]?.revision).toBe(2);
  await ui.click("workflowDuplicate"); expect(ui.store().workflows).toHaveLength(2);
  await ui.click("workflowDelete"); expect(ui.store().workflows).toHaveLength(1);
  expect(mock.writes).toHaveLength(0);
});
test("failed and conflicting saves retain draft and offer conflict-only choices", async () => {
  const ui = await editor(); await ui.fill("name", "retained"); ui.fail({ ok: false, status: "failed" });
  await ui.click("workflowSave"); expect(ui.field("name").value).toBe("retained"); expect(ui.field("status").textContent).toBe("workflowSaveFailed");
  expect(ui.field("conflict").hidden).toBe(false);
  const count = ui.messages.length; await ui.click("workflowSave"); expect(ui.messages.length).toBe(count);
  ui.fail(); await ui.click("workflowRetrySave"); expect(ui.store().workflows[0]?.name).toBe("retained");
  await ui.fill("name", "conflicting"); ui.fail({ ok: false, status: "conflict" }); await ui.click("workflowSave");
  expect(ui.field("name").value).toBe("conflicting"); expect(ui.field("status").textContent).toBe("workflowError_conflict");
});
// Normal editing remains independent of the explicitly opened inspection dialog.
test("editing and saved reload never request tab context, inspection or preview", async () => {
  const ui = await editor(); await ui.fill("name", "Rules"); await ui.click("workflowAddRule");
  const value = ui.root.all().find(item => item.ownText === "workflowValue")!.children[0]!;
  value.value = "example.com"; await value.dispatch("input");
  await vi.advanceTimersByTimeAsync(300); await ui.click("workflowSave"); await ui.click("workflowLoad");
  expect(ui.messages.some(input => ["workflow:context", "workflow:inspect", "workflow:preview-rule", "workflow:preview-saved"].includes(input.type))).toBe(false);
  for (const id of ["targets", "origin_status", "protections"]) expect(ui.root.querySelector("#workflow_" + id)).toBeUndefined();
  expect(mock.api.tabs.query).not.toHaveBeenCalled();
});
test("URL conditions stay folded on load and validation opens the invalid rule before focusing", async () => {
  const ui = await editor(); await ui.fill("name", "Conditions");
  expect(ui.field("rule_details").open).toBe(false);
  await ui.click("workflowAddRule"); await ui.click("workflowSave");
  const value = ui.root.all().find(item => item.ownText === "workflowValue")!.children[0]!;
  expect(ui.field("rule_details").open).toBe(true); expect(value.focused).toBe(true);
  value.value = "example.com"; await value.dispatch("input"); await ui.click("workflowSave");
  expect(ui.field("rule_details").open).toBe(false); await ui.click("workflowLoad");
  expect(ui.field("rule_details").open).toBe(false);
  expect(ui.root.all().find(item => item.ownText === "workflowValue")!.children[0]!.value).toBe("example.com");
});

test("explicit inspection validates the entire unsaved draft before context and keeps rule mode isolated", async () => {
  const ui = await editor(); await ui.fill("name", "Unsaved rule"); await ui.click("workflowAddRule");
  const initialChildren = [...ui.root.children];
  await ui.click("workflowInspectionOpenRule");
  expect(ui.messages.some(input => input.type === "workflow:context")).toBe(false);
  expect(ui.messages.some(input => input.type === "workflow:inspect" || input.type === "workflow:preview-rule")).toBe(false);
  expect(ui.root.children).toEqual(initialChildren); expect(ui.root.all().some(item => item.tag === "dialog")).toBe(false);
  expect(ui.field("status").textContent).toBe("workflowError_invalid");
  expect(ui.field("rule_details").open).toBe(true);
  const value = ui.root.all().find(item => item.ownText === "workflowValue")!.children[0]!;
  expect(value.focused).toBe(true);
  value.value = "example.com"; await value.dispatch("input");
  await ui.click("workflowInspectionOpenRule");
  expect(ui.messages.filter(input => input.type === "workflow:context")).toHaveLength(1);
  expect(ui.messages.some(input => input.type === "workflow:inspect")).toBe(false);
  const origin = ui.root.querySelector("#workflow_inspection_origin")!;
  expect(origin.value).toBe(""); origin.value = "1"; await origin.dispatch("change");
  await ui.click("workflowInspectionInspect");
  expect(ui.messages.at(-1)).toMatchObject({ type: "workflow:inspect", expectedStoreRevision: 0, draft: { name: "Unsaved rule" } });
  await ui.click("workflowInspectionClosePreview");
  expect(ui.messages.some(input => input.type === "workflow:preview-rule")).toBe(false);
  const ack = ui.root.querySelector("#workflow_inspection_ack")!; ack.checked = true; await ack.dispatch("change");
  await ui.click("workflowInspectionClosePreview"); expect(ui.messages.at(-1)).toMatchObject({ type: "workflow:preview-rule", expectedStoreRevision: 0 });
  expect(ui.store().workflows).toHaveLength(0); expect(mock.writes).toHaveLength(0);
});
test("field error focuses its control and external dirty/pristine changes are visible", async () => {
  const ui = await editor(); await ui.click("workflowSave"); expect(ui.field("name").focused).toBe(true);
  await ui.fill("name", "Empty");
  await ui.click("workflowSave");
  ui.store().workflows[0]!.name = "External pristine"; ui.store().workflows[0]!.revision++; ui.store().revision++;
  await mock.external({ saved_workflows_v1: ui.store() }, "local"); await flush();
  expect(ui.field("name").value).toBe("External pristine");
  await ui.fill("name", "Keep me"); ui.store().workflows[0]!.name = "External dirty"; ui.store().revision++;
  await mock.external({ saved_workflows_v1: ui.store() }, "local"); await flush();
  expect(ui.field("name").value).toBe("Keep me"); expect(ui.field("status").textContent).toBe("workflowError_conflict");
  expect(ui.field("status").attributes).toMatchObject({ role: "status", "aria-live": "polite" });
  expect(ui.root.all().some(item => item.textContent.includes("<b>Origin</b>"))).toBe(false);
});
test("explicit global copies append fresh enabled glob rules and operations without settings writes", async () => {
  const ui = await editor(); Object.assign(mock.data, { urlmatch_pattern: "  *example.com*  \n\n*docs*", glue: true, sorttab: true });
  await ui.fill("name", "Copied"); await ui.click("workflowCopyRules");
  await vi.waitFor(() => expect(ui.root.all().filter(item => item.ownText === "workflowValue")).toHaveLength(2));
  await ui.click("workflowCopyRules");
  await vi.waitFor(() => expect(ui.root.all().filter(item => item.ownText === "workflowValue")).toHaveLength(4));
  await ui.click("workflowCopyOperations");
  await vi.waitFor(() => expect(ui.field("scope").value).toBe("all"));
  await ui.click("workflowSave");
  const saved = ui.store().workflows[0]!; expect(saved.rules).toHaveLength(4);
  expect(new Set(saved.rules.map(rule => rule.id)).size).toBe(4); expect(saved.rules.every(rule => rule.enabled && rule.condition.kind === "glob")).toBe(true);
  expect(saved.scope).toBe("all"); expect(saved.operations.glue).toBe(true); expect(saved.operations.sorttab).toBe(true); expect(mock.writes).toHaveLength(0);
});
test("pristine blank workflow waits for deliberate inspection, and delayed reload preserves newer input", async () => {
  const ui = await editor(); await vi.advanceTimersByTimeAsync(300);
  expect(ui.field("status").textContent).toBe("workflowNewState"); expect(ui.messages.some(input => input.type === "workflow:inspect")).toBe(false);
  await ui.fill("name", "Original"); await ui.click("workflowSave");
  await ui.fill("name", "Edited before reload"); ui.store().revision++;
  await mock.external({ saved_workflows_v1: ui.store() }, "local"); await flush();
  ui.delayList(); await ui.click("workflowReload"); expect(ui.listWaiting).toHaveLength(1);
  await ui.fill("name", "Typed while reloading");
  ui.listWaiting[0]!({ ok: true, store: structuredClone(ui.store()) }); await flush();
  expect(ui.field("name").value).toBe("Typed while reloading"); expect(ui.field("status").textContent).toBe("workflowError_conflict");
});
test("host URL paste reduces only hostname and merge requires a deliberate scope choice", async () => {
  const ui = await editor(); await ui.fill("name", "Paste"); await ui.click("workflowAddRule");
  const value = ui.root.all().find(item => item.tag === "label" && item.ownText === "workflowValue")!.children[0]!;
  value.value = "https://docs.example.com/path?q=other.example"; await value.dispatch("input");
  await ui.click("workflowSave");
  expect(ui.store().workflows[0]?.rules[0]?.condition).toMatchObject({ kind: "host", value: "docs.example.com" });
  ui.field("op_glue").checked = true; await ui.field("op_glue").dispatch("change");
  expect(ui.field("scope").value).toBe("win"); await ui.click("workflowSave"); expect(ui.field("scope").focused).toBe(true);
  await ui.click("workflowUseAll"); expect(ui.field("scope").value).toBe("all"); await ui.click("workflowSave");
  expect(ui.store().workflows[0]?.scope).toBe("all");
  const kind = ui.root.all().find(item => item.tag === "label" && item.ownText === "workflowMatch")!.children[0]!;
  kind.value = "contains"; await kind.dispatch("change");
  const literal = ui.root.all().find(item => item.tag === "label" && item.ownText === "workflowValue")!.children[0]!;
  literal.value = "https://EXAMPLE.com/path?q=literal"; await literal.dispatch("input"); await ui.click("workflowSave");
  expect(ui.store().workflows[0]?.rules[0]?.condition).toMatchObject({ kind: "contains", value: "https://EXAMPLE.com/path?q=literal" });
});
test("workflow host is outside global autosave form and all three catalogs contain every workflow message", () => {
  const html = readFileSync(new URL("../../public/options.html", import.meta.url), "utf8"); expect(html.indexOf('id="workflows"')).toBeGreaterThan(html.indexOf("</form>"));
  const code = readFileSync(new URL("../../src/options/options-workflows.ts", import.meta.url), "utf8");
  const keys = [...code.matchAll(/"(workflow[A-Z][A-Za-z]+)"/g)].map(match => match[1]!);
  for (const locale of ["en", "ja", "zh_CN"]) {
    const catalog = JSON.parse(readFileSync(new URL("../../public/_locales/" + locale + "/messages.json", import.meta.url), "utf8")) as Record<string, { message: string }>;
    for (const key of keys) expect(catalog[key]?.message, locale + ":" + key).toBeTruthy();
    for (const mode of ["host", "contains", "glob"]) expect(catalog["workflowMode_" + mode]?.message).toBeTruthy();
    for (const status of ["invalid", "unavailable", "conflict", "failed", "busy", "stale", "unsupported"]) expect(catalog["workflowError_" + status]?.message).toBeTruthy();
  }
});

test("default workflow transport handles browser replies and unavailable errors", async () => {
  const ui = await editor(true);
  expect(ui.messages.some(input => input.type === "workflow:list")).toBe(true);
  await ui.fill("name", "Transport"); await ui.click("workflowSave");
  expect(ui.store().workflows[0]?.name).toBe("Transport");
  Object.assign(mock.runtime, { sendMessage: (_input: WorkflowRequest, callback?: (reply: unknown) => void) => {
    if (process.env.TEST_BROWSER === "chrome") {
      mock.runtime.lastError = { message: "Chrome transport detail" }; callback!(undefined); delete mock.runtime.lastError; return;
    }
    return Promise.reject(new Error("Firefox transport detail"));
  } });
  await ui.fill("name", "Unavailable"); await ui.click("workflowSave");
  expect(ui.field("status").textContent).toBe("workflowError_unavailable");
});


test("conflict choices are hidden normally; overwrite saves once using fresh revisions", async () => {
  const ui = await editor();
  expect(ui.field("conflict").hidden).toBe(true);
  expect(ui.root.all().some(item => item.ownText === "workflowReconcile")).toBe(false);
  await ui.fill("name", "Original"); await ui.click("workflowSave");
  await ui.fill("name", "My edit");
  ui.store().workflows[0]!.name = "Other edit"; ui.store().workflows[0]!.revision++; ui.store().revision++;
  await mock.external({ saved_workflows_v1: ui.store() }, "local"); await flush();
  expect(ui.field("conflict").hidden).toBe(false);
  await ui.click("workflowOverwrite");
  expect(ui.messages.filter(input => input.type === "workflow:update")).toEqual([
    expect.objectContaining({ expectedRevision: 2, expectedWorkflowRevision: 2, draft: expect.objectContaining({ name: "My edit" }) }),
  ]);
  expect(ui.store().workflows[0]!.name).toBe("My edit"); expect(ui.field("conflict").hidden).toBe(true);
});

test("using saved version discards edits without a write or another confirmation", async () => {
  const ui = await editor(); await ui.fill("name", "Original"); await ui.click("workflowSave"); await ui.fill("name", "Discard me");
  ui.store().workflows[0]!.name = "Latest saved"; ui.store().workflows[0]!.revision++; ui.store().revision++;
  await mock.external({ saved_workflows_v1: ui.store() }, "local"); await flush();
  const writes = ui.messages.filter(input => input.type === "workflow:update").length;
  await ui.click("workflowReload");
  expect(ui.field("name").value).toBe("Latest saved"); expect(ui.field("conflict").hidden).toBe(true);
  expect(ui.messages.filter(input => input.type === "workflow:update")).toHaveLength(writes);
});

test("typing during an overwrite check cancels the write and repeated clicks do not duplicate it", async () => {
  const ui = await editor(); await ui.fill("name", "Original"); await ui.click("workflowSave"); await ui.fill("name", "First edit");
  ui.fail({ ok: false, status: "conflict" }); await ui.click("workflowSave"); ui.fail();
  const writes = ui.messages.filter(input => input.type === "workflow:update").length;
  ui.delayList(); await ui.click("workflowOverwrite"); await ui.click("workflowOverwrite");
  expect(ui.listWaiting).toHaveLength(1);
  await ui.fill("name", "Typed while checking"); ui.listWaiting[0]!({ ok: true, store: structuredClone(ui.store()) }); await flush();
  expect(ui.field("name").value).toBe("Typed while checking"); expect(ui.field("status").textContent).toBe("workflowConflictChanged");
  expect(ui.field("conflict").hidden).toBe(false); expect(ui.messages.filter(input => input.type === "workflow:update")).toHaveLength(writes);
});

test("another conflict while writing returns to the choices without automatic retries", async () => {
  const ui = await editor(); await ui.fill("name", "Original"); await ui.click("workflowSave"); await ui.fill("name", "Keep me");
  ui.fail({ ok: false, status: "conflict" }); await ui.click("workflowSave");
  const writes = ui.messages.filter(input => input.type === "workflow:update").length;
  await ui.click("workflowOverwrite");
  expect(ui.messages.filter(input => input.type === "workflow:update")).toHaveLength(writes + 1);
  expect(ui.field("name").value).toBe("Keep me"); expect(ui.field("conflict").hidden).toBe(false);
});

test("a deleted procedure is never silently recreated by overwrite", async () => {
  const ui = await editor(); await ui.fill("name", "Original"); await ui.click("workflowSave"); await ui.fill("name", "Keep me");
  ui.store().workflows.splice(0); ui.store().revision++;
  await mock.external({ saved_workflows_v1: ui.store() }, "local"); await flush();
  const writes = ui.messages.filter(input => input.type === "workflow:create" || input.type === "workflow:update").length;
  await ui.click("workflowOverwrite");
  expect(ui.field("name").value).toBe("Keep me"); expect(ui.field("status").textContent).toBe("workflowConflictDeleted");
  expect(ui.messages.filter(input => input.type === "workflow:create" || input.type === "workflow:update")).toHaveLength(writes);
  expect(ui.field("conflict").children.find(item => item.tag === "button" && item.ownText === "workflowOverwrite")?.disabled).toBe(true);
});

test("saved store refresh reinspection aligns summary and request then focuses visible full inspect", async () => {
 const tabEvents = new Map<string, { listeners: Set<(...args: unknown[]) => unknown>; removeListener: ReturnType<typeof vi.fn> }>();
 for (const name of ["onUpdated", "onRemoved", "onMoved", "onAttached", "onDetached", "onCreated"]) {
   const listeners = new Set<(...args: unknown[]) => unknown>();
   const removeListener = vi.fn((listener: (...args: unknown[]) => unknown) => { listeners.delete(listener); });
   tabEvents.set(name, { listeners, removeListener });
   Object.assign(mock.api.tabs, { [name]: { addListener: (listener: (...args: unknown[]) => unknown) => { listeners.add(listener); }, removeListener } });
 }
 const ui = await editor(); await ui.fill("name", "Original workflow"); await ui.click("workflowAddRule");
 const value = ui.root.all().find(item => item.ownText === "workflowValue")!.children[0]!; value.value = "example.com"; await value.dispatch("input"); await ui.click("workflowSave");
 ui.field("rule_details").open = true;
 const opener = ui.root.all().find(item => item.tag === "button" && item.ownText === "workflowInspectionOpenRule")!;
 await opener.dispatch("click"); const origin = ui.root.querySelector("#workflow_inspection_origin")!; origin.value = "1"; await origin.dispatch("change"); await ui.click("workflowInspectionInspect");
 const saved = ui.store().workflows[0]!; saved.name = "Changed workflow"; saved.scope = "all"; saved.rules[0]!.name = "Changed rule"; saved.rules[0]!.enabled = false; saved.revision++; ui.store().revision++;
 await mock.external({ saved_workflows_v1: ui.store() }, "local"); await flush(); await ui.click("workflowInspectionInspect");
 expect(ui.messages.at(-1)).toMatchObject({ type: "workflow:inspect", expectedStoreRevision: ui.store().revision, draft: { name: saved.name, scope: "all", rules: [{ name: "Changed rule", enabled: false }] } });
 expect(ui.root.querySelector("#workflow_inspection_summary")!.textContent).toBe("Changed workflow · workflowScopeAll · workflowInspectionRuleMode · Changed rule · workflowDisabled · workflowSavedState");
 expect(opener.isConnected).toBe(false); expect(ui.field("rule_details").open).toBe(false);
 for (const event of tabEvents.values()) expect(event.listeners.size).toBe(1);
 await ui.click("workflowInspectionCancel"); expect(ui.root.all().find(item => item.tag === "button" && item.ownText === "workflowInspectionOpen")!.focused).toBe(true);
 for (const event of tabEvents.values()) { expect(event.removeListener).toHaveBeenCalledOnce(); expect(event.listeners.size).toBe(0); }
 const messagesAfterCancel = structuredClone(ui.messages), statusAfterCancel = ui.root.querySelector("#workflow_inspection_status")!.textContent;
 for (const listener of tabEvents.get("onUpdated")!.listeners) listener(2, { url: "https://changed.test" }, {});
 await flush();
 expect(ui.messages).toEqual(messagesAfterCancel); expect(ui.root.querySelector("#workflow_inspection_status")!.textContent).toBe(statusAfterCancel);
 expect(ui.field("rule_details").open).toBe(false);
});
