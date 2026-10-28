import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { sendRuntimeMessage } from "../../src/browser/message-transport";

const mode = process.env.TEST_BROWSER;
let send: ReturnType<typeof vi.fn>;
let runtime: { sendMessage: typeof send; lastError?: { message?: string } };
beforeEach(() => {
  send = vi.fn(); runtime = { sendMessage: send };
  vi.stubGlobal(mode === "chrome" ? "chrome" : "browser", { runtime });
});
afterEach(() => vi.unstubAllGlobals());
test.each([undefined, null, 17, { unexpected: ["opaque"] }])("preserves request and opaque reply identity: %j", async reply => {
  const request = { type: "opaque", nested: {} };
  const errorMessage = vi.fn(() => "fallback");
  send.mockImplementation((payload: object, callback?: (value: unknown) => void) => {
    expect(payload).toBe(request);
    if (mode === "chrome") { callback!(reply); return; }
    return Promise.resolve(reply);
  });
  expect(await sendRuntimeMessage(request, errorMessage)).toBe(reply);
  expect(send).toHaveBeenCalledTimes(1); expect(errorMessage).not.toHaveBeenCalled();
});
test("synchronous send failure retains identity and bypasses Chrome message policy", async () => {
  const failure = new Error("synchronous"); const policy = vi.fn(() => "rewritten");
  send.mockImplementation(() => { throw failure; });
  await expect(sendRuntimeMessage({}, policy)).rejects.toBe(failure);
  expect(policy).not.toHaveBeenCalled();
});
test("only Chrome callback errors use the consumer policy while lastError is live", async () => {
  const failure = { message: "original" };
  const policy = vi.fn((error: { message?: string }) => { expect(runtime.lastError).toBe(error); return "consumer:" + error.message; });
  send.mockImplementation((_payload: object, callback?: (value: unknown) => void) => {
    if (mode === "chrome") { runtime.lastError = failure; callback!(undefined); delete runtime.lastError; return; }
    return Promise.reject(failure);
  });
  const pending = sendRuntimeMessage({}, policy);
  if (mode === "chrome") { await expect(pending).rejects.toThrow("consumer:original"); expect(policy).toHaveBeenCalledWith(failure); }
  else { await expect(pending).rejects.toBe(failure); expect(policy).not.toHaveBeenCalled(); }
});
