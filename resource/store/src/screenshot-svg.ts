// Feature illustrations and a vector frame around a genuine options capture.
import { brandText, escape, layer, lines, logo, logoDefinition, rect, svg, text, wrap } from "./svg.ts";

export interface ScreenshotCopy {
  font: string;
  before: string;
  after: string;
  window: string;
  duplicate: string;
  optionsCaption: string;
  illustration: string;
  groupNote: string;
  duplicateNote: string;
  slides: { title: string; body: string }[];
}
interface Tab { id: string; site: string; url: string; window: number }
const tabs: Tab[] = [
  { id: "news-1", site: "news", url: "https://news.example/a", window: 1 },
  { id: "mail-1", site: "mail", url: "https://mail.example/inbox", window: 1 },
  { id: "news-2", site: "news", url: "https://news.example/a", window: 1 },
  { id: "shop-1", site: "shop", url: "https://shop.example/item", window: 2 },
  { id: "docs-1", site: "docs", url: "https://docs.example/guide", window: 2 },
  { id: "mail-2", site: "mail", url: "https://mail.example/inbox", window: 2 },
];
// Match the default runtime behavior: close the first copies, retain the last eligible tab.
const duplicateIds = new Set(tabs.filter((tab, i) => tabs.slice(i + 1).some(other => other.url === tab.url)).map(tab => tab.id));
const colors: Record<string, string> = { news: "#e8710a", mail: "#1a73e8", docs: "#188038", shop: "#a142f4" };
const border = 'stroke="#dddbd5"';
const windowFrame = (x: number, y: number, width: number, height: number, bar = 46) =>
  rect(x, y, width, height, "#fff", 14, border) + rect(x + 1, y + 1, width - 2, bar, "#ebe9e4", 13);

