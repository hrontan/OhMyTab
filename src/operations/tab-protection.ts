import type { TabType } from "../browser/browser-api";
import type { SettingType } from "../settings/setting";
import { getDomain, isDomainMatch } from "./misc";

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

// Shared observable reasons can be reused by the future confirmation preview.
export const protectionReasons = (tab: TabType, setting: SettingType, domains: string[]): ProtectionReason[] => {
  const reasons: ProtectionReason[] = [];
  if (tab.pinned) reasons.push("pinned");
  if (domains.some(domain => isDomainMatch(tab.url, domain, true))) reasons.push("protected-domain");
  if (setting.protect_audible && tab.audible) reasons.push("audible");
  if (setting.protect_groups && "groupId" in tab && tab.groupId != null && tab.groupId >= 0) reasons.push("existing-group");
  return reasons;
};

export const duplicateTabIds = (tabs: TabType[], keeper: "last" | "active", originId?: number): number[] => {
  const groups = new Map<string, TabType[]>();
  for (const tab of tabs) {
    const key = tab.url ?? "";
    const group = groups.get(key) ?? [];
    group.push(tab); groups.set(key, group);
  }
  const kept = new Set<TabType>();
  for (const group of groups.values()) {
    const active = keeper === "active" ? group.filter(tab => tab.active) : [];
    kept.add(active.find(tab => tab.id === originId) ?? active.at(-1) ?? group.at(-1)!);
  }
  return tabs.filter(tab => tab.id != null && !kept.has(tab)).map(tab => tab.id!);
};
