import type { TabType } from "../browser/browser-api";
export const UNDO_LIMIT = 50;
export const UNDO_TTL_MS = 5 * 60_000;
export type UndoEntry = { key: string; url: string; windowId: number; index: number; state: "ready" | "unknown" };
export type RestoreResult = "restored" | "failed" | "unknown";
export const normalDefaultSession = (tab: TabType | undefined, containers: boolean) =>
  tab?.incognito === false && (!containers || ("cookieStoreId" in tab && tab.cookieStoreId === "firefox-default"));
const recordable = (tab: TabType, containers: boolean): boolean => {
  if (!normalDefaultSession(tab, containers) || tab.windowId == null || !Number.isInteger(tab.index) || tab.index < 0 || !tab.url || tab.url.length > 4096) return false;
  try { const url = new URL(tab.url); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
};
export class UndoBuffer {
  private batch: { expiresAt: number; entries: UndoEntry[] } | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  busy = false;
  private clear() { this.batch = undefined; clearTimeout(this.timer); this.timer = undefined; }
  read(now = Date.now()) {
    if (this.batch && now >= this.batch.expiresAt) this.clear();
    return { expiresAt: this.batch?.expiresAt, entries: this.batch?.entries.map(entry => ({ ...entry })) ?? [], busy: this.busy };
  }
  record(tabs: TabType[], containers: boolean, now = Date.now()) {
    if (this.busy) return false;
    const eligible = tabs.filter(tab => recordable(tab, containers)).sort((a,b) => (a.windowId ?? -1) - (b.windowId ?? -1) || a.index - b.index).slice(0, UNDO_LIMIT);
    if (!eligible.length) return false;
    this.clear();
    this.batch = { expiresAt: now + UNDO_TTL_MS, entries: eligible.map(tab => ({ key: crypto.randomUUID(), url: tab.url!, windowId: tab.windowId!, index: tab.index, state: "ready" })) };
    this.timer = setTimeout(() => this.clear(), UNDO_TTL_MS);
    return true;
  }
  remove(keys?: string[]) {
    this.read();
    if (this.busy) return false;
    if (!keys) this.clear();
    else if (this.batch) { this.batch.entries = this.batch.entries.filter(entry => !keys.includes(entry.key)); if (!this.batch.entries.length) this.clear(); }
    return true;
  }
  async restore(keys: string[], create: (entry: UndoEntry) => Promise<RestoreResult>) {
    this.read();
    if (this.busy) return { status: "busy", restored: 0, failed: 0, unknown: 0 };
    this.busy = true;
    const result = { status: "complete", restored: 0, failed: 0, unknown: 0 };
    try {
      const batch = this.batch;
      for (const entry of batch?.entries.filter(entry => keys.includes(entry.key) && entry.state === "ready") ?? []) {
        if (Date.now() >= batch!.expiresAt) { this.clear(); break; }
        let outcome: RestoreResult;
        try { outcome = await create({ ...entry }); } catch { outcome = "unknown"; }
        result[outcome]++;
        if (outcome === "restored") batch!.entries = batch!.entries.filter(item => item.key !== entry.key);
        else if (outcome === "unknown") entry.state = "unknown";
      }
      if (this.batch && !this.batch.entries.length) this.clear();
      return result;
    } finally { this.busy = false; }
  }
}
