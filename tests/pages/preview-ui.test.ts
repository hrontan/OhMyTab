import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { PreviewPlan } from "../../src/operations/operation-plan.ts";

// A minimal DOM seam. The separate browser check covers native disabled reflection.
class Element {
  textContent = "";
  className = "";
  disabled = false; // Match the observed enabled state restored by Firefox.
  children: Element[] = [];
  listeners: (() => void)[] = [];
  append(...items: Element[]) { this.children.push(...items); }
  appendChild(item: Element) { this.children.push(item); }
  addEventListener(_name: string, listener: () => void) { this.listeners.push(listener); }
  click() { if (!this.disabled) this.listeners.forEach(listener => listener()); }
}
type Reply = { ok: boolean; status?: string; plan?: PreviewPlan };
const mode = process.env.TEST_BROWSER;
let nodes: Record<string, Element>;
let load: () => Promise<void>;
let settle: (reply: Reply) => void;
let reject: (error: Error) => void;
let calls: { type: string; token: string }[];
const plan = (targets = 1): PreviewPlan => ({ token: "original-token", expiresAt: Date.now() + 60000,
  originId: 7, originWindowId: 3, windowIds: [3],
  targets: Array.from({ length: targets }, () => ({ id: 8, windowId: 3, title: "Original", url: "https://example.test/", reasons: ["duplicate"] })), excluded: [] });
const disabled = (value: boolean) => {
  expect(nodes["#confirm"]!.disabled).toBe(value);
  expect(nodes["#cancel"]!.disabled).toBe(value);
};
beforeEach(async () => {
  vi.resetModules(); vi.useFakeTimers(); calls = [];
  nodes = Object.fromEntries(["#status", "#confirm", "#cancel", "#scope", "#count", "#targets", "#excluded"].map(id => [id, new Element()]));
  const api = { i18n: { getMessage: (key: string) => key }, runtime: {
    lastError: undefined as { message: string } | undefined,
    sendMessage: (request: { type: string; token: string }, callback?: (reply: Reply) => void) => {
      calls.push(request);
      const pending = request.type === "preview:get" ? new Promise<Reply>((resolve, fail) => { settle = resolve; reject = fail; }) : Promise.resolve<Reply>({ ok: true });
      if (mode === "chrome") { void pending.then(reply => callback!(reply), error => {
        api.runtime.lastError = { message: String(error) }; callback!(undefined as unknown as Reply); api.runtime.lastError = undefined;
      }); return; }
      return pending;
    },
  } };
  vi.stubGlobal(mode === "chrome" ? "chrome" : "browser", api);
  vi.doMock("../../src/browser/browser-api", () => ({ myBrowser: api }));
  vi.stubGlobal("location", { href: "https://extension.test/preview.html?token=original-token" });
  vi.stubGlobal("document", { documentElement: { lang: "" }, title: "",
    querySelector: (selector: string) => nodes[selector],
    querySelectorAll: (selector: string) => selector === "button" ? [nodes["#confirm"], nodes["#cancel"]] : [],
    createElement: () => new Element(),
    addEventListener: (_event: string, listener: () => Promise<void>) => { load = listener; },
  });
  await import("../../src/pages/preview.ts");
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.doUnmock("../../src/browser/browser-api"); });
test("restored enabled controls are disabled while initial GET is pending", async () => {
  const ready = load(); disabled(true); nodes["#confirm"]!.click(); nodes["#cancel"]!.click();
  expect(calls).toEqual([{ type: "preview:get", token: "original-token" }]);
  settle({ ok: true, plan: plan() }); await ready; disabled(false);
});
test("rejected initial GET explicitly disables controls even if state was restored during await", async () => {
  const ready = load(); nodes["#confirm"]!.disabled = false; nodes["#cancel"]!.disabled = false;
  reject(new Error("Could not establish connection. Receiving end does not exist.")); await ready;
  disabled(true); expect(nodes["#status"]!.textContent).toBe("previewExpired");
  nodes["#confirm"]!.click(); expect(calls).toHaveLength(1);
});
test.each([{ ok: false, status: "expired" }, { ok: true }])("missing or expired plan leaves controls disabled: %j", async reply => {
  const ready = load(); nodes["#confirm"]!.disabled = false; settle(reply); await ready;
  disabled(true); expect(nodes["#status"]!.textContent).toBe("previewExpired");
});
test("valid nonempty plan alone enables controls and preserves displayed target", async () => {
  const ready = load(); settle({ ok: true, plan: plan() }); await ready; disabled(false);
  expect(nodes["#targets"]!.children).toHaveLength(1); expect(nodes["#count"]!.textContent).toBe("previewCount: 1");
});
test("valid empty plan keeps confirm disabled and cancel available", async () => {
  const ready = load(); settle({ ok: true, plan: plan(0) }); await ready;
  expect(nodes["#confirm"]!.disabled).toBe(true); expect(nodes["#cancel"]!.disabled).toBe(false);
});
test.each(["confirm", "cancel"])("%s disables controls before sending original token and prevents a second click", async action => {
  const ready = load(); settle({ ok: true, plan: plan() }); await ready;
  nodes["#" + action]!.click(); disabled(true); await vi.runAllTicks(); await Promise.resolve(); await Promise.resolve();
  expect(calls).toEqual([{ type: "preview:get", token: "original-token" }, { type: "preview:" + action, token: "original-token" }]);
  nodes["#" + action]!.click(); expect(calls).toHaveLength(2);
  await vi.waitFor(() => expect(nodes["#status"]!.textContent).toBe(action === "confirm" ? "previewComplete" : "previewCancelled"));
});
test("expiry disables both controls without sending a mutation request", async () => {
  const ready = load(); settle({ ok: true, plan: plan() }); await ready;
  await vi.advanceTimersByTimeAsync(60000); disabled(true);
  expect(nodes["#status"]!.textContent).toBe("previewExpired"); expect(calls).toHaveLength(1);
});

test("reason rendering preserves unknown fallback, preview extract and named rule order", async () => {
  const preview = plan();
  preview.targets[0]!.reasons = ["move", "extract", "future-reason", "urlRule"];
  preview.targets[0]!.ruleNames = ["<First>", "Second"];
  preview.excluded = [{ ...preview.targets[0]!, reasons: ["urlRule"], ruleNames: [] }];
  const ready = load(); settle({ ok: true, plan: preview }); await ready;
  expect(nodes["#targets"]!.children[0]!.children[1]!.textContent).toBe("previewReasonMove, previewReasonExtract, previewReasonAction, workflowReasonURL — <First> — Second");
  expect(nodes["#excluded"]!.children[0]!.textContent).toBe("Original (8): previewReasonURL");
});
