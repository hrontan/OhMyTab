import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { installSettingsBrowser } from "../helpers/settings-browser";
import type { BrowserTarget } from "../helpers/browser";
import type { WorkflowReply, WorkflowRequest } from "../../src/workflows/workflow-types";
import { draft, ruleId } from "../workflows/fixtures";

class Element {
  value = ""; open = false; checked = false; disabled = false; hidden = false; id = ""; type = "";
  textContent = ""; dataset: Record<string, string> = {}; attributes: Record<string, string> = {};
  children: Element[] = []; parentElement?: Element; focused = false;
  listeners: Record<string, ((event: { preventDefault: () => void }) => unknown)[]> = {};
  constructor(public tag: string) {}
  appendChild(child: Element) { child.parentElement = this; this.children.push(child); return child; }
  replaceChildren() { this.children = []; this.textContent = ""; }
  setAttribute(key: string, value: string) { this.attributes[key] = value; }
  addEventListener(key: string, listener: (event: { preventDefault: () => void }) => unknown) { (this.listeners[key] ??= []).push(listener); }
  get isConnected(): boolean { return this.parentElement ? this.parentElement.children.includes(this) && this.parentElement.isConnected : this.tag === "section"; }
  getClientRects(): object[] { if (this.hidden || (this.tag === "details" && !this.open)) return []; return this.parentElement?.getClientRects() ?? [{}]; }
  focus() { this.focused = true; }
  showModal() { this.open = true; }
  close() { this.open = false; void this.dispatch("close"); }
  all(): Element[] { return [this, ...this.children.flatMap(child => child.all())]; }
  async dispatch(key: string) { if (key === "click" && this.disabled) return; this.listeners[key]?.forEach(listener => listener({ preventDefault() {} })); await flush(); }
}
const flush = async () => { for (let i = 0; i < 24; i++) await Promise.resolve(); };
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
const inspection = (count = 1) => ({ candidateCount: count, targetCount: count, excludedCount: 0, targets: count ? [{ id: 2, windowId: 1, title: "<b>unsafe</b>", url: "https://example.com/", ruleIds: [ruleId], ruleNames: ["Example"], reasons: ["urlRule"] }] : [], excluded: [] });
let mock: ReturnType<typeof installSettingsBrowser>;
beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); mock = installSettingsBrowser(process.env.TEST_BROWSER as BrowserTarget); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
async function setup() {
  const root = new Element("section"), opener = new Element("button");
  root.appendChild(opener); const fallback = root.appendChild(new Element("button"));
  vi.stubGlobal("getComputedStyle", () => ({ visibility: "visible" }));
  vi.stubGlobal("document", { createElement: (tag: string) => new Element(tag) });
  const events = new Map<string, Set<(...args: unknown[]) => unknown>>();
  for (const name of ["onUpdated", "onRemoved", "onMoved", "onAttached", "onDetached", "onCreated"]) {
    const listeners = new Set<(...args: unknown[]) => unknown>(); events.set(name, listeners);
    Object.assign(mock.api.tabs, { [name]: { addListener: (fn: (...args: unknown[]) => unknown) => listeners.add(fn), removeListener: (fn: (...args: unknown[]) => unknown) => listeners.delete(fn) } });
  }
  let state = { editorId: "22222222-2222-4222-8222-222222222222", draftRevision: 0, draft: draft(), expectedStoreRevision: 0, dirty: true };
  let valid = true, available = true, failNotice = false;
  const messages: WorkflowRequest[] = [];
  const pending: ReturnType<typeof deferred<WorkflowReply>>[] = [];
  let delayInspect = false, delayContext = false, delayPreview = false, empty = false;
  const request = vi.fn(async (input: WorkflowRequest): Promise<WorkflowReply> => {
    messages.push(structuredClone(input));
    if (input.type === "workflow:draft-changed") return failNotice ? { ok: false, status: "unavailable" } : { ok: true };
    if ((input.type === "workflow:inspect" && delayInspect) || (input.type === "workflow:context" && delayContext) || (input.type === "workflow:preview-rule" && delayPreview)) { const wait = deferred<WorkflowReply>(); pending.push(wait); return wait.promise; }
    if (input.type === "workflow:context") return { ok: true, windowId: 1, origins: [{ tabId: 1, windowId: 1, title: "Origin", url: "https://keep.test/" }, { tabId: 3, windowId: 1, title: "Other", url: "https://other.test/" }] };
    if (input.type === "workflow:inspect") { const result = inspection(empty ? 0 : 1); for (const row of result.targets) row.ruleNames = input.draft.rules.map(rule => rule.name); return { ok: true, editorId: input.editorId, draftRevision: input.draftRevision, inspection: result }; }
    return { ok: true, status: "preview" };
  });
  const controller = (await import("../../src/options/options-workflow-inspection")).createWorkflowInspection({ root: root as unknown as HTMLElement,
    focusFallback: () => fallback as unknown as HTMLElement,
    snapshot: () => valid ? structuredClone(state) : undefined, available: () => available,
    invalidate: () => { state.draftRevision++; return request({ type: "workflow:draft-changed", editorId: state.editorId, draftRevision: state.draftRevision }); }, request });
  const field = (id: string) => root.all().find(item => item.id === "workflow_inspection_" + id)!;
  const click = async (key: string) => { const control = root.all().find(item => item.tag === "button" && item.textContent === key)!; expect(control).toBeDefined(); await control.dispatch("click"); };
  const choose = async (id = "1") => { field("origin").value = id; await field("origin").dispatch("change"); };
  const open = (id: string | undefined = ruleId) => controller.open(opener as unknown as HTMLElement, id);
  return { root, opener, fallback, controller, open, choose, field, click, messages, pending, state: () => state,
    patch: (patch: Partial<typeof state>) => { state = { ...state, ...patch }; }, valid: (value: boolean) => { valid = value; }, available: (value: boolean) => { available = value; }, failNotice: (value: boolean) => { failNotice = value; }, delay: (kind: "inspect" | "context" | "preview") => { if (kind === "inspect") delayInspect = true; else if (kind === "context") delayContext = true; else delayPreview = true; }, empty: () => { empty = true; },
    emit: async (event: string, ...args: unknown[]) => { events.get(event)!.forEach(fn => fn(...args)); await flush(); }, events };
}

