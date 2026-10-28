import type { TabType, WindowType } from "../browser/browser-api";
import type { SettingType } from "../settings/setting";
export const PREVIEW_TTL_MS = 60_000;
export type PreviewRow = { id: number; windowId: number; title: string; url: string; reasons: string[]; ruleIds?: string[]; ruleNames?: string[] };
export type PreviewPlan = { token: string; expiresAt: number; originId: number; originWindowId: number; windowIds: number[]; targets: PreviewRow[]; excluded: PreviewRow[] };
export const previewRow = (tab: TabType, reasons: string[]): PreviewRow => {
  if (tab.id == null || tab.windowId == null) throw new Error("Preview tab identity unavailable");
  return { id: tab.id, windowId: tab.windowId, title: tab.title ?? "", url: tab.url ?? "", reasons: [...new Set(reasons)] };
};
// Active changes when the preview opens. All fields that affect eligibility,
// ordering, session identity or operation selection remain bound to the snapshot.
const tabState = (tab: TabType) => [tab.id, tab.windowId, tab.index, tab.url, tab.pinned,
  tab.incognito, "cookieStoreId" in tab ? tab.cookieStoreId : null,
  tab.audible, "groupId" in tab ? tab.groupId : null, tab.discarded, tab.title];
export const previewFingerprint = (tabs: TabType[], windows: WindowType[], setting: SettingType, origin: TabType) =>
  JSON.stringify({ tabs: [...tabs].sort((a,b) => (a.id ?? -1) - (b.id ?? -1)).map(tabState),
    windows: windows.map(window => [window.id, window.incognito]).sort((a,b) => Number(a[0]) - Number(b[0])),
    setting, origin: tabState(origin) });
export const isLivePreview = (plan: PreviewPlan, token: unknown, now = Date.now()) =>
  token === plan.token && now < plan.expiresAt;
