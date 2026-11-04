import { operationReasonKeys } from "../ui/operation-reasons";
import { initializePageText, message, sendPageRequest, setText as text } from "./page-runtime";
import type { PreviewPlan, PreviewRow } from "../operations/operation-plan";
const reasonKeys: Record<string, string> = { ...operationReasonKeys, extract: "previewReasonExtract" };
const buttons = (disabled: boolean) => document.querySelectorAll<HTMLButtonElement>("button").forEach(button => { button.disabled = disabled; });
const reasons = (row: PreviewRow) => [row.reasons.map(reason => message(reason === "urlRule" && row.ruleNames?.length ? "workflowReasonURL" : reasonKeys[reason] ?? "previewReasonAction")).join(", "), ...(row.ruleNames ?? [])].filter(Boolean).join(" — ");
const render = (plan: PreviewPlan) => {
  text("#scope", message("previewScope") + ": " + plan.windowIds.join(", ") + " — " + message("previewOrigin") + ": " + plan.originId + " / " + plan.originWindowId);
  text("#count", message("previewCount") + ": " + plan.targets.length);
  const targets = document.querySelector("#targets")!;
  for (const row of plan.targets) {
    const tr = document.createElement("tr"), tab = document.createElement("td"), reason = document.createElement("td"), url = document.createElement("div");
    tab.textContent = row.title + " (" + row.id + " / " + row.windowId + ")";
    url.className = "url"; url.textContent = row.url; tab.appendChild(url);
    reason.textContent = reasons(row); tr.append(tab, reason); targets.appendChild(tr);
  }
  const excluded = document.querySelector("#excluded")!;
  for (const row of plan.excluded) { const li = document.createElement("li"); li.textContent = row.title + " (" + row.id + "): " + reasons(row); excluded.appendChild(li); }
};
document.addEventListener("DOMContentLoaded", async () => {
  buttons(true);
  initializePageText("previewTitle");
  const token = new URL(location.href).searchParams.get("token");
  const request = async (type: string) => {
    const reply = await sendPageRequest({ type, token }, "Preview unavailable");
    return reply as { ok: boolean; status?: string; plan?: PreviewPlan };
  };
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  const finish = async (type: "confirm" | "cancel") => {
    clearTimeout(expiryTimer);
    buttons(true); text("#status", message(type === "confirm" ? "previewChecking" : "previewCancelled"));
    try {
      const reply = await request("preview:" + type);
      const key = reply.ok ? type === "confirm" ? "previewComplete" : "previewCancelled" : reply.status === "stale" ? "previewStale" : reply.status === "failed" ? "previewFailed" : "previewExpired";
      text("#status", message(key));
    } catch { text("#status", message("previewExpired")); }
  };
  document.querySelector("#confirm")!.addEventListener("click", () => { void finish("confirm"); });
  document.querySelector("#cancel")!.addEventListener("click", () => { void finish("cancel"); });
  try {
    const reply = await request("preview:get");
    if (!reply.ok || !reply.plan) throw new Error("Preview expired");
    render(reply.plan); buttons(false);
    document.querySelector<HTMLButtonElement>("#confirm")!.disabled = reply.plan.targets.length === 0;
    expiryTimer = setTimeout(() => { buttons(true); text("#status", message("previewExpired")); }, Math.max(0, reply.plan.expiresAt - Date.now()));
  } catch { buttons(true); text("#status", message("previewExpired")); }
});
