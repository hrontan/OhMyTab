import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { getDomain, getDomainsByLevelWithoutPublicSuffix, isDomainMatch } from "../../src/operations/misc.ts";
import { installBrowserMock, type BrowserTarget } from "../helpers/browser.ts";

const target = process.env.TEST_BROWSER as BrowserTarget;
beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

test.each([
  ["https://EXAMPLE.com:8443/path", "example.com"],
  ["http://example.com./", "example.com"],
  ["https://a.example.com/", "a.example.com"],
  ["http://127.0.0.1/", "127.0.0.1"],
  ["http://[2001:db8::1]/", "[2001:db8::1]"],
  ["http://localhost:8080/", "localhost"],
  ["file://example.com/path", ""], ["about:blank", ""], ["data:text/plain,test", ""],
  ["ftp://example.com/", ""], ["invalid", ""], ["", ""],
  ["https://bad_host.example/", ""], ["https://example.com../", ""],
])("actionable host %s => %s", (url, expected) => {
  expect(getDomain(url)).toBe(expected);
});

test.each([
  ["https://a.com.b.com/", ["a.com.b.com", "com.b.com", "b.com"]],
  ["https://a.example.co.uk/", ["a.example.co.uk", "example.co.uk"]],
  ["https://co.uk/", []], ["https://com/", []],
  ["https://a.example.com./", ["a.example.com", "example.com"]],
  ["https://a.tenant.blogspot.com/", ["a.tenant.blogspot.com", "tenant.blogspot.com"]],
  ["http://127.0.0.1/", []], ["http://[::1]/", []], ["http://localhost/", []],
  ["file://example.com/path", []], ["about:blank", []], ["data:text/plain,test", []],
  ["invalid", []], [undefined, []],
  ["https://a.b.c.d.e.f.example.com/", [
    "a.b.c.d.e.f.example.com", "b.c.d.e.f.example.com", "c.d.e.f.example.com",
    "d.e.f.example.com", "e.f.example.com",
  ]],
] as [string | undefined, string[]][])("hierarchy %s", (url, expected) => {
  expect(getDomainsByLevelWithoutPublicSuffix(url)).toEqual(expected);
});

// Paired positive/negative expectations use the same canonical host policy as
// the normal operation. Detailed boundary matching is checked via real events.
test.each([
  ["https://example.com/", "http://example.com:80/", true],
  ["https://example.com/", "https://a.example.com/", false],
  ["https://example.com/", "https://notexample.com/", false],
  ["https://example.com/", "https://example.com.evil.example/", false],
  ["https://example.com./", "https://example.com/", true],
  ["http://[::1]/", "http://[0:0:0:0:0:0:0:1]/", true],
  ["http://127.0.0.1/", "http://127.0.0.2/", false],
  ["http://localhost/", "http://a.localhost/", false],
] as [string, string, boolean][])("exact host pair %s / %s", (a, b, match) => {
  expect(Boolean(getDomain(a)) && getDomain(a) === getDomain(b)).toBe(match);
});

test.each([
  ["https://example.com/", true, true], ["https://a.example.com/", false, true],
  ["https://notexample.com/", false, false], ["https://example.com.evil.example/", false, false],
  ["https://example.com./", true, true], ["file://example.com/path", false, false],
  ["ftp://example.com/", false, false], ["about:blank", false, false],
  ["data:text/plain,test", false, false], ["invalid", false, false], [undefined, false, false],
] as [string | undefined, boolean, boolean][])("normal/detail boundary pair %s", (url, exact, detailed) => {
  expect(isDomainMatch(url, "example.com")).toBe(exact);
  expect(isDomainMatch(url, "example.com", true)).toBe(detailed);
  expect(isDomainMatch(url, "", true)).toBe(false);
});

type Input = { url?: string; pinned?: boolean; windowId?: number };
function installDomainBrowser(input: Input[], scope: "win" | "all" = "win") {
  const mock = installBrowserMock(target);
  const tabs: chrome.tabs.Tab[] = input.map((tab, index) => ({
    id: index + 1, index, windowId: 1, title: String(index), active: index === 0,
    pinned: false, highlighted: false, incognito: false, ...(target === "firefox" ? { cookieStoreId: "firefox-default" } : {}), selected: false,
    discarded: false, autoDiscardable: true, lastAccessed: 0, frozen: false, groupId: -1, ...tab,
  }));
  const event = () => ({ addListener: vi.fn() });
  const clicked = { addListener: vi.fn<(callback: (info: { menuItemId: string }, tab?: chrome.tabs.Tab) => Promise<void>) => void>() };
  const activated = { addListener: vi.fn<(callback: () => Promise<void>) => void>() };
  const created = vi.fn();
  const updated = vi.fn(async (_id: string, _details: unknown) => {});
  Object.assign(mock.api.tabs, { onCreated: event(), onMoved: event(), onDetached: event(), onAttached: event(), onUpdated: event(), onRemoved: event(), onActivated: activated });
  Object.assign(mock.api.windows, { onFocusChanged: event() });
  Object.assign(mock.api.action, { onClicked: event() });
  Object.assign(mock.api, {
    contextMenus: { onClicked: clicked, create: created, update: updated, removeAll: vi.fn(async () => {}) },
    commands: { onCommand: event() }, runtime: { onInstalled: event(), onStartup: event(), onMessage: event() },
    i18n: { getMessage: vi.fn((key: string) => key) },
  });
  mock.api.tabs.query.mockImplementation(async (value) => {
    const query = value as { currentWindow?: boolean; pinned?: boolean; active?: boolean };
    return structuredClone(tabs.filter(tab =>
      (!query.currentWindow || tab.windowId === 1) &&
      (query.pinned == null || tab.pinned === query.pinned) &&
      (query.active == null || tab.active === query.active),
    ));
  });
  mock.api.windows.getAll.mockResolvedValue(
    [...new Set(tabs.map(tab => tab.windowId))].map(id => ({
      id, type: "normal" as const, incognito: false, focused: id === 1, alwaysOnTop: false,
      tabs: tabs.filter(tab => tab.windowId === id).map(tab => ({ ...tab })),
    })),
  );
  mock.api.windows.create.mockImplementation(async () => ({ id: 3 }));
  Object.assign(mock.data, {
    glue: false, depclean: false, sorttab: false, refresh: false, comclose: false,
    closelocal: false, rxclose: false, grouping: false, iconbadge: false, urlmatch: false,
    contextmenu1: true, contextmenu1advanced: true, contextmenu1scope: scope,
    contextmenu4: true, contextmenu4advanced: true, contextmenu4scope: scope,
  });
  return { ...mock, clicked, activated, created, updated, active: tabs[0] };
}

