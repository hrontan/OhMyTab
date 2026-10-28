import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { UndoEntry } from "../../src/operations/undo.ts";

class Element {
  textContent = ""; className = ""; type = ""; disabled = false;
  children: Element[] = []; listeners: (() => void)[] = [];
  append(...items: Element[]) { this.children.push(...items); }
  appendChild(item: Element) { this.children.push(item); }
  replaceChildren() { this.children = []; }
  addEventListener(_event: string, listener: () => void) { this.listeners.push(listener); }
  click() { if (!this.disabled) this.listeners.forEach(listener => listener()); }
}
type Reply = { ok: boolean; busy?: boolean; entries?: UndoEntry[]; expiresAt?: number };
const mode = process.env.TEST_BROWSER;
let nodes: Record<string, Element>;
let load: () => void;
let settle: (reply: Reply) => void;
let calls: { type: string; keys?: string[] }[];
const entry = (key: string, state: "ready" | "unknown"): UndoEntry => ({ key, state, url: "https://example.test/" + key, windowId: 3, index: 0 });
const buttons = () => [...["#restore_all", "#clear_all", "#refresh"].map(id => nodes[id]!), ...nodes["#entries"]!.children.flatMap(li => li.children.filter(child => child.type === "button"))];
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
beforeEach(async () => {
  vi.resetModules(); vi.useFakeTimers(); calls = [];
  nodes = Object.fromEntries(["#entries", "#restore_all", "#clear_all", "#refresh", "#expires", "#status"].map(id => [id, new Element()]));
  const api = { i18n: { getMessage: (key: string) => key === "optionsLanguage" ? "en" : key }, runtime: {
    sendMessage: (request: { type: string; keys?: string[] }, callback?: (reply: Reply) => void) => {
      calls.push(request); const pending = new Promise<Reply>(resolve => { settle = resolve; });
      if (mode === "chrome") { void pending.then(reply => callback!(reply)); return; }
      return pending;
    },
  } };
  vi.stubGlobal(mode === "chrome" ? "chrome" : "browser", api);
  vi.doMock("../../src/browser/browser-api", () => ({ myBrowser: api }));
  vi.stubGlobal("document", { documentElement: { lang: "" }, title: "",
    querySelector: (selector: string) => nodes[selector], querySelectorAll: (selector: string) => selector === "button" ? buttons() : [],
    createElement: () => new Element(), addEventListener: (_event: string, listener: () => void) => { load = listener; },
  });
  await import("../../src/pages/undo-page.ts");
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.doUnmock("../../src/browser/browser-api"); });
test("pending GET disables controls and unknown entries cannot restore", async () => {
  load(); expect(buttons().every(button => button.disabled)).toBe(true);
  settle({ ok: true, entries: [entry("unknown", "unknown")] }); await flush();
  const row = nodes["#entries"]!.children[0]!;
  expect(row.children[1]!.disabled).toBe(true); expect(row.children[2]!.disabled).toBe(false);
  expect(nodes["#restore_all"]!.disabled).toBe(true); expect(nodes["#clear_all"]!.disabled).toBe(false);
  row.children[1]!.click(); expect(calls).toEqual([{ type: "undo:get", keys: undefined }]);
});
test("restore all sends only ready keys and disables all controls while pending", async () => {
  load(); settle({ ok: true, entries: [entry("ready", "ready"), entry("unknown", "unknown")] }); await flush();
  nodes["#restore_all"]!.click(); expect(buttons().every(button => button.disabled)).toBe(true);
  expect(calls[1]).toEqual({ type: "undo:restore", keys: ["ready"] });
  nodes["#restore_all"]!.click(); expect(calls).toHaveLength(2);
  settle({ ok: true, entries: [] }); await flush();
  expect(nodes["#restore_all"]!.disabled).toBe(true); expect(nodes["#clear_all"]!.disabled).toBe(true); expect(nodes["#refresh"]!.disabled).toBe(false);
});
test("busy reply disables every action including per-entry delete", async () => {
  load(); settle({ ok: true, busy: true, entries: [entry("ready", "ready")] }); await flush();
  expect(buttons()).toHaveLength(5); expect(buttons().every(button => button.disabled)).toBe(true);
  buttons().forEach(button => button.click()); expect(calls).toHaveLength(1);
});
test("expiry refreshes availability without restoring entries", async () => {
  load(); settle({ ok: true, entries: [entry("ready", "ready")], expiresAt: Date.now() + 1000 }); await flush();
  await vi.advanceTimersByTimeAsync(1000);
  expect(calls).toEqual([{ type: "undo:get", keys: undefined }, { type: "undo:get", keys: undefined }]);
  expect(buttons().every(button => button.disabled)).toBe(true);
  settle({ ok: true, entries: [] }); await flush(); expect(nodes["#status"]!.textContent).toBe("undoEmpty");
});
