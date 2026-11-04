// Shared, editable SVG primitives. No browser, raster or downloaded fonts.
import fs from "node:fs";
import { fileURLToPath } from "node:url";

export const BRAND_FONT = '"Segoe UI", sans-serif';
export const BRAND_WEIGHT = 800;
export const escape = (value: string) => value.replace(/[&<>"']/g, (char) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char] ?? char);
export const layer = (id: string, label: string, content: string, attributes = "") =>
  `<g id="${id}" aria-label="${escape(label)}" ${attributes}>\n${content}\n</g>`;
export const rect = (x: number, y: number, width: number, height: number, fill: string, radius = 0, extra = "") =>
  `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="${fill}" ${extra}/>`;
export const text = (value: string, x: number, y: number, size: number, extra = "") =>
  `<text x="${x}" y="${y}" font-size="${size}" ${extra}>${escape(value)}</text>`;
export const logoDefinition = () => {
  const source = fs.readFileSync(fileURLToPath(new URL("./logo.svg", import.meta.url)), "utf8")
    .replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "").trim();
  return `<symbol id="logo" viewBox="0 0 128 128">${source}</symbol>`;
};
export const logo = (x: number, y: number, size: number) =>
  `<use href="#logo" x="${x}" y="${y}" width="${size}" height="${size}"/>`;
export const brandText = (x: number, y: number, size: number, anchor = "start") =>
  text("OhMyTab", x, y, size, `id="brand-name" font-family="${escape(BRAND_FONT)}" font-weight="${BRAND_WEIGHT}" text-anchor="${anchor}" letter-spacing="-0.01em" fill="#555559"`);

// Conservative advances keep generation Node-only; real glyph bounds are checked in Chromium.
const advance = (char: string) => /[^\u0020-\u00ff]/u.test(char) ? 1 : /[MW@]/.test(char) ? .88 : /[il.,' !:;]/.test(char) ? .28 : /[A-Z]/.test(char) ? .66 : .5;
export function wrap(value: string, width: number, size: number): string[] {
  return value.split("\n").flatMap((paragraph) => {
    const tokens = paragraph.match(/[\u0020-\u00ff]+|[^\u0020-\u00ff]/gu) ?? [];
    const words = tokens.flatMap((token) => /^[\u0020-\u00ff]+$/u.test(token) ? token.split(/(?<=\s)/u) : [token]);
    const lines: string[] = [];
    let line = "", used = 0;
    for (const word of words) {
      const length = [...word].reduce((sum, char) => sum + advance(char) * size, 0);
      // Keep closing punctuation with its preceding text in Japanese and Chinese.
      if (used + length > width && line.trim() && !/^[、。，．！？）」』】]/u.test(word)) { lines.push(line.trim()); line = ""; used = 0; }
      line += word; used += length;
    }
    if (line.trim()) lines.push(line.trim());
    return lines;
  });
}
export const lines = (value: string, x: number, y: number, width: number, size: number, leading: number, extra = "") =>
  wrap(value, width, size).map((line, i) => text(line, x, y + leading * i, size, extra)).join("\n");
export const svg = (width: number, height: number, lang: string, defs: string, content: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xml:lang="${lang.replace("_", "-")}">\n<defs>${defs}</defs>\n${content}\n</svg>\n`;
