/* global chrome -- evaluated inside the extension service worker */
// Loaded only for a real settings capture, never for pure vector generation.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const root = path.resolve(import.meta.dirname, '../../..');
const dist = path.resolve(process.env['STORE_DIST_DIR'] ?? path.join(root, 'dist_chrome'));
const temporary = path.resolve(process.env['STORE_TEMP_DIR'] ?? path.join(root, '.tmp/store-render'));
fs.mkdirSync(temporary, { recursive: true });
process.env['TEMP'] = temporary;
process.env['TMP'] = temporary;
const { chromium } = createRequire(import.meta.url)(process.env['PLAYWRIGHT_CORE_PATH'] ?? 'playwright-core') as typeof import('playwright-core');
const dataURL = (file: string) => 'data:image/png;base64,' + fs.readFileSync(file).toString('base64');
const chromiumPath = () => {
  if (process.env["CHROMIUM_PATH"]) return process.env["CHROMIUM_PATH"];
  const base = path.join(
    process.env["LOCALAPPDATA"] ?? path.join(os.homedir(), ".cache"),
    "ms-playwright",
  );
  const builds = fs
    .readdirSync(base)
    .filter((name) => /^chromium-\d+$/.test(name))
    .sort((a, b) => Number(b.slice(9)) - Number(a.slice(9)));
  for (const build of builds) {
    for (const exe of [
      "chrome-win64/chrome.exe",
      "chrome-win/chrome.exe",
      "chrome-linux/chrome",
      "chrome-mac/Chromium.app/Contents/MacOS/Chromium",
    ]) {
      const candidate = path.join(base, build, exe);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  throw new Error(
    "Set CHROMIUM_PATH to a Chromium that can load unpacked extensions",
  );
};

const exampleWorkflow: Record<string, string> = {
  en: "Morning cleanup",
  ja: "朝のタブ整理",
  zh_CN: "早间标签整理",
};

// The options page as the extension renders it in each browser language.
export const optionsScreenshot = async (lang: string) => {
  if (!fs.existsSync(path.join(dist, "manifest.json")))
    throw new Error("Set STORE_DIST_DIR to an existing Chrome build");
  const profile = fs.mkdtempSync(path.join(temporary, "profile-"));
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: chromiumPath(),
    headless: true,
    locale: lang.replace("_", "-"),
    args: [
      `--lang=${lang.replace("_", "-")}`,
      `--disable-extensions-except=${dist}`,
      `--load-extension=${dist}`,
    ],
    // Tall enough that the saved-workflow editor lies inside the viewport without scrolling.
    viewport: { width: 640, height: 3600 },
  });
  try {
    let [worker] = context.serviceWorkers();
    worker ??= await context.waitForEvent("serviceworker");
    await worker.evaluate(() =>
      chrome.storage.sync.set({
        iconbadge: true,
        iconbadgescope: "win",
        comclose: true,
        rxclose: true,
        contextmenu1: true,
        contextmenu1advanced: true,
        contextmenu3: true,
      }),
    );
    const page = await context.newPage();
    await page.goto(
      `chrome-extension://${new URL(worker.url()).host}/options.html`,
    );
    await page.waitForTimeout(500);
    // An unsaved example routine typed into the real editor; nothing is stored.
    await page.fill("#workflow_name", exampleWorkflow[lang] ?? exampleWorkflow["en"]!);
    await page.selectOption("#workflow_scope", "all");
    for (const operation of ["glue", "depclean", "sorttab"])
      await page.check(`#workflow_op_${operation}`);
    const file = path.join(temporary, `options-${lang}.png`);
    // A contiguous real excerpt of the saved-workflow editor, from its heading to the last operation.
    const capture = await page.evaluate(() => {
      const required = (selector: string) => {
        const element = document.querySelector(selector);
        if (!element) throw new Error("Missing options element: " + selector);
        return element;
      };
      const form = required("#workflows");
      const bounds = form.getBoundingClientRect();
      const top = required("#workflow_editor h2").getBoundingClientRect().top - 12;
      const last = required("#workflow_op_grouping").closest("label");
      if (!last) throw new Error("Missing excerpt boundary");
      const bottom = last.getBoundingClientRect().bottom + 12;
      const clip = { x: bounds.left, y: top, width: bounds.width, height: bottom - top };
      const inside = (box: DOMRect) => box.left >= clip.x - 0.5 &&
        box.right <= clip.x + clip.width + 0.5 && box.top >= top - 0.5 &&
        box.bottom <= bottom + 0.5;
      const elements = Array.from(form.querySelectorAll("h2, legend, label, p, input, select"))
        .filter((element) => {
          const box = element.getBoundingClientRect();
          return box.width > 0 && box.height > 0 && box.top < bottom && box.bottom > top;
        }).map((element) => {
          const box = element.getBoundingClientRect();
          // Text ranges detect glyphs outside otherwise valid element bounds.
          const range = document.createRange();
          range.selectNodeContents(element);
          const textBoxes = Array.from(range.getClientRects());
          if (!inside(box) || textBoxes.some((rect) => !inside(rect)) ||
              element.scrollWidth > element.clientWidth + 1)
            throw new Error("Clipped options content: " + element.textContent);
          return { tag: element.tagName, id: element.id, text: element.textContent,
            box: box.toJSON(), textBoxes: textBoxes.map((rect) => rect.toJSON()),
            clientWidth: element.clientWidth, scrollWidth: element.scrollWidth };
        });
      if (document.documentElement.scrollWidth > innerWidth ||
          form.scrollWidth > form.clientWidth || clip.x + clip.width > innerWidth)
        throw new Error("Options excerpt exceeds the real viewport");
      return { clip, viewport: { width: innerWidth, height: innerHeight },
        documentScrollWidth: document.documentElement.scrollWidth,
        form: { clientWidth: form.clientWidth, scrollWidth: form.scrollWidth }, elements };
    });
    fs.writeFileSync(path.join(temporary, `options-${lang}.json`),
      JSON.stringify(capture, null, 2) + "\n");
    const { clip } = capture;
    await page.screenshot({ path: file, clip });
    return dataURL(file);
  } finally {
    await context.close();
    // Retain the isolated profile with capture evidence; never remove recursively.
  }
};
