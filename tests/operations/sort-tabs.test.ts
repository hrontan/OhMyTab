import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { installSortBrowser, type SortTabInput } from "../helpers/sort-browser.ts";
import type { BrowserTarget } from "../helpers/browser.ts";

vi.mock("../../src/background/contextmenu.ts", () => ({ initializeContextMenus: vi.fn(), updateContextMenus: vi.fn() }));
const target = process.env.TEST_BROWSER as BrowserTarget;
beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

const cases: { name: string; tabs: SortTabInput[]; expected: number[] }[] = [
  { name: "empty", tabs: [], expected: [] },
  { name: "single", tabs: [{ id: 1, title: "A" }], expected: [1] },
  { name: "already sorted", tabs: [{ id: 1, title: "A" }, { id: 2, title: "B" }], expected: [1, 2] },
  { name: "[B,A]", tabs: [{ id: 1, title: "B" }, { id: 2, title: "A" }], expected: [2, 1] },
  { name: "reverse", tabs: [{ id: 1, title: "D" }, { id: 2, title: "C" }, { id: 3, title: "B" }, { id: 4, title: "A" }], expected: [4, 3, 2, 1] },
  { name: "same title and URL", tabs: [{ id: 1, title: "same" }, { id: 2, title: "same" }, { id: 3, title: "same" }], expected: [1, 2, 3] },
  { name: "pinned prefix", tabs: [{ id: 8, title: "Z", pinned: true }, { id: 9, title: "Y", pinned: true }, { id: 1, title: "B" }, { id: 2, title: "A" }], expected: [2, 1] },
  { name: "group in middle", tabs: [{ id: 1, title: "D" }, { id: 8, title: "Z", groupId: 7 }, { id: 9, title: "Y", groupId: 7 }, { id: 2, title: "C" }, { id: 3, title: "B" }, { id: 4, title: "A" }], expected: [4, 3, 2, 1] },
  { name: "group before and after sortable tabs", tabs: [{ id: 8, title: "Z", groupId: 7 }, { id: 9, title: "Y", groupId: 7 }, { id: 1, title: "B" }, { id: 2, title: "A" }, { id: 10, title: "X", groupId: 8 }, { id: 11, title: "W", groupId: 8 }], expected: [2, 1] },
];

async function runAction(mock: ReturnType<typeof installSortBrowser>) {
  const callback = mock.clicked.addListener.mock.calls[0]?.[0];
  expect(callback).toBeTypeOf("function");
  await callback?.();
}

describe.each(["title", "url"] as const)("%s sort", (method) => {
  describe.each([true, false])("current-window-only=%s", (currentOnly) => {
    test.each(cases)("$name", async ({ tabs, expected }) => {
      const otherTabs: SortTabInput[] = [{ id: 101, title: "B" }, { id: 102, title: "A" }];
      const mock = installSortBrowser(target, { 1: tabs, 2: otherTabs });
      Object.assign(mock.data, { currentonly: currentOnly, sortkey: method });
      const protectedTabs = (mock.state.get(1) ?? []).filter(tab => tab.pinned || tab.groupId !== -1).map(tab => ({ ...tab }));
      await import("../../src/background/background.ts");
      await runAction(mock);
      const result = mock.state.get(1) ?? [];
      expect(result.filter(tab => !tab.pinned && tab.groupId === -1).map(tab => tab.id)).toEqual(expected);
      expect(mock.state.get(2)?.map(tab => tab.id)).toEqual(currentOnly ? [101, 102] : [102, 101]);
      expect(result.map(tab => tab.index)).toEqual(result.map((_, index) => index));
      expect(new Set(result.map(tab => tab.id)).size).toBe(tabs.length);
      for (const before of protectedTabs) {
        const after = result.find(tab => tab.id === before.id);
        expect(after?.groupId).toBe(before.groupId);
        if (before.pinned) expect(after?.index).toBe(before.index);
      }
      for (const groupId of new Set(protectedTabs.filter(tab => !tab.pinned).map(tab => tab.groupId))) {
        expect(result.filter(tab => tab.groupId === groupId).map(tab => tab.id)).toEqual(
          protectedTabs.filter(tab => tab.groupId === groupId).map(tab => tab.id),
        );
      }
      const protectedIds = new Set(protectedTabs.map(tab => tab.id));
      expect(mock.api.tabs.move.mock.calls.every(([ids]) => ids.every(id => !protectedIds.has(id)))).toBe(true);
      if (["empty", "single", "already sorted", "same title and URL"].includes(cases.find(item => item.tabs === tabs)?.name ?? "")) {
        expect(mock.api.tabs.move.mock.calls.filter(([, details]) => (details as { windowId: number }).windowId === 1)).toHaveLength(0);
      }
    });
  });
});

test("successive title and URL sorts retain independent input order and starting index", async () => {
  const mock = installSortBrowser(target, { 1: [
    { id: 8, title: "pinned", pinned: true },
    { id: 1, title: "B", url: "https://example.com/a" },
    { id: 2, title: "A", url: "https://example.com/b" },
  ] });
  Object.assign(mock.data, { currentonly: true, sortkey: "title" });
  await import("../../src/background/background.ts");
  await runAction(mock);
  expect(mock.state.get(1)?.map(tab => tab.id)).toEqual([8, 2, 1]);
  expect(mock.api.tabs.move).toHaveBeenLastCalledWith([2], { windowId: 1, index: 1 });
  mock.data.sortkey = "url";
  await runAction(mock);
  expect(mock.state.get(1)?.map(tab => tab.id)).toEqual([8, 1, 2]);
  expect(mock.api.tabs.move).toHaveBeenLastCalledWith([1], { windowId: 1, index: 1 });
  await runAction(mock);
  expect(mock.api.tabs.move).toHaveBeenCalledTimes(2);
});

test("sorting reads each window once instead of once per move", async () => {
  const reversed = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, title: String.fromCharCode(90 - i) }));
  const mock = installSortBrowser(target, { 1: reversed });
  Object.assign(mock.data, { currentonly: true, sortkey: "title" });
  await import("../../src/background/background.ts");
  mock.api.tabs.query.mockClear();
  await runAction(mock);
  expect(mock.state.get(1)?.map(tab => tab.id)).toEqual(reversed.map(tab => tab.id).reverse());
  expect(mock.api.tabs.move).toHaveBeenCalledTimes(29);
  expect(mock.api.tabs.query.mock.calls.filter(([query]) => (query as { windowId?: number }).windowId === 1)).toHaveLength(1);
});

test("a failed move reloads the window order before continuing", async () => {
  const mock = installSortBrowser(target, { 1: [{ id: 1, title: "C" }, { id: 2, title: "B" }, { id: 3, title: "A" }] });
  Object.assign(mock.data, { currentonly: true, sortkey: "title" });
  mock.api.tabs.move.mockImplementationOnce(async () => { throw new Error("dragging"); });
  await import("../../src/background/background.ts");
  mock.api.tabs.query.mockClear();
  await runAction(mock);
  expect(mock.api.tabs.query.mock.calls.filter(([query]) => (query as { windowId?: number }).windowId === 1).length).toBeGreaterThan(1);
  expect(mock.state.get(1)?.map(tab => tab.index)).toEqual([0, 1, 2]);
});