test("construction and invalid drafts never query; open gets context once and requires explicit origin and inspection", async () => {
 const ui = await setup(); expect(ui.messages).toEqual([]); expect(ui.root.children).toEqual([ui.opener, ui.fallback]);
 const initialChildren = [...ui.root.children];
 ui.valid(false); await ui.open(); expect(ui.messages).toEqual([]); expect(ui.root.children).toEqual(initialChildren);
 expect(ui.root.all().some(item => item.tag === "dialog")).toBe(false);
 expect(ui.messages.some(item => ["workflow:context", "workflow:inspect", "workflow:preview-rule"].includes(item.type))).toBe(false);
 ui.valid(true); await ui.open(); expect(ui.messages.filter(item => item.type === "workflow:context")).toHaveLength(1);
 expect(ui.field("origin").value).toBe(""); await ui.click("workflowInspectionInspect"); expect(ui.messages.some(item => item.type === "workflow:inspect")).toBe(false);
 await ui.choose(); expect(ui.messages.some(item => item.type === "workflow:inspect")).toBe(false);
 await ui.click("workflowInspectionInspect"); expect(ui.messages.at(-1)).toMatchObject({ type: "workflow:inspect", ruleId, origin: { tabId: 1, windowId: 1 }, expectedStoreRevision: 0 });
 expect(ui.field("results").children.some(row => row.textContent.includes("<b>unsafe</b>"))).toBe(true);
 expect(ui.field("status").attributes).toMatchObject({ role: "status", "aria-live": "polite" });
 expect(mock.api.tabs.query).not.toHaveBeenCalled();
});

