import { compileURLRules } from "../rules/url-rules";
import { WorkflowError, type WorkflowDraft, type WorkflowRule, type WorkflowOperations } from "./workflow-types";

export const strictObject = (value: unknown, keys: string[]): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw new WorkflowError("invalid");
  return value as Record<string, unknown>;
};
export const revision = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new WorkflowError("invalid");
  return value;
};
export const uuid = (value: unknown): string => {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new WorkflowError("invalid");
  return value;
};
export const workflowName = (value: unknown): string => {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 80) throw new WorkflowError("invalid", "name");
  return value.trim();
};
const bool = (value: unknown): boolean => { if (typeof value !== "boolean") throw new WorkflowError("invalid"); return value; };
const host = (value: string): string => {
  if (/[\s/@?#*\\]/.test(value) || (value.startsWith("[") ? !/^\[[0-9a-f:.]+\]$/i.test(value) : value.includes(":"))) throw new WorkflowError("invalid", "condition");
  try {
    const parsed = new URL("http://" + value);
    const result = parsed.hostname.toLowerCase().replace(/\.$/, "");
    if (!result || parsed.port || parsed.pathname !== "/" || result.split(".").some(part => !part) || (!result.startsWith("[") && !/^[a-z0-9._-]+$/.test(result))) throw Error();
    return result;
  } catch { throw new WorkflowError("invalid", "condition"); }
};
export const validateWorkflowDraft = (input: unknown): WorkflowDraft => {
  const draft = strictObject(input, ["name", "scope", "rules", "operations"]);
  if (draft.scope !== "win" && draft.scope !== "all") throw new WorkflowError("invalid", "scope");
  if (!Array.isArray(draft.rules) || draft.rules.length > 100) throw new WorkflowError("invalid", "rules");
  const ids = new Set<string>();
  const rules: WorkflowRule[] = draft.rules.map((inputRule: unknown) => {
    const rule = strictObject(inputRule, ["id", "name", "enabled", "condition"]), id = uuid(rule.id);
    if (ids.has(id.toLowerCase())) throw new WorkflowError("invalid", "rules", id);
    ids.add(id.toLowerCase());
    try {
      const condition = strictObject(rule.condition, ["kind", "value", "includeSubdomains"]);
      if (typeof condition.value !== "string" || !condition.value.trim() || condition.value.length > 1024 || /[\r\n]/.test(condition.value)) throw new WorkflowError("invalid", "condition");
      let parsed: WorkflowRule["condition"];
      if (condition.kind === "host") parsed = { kind: "host", value: host(condition.value.trim()), includeSubdomains: bool(condition.includeSubdomains) };
      else {
        if ("includeSubdomains" in condition || (condition.kind !== "glob" && condition.kind !== "contains")) throw new WorkflowError("invalid", "condition");
        const value = condition.kind === "glob" ? condition.value.trim() : condition.value;
        if (condition.kind === "glob") compileURLRules(value);
        parsed = { kind: condition.kind, value };
      }
      return { id, name: workflowName(rule.name), enabled: bool(rule.enabled), condition: parsed };
    } catch { throw new WorkflowError("invalid", "condition", id); }
  });
  const op = strictObject(draft.operations, ["glue", "depclean", "sorttab", "sortkey", "refresh", "comclose", "rxclose", "closelocal", "grouping", "grouping_min"]);
  if (op.sortkey !== "url" && op.sortkey !== "title") throw new WorkflowError("invalid", "operations");
  const minimum = revision(op.grouping_min);
  if (minimum < 2 || minimum > 10) throw new WorkflowError("invalid", "operations");
  const operations: WorkflowOperations = { glue: bool(op.glue), depclean: bool(op.depclean), sorttab: bool(op.sorttab), sortkey: op.sortkey, refresh: bool(op.refresh), comclose: bool(op.comclose), rxclose: bool(op.rxclose), closelocal: bool(op.closelocal), grouping: bool(op.grouping), grouping_min: minimum };
  if (draft.scope === "win" && operations.glue) throw new WorkflowError("invalid", "scope");
  return { name: workflowName(draft.name), scope: draft.scope, rules, operations };
};
export type CompiledWorkflowRule = { rule: WorkflowRule; test: (url: string) => boolean };
export const compileWorkflowRules = (rules: WorkflowRule[]): CompiledWorkflowRule[] => rules.map(rule => {
  const condition = rule.condition;
  if (condition.kind === "glob") { const patterns = compileURLRules(condition.value); return { rule, test: url => patterns.some(pattern => pattern.test(url)) }; }
  if (condition.kind === "contains") return { rule, test: url => url.includes(condition.value) };
  const value = host(condition.value), ip = value.startsWith("[") || /^\d+\.\d+\.\d+\.\d+$/.test(value);
  return { rule, test: url => { try { const parsed = new URL(url), hostname = parsed.hostname.replace(/\.$/, ""); return ["http:", "https:"].includes(parsed.protocol) && (hostname === value || (!ip && condition.includeSubdomains && hostname.endsWith("." + value))); } catch { return false; } } };
});
export const matchingWorkflowRules = (url: string | undefined, rules: CompiledWorkflowRule[]): WorkflowRule[] =>
  url == null ? [] : rules.filter(rule => rule.rule.enabled && rule.test(url)).map(rule => rule.rule);
