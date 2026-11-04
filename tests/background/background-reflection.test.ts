import { afterEach, beforeEach, expect, test, vi } from "vitest";

let setIconBadge: ReturnType<typeof vi.fn>, updateContextMenus: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.resetModules();
  setIconBadge = vi.fn(async () => {}); updateContextMenus = vi.fn(async () => {});
  vi.doMock("../../src/background/badge", () => ({ setIconBadge }));
  vi.doMock("../../src/background/contextmenu", () => ({ initializeContextMenus: vi.fn(async () => {}), updateContextMenus }));
  vi.doMock("../../src/browser/api", () => ({ getActiveTab: async () => ({ url: "https://example.com/", pinned: false }) }));
  vi.doMock("../../src/settings/setting", () => ({ getSetting: async () => ({ iconbadge: true, iconbadgescope: "all" }), getChangedSettingKeys: () => [] }));
});
afterEach(() => { for (const path of ["badge", "contextmenu"]) vi.doUnmock("../../src/background/" + path);
  vi.doUnmock("../../src/browser/api"); vi.doUnmock("../../src/settings/setting"); });
async function reflection() {
  let running = true;
  const { createBackgroundReflection } = await import("../../src/background/background-reflection.ts");
  return { value: createBackgroundReflection({ isOperationRunning: () => running }), stop: () => { running = false; } };
}

test("updates deferred during an inspection are applied when it settles", async () => {
  const { value, stop } = await reflection();
  await value.updateIconBadge(); await value.updateFlushContextMenus();
  expect(setIconBadge).not.toHaveBeenCalled(); expect(updateContextMenus).not.toHaveBeenCalled();
  stop(); await value.onOperationSettled(true);
  expect(setIconBadge).toHaveBeenCalledOnce(); expect(updateContextMenus).toHaveBeenCalledOnce();
});

test("an inspection without deferred events does not redraw", async () => {
  const { value, stop } = await reflection();
  stop(); await value.onOperationSettled(true);
  expect(setIconBadge).not.toHaveBeenCalled(); expect(updateContextMenus).not.toHaveBeenCalled();
  await value.onOperationSettled(); expect(setIconBadge).toHaveBeenCalledOnce();
});
