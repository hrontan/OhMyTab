type URLRule = { test: (value: string) => boolean };

function parseURL(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

function networkURL(value: string): URL | undefined {
  const url = parseURL(value);
  if (!url || !["http:", "https:"].includes(url.protocol) ||
      url.username || url.password || url.port) return undefined;
  return url;
}

export const RX_SYSTEM: URLRule = {
  test(value) {
    const url = parseURL(value);
    if (!url) return false;
    if (url.protocol === "about:") return url.pathname.length > 0;
    return ["chrome:", "edge:", "brave:", "chrome-extension:"].includes(url.protocol) &&
      Boolean(url.hostname) && !url.username && !url.password && !url.port;
  },
};

export const RX_SYSTEM2: URLRule = {
  test(value) {
    const url = networkURL(value);
    return url?.protocol === "https:" && url.hostname === "ntp.msn.com";
  },
};

export const SYSTEM_PAGE_RULE: URLRule = {
  test: (value) => RX_SYSTEM.test(value) || RX_SYSTEM2.test(value),
};

export const RX_LOCAL = /^file:\/\/\//;

// Preserve the existing explicit Google country-host allowlist. These aliases
// may redirect to google.com; do not infer arbitrary google.* hostnames.
const GOOGLE_HOST = new RegExp("^www\\.google\\.(?:" + "com|ad|ae|com\\.af|com\\.ag|com\\.ai|al|am|co\\.ao|com\\.ar|as|at|com\\.au|az|ba|com\\.bd|be|bf|bg|com\\.bh|bi|bj|com\\.bn|com\\.bo|com\\.br|bs|bt|co\\.bw|by|com\\.bz|ca|cd|cf|cg|ch|ci|co\\.ck|cl|cm|cn|com\\.co|co\\.cr|com\\.cu|cv|com\\.cy|cz|de|dj|dk|dm|com\\.do|dz|com\\.ec|ee|com\\.eg|es|com\\.et|fi|com\\.fj|fm|fr|ga|ge|gg|com\\.gh|com\\.gi|gl|gm|gp|gr|com\\.gt|gy|com\\.hk|hn|hr|ht|hu|co\\.id|ie|co\\.il|im|co\\.in|iq|is|it|je|com\\.jm|jo|co\\.jp|co\\.ke|com\\.kh|ki|kg|co\\.kr|com\\.kw|kz|la|com\\.lb|li|lk|co\\.ls|lt|lu|lv|com\\.ly|co\\.ma|md|me|mg|mk|ml|com\\.mm|mn|ms|com\\.mt|mu|mv|mw|com\\.mx|com\\.my|co\\.mz|com\\.na|com\\.nf|com\\.ng|com\\.ni|ne|nl|no|com\\.np|nr|nu|co\\.nz|com\\.om|com\\.pa|com\\.pe|com\\.pg|com\\.ph|com\\.pk|pl|pn|com\\.pr|ps|pt|com\\.py|com\\.qa|ro|ru|rw|com\\.sa|com\\.sb|sc|se|com\\.sg|sh|si|sk|com\\.sl|sn|so|sm|sr|st|com\\.sv|td|tg|co\\.th|com\\.tj|tk|tl|tm|tn|to|com\\.tr|tt|com\\.tw|co\\.tz|com\\.ua|co\\.ug|co\\.uk|com\\.uy|co\\.uz|com\\.vc|co\\.ve|vg|co\\.vi|com\\.vn|vu|ws|rs|co\\.za|co\\.zm|co\\.zw|cat" + ")$");

export const SEARCH_PAGE_RULES = [
  { hosts: ["search.yahoo.com", "search.yahoo.co.jp"], paths: ["/search"], terms: ["p"] },
  { hosts: ["www.bing.com", "search.brave.com"], paths: ["/search"], terms: ["q"] },
  { hosts: ["scholar.google.com"], paths: ["/scholar"], terms: ["q"] },
  { hosts: ["www.baidu.com"], paths: ["/s", "/baidu"], terms: ["wd"] },
  { hosts: ["duckduckgo.com"], paths: ["/"], terms: ["q"] },
  { hosts: ["www.dogpile.com"], paths: ["/serp"], terms: ["q"] },
  { hosts: ["yandex.com", "yandex.ru"], paths: ["/search/"], terms: ["text"] },
  { hosts: ["www.startpage.com"], paths: ["/sp/search"], terms: ["query", "q"] },
  { hosts: ["www.ecosia.org"], paths: ["/search"], terms: ["q"] },
  { hosts: ["swisscows.com"], paths: ["/web"], terms: ["query"] },
  { hosts: ["search.naver.com"], paths: ["/search.naver"], terms: ["query"] },
];

export const RX_SEARCH_ENGINE: URLRule = {
  test(value) {
    const url = networkURL(value);
    if (!url) return false;
    const rule = GOOGLE_HOST.test(url.hostname)
      ? { paths: ["/search"], terms: ["q"] }
      : SEARCH_PAGE_RULES.find((candidate) => candidate.hosts.includes(url.hostname));
    return Boolean(rule && rule.paths.includes(url.pathname) &&
      rule.terms.some((key) => url.searchParams.getAll(key).some((term) => term.trim().length > 0)));
  },
};