function tab(row: Tab, x: number, y: number, width: number, duplicate: string, phase: string): string {
  const marked = phase === "before" && duplicateIds.has(row.id);
  return layer(`${phase}-${row.id}`, `${row.site}: ${marked ? "first duplicate closed" : "retained"}`,
    rect(x, y, width, 77, "#f6f5f1", 9, marked ? 'stroke="#d93025" stroke-width="2" stroke-dasharray="4 3"' : border) +
    rect(x + 9, y + 10, 12, 12, colors[row.site] ?? "#555559", 3) +
    text(row.site[0]!.toUpperCase() + row.site.slice(1), x + 27, y + 21, 14) +
    text(row.url.replace("https://", ""), x + 9, y + 41, 9) +
    (marked ? rect(x + 8, y + 51, 90, 19, "#d93025", 9) + text(duplicate, x + 16, y + 64, 11, 'fill="#fff" font-weight="700"') : ""),
    `data-tab-id="${row.id}" data-url="${escape(row.url)}" data-phase="${phase}" data-duplicate="${marked}"`);
}
function flow(copy: ScreenshotCopy): string {
  const win = (n: number, rows: Tab[], y: number, phase: string) => {
    const width = (594 - (rows.length - 1) * 6) / rows.length;
    return layer(`${phase}-window-${n}`, `${copy.window} ${n}`,
      windowFrame(0, y, 620, 125, 94) +
      rows.map((row, i) => tab(row, 13 + i * (width + 6), y + 14, width, copy.duplicate, phase)).join("") +
      text(`${copy.window} ${n}`, 14, y + 114, 13, 'fill="#5d5d66"'));
  };
  return text(copy.before, 0, 24, 15, 'fill="#8a5300" font-weight="700"') +
    win(1, tabs.filter(row => row.window === 1), 38, "before") +
    win(2, tabs.filter(row => row.window === 2), 175, "before") +
    `<path d="M294 320 H326 L310 338 Z" fill="#ffb03b"/>` +
    text(copy.after, 0, 370, 15, 'fill="#8a5300" font-weight="700"') +
    win(1, tabs.filter(row => !duplicateIds.has(row.id)).sort((a, b) => a.url.localeCompare(b.url)), 384, "after") +
    lines(copy.duplicateNote, 0, 540, 620, 13, 19, 'fill="#5d5d66"');
}
function menu(messages: Record<string, { message: string }>): string {
  const m = (key: string) => { const value = messages[key]; if (!value) throw Error("Missing message " + key); return value.message; };
  const win1 = m("text0_0");
  const rows = ["…", m("text4"), m("text2") + win1,
    m("text6") + " [(*.)news.example.com]" + win1,
    m("text6") + " [(*.)example.com]" + win1, m("text5") + m("text0_1")];
  return windowFrame(0, 0, 620, 580) +
    ["news", "news", "mail", "docs"].map((site, i) => rect(12 + i * 135, 16, 129, 31, "#f6f5f1", 9, border) + rect(23 + i * 135, 25, 12, 12, colors[site]!, 3) + text(site, 43 + i * 135, 38, 14)).join("") +
    `<path d="M30 133 L51 143 L37 152 Z" fill="#26262a"/>` +
    rect(24, 150, 580, 279, "#fff", 10, 'stroke="#cfcdc7"') +
    rows.map((row, i) => {
      const y = 185 + i * 44;
      return (i === 2 ? rect(25, y - 25, 578, 43, "#fff1d9") : "") +
        (i ? logo(40, y - 14, 18) : "") + text(row, i ? 70 : 40, y, 12, i === 2 ? 'font-weight="700"' : "");
    }).join("") +
    [202, 334].map(y => `<path d="M25 ${y} H603" stroke="#dddbd5"/>`).join("");
}
function badge(copy: ScreenshotCopy): string {
  return rect(0, 85, 620, 70, "#fff", 14, border) +
    rect(18, 103, 510, 34, "#f1f0ec", 17) + rect(546, 100, 40, 40, "#f6f5f1", 8) + logo(551, 105, 30) +
    rect(570, 128, 29, 20, "#8cb6f7", 4) + text("12", 576, 143, 13, 'fill="#fff"') +
    layer("collapsed-domain-groups", "Chrome domain groups, collapsed", windowFrame(0, 183, 620, 220) +
      rect(12, 199, 173, 30, "#188038", 8) + text("docs.example.com", 24, 219, 13, 'fill="#fff" font-weight="700"') +
      rect(192, 199, 177, 30, "#e8710a", 8) + text("news.example.com", 204, 219, 13, 'fill="#fff" font-weight="700"') +
      lines(copy.groupNote, 14, 376, 590, 13, 18, 'fill="#5d5d66"'), 'data-collapsed="true" data-browser="Chrome"');
}
export function screenshotSVG(lang: string, index: number, copy: ScreenshotCopy, messages: Record<string, { message: string }>, capture?: string): string {
  const slide = copy.slides[index];
  if (!slide) throw Error("Missing slide " + index);
  const titleLines = slide.title.split("\n");
  const bodyLines = wrap(slide.body, 460, 21);
  const blockHeight = titleLines.length * 57.5 + 60 + bodyLines.length * 35.7;
  const titleY = 400 - blockHeight / 2 + 43;
  const underlineY = titleY + (titleLines.length - 1) * 57.5 + 28;
  const copyContent = titleLines.map((line, i) => text(line, 80, titleY + i * 57.5, 46, 'font-weight="700" letter-spacing="-0.01em"')).join("\n") +
    rect(80, underlineY, 64, 6, "#ffb03b", 3) +
    lines(slide.body, 80, underlineY + 59, 460, 21, 35.7, 'fill="#5d5d66"');
  let illustration: string;
  if (index === 3) {
    if (!capture?.startsWith("data:image/png;base64,")) throw Error("Settings slide requires a genuine PNG capture");
    const png = Buffer.from(capture.slice("data:image/png;base64,".length), "base64");
    const w = png.readUInt32BE(16), h = png.readUInt32BE(20);
    const scale = Math.min(608 / w, 620 / h);
    const width = w * scale, height = h * scale;
    const x = (620 - width) / 2, y = (620 - height) / 2;
    illustration = rect(x - 1, y - 1, width + 2, height + 2, "#fff", 1, border) +
      `<image id="settings-capture" aria-label="Real Chrome options page excerpt" x="${x}" y="${y}" width="${width}" height="${height}" href="${capture}"/>`;
  } else illustration = [() => flow(copy), () => menu(messages), () => badge(copy)][index]!();
  return svg(1280, 800, lang, logoDefinition(), [
    layer("background", "Background", rect(0, 0, 1280, 800, "#f7f6f3")),
    layer("brand", "OhMyTab brand", logo(80, 44, 36) + brandText(128, 71, 22)),
    layer("copy", "Localized title and description", copyContent, `font-family="${escape(copy.font)}" fill="#26262a"`),
    layer(index === 3 ? "capture" : "illustration", index === 3 ? "Genuine settings capture in vector frame" : "Feature illustration", illustration +
      lines(index === 3 ? copy.optionsCaption : copy.illustration, 0, 650, 620, 13, 19, 'fill="#5d5d66"'),
      `transform="translate(630 100)" font-family="${escape(copy.font)}" fill="#26262a"`),
  ].join("\n"));
}
