import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { RX_SEARCH_ENGINE, RX_SYSTEM, RX_SYSTEM2 } from "../../src/rules/regex.ts";
import { installBrowserMock, type BrowserTarget } from "../helpers/browser.ts";

vi.mock("../../src/background/contextmenu.ts", () => ({ initializeContextMenus: vi.fn(), updateContextMenus: vi.fn() }));
const target = process.env.TEST_BROWSER as BrowserTarget;
beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

const searchFixtures = [
  "https://www.google.com/search?q=test", "https://www.google.co.jp/search?q=test",
  "https://search.yahoo.com/search?p=test", "https://search.yahoo.co.jp/search?p=test",
  "https://www.bing.com/search?q=test", "https://search.brave.com/search?q=test",
  "https://scholar.google.com/scholar?q=test", "https://www.baidu.com/s?wd=test",
  "https://www.baidu.com/baidu?wd=test", "https://duckduckgo.com/?q=test",
  "https://www.dogpile.com/serp?q=test", "https://yandex.com/search/?text=test",
  "https://yandex.ru/search/?text=test", "https://www.startpage.com/sp/search?query=test",
  "https://www.startpage.com/sp/search?q=test", "https://www.ecosia.org/search?q=test",
  "https://swisscows.com/web?query=test", "https://search.naver.com/search.naver?query=test",
];
const systemFixtures = [
  "chrome://settings/", "edge://settings/", "brave://settings/wallet",
  "chrome-extension://abcdefghijklmnopabcdefghijklmnop/options.html", "about:blank", "about:newtab",
  "https://ntp.msn.com/", "https://ntp.msn.com/edge/ntp",
];
const systemTest = (url: string) => RX_SYSTEM.test(url) || RX_SYSTEM2.test(url);

test.each(systemFixtures)("system positive %s", (url) => {
  expect(systemTest(url)).toBe(true);
});
test.each([
  "https://ntp.msn.com.evil.example/", "https://ntpXmsnYcom.example/",
  "https://ntp-msn.com/", "https://example.com/?url=chrome://settings",
  "http://ntp.msn.com/", "https://ntp.msn.com:8443/", "chrome://", "about:",
  "invalid", "", "file:///tmp/page.html", "https://www.msn.com/",
])("system negative %s", (url) => {
  expect(systemTest(url)).toBe(false);
});

test.each(searchFixtures)("search positive %s", (url) => {
  expect(RX_SEARCH_ENGINE.test(url)).toBe(true);
  const parsed = new URL(url);
  // Every positive has paired host and non-result-path exclusions.
  parsed.hostname += ".evil.example";
  expect(RX_SEARCH_ENGINE.test(parsed.href)).toBe(false);
  parsed.hostname = new URL(url).hostname;
  parsed.pathname = "/privacy";
  expect(RX_SEARCH_ENGINE.test(parsed.href)).toBe(false);
});
test.each([
  "https://www.ecosia.org.evil.example/", "https://www.ecosia.org/privacy",
  "https://www.ecosia.org/privacy?q=test", "https://www.ecosia.org/",
  "https://www.ecosia.org/search?q=", "https://www.google.com/search?q=%20",
  "https://www.google.com/search?tracking=test", "https://www.google.com/imghp",
  "https://www.google.com/searching?q=test", "https://www.bing.com/searching?q=test",
  "https://swisscows.com/en", "https://search.naver.com/privacy?query=test",
  "https://www.youtube.com/results?search_query=test", "https://you.com/search?q=test",
  "https://www.google.com:8443/search?q=test", "https://user:password@www.google.com/search?q=test",
  "ftp://www.google.com/search?q=test", "invalid", "", "about:blank",
])("search negative %s", (url) => {
  expect(RX_SEARCH_ENGINE.test(url)).toBe(false);
});

test("parameter order, fragments and repeated predicates are stable", () => {
  const url = "https://www.google.com/search?hl=en&q=test#section";
  expect(RX_SEARCH_ENGINE.test(url)).toBe(true);
  expect(RX_SEARCH_ENGINE.test(url)).toBe(true);
});

