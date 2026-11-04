import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { installBrowserMock, type BrowserTarget } from "../helpers/browser.ts";
import { createOptionsDocument } from "../helpers/options-dom.ts";

const target = process.env.TEST_BROWSER as BrowserTarget;
const event = () => ({ addListener: vi.fn() });
vi.mock("../../src/background/contextmenu.ts", () => ({ initializeContextMenus: vi.fn(), updateContextMenus: vi.fn(), getDetailedMenuTarget: vi.fn() }));
let mock: ReturnType<typeof installBrowserMock>;
beforeEach(() => {
  vi.resetModules();
  mock = installBrowserMock(target);
  Object.assign(mock.data, { glue: false, depclean: true, sorttab: false, refresh: false, urlmatch: true });
  Object.assign(mock.api.tabs, { onCreated: event(), onMoved: event(), onDetached: event(), onAttached: event(), onUpdated: event(), onRemoved: event(), onActivated: event() });
  Object.assign(mock.api.windows, { onFocusChanged: event() });
  Object.assign(mock.api.action, { onClicked: event() });
  Object.assign(mock.api, { contextMenus: { onClicked: event() }, commands: { onCommand: event() }, runtime: { onInstalled: event(), onStartup: event(), onMessage: event() }, i18n: { getMessage: (key: string) => key } });
});
afterEach(() => vi.unstubAllGlobals());

async function click() {
  await import("../../src/background/background.ts");
  const action = mock.api.action as unknown as { onClicked: { addListener: { mock: { calls: [() => Promise<void>][] } } } };
  await action.onClicked.addListener.mock.calls[0]?.[0]();
}

function duplicateTabs() {
  mock.api.tabs.query.mockResolvedValue([1, 2].map(id => ({
    id, index: id, url: "https://ok.test/page", windowId: 1, pinned: false,
    active: false, highlighted: false, incognito: false, ...(target === "firefox" ? { cookieStoreId: "firefox-default" } : {}), selected: false,
    discarded: false, autoDiscardable: true, groupId: -1, lastAccessed: 0, frozen: false,
  })));
}

test.each(["*ok*\n[", "+(a|aa)", "+(*|?)", "+(+(a))", "*(+(a))", "+(+(+(a)))", "[[:constructor:]]", "x".repeat(1025), Array(101).fill("*").join("\n"), "x".repeat(8192)])("invalid enabled saved rules stop bulk closure case %#", async pattern => {
  mock.data.urlmatch_pattern = pattern;
  duplicateTabs();
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  await click();
  expect(mock.api.tabs.remove).not.toHaveBeenCalled();
  expect(error).toHaveBeenCalled();
});

test("OFF bypasses invalid saved rules and preserves duplicate removal", async () => {
  const rules = await import("../../src/rules/url-rules.ts");
  const compile = vi.spyOn(rules, "compileURLRules");
  mock.data.urlmatch = false;
  mock.data.urlmatch_pattern = "[\n" + "x".repeat(65537);
  duplicateTabs();
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  await click();
  expect(mock.api.tabs.remove).toHaveBeenCalledExactlyOnceWith([1]);
  expect(error).not.toHaveBeenCalled();
  expect(compile).not.toHaveBeenCalled();
});

test.each(["[", "+(a|aa)", "x".repeat(1025), Array(101).fill("*").join("\n"), "x".repeat(8192)])("actual save change rejects invalid syntax without changing stored settings case %#", async pattern => {
  mock.data.urlmatch = false;
  mock.data.urlmatch_pattern = "*existing*";
  const { defaultSetting } = await import("../../src/settings/setting.ts");
  const dom = createOptionsDocument(Object.keys(defaultSetting));
  vi.stubGlobal("document", dom.document);
  await import("../../src/options/options.ts");
  await dom.load();
  dom.elements.urlmatch!.checked = true;
  dom.elements.urlmatch_pattern!.value = pattern;
  const old = structuredClone(mock.data);
  await dom.form.dispatch("change");
  expect(mock.data).toEqual(old);
  expect(mock.api.storage.sync.set).not.toHaveBeenCalled();
  expect(dom.status.textContent).toContain("settingsSaveFailed");
  expect(dom.status.textContent).toContain("1");
  // Real sync storage also rejects oversized data when URL matching is OFF.
  if (pattern.length >= 8192) dom.elements.urlmatch_pattern!.value = "*fixed*";
  dom.elements.urlmatch!.checked = false;
  await dom.form.dispatch("change");
  expect(mock.data.urlmatch).toBe(false);
  expect(mock.data.urlmatch_pattern).toBe(pattern.length >= 8192 ? "*fixed*" : pattern);
});

test("loaded invalid enabled rules show the physical line and can be disabled unchanged", async () => {
  mock.data.urlmatch_pattern = "\n+(a|aa)";
  const { defaultSetting } = await import("../../src/settings/setting.ts");
  const dom = createOptionsDocument(Object.keys(defaultSetting));
  vi.stubGlobal("document", dom.document);
  await import("../../src/options/options.ts");
  await dom.load();
  expect(dom.status.textContent).toContain("Line 2");
  expect(dom.elements.urlmatch_pattern!.value).toBe("\n+(a|aa)");
  expect(mock.api.storage.sync.set).not.toHaveBeenCalled();
  dom.elements.urlmatch!.checked = false;
  await dom.form.dispatch("change");
  expect(mock.data.urlmatch).toBe(false);
  expect(mock.data.urlmatch_pattern).toBe("\n+(a|aa)");
});
