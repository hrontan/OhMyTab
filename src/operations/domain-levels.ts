import { getPublicSuffix } from "tldts";
import { getDomain } from "./misc";

const isRawIp = (domain: string) =>
  /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(
    domain,
  );

export const getDomainsByLevelWithoutPublicSuffix = (
  url: string | undefined,
) => {
  const domain = getDomain(url ?? "");
  if (!domain || isRawIp(domain) || domain.startsWith("[") || !domain.includes(".")) return [];
  const publicSuffix = getPublicSuffix(domain, { allowPrivateDomains: true });
  if (!publicSuffix || domain === publicSuffix || !domain.endsWith("." + publicSuffix)) return [];
  const labels = domain.split(".");
  const suffixLabelCount = publicSuffix.split(".").length;
  // Existing menus have levels 0..4: retain the five most-specific candidates.
  return Array.from({ length: Math.min(5, labels.length - suffixLabelCount) },
    (_, index) => labels.slice(index).join("."));
};