test("valid unsaved disabled rule needs acknowledgement and fresh preview; no whole workflow request", async () => {
 const ui = await setup(); ui.state().draft.rules[0]!.enabled = false;
 await ui.open(); await ui.choose(); await ui.click("workflowInspectionInspect");
 await ui.click("workflowInspectionClosePreview"); expect(ui.messages.some(item => item.type === "workflow:preview-rule")).toBe(false);
 ui.field("ack").checked = true; await ui.field("ack").dispatch("change"); await ui.click("workflowInspectionClosePreview");
 expect(ui.messages.at(-1)).toMatchObject({ type: "workflow:preview-rule", ruleId, draft: { rules: [{ enabled: false }] } });
 expect(ui.field("status").dataset.state).toBe("workflowInspectionConfirmHelp");
 await ui.click("workflowInspectionClosePreview"); expect(ui.messages.filter(item => item.type === "workflow:preview-rule")).toHaveLength(1);
 expect(ui.messages.some(item => item.type === "workflow:preview-saved")).toBe(false);
});

test("whole workflow mode is inspection only and empty results never enable close", async () => {
 const ui = await setup(); await ui.controller.open(ui.opener as unknown as HTMLElement); await ui.choose(); await ui.click("workflowInspectionInspect");
 const preview = ui.root.all().find(item => item.textContent === "workflowInspectionClosePreview")!; expect(preview.hidden).toBe(true);
 await ui.click("workflowInspectionClosePreview"); expect(ui.messages.some(item => item.type === "workflow:preview-rule")).toBe(false);
 await ui.click("workflowInspectionCancel"); await ui.open(); ui.empty(); await ui.choose(); await ui.click("workflowInspectionInspect");
 ui.field("ack").checked = true; await ui.field("ack").dispatch("change"); await ui.click("workflowInspectionClosePreview");
 expect(ui.field("status").dataset.state).toBe("workflowInspectionEmpty"); expect(ui.messages.some(item => item.type === "workflow:preview-rule")).toBe(false);
});

test("reverse asynchronous inspection cannot write old results or status after origin/rule/reopen changes", async () => {
 const ui = await setup(); await ui.open(); await ui.choose(); ui.delay("inspect");
 await ui.click("workflowInspectionInspect"); const first = ui.messages.at(-1)!;
 await ui.choose("3"); await ui.click("workflowInspectionInspect"); const second = ui.messages.at(-1)!;
 if (first.type !== "workflow:inspect" || second.type !== "workflow:inspect") throw Error("missing inspection");
 ui.pending[1]!.resolve({ ok: true, editorId: second.editorId, draftRevision: second.draftRevision, inspection: inspection() }); await flush();
 const before = ui.field("status").textContent; ui.pending[0]!.resolve({ ok: false, status: "failed" }); await flush();
 expect(ui.field("status").textContent).toBe(before); expect(ui.field("results").children).not.toHaveLength(0);
 await ui.click("workflowInspectionInspect"); const third = ui.pending[2]!; await ui.click("workflowInspectionCancel"); await ui.controller.open(ui.opener as unknown as HTMLElement);
 const current = ui.field("status").textContent; third.resolve({ ok: false, status: "failed" }); await flush(); expect(ui.field("status").textContent).toBe(current);
});

test.each(["cancel", "escape", "native-close"])("%s clears sensitive rows, invalidates, removes listeners, and restores focus", async method => {
 const ui = await setup(); await ui.open(); await ui.choose(); await ui.click("workflowInspectionInspect"); const revision = ui.state().draftRevision;
 if (method === "cancel") await ui.click("workflowInspectionCancel");
 if (method === "escape") await ui.field("dialog").dispatch("cancel");
 if (method === "native-close") { ui.field("dialog").close(); await flush(); }
 expect(ui.field("dialog").open).toBe(false); expect(ui.field("results").children).toEqual([]); expect(ui.field("origin").children).toEqual([]);
 expect(ui.opener.focused).toBe(true); expect(ui.state().draftRevision).toBeGreaterThan(revision); expect([...ui.events.values()].every(listeners => listeners.size === 0)).toBe(true);
});

