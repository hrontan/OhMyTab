import { sendRuntimeMessage } from "../browser/message-transport";
import { myBrowser } from "../browser/browser-api";
import { getSetting } from "../settings/setting";
import { validateWorkflowDraft } from "../workflows/workflow-rules";
import { createWorkflowInspection } from "./options-workflow-inspection";
import type { WorkflowDraft, WorkflowReply, WorkflowRequest, WorkflowStore, SavedWorkflow, WorkflowRule } from "../workflows/workflow-types";

const message = (key: string) => myBrowser.i18n.getMessage(key);
const operationLabels = { glue: "option1", depclean: "option2", sorttab: "option3", refresh: "option4", comclose: "option5", rxclose: "option7", closelocal: "option13", grouping: "option14" } as const;
const emptyDraft = (): WorkflowDraft => ({ name: "", scope: "win", rules: [], operations: { glue: false, depclean: false, sorttab: false, sortkey: "url", refresh: false, comclose: false, rxclose: false, closelocal: false, grouping: false, grouping_min: 4 } });
const send = async (request: WorkflowRequest): Promise<WorkflowReply> =>
  await sendRuntimeMessage(request, () => "unavailable") as WorkflowReply;

/** Initialize after localization, outside the global settings form. */
export const initializeWorkflows = async (request = send) => {
  const root = document.querySelector<HTMLElement>("#workflows");
  if (!root) return;
  let store: WorkflowStore = { version: 1, revision: 0, workflows: [] };
  let selected: SavedWorkflow | undefined, draft = emptyDraft(), dirty = false, conflict = false, busy = false;
  const editorId = crypto.randomUUID();
  let draftRevision = 0, listSerial = 0;
  const ruleFields = new Map<string, HTMLInputElement>();
  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, parent: HTMLElement, text?: string) => {
    const element = document.createElement(tag); if (text !== undefined) element.textContent = text;
    if (parent.tagName === "LABEL" && (tag === "input" || tag === "select")) element.setAttribute("aria-label", parent.textContent ?? "");
    parent.appendChild(element); return element;
  };
  const heading = make("h1", root, message("workflowTitle")); heading.id = "workflow_heading";
  root.setAttribute("aria-labelledby", heading.id);
  make("p", root, message("workflowHelp"));
  make("p", root, message("workflowStorageHelp"));
  const status = make("p", root); status.id = "workflow_status"; status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite"); status.setAttribute("aria-atomic", "true");
  const announce = (key: string) => { status.textContent = message(key); status.dataset.state = key; };
  const button = (parent: HTMLElement, key: string, action: () => unknown) => {
    const control = make("button", parent, message(key)); control.type = "button"; control.addEventListener("click", () => { void action(); }); return control;
  };
  const label = (parent: HTMLElement, key: string) => make("label", parent, message(key));
  const selection = make("section", root); selection.id = "workflow_selection";
  const list = make("select", label(selection, "workflowSaved")); list.id = "workflow_list";
  const loadActions = make("div", selection); loadActions.className = "workflow-load-actions";
  const newActions = make("div", selection); newActions.className = "workflow-new-actions";
  const conflictChoice = make("section", root); conflictChoice.id = "workflow_conflict"; conflictChoice.hidden = true;
  const conflictHeading = make("h2", conflictChoice, message("workflowConflictTitle")); conflictHeading.id = "workflow_conflict_heading";
  conflictChoice.setAttribute("aria-labelledby", conflictHeading.id);
  const conflictHelp = make("p", conflictChoice, message("workflowConflictHelp"));
  const conflictButtons: HTMLButtonElement[] = [], mutationButtons: HTMLButtonElement[] = [];
  let deletedConflict = false;
  const setBusy = (value: boolean) => {
    busy = value;
    for (const control of conflictButtons) control.disabled = value || (control === overwriteButton && deletedConflict);
    for (const control of mutationButtons) control.disabled = value || conflict;
  };
  const setConflict = (value: boolean) => {
    conflict = value; conflictChoice.hidden = !value;
    if (!value) deletedConflict = false;
    conflictHelp.textContent = message(selected ? "workflowConflictHelp" : "workflowConflictNewHelp");
    overwriteButton.textContent = message(selected ? "workflowOverwrite" : "workflowRetrySave");
    setBusy(busy);
  };
  const choice = make("div", root); choice.hidden = true;
  make("p", choice, message("workflowDiscardHelp"));
  let pending: (() => void) | undefined;
  button(choice, "workflowKeep", () => { choice.hidden = true; pending = undefined; list.value = selected?.id ?? ""; });
  button(choice, "workflowDiscard", () => { choice.hidden = true; const action = pending; pending = undefined; action?.(); });
  const guard = (action: () => void) => { if (busy) return; if (dirty) { pending = action; choice.hidden = false; choice.querySelector("button")?.focus(); } else action(); };
  const editor = make("section", root); editor.id = "workflow_editor";
  make("h2", editor, message("workflowEditing"));
  const name = make("input", label(editor, "workflowName")); name.id = "workflow_name"; name.maxLength = 80;
  const scope = make("select", label(editor, "workflowScope")); scope.id = "workflow_scope";
  for (const [value, key] of [["win", "workflowScopeWin"], ["all", "workflowScopeAll"]] as const) { const opt = make("option", scope, message(key)); opt.value = value; }
  make("p", editor, message("workflowScopeHelp"));
  const glueOffer = make("div", editor); glueOffer.hidden = true;
  make("p", glueOffer, message("workflowGlueScope"));
  button(glueOffer, "workflowUseAll", () => { draft.scope = "all"; scope.value = "all"; glueOffer.hidden = true; changed(); });
  const operations = make("fieldset", editor); make("legend", operations, message("workflowOperations"));
  const operationInputs = new Map<keyof typeof operationLabels, HTMLInputElement>();
  for (const key of Object.keys(operationLabels) as (keyof typeof operationLabels)[]) {
    const operationLabel = make("label", operations); operationLabel.className = "workflow-operation-label";
    const input = make("input", operationLabel); input.type = "checkbox"; input.id = "workflow_op_" + key; input.setAttribute("aria-label", message(operationLabels[key]));
    make("span", operationLabel, message(operationLabels[key])); operationInputs.set(key, input);
    input.addEventListener("change", () => { draft.operations[key] = input.checked; glueOffer.hidden = !draft.operations.glue || draft.scope === "all"; changed(); });
  }
  const sortkey = make("select", label(operations, "option3_0"));
  for (const value of ["url", "title"]) { const opt = make("option", sortkey, message(value === "url" ? "option3_1" : "option3_2")); opt.value = value; }
  sortkey.addEventListener("change", () => { draft.operations.sortkey = sortkey.value as "url" | "title"; changed(); });
  const minimum = make("input", label(operations, "option14_0")); minimum.type = "number"; minimum.min = "2"; minimum.max = "10";
  minimum.addEventListener("input", () => { draft.operations.grouping_min = Number(minimum.value); changed(); });
  const ruleDetails = make("details", editor); ruleDetails.id = "workflow_rule_details";
  make("summary", ruleDetails, message("workflowRules"));
  const rules = make("fieldset", ruleDetails); make("legend", rules, message("workflowRules")); make("p", rules, message("workflowRuleHelp"));
  const rows = make("div", rules);
  const error = (reply: { status: string; field?: string; ruleId?: string }) => {
    if (reply.status === "conflict") setConflict(true);
    announce(conflict && reply.status === "failed" ? "workflowSaveFailed" : "workflowError_" + reply.status);
    if (conflict && (reply.status === "conflict" || reply.status === "failed")) { conflictChoice.querySelector("button")?.focus(); return; }
    const field = reply.ruleId ? ruleFields.get(reply.ruleId) : reply.field === "scope" ? scope : reply.field === "operations" ? minimum : name;
    if (reply.ruleId || reply.field === "rules") ruleDetails.open = true;
    (reply.field === "rules" && !reply.ruleId ? ruleDetails.querySelector("button") : field)?.focus();
  };
  const call = async (input: WorkflowRequest): Promise<WorkflowReply> => {
    try { return await request(input); } catch { return { ok: false, status: "unavailable" }; }
  };
  const validate = (): WorkflowDraft | undefined => {
    const candidate = structuredClone(draft);
    for (const rule of candidate.rules) if (rule.condition.kind === "host" && /^https?:\/\//i.test(rule.condition.value.trim())) {
      try { rule.condition.value = new URL(rule.condition.value.trim()).hostname; } catch { error({ status: "invalid", ruleId: rule.id }); return; }
    }
    try { return validateWorkflowDraft(candidate); } catch (failure) { error(failure as { status: string; field?: string; ruleId?: string }); return; }
  };
  const identity = () => ({ editorId, draftRevision });
  function changed() {
    dirty = true;
    void inspection.invalidate();
    announce(conflict ? "workflowError_conflict" : "workflowUnsaved");
  }
  const renderRules = () => {
    rows.replaceChildren(); ruleFields.clear();
    draft.rules.forEach(rule => {
      const row = make("fieldset", rows); make("legend", row, rule.name || message("workflowRuleName"));
      const ruleName = make("input", label(row, "workflowRuleName")); ruleName.value = rule.name; ruleName.maxLength = 80;
      ruleName.addEventListener("input", () => { rule.name = ruleName.value; row.querySelector("legend")!.textContent = rule.name; changed(); });
      const enabled = make("input", label(row, "workflowEnabled")); enabled.type = "checkbox"; enabled.checked = rule.enabled;
      const state = make("p", row, message(rule.enabled ? "workflowEnabled" : "workflowDisabled"));
      enabled.addEventListener("change", () => { rule.enabled = enabled.checked; state.textContent = message(rule.enabled ? "workflowEnabled" : "workflowDisabled"); changed(); });
      const kind = make("select", label(row, "workflowMatch")); for (const value of ["host", "contains", "glob"]) { const opt = make("option", kind, message("workflowMode_" + value)); opt.value = value; } kind.value = rule.condition.kind;
      const value = make("input", label(row, "workflowValue")); value.value = rule.condition.value; value.maxLength = 1024; ruleFields.set(rule.id, value);
      value.addEventListener("input", () => { rule.condition.value = value.value; changed(); });
      const subLabel = label(row, "workflowSubdomains"), sub = make("input", subLabel); sub.type = "checkbox"; sub.checked = rule.condition.kind === "host" && rule.condition.includeSubdomains; subLabel.hidden = rule.condition.kind !== "host";
      sub.addEventListener("change", () => { if (rule.condition.kind === "host") rule.condition.includeSubdomains = sub.checked; changed(); });
      kind.addEventListener("change", () => { rule.condition = kind.value === "host" ? { kind: "host", value: value.value, includeSubdomains: sub.checked } : { kind: kind.value as "glob" | "contains", value: value.value }; subLabel.hidden = kind.value !== "host"; changed(); });
      button(row, "workflowRemoveRule", () => { draft.rules = draft.rules.filter(item => item !== rule); changed(); renderRules(); });
      const inspectRule = button(row, "workflowInspectionOpenRule", () => inspection.open(inspectRule, rule.id));
    });
  };
  const render = () => {
    name.value = draft.name; scope.value = draft.scope; sortkey.value = draft.operations.sortkey; minimum.value = String(draft.operations.grouping_min);
    operationInputs.forEach((input, key) => { input.checked = draft.operations[key]; });
    glueOffer.hidden = !draft.operations.glue || draft.scope === "all";
    renderRules(); list.value = selected?.id ?? "";
  };
  const replaceDraft = (saved?: SavedWorkflow) => {
    selected = saved; draft = saved ? structuredClone({ name: saved.name, scope: saved.scope, operations: saved.operations, rules: saved.rules }) : emptyDraft();
    try { sessionStorage.setItem("ohmytab_workflow_selection", saved?.id ?? ""); } catch { /* Selection persistence is optional. */ }
    changed(); dirty = false; ruleDetails.open = false; setConflict(false); render(); announce(saved ? "workflowSavedState" : "workflowNewState");
  };
  const renderList = () => {
    list.replaceChildren(); const blank = make("option", list, message("workflowNewState")); blank.value = "";
    for (const saved of store.workflows) { const opt = make("option", list, saved.name); opt.value = saved.id; }
    list.value = selected?.id ?? "";
  };
  const refreshList = async (reload = false) => {
    const serial = ++listSerial, revision = draftRevision, reply = await call({ type: "workflow:list" });
    if (serial !== listSerial) return;
    if (!reply.ok) { error(reply); return; } if (!("store" in reply)) return;
    const previous = selected; store = reply.store; renderList();
    let remembered = "";
    try { remembered = sessionStorage.getItem("ohmytab_workflow_selection") ?? ""; } catch { /* Storage may be unavailable. */ }
    const current = store.workflows.find(item => item.id === (previous?.id ?? remembered));
    if ((dirty && !reload) || revision !== draftRevision) { setConflict(true); announce("workflowError_conflict"); }
    else replaceDraft(current);
  };
  list.addEventListener("change", () => { if (busy) { list.value = selected?.id ?? ""; return; } const id = list.value; if (dirty) list.value = selected?.id ?? ""; guard(() => replaceDraft(store.workflows.find(item => item.id === id))); });
  button(loadActions, "workflowLoad", () => { const id = list.value; guard(() => replaceDraft(store.workflows.find(item => item.id === id))); });
  name.addEventListener("input", () => { draft.name = name.value; changed(); });
  scope.addEventListener("change", () => { draft.scope = scope.value as "win" | "all"; glueOffer.hidden = !draft.operations.glue || draft.scope === "all"; changed(); });
  button(newActions, "workflowNew", () => guard(() => replaceDraft()));
  const mutate = async (kind: "save" | "duplicate" | "delete") => {
    if (busy) return;
    if (conflict) { announce("workflowError_conflict"); conflictChoice.querySelector("button")?.focus(); return; }
    const valid = kind === "save" ? validate() : undefined; if (kind === "save" && !valid) return;
    const baseline = selected, revision = draftRevision;
    if (kind !== "save" && !baseline) { announce("workflowSelectSaved"); return; }
    setBusy(true); announce("workflowSaving");
    const input: WorkflowRequest = kind === "save" ? baseline ? { type: "workflow:update", expectedRevision: store.revision, id: baseline.id, expectedWorkflowRevision: baseline.revision, draft: valid! } : { type: "workflow:create", expectedRevision: store.revision, draft: valid! }
      : kind === "duplicate" ? { type: "workflow:duplicate", expectedRevision: store.revision, id: baseline!.id, expectedWorkflowRevision: baseline!.revision, name: (baseline!.name.slice(0, 60) + " " + message("workflowCopy")).slice(0, 80) }
      : { type: "workflow:delete", expectedRevision: store.revision, id: baseline!.id, expectedWorkflowRevision: baseline!.revision };
    const reply = await call(input); setBusy(false);
    if (!reply.ok) { if (reply.status === "conflict" || reply.status === "failed") setConflict(true); error(reply); return; }
    if (!("store" in reply)) return;
    const oldIds = new Set(store.workflows.map(item => item.id)); store = reply.store; renderList();
    if (revision !== draftRevision) { setConflict(true); announce("workflowError_conflict"); return; }
    const next = kind === "delete" ? undefined : kind === "duplicate" || !baseline ? store.workflows.find(item => !oldIds.has(item.id)) : store.workflows.find(item => item.id === baseline.id);
    replaceDraft(next); announce("workflowSavedState");
  };
  const saveActions = make("div", editor); saveActions.className = "workflow-save-actions";
  const inspectDraft = button(saveActions, "workflowInspectionOpen", () => inspection.open(inspectDraft));
  const saveButton = button(saveActions, "workflowSave", () => mutate("save")); saveButton.className = "workflow-primary"; mutationButtons.push(saveButton);
  const savedActions = make("section", root); savedActions.className = "workflow-saved-actions";
  make("h2", savedActions, message("workflowSavedActions"));
  mutationButtons.push(button(savedActions, "workflowDuplicate", () => guard(() => { void mutate("duplicate"); })));
  mutationButtons.push(button(savedActions, "workflowDelete", () => guard(() => { void mutate("delete"); })));
  conflictButtons.push(button(conflictChoice, "workflowReload", async () => {
    if (busy || !conflict) return;
    setBusy(true);
    try { await refreshList(true); } finally { setBusy(false); }
  }));
  const overwriteButton = button(conflictChoice, "workflowOverwrite", async () => {
    if (busy || !conflict || deletedConflict || !validate()) return;
    const revision = draftRevision, baseline = selected, serial = ++listSerial;
    setBusy(true); announce("workflowSaving");
    try {
      const reply = await call({ type: "workflow:list" });
      if (revision !== draftRevision || serial !== listSerial || selected?.id !== baseline?.id) {
        announce("workflowConflictChanged"); return;
      }
      if (!reply.ok) { error(reply); return; }
      if (!("store" in reply)) return;
      const current = baseline ? reply.store.workflows.find(item => item.id === baseline.id) : undefined;
      if (baseline && !current) {
        deletedConflict = true; announce("workflowConflictDeleted"); return;
      }
      store = reply.store; selected = current; renderList(); setConflict(false);
    } finally { setBusy(false); }
    await mutate("save");
  });
  conflictButtons.push(overwriteButton);
  button(rules, "workflowAddRule", () => { draft.rules.push({ id: crypto.randomUUID(), name: message("workflowRuleName"), enabled: true, condition: { kind: "host", value: "", includeSubdomains: false } }); changed(); renderRules(); });
  button(rules, "workflowCopyRules", async () => {
    const revision = draftRevision; try { const setting = await getSetting(); if (revision !== draftRevision) return;
      const additions: WorkflowRule[] = setting.urlmatch_pattern.split(/\r?\n/).map(value => value.trim()).filter(Boolean).map((value, index) => ({ id: crypto.randomUUID(), name: message("workflowRuleName") + " " + (draft.rules.length + index + 1), enabled: true, condition: { kind: "glob", value } }));
      const next = { ...draft, name: draft.name || message("workflowNewState"), rules: [...draft.rules, ...additions] }; validateWorkflowDraft(next);
      draft.rules = next.rules; changed(); renderRules();
    } catch { error({ status: "invalid", field: "rules" }); }
  });
  button(operations, "workflowCopyOperations", async () => { const revision = draftRevision; try { const setting = await getSetting(); if (revision !== draftRevision) return; for (const key of Object.keys(operationLabels) as (keyof typeof operationLabels)[]) draft.operations[key] = setting[key]; draft.operations.sortkey = setting.sortkey; draft.operations.grouping_min = setting.grouping_min; draft.scope = setting.glue || !setting.currentonly ? "all" : "win"; changed(); render(); } catch { error({ status: "unavailable" }); } });
  const inspection = createWorkflowInspection({ root,
    focusFallback: () => inspectDraft,
    available: () => !busy && !conflict,
    snapshot: () => { const valid = validate(); return valid ? { ...identity(), draft: valid, expectedStoreRevision: store.revision, dirty } : undefined; },
    invalidate: () => { draftRevision++; return call({ type: "workflow:draft-changed", ...identity() }); },
    request: call,
  });
  myBrowser.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" || (area === "local" && changes.saved_workflows_v1)) void inspection.invalidate();
    if (area === "local" && changes.saved_workflows_v1 && !busy) void refreshList();
  });
  render(); await refreshList();
};
