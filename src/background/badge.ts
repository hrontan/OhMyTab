import { myBrowser, type ScopeType } from "../browser/browser-api";

const BADGE_COLOR = "#8cb6f7";
const BADGE_STATE_KEY = "ohmytabBadge";
// Chrome keys tab-specific texts by tab ID; Firefox keys window-specific texts by window ID.
type BadgeState = { color: boolean; global?: string; specific: Map<number, string>; legacyCleared: boolean };
type SessionArea = {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
};
const sessionArea = () => (myBrowser.storage as { session?: SessionArea }).session;
let badgeState: BadgeState | undefined;

// Badge values outlive the background page, so a new lifetime restores what it
// showed. Without a record, earlier lifetimes or versions may have left any value.
const loadBadgeState = async (): Promise<BadgeState> => {
  try {
    const saved = (await sessionArea()?.get(BADGE_STATE_KEY))?.[BADGE_STATE_KEY] as
      { color?: boolean; global?: string; specific?: [number, string][]; legacyCleared?: boolean } | undefined;
    if (saved) {
      return {
        color: saved.color === true, specific: new Map(saved.specific ?? []),
        legacyCleared: saved.legacyCleared === true,
        ...(typeof saved.global === "string" ? { global: saved.global } : {}),
      };
    }
  } catch {
    // Session storage is optional; the next pass then rewrites every value.
  }
  return { color: false, specific: new Map(), legacyCleared: false };
};
const saveBadgeState = async (state: BadgeState) => {
  try {
    await sessionArea()?.set({ [BADGE_STATE_KEY]: {
      color: state.color, global: state.global, specific: [...state.specific], legacyCleared: state.legacyCleared,
    } });
  } catch {
    // Losing the record only costs one full rewrite in a later lifetime.
  }
};

const badgeCall = async (work: () => unknown): Promise<boolean> => {
  try {
    await work();
    return true;
  } catch {
    console.log("setIconBadgeImpl", new Error("Badge API failed"));
    return false;
  }
};
// null removes a tab- or window-specific text so the broader value shows again.
const setBadgeTextFor = (target: { tabId: number } | { windowId: number } | object, text: string | null) =>
  badgeCall(() => myBrowser.action.setBadgeText({ ...target, text } as { text: string }));

export const setIconBadge = async (isEnable: boolean, scope: ScopeType) => {
  // Badge counts include pinned tabs; operation queries intentionally exclude them.
  const tabs = await myBrowser.tabs.query({ windowType: "normal" });
  const state = badgeState ??= await loadBadgeState();
  const counts = new Map<number, number>();
  for (const tab of tabs) {
    if (tab.windowId != null) counts.set(tab.windowId, (counts.get(tab.windowId) ?? 0) + 1);
  }
  const perWindow = isEnable && scope === "win";
  const desired = new Map<number, string>();
  const live = new Set<number>();
  let specificTarget: (key: number) => object;
  /// #if BROWSER === "chrome"
  for (const tab of tabs) {
    if (tab.id == null) continue;
    live.add(tab.id);
    if (perWindow) desired.set(tab.id, String(counts.get(tab.windowId!) ?? 0));
  }
  specificTarget = key => ({ tabId: key });
  /// #else
  for (const [windowId, count] of counts) {
    live.add(windowId);
    if (perWindow) desired.set(windowId, String(count));
  }
  specificTarget = key => ({ windowId: key });
  /// #endif

  const before = JSON.stringify([state.color, state.global, [...state.specific], state.legacyCleared]);
  const calls: Promise<unknown>[] = [];
  if (!state.color) {
    calls.push(badgeCall(() => myBrowser.action.setBadgeBackgroundColor({ color: BADGE_COLOR }))
      .then(ok => { if (ok) state.color = true; }));
  }
  const global = isEnable && !perWindow ? String(tabs.length) : "";
  if (state.global !== global) {
    calls.push(setBadgeTextFor({}, global).then(ok => { if (ok) state.global = global; }));
  }
  for (const key of [...state.specific.keys()]) {
    // Closing a tab or window discards its specific value.
    if (!live.has(key)) state.specific.delete(key);
    else if (!desired.has(key)) {
      calls.push(setBadgeTextFor(specificTarget(key), null).then(ok => { if (ok) state.specific.delete(key); }));
    }
  }
  if (!state.legacyCleared) {
    // Older versions set a text on every tab; clear what will not be rewritten.
    const clears: Promise<boolean>[] = [];
    for (const tab of tabs) {
      if (tab.id == null) continue;
      /// #if BROWSER === "chrome"
      if (desired.has(tab.id)) continue;
      /// #endif
      clears.push(setBadgeTextFor({ tabId: tab.id }, null));
    }
    /// #if BROWSER !== "chrome"
    for (const windowId of live) if (!desired.has(windowId)) clears.push(setBadgeTextFor({ windowId }, null));
    /// #endif
    calls.push(Promise.all(clears).then(results => { if (results.every(Boolean)) state.legacyCleared = true; }));
  }
  for (const [key, text] of desired) {
    if (state.specific.get(key) === text) continue;
    calls.push(setBadgeTextFor(specificTarget(key), text).then(ok => {
      if (ok) state.specific.set(key, text);
      else state.specific.delete(key);
    }));
  }
  await Promise.all(calls);
  if (JSON.stringify([state.color, state.global, [...state.specific], state.legacyCleared]) !== before) {
    await saveBadgeState(state);
  }
};

const NOTICE_MS = 2000;
// Briefly marks a request that was not executed on the tab where it was made.
export const flashIconBadge = async (tabId: number, restored: () => unknown) => {
  const shown = await Promise.all([
    setBadgeTextFor({ tabId }, "!"),
    badgeCall(() => myBrowser.action.setBadgeBackgroundColor({ tabId, color: "#d93025" })),
  ]);
  if (!shown.some(Boolean)) return;
  setTimeout(() => {
    void (async () => {
      /// #if BROWSER === "chrome"
      badgeState?.specific.delete(tabId);
      /// #endif
      await Promise.all([
        setBadgeTextFor({ tabId }, null),
        badgeCall(() => myBrowser.action.setBadgeBackgroundColor({ tabId, color: BADGE_COLOR })),
      ]);
      await restored();
    })();
  }, NOTICE_MS);
};