test("inspection TTL, draft/store changes, busy state and tab changes block preview without querying", async () => {
 const ui = await setup(); await ui.open(); await ui.choose(); await ui.click("workflowInspectionInspect");
 await vi.advanceTimersByTimeAsync(60000); expect(ui.field("status").dataset.state).toBe("workflowInspectionStale");
 await ui.click("workflowInspectionClosePreview"); expect(ui.messages.some(item => item.type === "workflow:preview-rule")).toBe(false);
 await ui.click("workflowInspectionInspect"); ui.patch({ expectedStoreRevision: 1 }); await ui.controller.invalidate();
 expect(ui.field("results").children).toEqual([]); await ui.click("workflowInspectionInspect");
 ui.field("ack").checked = true; await ui.field("ack").dispatch("change"); ui.available(false); await ui.click("workflowInspectionClosePreview"); expect(ui.messages.some(item => item.type === "workflow:preview-rule")).toBe(false);
 ui.available(true); await ui.emit("onUpdated", 2, { url: "https://changed.test" }, { url: "https://changed.test" });
 expect(ui.field("status").dataset.state).toBe("workflowInspectionStale"); expect(ui.messages.filter(item => item.type === "workflow:context")).toHaveLength(1);
 expect(ui.messages.filter(item => item.type === "workflow:inspect")).toHaveLength(3);
});

test("failed invalidation halts inspection/preview until a successful explicit retry", async () => {
 const ui = await setup(); await ui.open(); await ui.choose(); await ui.click("workflowInspectionInspect");
 ui.failNotice(true); await ui.controller.invalidate(); expect(ui.field("status").dataset.state).toBe("workflowInspectionNotifyFailed");
 const count = ui.messages.length; await ui.click("workflowInspectionInspect"); await ui.click("workflowInspectionClosePreview"); expect(ui.messages).toHaveLength(count);
 ui.failNotice(false); await ui.choose("3"); await ui.click("workflowInspectionInspect"); expect(ui.field("status").dataset.state).toBe("workflowInspectionReady");
});

test("old context response after close/reopen cannot populate origin or status", async () => {
 const ui = await setup(); ui.delay("context"); const first = ui.open(); await flush(); await ui.click("workflowInspectionCancel"); const second = ui.open(); await flush();
 ui.pending[1]!.resolve({ ok: true, windowId: 1, origins: [] }); await second; const text = ui.field("status").textContent;
 ui.pending[0]!.resolve({ ok: true, windowId: 1, origins: [{ tabId: 99, windowId: 1, title: "old", url: "https://old.test" }] }); await first;
 expect(ui.field("status").textContent).toBe(text); expect(ui.field("origin").children).toHaveLength(1);
});

test("three catalogs contain every inspection key with matching new key inventory", () => {
 const code = readFileSync(new URL("../../src/options/options-workflow-inspection.ts", import.meta.url), "utf8"); const keys = [...code.matchAll(/"(workflow[A-Z][A-Za-z]+)"/g)].map(match => match[1]!);
 const inventories = ["en", "ja", "zh_CN"].map(locale => {
   const catalog = JSON.parse(readFileSync(new URL("../../public/_locales/" + locale + "/messages.json", import.meta.url), "utf8")) as Record<string, { message: string }>;
   for (const key of keys) expect(catalog[key]?.message, locale + ":" + key).toBeTruthy();
   return Object.keys(catalog).filter(key => key.startsWith("workflowInspection")).sort();
 });
 expect(inventories[1]).toEqual(inventories[0]); expect(inventories[2]).toEqual(inventories[0]);
});

