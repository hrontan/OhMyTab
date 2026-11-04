import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { installBrowserMock, type BrowserTarget } from "../helpers/browser.ts";
import type { SettingType } from "../../src/settings/setting.ts";

vi.mock("../../src/background/contextmenu.ts", () => ({ initializeContextMenus: vi.fn(), updateContextMenus: vi.fn() }));
const target = process.env.TEST_BROWSER as BrowserTarget;
beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

// Exercise the registered action and real settings/API adapters. Query results
// respect current-window and pinned filters; remove changes subsequent queries.
function installCloseBrowser(settings: Partial<SettingType>) {
  const mock = installBrowserMock(target);
  let tabs: chrome.tabs.Tab[] = [
    { id: 1, url: "https://match.example/page", windowId: 1 },
    { id: 2, url: "https://duplicate.example/", windowId: 1 },
    { id: 3, url: "https://duplicate.example/", windowId: 1 },
    { id: 4, url: "about:blank", windowId: 1 },
    { id: 5, url: "file:///tmp/page.html", windowId: 1 },
    { id: 6, url: "https://www.google.com/search?q=test", windowId: 1 },
    { id: 7, url: "https://match.example/pinned", windowId: 1, pinned: true },
    { id: 8, url: "https://match.example/other-window", windowId: 2 },
    { id: 9, url: "https://keep.example/", windowId: 1 },
    { id: 10, url: "https://ntp.msn.com/page", windowId: 1 },
  ].map((tab, index) => ({
    active: false, highlighted: false, incognito: false, ...(target === "firefox" ? { cookieStoreId: "firefox-default" } : {}), selected: false,
    discarded: false, autoDiscardable: true, lastAccessed: 0, frozen: false, groupId: -1,
    index, title: String(tab.id), pinned: false, ...tab,
  }));
  const event = () => ({ addListener: vi.fn() });
  const clicked = { addListener: vi.fn<(callback: () => Promise<void>) => void>() };
  Object.assign(mock.api.tabs, { onCreated: event(), onMoved: event(), onDetached: event(), onAttached: event(), onUpdated: event(), onRemoved: event(), onActivated: event() });
  Object.assign(mock.api.windows, { onFocusChanged: event() });
  Object.assign(mock.api.action, { onClicked: clicked });
  Object.assign(mock.api, {
    contextMenus: { onClicked: event() }, commands: { onCommand: event() }, runtime: { onInstalled: event(), onStartup: event(), onMessage: event() },
  });
  mock.api.tabs.query.mockImplementation(async (value) => {
    const query = value as { currentWindow?: boolean; pinned?: boolean };
    return structuredClone(tabs.filter(tab =>
      (!query.currentWindow || tab.windowId === 1) &&
      (query.pinned == null || tab.pinned === query.pinned),
    ));
  });
  mock.api.tabs.remove.mockImplementation(async (ids) => {
    tabs = tabs.filter(tab => !ids.includes(tab.id!));
  });
  Object.assign(mock.data, {
    glue: false, depclean: false, sorttab: false, refresh: false, comclose: false,
    closelocal: false, rxclose: false, grouping: false, iconbadge: false,
    urlmatch: false, currentonly: true, urlmatch_pattern: "match.example", ...settings,
  });
  return { ...mock, clicked, remaining: () => tabs.map(tab => tab.id) };
}

async function execute(settings: Partial<SettingType>, expected: number[]) {
  const mock = installCloseBrowser(settings);
  await import("../../src/background/background.ts");
  const callback = mock.clicked.addListener.mock.calls[0]?.[0];
  expect(callback).toBeTypeOf("function");
  await callback?.();
  const removed = mock.api.tabs.remove.mock.calls.flatMap(([ids]) => ids);
  expect([...removed].sort((a, b) => a - b)).toEqual(expected);
  expect(new Set(removed).size).toBe(removed.length);
  expect(mock.remaining()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].filter(id => !expected.includes(id)));
  return mock;
}

describe("disabled saved URL rules do not expand other features", () => {
  test.each(Array.from({ length: 16 }, (_, mask) => mask))("enabled feature mask %i", async (mask) => {
    const depclean = Boolean(mask & 1);
    const comclose = Boolean(mask & 2);
    const closelocal = Boolean(mask & 4);
    const rxclose = Boolean(mask & 8);
    const expected = [
      ...(depclean ? [2] : []), ...(comclose ? [4, 10] : []),
      ...(closelocal ? [5] : []), ...(rxclose ? [6] : []),
    ].sort((a, b) => a - b);
    await execute({ depclean, comclose, closelocal, rxclose }, expected);
  });

  test.each(["depclean", "comclose", "closelocal", "rxclose"] as const)("over-limit rule does not block %s", async (feature) => {
    const expected = { depclean: [2], comclose: [4, 10], closelocal: [5], rxclose: [6] };
    await execute({ [feature]: true, urlmatch_pattern: "a".repeat(65_537) }, expected[feature]);
  });

  test("incomplete glob syntax remains inert when disabled", async () => {
    await execute({ depclean: true, urlmatch_pattern: "[\n@(\n{a,b" }, [2]);
  });

  test("all-window cleanup still excludes pinned and URL-only matches", async () => {
    await execute({ currentonly: false, depclean: true }, [2]);
  });
});

describe("enabled valid URL rules", () => {
  test("matches current window while preserving pinned and nonmatches", async () => {
    await execute({ urlmatch: true }, [1]);
  });
  test("matches all windows while preserving pinned and nonmatches", async () => {
    await execute({ urlmatch: true, currentonly: false }, [1, 8]);
  });
  test("trims multiline rules and deduplicates overlapping rule and feature matches", async () => {
    await execute({
      urlmatch: true, depclean: true,
      urlmatch_pattern: " \n  match.example  \r\n\nmatch.example/page\n duplicate.example \n",
    }, [1, 2, 3]);
  });
  test("blank rules do not close any tabs", async () => {
    await execute({ urlmatch: true, urlmatch_pattern: "\n \t\r\n" }, []);
  });
  test("matching and nonmatching ordinary glob rules retain their meaning", async () => {
    await execute({ urlmatch: true, urlmatch_pattern: "https://match.example/*\nnot-present.example" }, [1]);
  });
});
