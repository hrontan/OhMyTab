import { readdirSync, readFileSync } from "node:fs";
import { expect, test } from "vitest";
import type { BrowserTarget } from "../helpers/browser.ts";

const target = process.env.TEST_BROWSER as BrowserTarget;
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const manifest = JSON.parse(read(`public/${target}.json`));

// Required API floor for this MV3 build (Chrome baseline 88); call options count.
// Sources and option limits: docs/browser-support.ja.md (C4 source audit).
// null marks an API this browser's build must not use.
const apiFloors: Record<string, Record<BrowserTarget, number | null>> = {
  "action.onClicked": { chrome: 88, firefox: 109 },
  "action.setBadgeBackgroundColor": { chrome: 88, firefox: 109 },
  "action.setBadgeText": { chrome: 116, firefox: 109 },
  "action.setTitle": { chrome: 88, firefox: 109 },
  "commands.onCommand": { chrome: 88, firefox: 48 },
  "contextMenus.create": { chrome: 88, firefox: 63 },
  "contextMenus.onClicked": { chrome: 88, firefox: 55 },
  "contextMenus.removeAll": { chrome: 123, firefox: 55 },
  "contextMenus.update": { chrome: 123, firefox: 63 },
  "i18n.getMessage": { chrome: 88, firefox: 45 },
  "runtime.getURL": { chrome: 88, firefox: 45 },
  "runtime.id": { chrome: 88, firefox: 45 },
  "runtime.lastError": { chrome: 88, firefox: 47 },
  "runtime.onInstalled": { chrome: 88, firefox: 52 },
  // The sender.id origin check requires the add-on ID (Firefox 54+).
  "runtime.onMessage": { chrome: 88, firefox: 54 },
  "runtime.onStartup": { chrome: 88, firefox: 52 },
  // Chrome uses the callback form; Firefox uses its Promise form.
  "runtime.sendMessage": { chrome: 88, firefox: 45 },
  "storage.onChanged": { chrome: 88, firefox: 45 },
  "storage.sync": { chrome: 88, firefox: 53 },
  "tabGroups.move": { chrome: 89, firefox: null },
  "tabGroups.query": { chrome: 89, firefox: null },
  "tabGroups.update": { chrome: 89, firefox: null },
  "tabs.create": { chrome: 88, firefox: 45 },
  "tabs.get": { chrome: 88, firefox: 45 },
  "tabs.group": { chrome: 88, firefox: null },
  "tabs.move": { chrome: 88, firefox: 46 },
  "tabs.onActivated": { chrome: 88, firefox: 45 },
  "tabs.onAttached": { chrome: 88, firefox: 45 },
  "tabs.onCreated": { chrome: 88, firefox: 45 },
  "tabs.onDetached": { chrome: 88, firefox: 45 },
  "tabs.onMoved": { chrome: 88, firefox: 45 },
  "tabs.onReplaced": { chrome: 88, firefox: null },
  "tabs.onRemoved": { chrome: 88, firefox: 45 },
  "tabs.onUpdated": { chrome: 88, firefox: 45 },
  "tabs.query": { chrome: 88, firefox: 45 },
  "tabs.reload": { chrome: 88, firefox: 45 },
  "tabs.remove": { chrome: 88, firefox: 45 },
  "tabs.ungroup": { chrome: 88, firefox: null },
  "windows.create": { chrome: 88, firefox: 45 },
  "windows.getAll": { chrome: 88, firefox: 58 },
  // Method floor only: Firefox ignores windowTypes; this does not certify that filter.
  "windows.getLastFocused": { chrome: 88, firefox: 45 },
  "windows.onFocusChanged": { chrome: 88, firefox: 45 },
  "windows.update": { chrome: 88, firefox: 45 },
};
// Module backgrounds: Chrome 92, Firefox 112 (MDN browser-compat-data background.type).
const backgroundFloor: Record<BrowserTarget, number> = { chrome: 92, firefox: 112 };

const usedApis = () => {
  const used = new Set<string>();
  const directPrefix = target === "chrome" ? "chrome" : "browser";
  for (const file of readdirSync(new URL("../../src", import.meta.url), { encoding: "utf8", recursive: true })) {
    if (!file.endsWith(".ts")) continue;
    // Lower-case members only, so type names such as chrome.tabs.Tab are skipped.
    for (const [, prefix, api] of read(`src/${file}`).matchAll(/\b(myBrowser|chrome|browser)\.([a-zA-Z0-9]+\??\.[a-z][a-zA-Z]*)/g)) {
      if (prefix === "myBrowser" || prefix === directPrefix) used.add(api!.replace("?", ""));
    }
  }
  return used;
};

test(`${target} manifest floor covers every browser API the source uses`, () => {
  const floors = [backgroundFloor[target]];
  for (const api of usedApis()) {
    expect(apiFloors, `record the ${target} floor of ${api}`).toHaveProperty([api]);
    const floor = apiFloors[api]![target];
    expect(floor, `${api} is not available on ${target}`).not.toBeNull();
    floors.push(floor!);
  }
  const declared = target === "chrome"
    ? manifest.minimum_chrome_version
    : manifest.browser_specific_settings.gecko.strict_min_version;
  expect(Number.parseFloat(declared)).toBe(Math.max(...floors));
});

test.runIf(target === "chrome")("Chrome uses a module service worker", () => {
  expect(manifest.background).toEqual({ service_worker: "background.mjs", type: "module" });
});

test.runIf(target === "firefox")("Firefox uses module event-page scripts", () => {
  expect(manifest.background).toEqual({ scripts: ["background.mjs"], type: "module" });
  expect(manifest.browser_specific_settings.gecko.id).toBe("hrontan@gmail.com");
});
