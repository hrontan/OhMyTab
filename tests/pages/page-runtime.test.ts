import { afterEach, beforeEach, expect, test, vi } from "vitest";

const mode = process.env.TEST_BROWSER;
let send: ReturnType<typeof vi.fn>;
let runtime: { sendMessage: typeof send; lastError?: { message?: string } };
let api: { runtime: typeof runtime; i18n: { getMessage: (key: string) => string } };
beforeEach(() => {
  vi.resetModules();
  send = vi.fn(); runtime = { sendMessage: send };
  api = { runtime, i18n: { getMessage: key => key === "optionsLanguage" ? "invalid_locale" : "translated:" + key } };
  vi.stubGlobal(mode === "chrome" ? "chrome" : "browser", api);
  vi.doMock("../../src/browser/browser-api", () => ({ myBrowser: api }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.doUnmock("../../src/browser/browser-api"); });
test("import needs no DOM and sends no request", async () => {
  vi.stubGlobal("document", undefined); vi.stubGlobal("location", undefined);
  await import("../../src/pages/page-runtime.ts"); expect(send).not.toHaveBeenCalled();
});
test.each([{ type: "preview:get", token: "original" }, { type: "undo:restore", keys: ["ready"] }, { type: "undo:get", keys: undefined }])("request and response retain identity: %j", async request => {
  const response = { ok: true, status: "unchanged" };
  send.mockImplementation((payload: object, callback?: (reply: unknown) => void) => {
    expect(payload).toBe(request);
    if (mode === "chrome") { callback!(response); return; }
    return Promise.resolve(response);
  });
  const { sendPageRequest } = await import("../../src/pages/page-runtime.ts");
  expect(await sendPageRequest(request, "Unavailable")).toBe(response);
  expect(send).toHaveBeenCalledTimes(1);
});
test.each(["Connection lost", ""])("transport errors propagate while callback lastError is live: %s", async errorMessage => {
  send.mockImplementation((_request: object, callback?: (reply: unknown) => void) => {
    if (mode === "chrome") {
      runtime.lastError = { message: errorMessage }; callback!(undefined); delete runtime.lastError; return;
    }
    return Promise.reject(new Error(errorMessage || "Unavailable"));
  });
  const { sendPageRequest } = await import("../../src/pages/page-runtime.ts");
  await expect(sendPageRequest({ type: "preview:get" }, "Unavailable")).rejects.toThrow(errorMessage || "Unavailable");
});
test("text initialization uses locale fallback and textContent", async () => {
  const label = { dataset: { message: "label" }, textContent: "" };
  const target = { textContent: "" };
  const doc = { documentElement: { lang: "" }, title: "", querySelectorAll: () => [label], querySelector: () => target };
  vi.stubGlobal("document", doc);
  const { initializePageText, setText } = await import("../../src/pages/page-runtime.ts");
  initializePageText("pageTitle"); setText("#status", "<literal>");
  expect(doc.documentElement.lang).toBe("en"); expect(doc.title).toBe("translated:pageTitle");
  expect(label.textContent).toBe("translated:label"); expect(target.textContent).toBe("<literal>");
  api.i18n.getMessage = key => key === "optionsLanguage" ? "zh-CN" : key;
  initializePageText("next"); expect(doc.documentElement.lang).toBe("zh-CN");
});

test.each([undefined, ""])("missing or empty Chrome error message uses the page fallback: %s", async errorMessage => {
  const failure = new Error("Firefox original");
  send.mockImplementation((_request: object, callback?: (reply: unknown) => void) => {
    if (mode === "chrome") {
      runtime.lastError = errorMessage === undefined ? {} : { message: errorMessage };
      callback!(undefined); delete runtime.lastError; return;
    }
    return Promise.reject(failure);
  });
  const { sendPageRequest } = await import("../../src/pages/page-runtime.ts");
  const pending = sendPageRequest({}, "Page-specific unavailable");
  if (mode === "chrome") await expect(pending).rejects.toThrow("Page-specific unavailable");
  else await expect(pending).rejects.toBe(failure);
});
