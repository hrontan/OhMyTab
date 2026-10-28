import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { isMatch, makeRe } from "picomatch";
import { installBrowserMock, type BrowserTarget } from "../helpers/browser.ts";

vi.mock("../../src/background/contextmenu.ts", () => ({
  initializeContextMenus: vi.fn(),
  updateContextMenus: vi.fn(),
}));

const target = process.env.TEST_BROWSER as BrowserTarget;
const clicked = { addListener: vi.fn<(callback: () => Promise<void>) => void>() };
let mock: ReturnType<typeof installBrowserMock>;
const event = () => ({ addListener: vi.fn() });

function tab(id: number, url: string): chrome.tabs.Tab {
  return {
    id, url, index: id, windowId: 1, active: false, highlighted: false,
    pinned: false, incognito: false, ...(target === "firefox" ? { cookieStoreId: "firefox-default" } : {}), selected: false, discarded: false,
    autoDiscardable: true, groupId: -1, lastAccessed: 0, frozen: false,
  };
}

beforeEach(() => {
  vi.resetModules();
  mock = installBrowserMock(target);
  Object.assign(mock.api.tabs, { onCreated: event(), onMoved: event(), onDetached: event(), onAttached: event(), onUpdated: event(), onRemoved: event(), onActivated: event() });
  Object.assign(mock.api.windows, { onFocusChanged: event() });
  Object.assign(mock.api.action, { onClicked: clicked });
  Object.assign(mock.api, {
    contextMenus: { onClicked: event() },
    commands: { onCommand: event() },
    runtime: { onInstalled: event(), onStartup: event(), onMessage: event() },
  });
  Object.assign(mock.data, {
    glue: false, depclean: false, sorttab: false, refresh: false,
    comclose: false, closelocal: false, rxclose: false, grouping: false,
    iconbadge: false, urlmatch: true,
  });
});
afterEach(() => vi.unstubAllGlobals());

test.each([
  ["https://example.com/docs/page", "example.com/**", true],
  ["https://other.test/docs/page", "example.com/**", false],
  ["https://example.com/item1", "item?", true],
  ["https://example.com/item", "item?", false],
  ["https://example.com/docs/page", "{docs,help}/**", true],
  ["https://example.com/news/page", "{docs,help}/**", false],
  ["https://example.com/foo", "@(foo|bar)", true],
  ["https://example.com/baz", "@(foo|bar)", false],
])("contains matching: %s against %s", (url, pattern, expected) => {
  expect(isMatch(url, pattern, { contains: true })).toBe(expected);
});

test("real action processing preserves multiline OR, trim, blank lines and deduplication", async () => {
  mock.data.urlmatch_pattern = "  example.com/**\r\n\n  other.test/**  \nexample.com/**\n   ";
  mock.api.tabs.query.mockResolvedValue([
    tab(1, "https://example.com/a"), tab(2, "https://other.test/b"),
    tab(3, "https://unmatched.test/c"),
  ]);
  await import("../../src/background/background.ts");
  const callback = clicked.addListener.mock.calls[0]?.[0];
  expect(callback).toBeTypeOf("function");
  await callback?.();
  expect(mock.api.tabs.remove).toHaveBeenCalledExactlyOnceWith([1, 2]);
});

test("blank-only saved rules do not select any URL", async () => {
  mock.data.urlmatch_pattern = "\r\n   \n\t";
  mock.api.tabs.query.mockResolvedValue([tab(1, "https://example.com/a")]);
  Object.assign(mock.api, { i18n: {
    getMessage: (key: string, substitutions: string[] = []) => [key, ...substitutions].join(":"),
  } });
  await import("../../src/background/background.ts");
  const action = clicked.addListener.mock.calls[0]?.[0];
  expect(action).toBeTypeOf("function");
  await action?.();
  expect(mock.api.tabs.remove).not.toHaveBeenCalled();
  expect(mock.api.tabs.move).not.toHaveBeenCalled();
  expect(mock.api.tabs.reload).not.toHaveBeenCalled();
  expect(mock.api.windows.create).not.toHaveBeenCalled();
  expect(mock.api.action.setTitle).toHaveBeenLastCalledWith({ title: "operationResult:0:0:0:0:0" });

  // The completed no-op releases state; a nonempty next request really runs.
  mock.data.urlmatch_pattern = "example.com/**";
  await action?.();
  expect(mock.api.tabs.remove).toHaveBeenCalledExactlyOnceWith([1]);
  expect(mock.api.action.setTitle).toHaveBeenLastCalledWith({ title: "operationResult:1:1:0:0:0" });

  // Failed acquisition is not presented as a successful zero-target result.
  mock.api.tabs.remove.mockClear();
  mock.api.tabs.query.mockRejectedValueOnce(new Error("target acquisition failed"));
  await action?.();
  expect(mock.api.tabs.remove).not.toHaveBeenCalled();
  expect(mock.api.action.setTitle).toHaveBeenLastCalledWith({ title: "operationFailed:0:0:0:0:1" });
  await action?.();
  expect(mock.api.tabs.remove).toHaveBeenCalledExactlyOnceWith([1]);
});

test("unknown POSIX classes cannot inject inherited methods into a regex", () => {
  const regex = makeRe("[[:constructor:]]");
  expect(regex.source).not.toContain("function");
  expect(regex.test("function Object() { [native code] }")).toBe(false);
  expect(isMatch("a", "[[:alpha:]]")).toBe(true);
  expect(isMatch("1", "[[:alpha:]]")).toBe(false);
});

test("hazardous repeated extglobs complete in an isolated timeout process", () => {
  const script = `
    import picomatch from 'picomatch';
    const { makeRe } = picomatch;
    const patterns = ['+(a|aa)', '+(*|?)', '+(+(a))', '*(+(a))', '+(+(+(a)))'];
    const results = patterns.map(pattern => ({
      pattern,
      nonmatch: makeRe(pattern).test('a'.repeat(48) + 'b'),
      literal: makeRe(pattern).test(pattern),
    }));
    console.log(JSON.stringify(results));
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
    cwd: process.cwd(), timeout: 2000, encoding: "utf8",
  });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  const rows = JSON.parse(result.stdout) as { nonmatch: boolean; literal: boolean }[];
  expect(rows).toHaveLength(5);
  expect(rows.every(row => row.nonmatch === false && row.literal === true)).toBe(true);
});
