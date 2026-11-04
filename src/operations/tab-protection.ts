import type { TabType } from "../browser/browser-api";
import type { SettingType } from "../settings/setting";
import { getDomain } from "./misc";

export type ProtectionReason = "pinned" | "protected-domain" | "audible" | "existing-group";
export const parseProtectedDomains = (raw: string): string[] => {
  if (raw.length > 4096) throw new Error("Protected domains: maximum 4096 characters");
  const domains: string[] = [];
  raw.split("\n").forEach((value, index) => {
    const line = value.trim();
    if (!line) return;
    const domain = getDomain("https://" + line);
    if (/[\s/@?#:]/.test(line) || !domain) throw new Error("Protected domains: invalid hostname on line " + (index + 1));
    if (domains.length >= 100) throw new Error("Protected domains: maximum 100 hostnames");
    domains.push(domain);
  });
  return domains;
};

export const protectionReasons = (
  tab: TabType, setting: SettingType, domains: string[], domainOf: (url: string | undefined) => string = url => getDomain(url ?? ""),
): ProtectionReason[] => {
  const reasons: ProtectionReason[] = [];
  if (tab.pinned) reasons.push("pinned");
  if (domains.length > 0) {
    const host = domainOf(tab.url);
    if (host && domains.some(domain => domain && (host === domain || host.endsWith("." + domain)))) reasons.push("protected-domain");
  }
  if (setting.protect_audible && tab.audible) reasons.push("audible");
  if (setting.protect_groups && "groupId" in tab && tab.groupId != null && tab.groupId >= 0) reasons.push("existing-group");
  return reasons;
};

// Until the first navigation commits, Chrome reports "" and Firefox about:blank,
// even with status "complete" right after tabs.create (Firefox 158). Such tabs
// share a URL only by accident, so they are never duplicates.
const uncommittedTab = (tab: TabType) => !tab.url || tab.url === "about:blank";

export const duplicateTabIds = (tabs: TabType[], keeper: "last" | "active", originId?: number): number[] => {
  const groups = new Map<string, TabType[]>();
  for (const tab of tabs) {
    if (uncommittedTab(tab)) continue;
    const group = groups.get(tab.url!) ?? [];
    group.push(tab); groups.set(tab.url!, group);
  }
  const kept = new Set<TabType>();
  for (const group of groups.values()) {
    const active = keeper === "active" ? group.filter(tab => tab.active) : [];
    kept.add(active.find(tab => tab.id === originId) ?? active.at(-1) ?? group.at(-1)!);
  }
  return tabs.filter(tab => tab.id != null && !uncommittedTab(tab) && !kept.has(tab)).map(tab => tab.id!);
};