const notices = (ui: Awaited<ReturnType<typeof setup>>) => ui.messages.filter(item => item.type === "workflow:draft-changed").length;
test("summary uses the same new saved snapshot as inspection request and results", async () => {
 const ui = await setup(); await ui.open(); await ui.choose(); await ui.click("workflowInspectionInspect");
 const next = structuredClone(ui.state().draft); next.name = "Changed workflow"; next.scope = "all"; next.rules[0]!.name = "Changed rule"; next.rules[0]!.enabled = false;
 ui.patch({ draft: next, expectedStoreRevision: 2, dirty: false }); await ui.controller.invalidate(); await ui.click("workflowInspectionInspect");
 expect(ui.messages.at(-1)).toMatchObject({ type: "workflow:inspect", expectedStoreRevision: 2, draft: next });
 expect(ui.field("summary").textContent).toBe("Changed workflow · workflowScopeAll · workflowInspectionRuleMode · Changed rule · workflowDisabled · workflowSavedState");
 expect(ui.root.all().find(item => item.textContent === "workflowInspectionDisabledRuleHelp")!.hidden).toBe(false);
 expect(ui.field("results").children.some(row => row.textContent.includes("Changed rule"))).toBe(true);
});
test("invalidation refreshes the open summary before reinspection and keeps it when the rule vanishes", async () => {
 const ui = await setup(); await ui.open(); await ui.choose(); await ui.click("workflowInspectionInspect");
 const next = structuredClone(ui.state().draft); next.name = "Stored workflow"; next.scope = "all"; next.rules[0]!.name = "Stored rule"; next.rules[0]!.enabled = false;
 ui.patch({ draft: next, dirty: false }); await ui.controller.invalidate();
 const refreshed = "Stored workflow · workflowScopeAll · workflowInspectionRuleMode · Stored rule · workflowDisabled · workflowSavedState";
 expect(ui.field("summary").textContent).toBe(refreshed);
 expect(ui.field("results").children).toHaveLength(0);
 const removed = structuredClone(next); removed.rules = removed.rules.filter(rule => rule.id !== ruleId);
 ui.patch({ draft: removed }); await ui.controller.invalidate();
 expect(ui.field("summary").textContent).toBe(refreshed);
});
test.each(["detached", "hidden"])("%s opener returns to current visible full inspection without expanding details", async kind => {
 const ui = await setup(); await ui.open();
 if (kind === "detached") ui.root.children = ui.root.children.filter(item => item !== ui.opener); else ui.opener.hidden = true;
 await ui.click("workflowInspectionCancel"); expect(ui.opener.focused).toBe(false); expect(ui.fallback.focused).toBe(true);
});
test.each([
 ["onCreated", [{ url: "own" }]], ["onCreated", [{ pendingUrl: "own" }]],
 ["onUpdated", [2, { url: "own" }, {}]], ["onUpdated", [2, { pendingUrl: "own" }, {}]],
 ["onUpdated", [2, {}, { pendingUrl: "own" }]],
] as const)("known own event %s preserves fresh results without draft notification", async (event, data) => {
 const ui = await setup(); await ui.open(); await ui.choose(); await ui.click("workflowInspectionInspect"); const count = notices(ui), revision = ui.state().draftRevision;
 const args = data.map(item => typeof item === "object" ? Object.fromEntries(Object.entries(item).map(([k,v]) => [k,v === "own" ? mock.runtime.getURL("preview.html") : v])) : item);
 await ui.emit(event, ...args); expect(ui.field("status").dataset.state).toBe("workflowInspectionReady"); expect(notices(ui)).toBe(count); expect(ui.state().draftRevision).toBe(revision);
});
test.each([
 ["onCreated", [{}]], ["onCreated", [{ url: "https://normal.test" }]],
 ["onUpdated", [2, {}, {}]], ["onUpdated", [2, { url: "https://changed.test" }, {}]],
 ["onRemoved", [2, { windowId: 1 }]], ["onMoved", [2, { windowId: 1 }]], ["onAttached", [2, {}]], ["onDetached", [2, {}]],
] as const)("unknown or normal event %s expires only display", async (event, args) => {
 const ui = await setup(); await ui.open(); await ui.choose(); await ui.click("workflowInspectionInspect"); const count = notices(ui), revision = ui.state().draftRevision;
 await ui.emit(event, ...args); expect(ui.field("status").dataset.state).toBe("workflowInspectionStale"); expect(ui.field("results").children).toEqual([]);
 expect(notices(ui)).toBe(count); expect(ui.state().draftRevision).toBe(revision); await ui.click("workflowInspectionClosePreview"); expect(ui.messages.some(item => item.type === "workflow:preview-rule")).toBe(false);
 expect(mock.api.tabs.query).not.toHaveBeenCalled();
});
test("TTL refuses a new preview without invalidating an already created server preview context", async () => {
 const ui = await setup(); await ui.open(); await ui.choose(); await ui.click("workflowInspectionInspect"); const count = notices(ui), revision = ui.state().draftRevision;
 await vi.advanceTimersByTimeAsync(60000); expect(notices(ui)).toBe(count); expect(ui.state().draftRevision).toBe(revision);
 ui.field("ack").checked = true; await ui.click("workflowInspectionClosePreview"); expect(ui.messages.some(item => item.type === "workflow:preview-rule")).toBe(false);
});
test("preview pending own events and confirmed self close observations preserve draft context and reply", async () => {
 const ui = await setup(); await ui.open(); await ui.choose(); await ui.click("workflowInspectionInspect"); ui.delay("preview");
 ui.field("ack").checked = true; await ui.field("ack").dispatch("change"); await ui.click("workflowInspectionClosePreview"); const count = notices(ui), revision = ui.state().draftRevision;
 await ui.emit("onCreated", { pendingUrl: mock.runtime.getURL("preview.html") });
 await ui.emit("onRemoved", 2, { windowId: 1 });
 ui.pending[0]!.resolve({ ok: true, status: "preview" }); await flush(); expect(ui.field("status").dataset.state).toBe("workflowInspectionConfirmHelp");
 await ui.emit("onRemoved", 3, { windowId: 1 }); await ui.emit("onUpdated", 1, {}, {});
 expect(notices(ui)).toBe(count); expect(ui.state().draftRevision).toBe(revision);
 await ui.click("workflowInspectionCancel"); expect(notices(ui)).toBe(count + 1);
});
test("local observation discards obsolete inspect and context responses including their status", async () => {
 const ui = await setup(); await ui.open(); await ui.choose(); ui.delay("inspect"); await ui.click("workflowInspectionInspect");
 await ui.emit("onCreated", {}); const status = ui.field("status").textContent;
 ui.pending[0]!.resolve({ ok: false, status: "failed" }); await flush(); expect(ui.field("status").textContent).toBe(status); expect(ui.field("results").children).toEqual([]);
 await ui.click("workflowInspectionCancel"); ui.delay("context"); const open = ui.open(); await flush(); await ui.emit("onUpdated", 2, {}, {});
 ui.pending[1]!.resolve({ ok: true, windowId: 1, origins: [{ tabId: 99, windowId: 1, title: "Obsolete", url: "https://old.test" }] }); await open;
 expect(ui.field("origin").children).toEqual([]); expect(ui.field("status").dataset.state).toBe("workflowInspectionStale");
});

