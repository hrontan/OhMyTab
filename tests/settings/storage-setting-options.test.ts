import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { installBrowserMock, type BrowserTarget } from "../helpers/browser.ts";
import { createOptionsDocument } from "../helpers/options-dom.ts";

const target = process.env.TEST_BROWSER as BrowserTarget;
const initialize = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../../src/background/contextmenu.ts", () => ({ initializeContextMenus: initialize }));
let mock: ReturnType<typeof installBrowserMock>;
let runtime: { lastError?: { message: string } };

beforeEach(() => {
  vi.resetModules();
  initialize.mockClear();
  mock = installBrowserMock(target);
  runtime = {};
  Object.assign(mock.api, { runtime, i18n: { getMessage: (key: string) => key } });
});
afterEach(() => vi.unstubAllGlobals());

function fail(operation: "get" | "set", message: string) {
  const callbackFailure = (callback: () => void) => {
    runtime.lastError = { message };
    callback();
    delete runtime.lastError;
  };
  if (operation === "get") {
    mock.api.storage.sync.get.mockImplementationOnce((_values, callback) => {
      if (target === "firefox") return Promise.reject<Record<string, unknown>>(new Error(message));
      callbackFailure(() => callback?.({}));
      return undefined;
    });
  } else {
    mock.api.storage.sync.set.mockImplementationOnce((_values, callback) => {
      if (target === "firefox") return Promise.reject<void>(new Error(message));
      callbackFailure(() => callback?.());
      return undefined;
    });
  }
}

test.each(["get", "set"] as const)("%s rejects browser callback/promise failure", async operation => {
  fail(operation, "storage unavailable");
  const api = await import("../../src/browser/browser-api.ts");
  await expect(operation === "get" ? api.getStorage({ glue: false }) : api.setStorage({ glue: false })).rejects.toThrow("storage unavailable");
});

test.each(["QUOTA_BYTES_PER_ITEM", "MAX_WRITE_OPERATIONS_PER_MINUTE", "MAX_WRITE_OPERATIONS_PER_HOUR"])("%s failure preserves existing data and retry commits", async message => {
  Object.assign(mock.data, { glue: false, urlmatch_pattern: "*existing*" });
  const old = structuredClone(mock.data);
  const { setStorage } = await import("../../src/browser/browser-api.ts");
  fail("set", message);
  await expect(setStorage({ glue: true, urlmatch_pattern: "*new*" })).rejects.toThrow(message);
  expect(mock.data).toEqual(old);
  await setStorage({ glue: true, urlmatch_pattern: "*new*" });
  expect(mock.data).toEqual({ glue: true, urlmatch_pattern: "*new*" });
});

test.each([NaN, Infinity, -Infinity, 1, 11, 2.5, "4", null])("invalid grouping_min %s defaults", async value => {
  mock.data.grouping_min = value;
  const { getSetting } = await import("../../src/settings/setting.ts");
  expect((await getSetting()).grouping_min).toBe(4);
});

test.each([2, 4, 10])("valid threshold %s retained", async value => {
  mock.data.grouping_min = value;
  const { getSetting } = await import("../../src/settings/setting.ts");
  expect((await getSetting()).grouping_min).toBe(value);
});

test("old partial malformed data gets canonical defaults without writing or mutating", async () => {
  Object.assign(mock.data, { glue: "false", depclean: 0, sortkey: "unknown", iconbadgescope: "current", contextmenu1scope: null, contextmenu4scope: [], urlmatch_pattern: 123, extra: "discard" });
  const old = structuredClone(mock.data);
  const { getSetting, defaultSetting } = await import("../../src/settings/setting.ts");
  expect(await getSetting()).toEqual(defaultSetting);
  expect(mock.data).toEqual(old);
  expect(mock.api.storage.sync.set).not.toHaveBeenCalled();
});

test("normalization is shared by reads, input construction and writes; pattern is untouched", async () => {
  const setting = await import("../../src/settings/setting.ts");
  const input = { ...setting.defaultSetting, glue: true, currentonly: true, urlmatch_pattern: "  *one*\n*two*  " };
  Object.assign(mock.data, input);
  const expected = { ...input, currentonly: false };
  expect(await setting.getSetting()).toEqual(expected);
  expect(setting.constructSetting(key => input[key])).toEqual(expected);
  await setting.setSetting(input);
  expect(mock.data).toEqual(expected);
  expect(setting.fixSetting(input)).toEqual(expected);
  expect(input.currentonly).toBe(true);
});

async function loadOptions() {
  const { defaultSetting } = await import("../../src/settings/setting.ts");
  const dom = createOptionsDocument(Object.keys(defaultSetting));
  vi.stubGlobal("document", dom.document);
  await import("../../src/options/options.ts");
  await dom.load();
  mock.api.tabs.query.mockClear();
  initialize.mockClear();
  return dom;
}

test.each(["QUOTA_BYTES_PER_ITEM", "MAX_WRITE_OPERATIONS_PER_MINUTE"])("real change handler shows %s failure, keeps draft and retries", async message => {
  Object.assign(mock.data, { glue: false, currentonly: false, urlmatch_pattern: "*existing*" });
  const dom = await loadOptions();
  const old = structuredClone(mock.data);
  dom.elements.glue!.checked = true;
  dom.elements.currentonly!.checked = true;
  dom.elements.urlmatch_pattern!.value = "*draft*";
  fail("set", message);
  await dom.form.dispatch("change");
  expect(mock.data).toEqual(old);
  expect(dom.elements.currentonly!.checked).toBe(true);
  expect(dom.elements.urlmatch_pattern!.value).toBe("*draft*");
  expect(dom.status.textContent).toContain("settingsSaveFailed");
  expect(dom.status.textContent).toContain(message);
  expect(dom.status.attributes.role).toBe("alert");
  expect(initialize).not.toHaveBeenCalled();
  expect(mock.api.tabs.query).not.toHaveBeenCalled();
  const retry = dom.status.children.find(element => element.type === "button");
  expect(retry?.textContent).toBe("settingsRetry");
  await retry?.dispatch("click");
  expect(mock.data.urlmatch_pattern).toBe("*draft*");
  expect(mock.data.currentonly).toBe(false);
  expect(dom.elements.currentonly!.checked).toBe(false);
  expect(dom.status.textContent).toBe("settingsSaved");
  expect(initialize).not.toHaveBeenCalled();
});

test("initial read failure offers retry and registered form remains usable", async () => {
  fail("get", "read unavailable");
  const dom = await loadOptions();
  expect(dom.status.textContent).toContain("settingsLoadFailed");
  expect(mock.api.storage.sync.set).not.toHaveBeenCalled();
  await dom.status.children.find(element => element.type === "button")?.dispatch("click");
  expect(dom.elements.glue!.checked).toBe(true);
  dom.elements.depclean!.checked = false;
  await dom.form.dispatch("change");
  expect(mock.data.depclean).toBe(false);
});
