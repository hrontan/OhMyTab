// Pure vector promo generation: Node builtins only; no browser or Chrome build.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { brandText, escape, layer, logo, logoDefinition, rect, svg, text } from "./svg.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
export const promoLocales = ["en", "ja", "zh_CN"] as const;
export const promoKinds = ["small", "marquee"] as const;
type Locale = typeof promoLocales[number];
type Kind = typeof promoKinds[number];
interface PromoCopy { font: string; promo: string; tagline: string }

export function promoSVG(lang: Locale, kind: Kind, copy: PromoCopy): string {
  const small = kind === "small";
  const width = small ? 440 : 1400;
  const height = small ? 280 : 560;
  // Existing flex positions measured with the copy.json local font stacks.
  const textX = small ? 220 : ({ en: 567.90625, ja: 581.90625, zh_CN: 610.6875 })[lang];
  const iconX = small ? 174 : textX - 184;
  const iconY = small ? (lang === "zh_CN" ? 53 : 52) : 216;
  return svg(width, height, lang, logoDefinition(), [
    layer("background", "Background", rect(0, 0, width, height, "#f7f6f3") +
      `<circle cx="${width - 100}" cy="60" r="260" fill="#ffb03b" opacity="0.16"/>`),
    layer("brand", "OhMyTab brand", logo(iconX, iconY, small ? 92 : 128) +
      brandText(textX, small ? 194 : 285, small ? 34 : 76, small ? "middle" : "start")),
    layer("copy", "Localized description", text(small ? copy.promo : copy.tagline,
      textX, small ? 222 : 345, small ? 16 : 30,
      `font-family="${escape(copy.font)}" text-anchor="${small ? "middle" : "start"}" fill="#5d5d66"`)),
  ].join("\n"));
}

export function writePromos(out: string, selected?: ReadonlySet<string>): string[] {
  const input: unknown = JSON.parse(fs.readFileSync(path.join(here, "copy.json"), "utf8"));
  if (!input || typeof input !== "object") throw new Error("Invalid promo copy");
  const written: string[] = [];
  for (const lang of promoLocales) {
    const row: unknown = (input as Record<string, unknown>)[lang];
    if (!row || typeof row !== "object") throw new Error("Missing promo locale: " + lang);
    const fields = row as Record<string, unknown>;
    const font = fields["font"], promo = fields["promo"], tagline = fields["tagline"];
    if (typeof font !== "string" || typeof promo !== "string" || typeof tagline !== "string")
      throw new Error("Invalid promo fields: " + lang);
    for (const kind of promoKinds) {
      const name = `promo-${kind}-${lang}.svg`;
      if (selected && !selected.has(name)) continue;
      fs.mkdirSync(out, { recursive: true });
      fs.writeFileSync(path.join(out, name), promoSVG(lang, kind, { font, promo, tagline }));
      written.push(name);
    }
  }
  return written;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const selected = process.env["STORE_IMAGES"]?.split(",").map((name) => name.trim()).filter(Boolean);
  const out = path.resolve(process.env["STORE_OUTPUT_DIR"] ?? path.join(here, "../images"));
  for (const name of writePromos(out, selected ? new Set(selected) : undefined)) console.log(name);
}