test("strong invalidation during preview preparation discards its obsolete reply and notification errors fail closed", async () => {
 const ui = await setup(); await ui.open(); await ui.choose(); await ui.click("workflowInspectionInspect"); ui.delay("preview");
 ui.field("ack").checked = true; await ui.field("ack").dispatch("change"); await ui.click("workflowInspectionClosePreview"); const count = notices(ui);
 ui.failNotice(true); await ui.controller.invalidate(); expect(notices(ui)).toBe(count + 1); expect(ui.field("status").dataset.state).toBe("workflowInspectionNotifyFailed");
 ui.pending[0]!.resolve({ ok: true, status: "preview" }); await flush(); expect(ui.field("status").dataset.state).toBe("workflowInspectionNotifyFailed");
 const requests = ui.messages.length; await ui.click("workflowInspectionInspect"); await ui.click("workflowInspectionClosePreview"); expect(ui.messages).toHaveLength(requests);
});
test("inspection TTL during preview preparation preserves its server context and reply", async () => {
 const ui = await setup(); await ui.open(); await ui.choose(); await ui.click("workflowInspectionInspect"); ui.delay("preview");
 ui.field("ack").checked = true; await ui.field("ack").dispatch("change"); await ui.click("workflowInspectionClosePreview"); const count = notices(ui);
 await vi.advanceTimersByTimeAsync(60000); expect(ui.field("status").dataset.state).toBe("workflowInspectionStale"); expect(notices(ui)).toBe(count);
 ui.pending[0]!.resolve({ ok: true, status: "preview" }); await flush(); expect(ui.field("status").dataset.state).toBe("workflowInspectionConfirmHelp"); expect(notices(ui)).toBe(count);
});
