import type { TabType } from "../browser/browser-api";


export const compareURL = <T extends TabType>(
  tab1: T, tab2: T, parseURL: (url: string) => URL = url => new URL(url),
) => {
  // Chrome reports "" until a navigation commits; such tabs sort first. Other
  // unparsable URLs still fail the operation.
  if (!tab1.url || !tab2.url) return tab1.url ? 1 : tab2.url ? -1 : 0;
  const url1Obj = parseURL(tab1.url);
  const url2Obj = parseURL(tab2.url);
  const url1Protocol = url1Obj.protocol;
  const url2Protocol = url2Obj.protocol;
  if (
    (url1Protocol === "http:" || url1Protocol === "https:") &&
    (url2Protocol === "http:" || url2Protocol === "https:")
  ) {
    const url1URLWithoutProtocol =
      url1Obj.host + url1Obj.pathname + url1Obj.search + url1Obj.hash;
    const url2URLWithoutProtocol =
      url2Obj.host + url2Obj.pathname + url2Obj.search + url2Obj.hash;
    if (url1URLWithoutProtocol < url2URLWithoutProtocol) return -1;
    else if (url1URLWithoutProtocol > url2URLWithoutProtocol) return 1;
    else return 0;
  } else {
    const href1 = url1Obj.href, href2 = url2Obj.href;
    if (href1 < href2) return -1;
    else if (href1 > href2) return 1;
    else return 0;
  }
};

export const compareTitle = <T extends TabType | chrome.tabGroups.TabGroup>(
  tab1: T,
  tab2: T,
) => {
  const title1 = tab1.title ?? "";
  const title2 = tab2.title ?? "";
  if (title1 < title2) return -1;
  else if (title1 > title2) return 1;
  else return 0;
};

export const removeUndefined = <T>(arr: (T | undefined)[]): T[] => {
  return arr.filter((el): el is Exclude<typeof el, undefined> => el != null);
};

export const tabs2TabIds = (tabs: TabType[]) =>
  removeUndefined(tabs.map((tab) => tab.id));

export const getDomain = (url: string, parseURL: (url: string) => URL = value => new URL(value)) => {
  try {
    const parsed = parseURL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
    if (host.startsWith("[") && host.endsWith("]")) return host;
    if (host.length === 0 || host.length > 253) return "";
    const labels = host.split(".");
    return labels.every((label) =>
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)
    ) ? host : "";
  } catch {
    return "";
  }
};

export const isDomainMatch = (
  url: string | undefined,
  domain: string,
  includeSubdomains = false,
) => {
  const host = getDomain(url ?? "");
  if (!host || !domain) return false;
  return host === domain || (includeSubdomains && host.endsWith("." + domain));
};
