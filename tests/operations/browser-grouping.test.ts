import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { installBrowserMock, type BrowserTarget } from "../helpers/browser.ts";
const target = process.env.TEST_BROWSER as BrowserTarget;
let mock: ReturnType<typeof installBrowserMock>;
beforeEach(() => { vi.resetModules(); mock = installBrowserMock(target); });
afterEach(() => vi.unstubAllGlobals());

test("unsupported effective grouping never overwrites the shared Chrome preference", async () => {
  Object.assign(mock.data, { grouping: true, grouping_min: 7, protect_audible: true });
  const setting = await import("../../src/settings/setting.ts");
  const effective = await setting.getSetting();
  expect(effective.grouping).toBe(target === "chrome");
  expect(mock.data.grouping).toBe(true);
  await setting.setSetting({ ...effective, protect_audible: false }, ["protect_audible"]);
  expect(mock.data).toMatchObject({ grouping: true, grouping_min: 7, protect_audible: false });
  await setting.setSetting({ ...effective, grouping: false, grouping_min: 9 });
  expect(mock.data).toMatchObject({ grouping: target === "firefox", grouping_min: target === "firefox" ? 7 : 9 });
  expect((await setting.getSetting()).grouping).toBe(false);
});
test("Firefox ignores explicit unsupported writes while Chrome can enable grouping", async () => {
  const setting = await import("../../src/settings/setting.ts");
  Object.assign(mock.data, { grouping: false, grouping_min: 4 });
  await setting.setSetting({ ...setting.defaultSetting, grouping: true, grouping_min: 8 }, ["grouping", "grouping_min"]);
  expect(mock.data.grouping).toBe(target === "chrome");
  expect(mock.data.grouping_min).toBe(target === "chrome" ? 8 : 4);
  expect(mock.api.storage.sync.set).toHaveBeenCalledTimes(target === "chrome" ? 1 : 0);
});