const operationFixtures = [
  ...systemFixtures, ...searchFixtures,
  "https://ntp.msn.com.evil.example/", "https://ntpXmsnYcom.example/",
  "https://www.ecosia.org.evil.example/", "https://www.ecosia.org/privacy",
  "https://www.google.com/searching?q=test", "https://keep.example/", "invalid", "file:///tmp/page",
];

function installSelectionBrowser(feature: "comclose" | "rxclose", currentOnly: boolean) {
  const mock = installBrowserMock(target);
  const tabs: chrome.tabs.Tab[] = [
    ...operationFixtures.map((url, index) => ({ id: index + 1, url, windowId: 1, pinned: false })),
    { id: 101, url: systemFixtures[6]!, windowId: 1, pinned: true },
    { id: 102, url: searchFixtures[0]!, windowId: 1, pinned: true },
    { id: 103, url: systemFixtures[6]!, windowId: 2, pinned: false },
    { id: 104, url: searchFixtures[0]!, windowId: 2, pinned: false },
  ].map((tab, index) => ({
    index, active: false, highlighted: false, incognito: false, ...(target === "firefox" ? { cookieStoreId: "firefox-default" } : {}), selected: false,
    discarded: false, autoDiscardable: true, lastAccessed: 0, frozen: false, groupId: -1, ...tab,
  }));
  const event = () => ({ addListener: vi.fn() });
  const clicked = { addListener: vi.fn<(callback: () => Promise<void>) => void>() };
  const commanded = { addListener: vi.fn<(callback: (command: string) => Promise<void>) => void>() };
  Object.assign(mock.api.tabs, { onCreated: event(), onMoved: event(), onDetached: event(), onAttached: event(), onUpdated: event(), onRemoved: event(), onActivated: event() });
  Object.assign(mock.api.windows, { onFocusChanged: event() });
  Object.assign(mock.api.action, { onClicked: clicked });
  Object.assign(mock.api, {
    contextMenus: { onClicked: event() }, commands: { onCommand: commanded }, runtime: { onInstalled: event(), onStartup: event(), onMessage: event() },
  });
  mock.api.tabs.query.mockImplementation(async (value) => {
    const query = value as { currentWindow?: boolean; pinned?: boolean };
    return structuredClone(tabs.filter(tab =>
      (!query.currentWindow || tab.windowId === 1) &&
      (query.pinned == null || tab.pinned === query.pinned),
    ));
  });
  Object.assign(mock.data, {
    glue: false, depclean: false, sorttab: false, refresh: false, comclose: false,
    closelocal: false, rxclose: false, grouping: false, iconbadge: false, urlmatch: false,
    currentonly: currentOnly, [feature]: true,
  });
  return { ...mock, clicked, commanded };
}

describe.each(["comclose", "rxclose"] as const)("%s entry-point parity", (feature) => {
  test.each([true, false])("current-window-only=%s", async (currentOnly) => {
    const expected = feature === "comclose"
      ? systemFixtures.map((_, i) => i + 1)
      : searchFixtures.map((_, i) => i + 1 + systemFixtures.length);
    if (!currentOnly) expected.push(feature === "comclose" ? 103 : 104);
    const selected: number[][] = [];
    for (const entry of ["button", "shortcut"]) {
      vi.resetModules();
      const mock = installSelectionBrowser(feature, currentOnly);
      await import("../../src/background/background.ts");
      if (entry === "button") {
        const callback = mock.clicked.addListener.mock.calls[0]?.[0];
        expect(callback).toBeTypeOf("function");
        await callback?.();
      } else {
        const callback = mock.commanded.addListener.mock.calls[0]?.[0];
        expect(callback).toBeTypeOf("function");
        await callback?.(feature === "comclose" ? "07_execute_option5" : "09_execute_option7");
      }
      const ids = mock.api.tabs.remove.mock.calls.flatMap(([values]) => values);
      expect(ids.sort((a, b) => a - b)).toEqual(expected);
      expect(new Set(ids).size).toBe(ids.length);
      selected.push(ids);
    }
    expect(selected[0]).toEqual(selected[1]);
  });
});
