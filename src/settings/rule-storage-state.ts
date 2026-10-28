import { getStorage } from "../browser/browser-api";

export const ruleStorageKey = "ohmytab_url_rules_v1";
export const ruleKeys = ["urlmatch", "urlmatch_pattern"] as const;
export type RuleMode = "sync" | "local";
export type Rules = { urlmatch: boolean; urlmatch_pattern: string };
export type State = { mode: RuleMode; rules?: Rules };
export const defaults: Rules = { urlmatch: false, urlmatch_pattern: "" };
export const same = (a: Rules, b: Rules) => a.urlmatch === b.urlmatch && a.urlmatch_pattern === b.urlmatch_pattern;

export async function state(): Promise<State> {
  const value: unknown = (await getStorage({ [ruleStorageKey]: null }, "local"))[ruleStorageKey];
  if (value == null) return { mode: "sync" };
  const record = value as Partial<State>;
  if (record.mode === "sync") return { mode: "sync" };
  if (record.mode === "local" && typeof record.rules?.urlmatch === "boolean" && typeof record.rules.urlmatch_pattern === "string") {
    return { mode: "local", rules: record.rules };
  }
  throw new Error("Invalid local URL-rule storage record; original data retained");
}

export async function locked<T>(operation: () => Promise<T>): Promise<T> {
  const locks = globalThis.navigator?.locks;
  if (!locks) throw new Error("URL-rule storage switching requires Web Locks");
  return locks.request("ohmytab-url-rules-v1", operation);
}

