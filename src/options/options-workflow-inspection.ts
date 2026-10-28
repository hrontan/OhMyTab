import { myBrowser } from "../browser/browser-api";
import { operationReasonKeys } from "../ui/operation-reasons";
import type { DraftIdentity, Origin, WorkflowDraft, WorkflowReply, WorkflowRequest } from "../workflows/workflow-types";

type Snapshot = DraftIdentity & { draft: WorkflowDraft; expectedStoreRevision: number; dirty: boolean };
type Dependencies = {
  root: HTMLElement;
  snapshot: () => Snapshot | undefined;
  focusFallback: () => HTMLElement | undefined;
  available: () => boolean;
  invalidate: () => Promise<WorkflowReply>;
  request: (request: WorkflowRequest) => Promise<WorkflowReply>;
};
const message = (key: string) => myBrowser.i18n.getMessage(key);
const INSPECTION_TTL_MS = 60000;

/** Inspection is created only by an explicit editor action; it grants no execution token. */
export const createWorkflowInspection = (dependencies: Dependencies) => {
  let dialog: HTMLDialogElement | undefined, originSelect: HTMLSelectElement, inspectButton: HTMLButtonElement;
  let previewButton: HTMLButtonElement, acknowledgement: HTMLInputElement, status: HTMLElement, results: HTMLElement, summary: HTMLElement;
  let opener: HTMLElement | undefined, ruleId: string | undefined, origins: Origin[] = [];
  let epoch = 0, serial = 0, observation = 0, acknowledged = false, waiting = false, fresh = false;
  let inspected: Snapshot | undefined, expiresAt = 0, timer: ReturnType<typeof setTimeout> | undefined;
  let detach: (() => void) | undefined;
  let pendingKind: "context" | "inspect" | "preview" | undefined;
  let disabledHelp: HTMLElement;
  const isOpen = () => !!dialog?.open;
  const announce = (key: string) => { if (status) { status.textContent = message(key); status.dataset.state = key; } };
  const selectedOrigin = () => origins.find(item => String(item.tabId) === originSelect?.value);
  const update = () => {
    if (!dialog) return;
    inspectButton.disabled = waiting || !acknowledged || !selectedOrigin() || !dependencies.available();
    previewButton.hidden = !ruleId;
    previewButton.disabled = waiting || !acknowledged || !fresh || !dependencies.available() || !inspected || (inspected.dirty && !acknowledgement.checked);
    acknowledgement.disabled = waiting || !fresh;
  };
  const clear = () => {
    fresh = false; inspected = undefined; expiresAt = 0;
    if (acknowledgement) acknowledgement.checked = false;
    if (timer) clearTimeout(timer);
    timer = undefined;
    results?.replaceChildren();
  };
  // Observations expire the display, never the backend draft/preview context.
  const stale = () => {
    ++observation; clear();
    if (pendingKind !== "preview") { waiting = false; pendingKind = undefined; }
    if (isOpen()) announce("workflowInspectionStale");
    update();
  };
  const renderSummary = (snapshot: Snapshot) => {
    const rule = snapshot.draft.rules.find(item => item.id === ruleId);
    summary.textContent = [snapshot.draft.name, message(snapshot.draft.scope === "all" ? "workflowScopeAll" : "workflowScopeWin"), message(rule ? "workflowInspectionRuleMode" : "workflowInspectionFullMode"), rule?.name,
      rule ? message(rule.enabled ? "workflowEnabled" : "workflowDisabled") : "", message(snapshot.dirty ? "workflowUnsaved" : "workflowSavedState")].filter(Boolean).join(" · ");
    disabledHelp.hidden = !rule || rule.enabled;
  };
  const invalidate = async () => {
    const version = ++serial;
    clear(); acknowledged = false; waiting = false; pendingKind = undefined;
    if (isOpen()) {
      announce("workflowInspectionStale");
      // Keep the heading on the current editor state; a vanished rule keeps its last summary instead of reading as full mode.
      const snapshot = dependencies.snapshot();
      if (snapshot && (!ruleId || snapshot.draft.rules.some(rule => rule.id === ruleId))) renderSummary(snapshot);
    }
    update();
    const reply = await dependencies.invalidate().catch((): WorkflowReply => ({ ok: false, status: "unavailable" }));
    if (version !== serial) return;
    acknowledged = reply.ok;
    if (!reply.ok && isOpen()) announce("workflowInspectionNotifyFailed");
    update();
  };
  const visible = (element: HTMLElement | undefined): element is HTMLElement => !!element?.isConnected && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden";
  const close = () => {
    if (!opener) return;
    const previous = opener; opener = undefined;
    ++epoch; detach?.(); detach = undefined;
    origins = []; originSelect.replaceChildren(); summary.textContent = ""; disabledHelp.hidden = true;
    if (isOpen()) dialog!.close();
    void invalidate();
    const target = visible(previous) ? previous : dependencies.focusFallback();
    if (visible(target)) target.focus();
  };
  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, parent: HTMLElement, key?: string) => {
    const element = document.createElement(tag); if (key) element.textContent = message(key);
    parent.appendChild(element); return element;
  };
  const button = (parent: HTMLElement, key: string, action: () => unknown) => {
    const element = make("button", parent, key); element.type = "button";
    element.addEventListener("click", () => { void action(); }); return element;
  };
  const inspect = async () => {
    if (waiting || !acknowledged || !dependencies.available()) return;
    const origin = selectedOrigin(), snapshot = dependencies.snapshot();
    if (!origin || !snapshot || (ruleId && !snapshot.draft.rules.some(rule => rule.id === ruleId))) return;
    const version = ++serial, currentEpoch = epoch, currentObservation = observation;
    clear(); renderSummary(snapshot); waiting = true; pendingKind = "inspect"; announce("workflowInspectionLoading"); update();
    const reply = await dependencies.request({ type: "workflow:inspect", editorId: snapshot.editorId, draftRevision: snapshot.draftRevision,
      expectedStoreRevision: snapshot.expectedStoreRevision, origin, draft: snapshot.draft, ...(ruleId ? { ruleId } : {}) });
    if (!isOpen() || version !== serial || currentEpoch !== epoch || currentObservation !== observation) return;
    waiting = false; pendingKind = undefined;
    if (!reply.ok || !("inspection" in reply) || reply.editorId !== snapshot.editorId || reply.draftRevision !== snapshot.draftRevision) {
      announce(reply.ok ? "workflowError_stale" : "workflowError_" + reply.status); update(); return;
    }
    inspected = snapshot; fresh = true; expiresAt = Date.now() + INSPECTION_TTL_MS;
    const inspection = reply.inspection;
    for (const [key, count] of [["workflowCandidates", inspection.candidateCount], ["workflowActual", inspection.targetCount], ["workflowExcluded", inspection.excludedCount]] as const) {
      const line = make("p", results); line.textContent = message(key) + ": " + count;
    }
    for (const row of [...inspection.targets, ...inspection.excluded]) {
      const line = make("p", results);
      line.textContent = [row.title, row.url, ...row.ruleNames, ...row.reasons.map(reason => message(reason === "urlRule" ? "workflowReasonURL" : operationReasonKeys[reason] ?? "previewReasonAction"))].filter(Boolean).join(" · ");
    }
    acknowledgement.parentElement!.hidden = !snapshot.dirty || !ruleId;
    announce(inspection.targetCount ? "workflowInspectionReady" : "workflowInspectionEmpty");
    previewButton.disabled = !inspection.targetCount;
    timer = setTimeout(stale, INSPECTION_TTL_MS);
    update();
    // An empty result never enables the close preview.
    if (!inspection.targetCount) { fresh = false; update(); }
  };
  const preview = async () => {
    if (!fresh || Date.now() >= expiresAt) { if (fresh) stale(); return; }
    if (waiting || !acknowledged || !ruleId || !inspected || !dependencies.available() || (inspected.dirty && !acknowledgement.checked)) return;
    const origin = selectedOrigin(), current = dependencies.snapshot();
    if (!origin || !current || JSON.stringify(current) !== JSON.stringify(inspected)) { void invalidate(); return; }
    const version = ++serial, currentEpoch = epoch;
    waiting = true; pendingKind = "preview"; update(); announce("workflowInspectionPreviewing");
    const reply = await dependencies.request({ type: "workflow:preview-rule", editorId: current.editorId, draftRevision: current.draftRevision,
      expectedStoreRevision: current.expectedStoreRevision, origin, draft: current.draft, ruleId });
    if (!isOpen() || currentEpoch !== epoch || version !== serial) return;
    waiting = false; pendingKind = undefined;
    clear(); announce(reply.ok && "status" in reply && reply.status === "preview" ? "workflowInspectionConfirmHelp" : reply.ok ? "workflowInspectionEmpty" : "workflowError_" + reply.status); update();
  };
  const build = () => {
    dialog = make("dialog", dependencies.root); dialog.id = "workflow_inspection_dialog";
    const heading = make("h2", dialog, "workflowInspectionTitle"); heading.id = "workflow_inspection_heading"; dialog.setAttribute("aria-labelledby", heading.id);
    summary = make("p", dialog); summary.id = "workflow_inspection_summary";
    disabledHelp = make("p", dialog, "workflowInspectionDisabledRuleHelp"); disabledHelp.hidden = true;
    make("p", dialog, "workflowInspectionHelp");
    const originLabel = make("label", dialog, "workflowInspectionOrigin");
    originSelect = make("select", originLabel); originSelect.id = "workflow_inspection_origin"; originSelect.setAttribute("aria-label", message("workflowInspectionOrigin"));
    originSelect.addEventListener("change", () => { void invalidate(); });
    status = make("p", dialog); status.id = "workflow_inspection_status"; status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite"); status.setAttribute("aria-atomic", "true");
    results = make("div", dialog); results.id = "workflow_inspection_results";
    inspectButton = button(dialog, "workflowInspectionInspect", inspect);
    const ackLabel = make("label", dialog); ackLabel.hidden = true;
    acknowledgement = make("input", ackLabel); acknowledgement.type = "checkbox"; acknowledgement.id = "workflow_inspection_ack";
    make("span", ackLabel, "workflowInspectionUnsavedAck"); acknowledgement.addEventListener("change", update);
    previewButton = button(dialog, "workflowInspectionClosePreview", preview);
    button(dialog, "workflowInspectionCancel", close);
    dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
    // Handles a native close initiated by the host as well as our Cancel/Escape path.
    dialog.addEventListener("close", close);
  };
  const open = async (control: HTMLElement, selectedRule?: string) => {
    if (isOpen() || !dependencies.available()) return;
    const snapshot = dependencies.snapshot(); if (!snapshot) return;
    const rule = selectedRule ? snapshot.draft.rules.find(item => item.id === selectedRule) : undefined;
    if (selectedRule && !rule) return;
    if (!dialog) build();
    opener = control; ruleId = selectedRule; ++epoch; origins = [];
    const currentEpoch = epoch;
    renderSummary(snapshot);
    dialog!.showModal();
    const onTabChange = () => { stale(); };
    type TabURL = { url?: string | undefined; pendingUrl?: string | undefined };
    const ownPreview = (...information: (TabURL | undefined)[]) => information.some(item => [item?.url, item?.pendingUrl].some(url => url?.startsWith(myBrowser.runtime.getURL(""))));
    const onUpdated = (_id: number, change: TabURL, tab: TabURL) => { if (!ownPreview(change, tab)) onTabChange(); };
    const onCreated = (tab: TabURL) => { if (!ownPreview(tab)) onTabChange(); };
    myBrowser.tabs.onUpdated?.addListener(onUpdated); myBrowser.tabs.onCreated?.addListener(onCreated); myBrowser.tabs.onRemoved?.addListener(onTabChange); myBrowser.tabs.onMoved?.addListener(onTabChange);
    myBrowser.tabs.onAttached?.addListener(onTabChange); myBrowser.tabs.onDetached?.addListener(onTabChange);
    detach = () => { myBrowser.tabs.onUpdated?.removeListener(onUpdated); myBrowser.tabs.onCreated?.removeListener(onCreated); myBrowser.tabs.onRemoved?.removeListener(onTabChange); myBrowser.tabs.onMoved?.removeListener(onTabChange); myBrowser.tabs.onAttached?.removeListener(onTabChange); myBrowser.tabs.onDetached?.removeListener(onTabChange); };
    await invalidate(); if (!isOpen() || currentEpoch !== epoch) return;
    const version = serial, currentObservation = observation; waiting = true; pendingKind = "context"; announce("workflowInspectionContextLoading"); update();
    const reply = await dependencies.request({ type: "workflow:context" });
    if (!isOpen() || currentEpoch !== epoch || version !== serial || currentObservation !== observation) return;
    waiting = false; pendingKind = undefined; originSelect.replaceChildren();
    const placeholder = make("option", originSelect, "workflowInspectionChooseOrigin"); placeholder.value = "";
    if (!reply.ok || !("origins" in reply)) { announce(reply.ok ? "workflowError_unavailable" : "workflowError_" + reply.status); update(); return; }
    origins = reply.origins.map(item => ({ tabId: item.tabId, windowId: item.windowId }));
    for (const item of reply.origins) { const option = make("option", originSelect); option.value = String(item.tabId); option.textContent = item.title + " · " + item.url; }
    originSelect.value = ""; announce(origins.length ? "workflowInspectionChooseOrigin" : "workflowInspectionNoOrigin"); update(); originSelect.focus();
  };
  return { open, invalidate };
};
