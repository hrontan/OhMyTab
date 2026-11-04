// These declarations exercise both browser namespaces without running browser code.
export async function firefoxOnlyApi(): Promise<number[]> {
  return browser.tabs.hide([1]);
}

export async function chromeOnlyApi(): Promise<number> {
  return chrome.tabs.group({ tabIds: [1] });
}

export function checkedBrowserArguments(): void {
  // @ts-expect-error -- Firefox requires numeric tab identifiers.
  void browser.tabs.hide(["invalid"]);
  // @ts-expect-error -- Chrome requires numeric tab identifiers.
  void chrome.tabs.group({ tabIds: ["invalid"] });
}
