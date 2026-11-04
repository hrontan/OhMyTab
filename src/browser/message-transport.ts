/** Send a runtime request without interpreting its reply. */
export const sendRuntimeMessage = async (request: object, errorMessage: (error: { message?: string }) => string): Promise<unknown> => {
  let response: unknown;
  /// #if BROWSER === "chrome"
  response = await new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(request, response => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(errorMessage(error)));
      else resolve(response);
    });
  });
  /// #else
  response = await browser.runtime.sendMessage(request);
  /// #endif
  return response;
};