async function operate(operation: "close" | "extract", detailed: boolean, input: Input[], expected: number[], scope: "win" | "all" = "win", level = 0) {
  const mock = installDomainBrowser(input, scope);
  await import("../../src/background/background.ts");
  if (detailed) await mock.activated.addListener.mock.calls[0]?.[0]();
  const callback = mock.clicked.addListener.mock.calls[0]?.[0];
  expect(callback).toBeTypeOf("function");
  await callback?.({ menuItemId: detailed ? `ohmytab_${operation}_l${level}` : `ohmytab_${operation}_tabs` }, mock.active);
  const actual = operation === "close"
    ? mock.api.tabs.remove.mock.calls.flatMap(([ids]) => ids)
    : [
      ...mock.api.windows.create.mock.calls.map(([details]) => (details as { tabId?: number }).tabId).filter((id): id is number => id != null),
      ...mock.api.tabs.move.mock.calls.flatMap(([ids]) => ids),
    ];
  expect(actual.sort((a, b) => a - b)).toEqual(expected);
  expect(new Set(actual).size).toBe(actual.length);
}

describe.each(["close", "extract"] as const)("%s actual context-menu IDs", (operation) => {
  const input: Input[] = [
    { url: "https://example.com/" }, { url: "https://a.example.com/" },
    { url: "https://notexample.com/" }, { url: "https://example.com.evil.example/" },
    { url: "file://example.com/path" }, { url: "about:blank" }, { url: "data:text/plain,test" },
    {}, { url: "invalid" }, { url: "https://example.com/pinned", pinned: true },
    { url: "https://example.com/other", windowId: 2 },
    { url: "https://example.com./" }, { url: "http://EXAMPLE.com:8080/" },
    { url: "ftp://example.com/" },
  ];
  test("normal host equality excludes subdomains and non-HTTP URLs", async () => {
    await operate(operation, false, input, [1, 12, 13]);
  });
  test("detailed domain includes boundary-delimited subdomains only", async () => {
    await operate(operation, true, input, [1, 2, 12, 13]);
  });
  test("all-window detailed operation still excludes pinned tabs", async () => {
    await operate(operation, true, input, [1, 2, 11, 12, 13], "all");
  });
  test.each([undefined, "invalid", "file://example.com/path", "about:blank", "data:text/plain,test"])("nonactionable target %s", async (url) => {
    for (const detailed of [false, true]) {
      await operate(operation, detailed, [url == null ? {} : { url }, {}, { url: "invalid" }, { url: "file:///tmp/a" }, { url: "about:blank" }], []);
      vi.resetModules();
    }
  });
  test("multi-label public suffix does not widen to co.uk", async () => {
    await operate(operation, true, [
      { url: "https://a.example.co.uk/" }, { url: "https://example.co.uk/" },
      { url: "https://b.example.co.uk/" }, { url: "https://notexample.co.uk/" },
      { url: "https://another.co.uk/" },
    ], [1, 2, 3], "win", 1);
  });
  test.each(["http://127.0.0.1/", "http://[::1]/", "http://localhost/"])("special host %s supports exact operation only", async (url) => {
    await operate(operation, false, [{ url }, { url }, { url: "https://example.com/" }], [1, 2]);
    vi.resetModules();
    await operate(operation, true, [{ url }, { url }], []);
  });
});

test("deep hostname exposes only the five existing most-specific menu levels", async () => {
  const mock = installDomainBrowser([{ url: "https://a.b.c.d.e.f.example.com/" }]);
  await import("../../src/background/background.ts");
  const callback = mock.activated.addListener.mock.calls[0]?.[0];
  await callback?.();
  // Existing menu updates launch independent async calls. Flush their promises.
  await Promise.resolve();
  const candidates = getDomainsByLevelWithoutPublicSuffix(mock.active?.url);
  expect(candidates).toHaveLength(5);
  expect(mock.updated.mock.calls.map(([id]) => id).sort()).toEqual([
    ...Array.from({ length: 5 }, (_, i) => `ohmytab_close_l${i}`),
    ...Array.from({ length: 5 }, (_, i) => `ohmytab_extract_l${i}`),
  ].sort());
  for (let level = 0; level < 5; level++) {
    const details = mock.updated.mock.calls.find(([id]) => id === `ohmytab_close_l${level}`)?.[1] as { title: string; visible: boolean };
    expect(details.visible).toBe(true);
    expect(details.title).toContain(candidates[level]);
  }
});
