import type { TabType, WindowType } from "../browser/browser-api";

export type TabSession = {
  incognito: boolean;
  containers: boolean;
  store: string | undefined;
  originId: number | undefined;
};

export const captureTabSession = (
  active: TabType | undefined, window: WindowType, containers: boolean,
): TabSession => {
  const incognito = active?.incognito ?? window.incognito;
  if (typeof incognito !== "boolean") throw new Error("Tab session unavailable");
  const store = active && "cookieStoreId" in active && typeof active.cookieStoreId === "string"
    ? active.cookieStoreId : undefined;
  return { incognito, containers, store, originId: active?.id };
};

export const isSameTabSession = (tab: TabType, session: TabSession): boolean => {
  if (tab.incognito !== session.incognito) return false;
  if (!session.containers) return true;
  // Missing container metadata is not evidence of the default container.
  if (!session.store) return tab.id != null && tab.id === session.originId;
  return "cookieStoreId" in tab && tab.cookieStoreId === session.store;
};
