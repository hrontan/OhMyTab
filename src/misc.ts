import { getPublicSuffix } from "tldts";
import type { TabType } from "src/api";
import { RX_SYSTEM } from "./regex";

export const compareURL = <T extends TabType>(tab1: T, tab2: T) => {
  const url1Obj = new URL(tab1.url ?? "");
  const url2Obj = new URL(tab2.url ?? "");
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
    if (url1Obj < url2Obj) return -1;
    else if (url1Obj > url2Obj) return 1;
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

export const getDomain = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch (error) {
    return "";
  }
};

const isRawIp = (domain: string) =>
  /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(
    domain,
  );

export const getDomainsByLevelWithoutPublicSuffix = (
  url: string | undefined,
) => {
  if (url == null) return [];
  if (RX_SYSTEM.test(url)) return [];
  const domain = getDomain(url);
  if (isRawIp(domain)) return [];
  const publicSuffix = getPublicSuffix(domain);
  if (publicSuffix == null) return [];
  const domainArr = domain.replace("." + publicSuffix, "").split(".") ?? [];
  return domainArr.map((_, i) =>
    domainArr.slice(i).concat([publicSuffix]).join("."),
  );
};
