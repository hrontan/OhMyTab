import type { InlineConfig } from "vite";
import path from "node:path";
import { browserOutput, projectRoot } from "./scripts/build/build-paths.ts";
import { browserBranches } from "./scripts/build/browser-branches.ts";

export const entries = {
  background: "background/background.ts",
  options: "options/options.ts",
  preview: "pages/preview.ts",
  undo: "pages/undo-page.ts",
};

// Separate library builds preserve standalone entry modules without shared chunks.
export default function createConfig(browser: unknown, entry: string) {
  if (!(entry in entries) || !Object.hasOwn(entries, entry))
    throw new Error("Unsupported entry: " + entry);
  return {
    configFile: false,
    root: projectRoot,
    publicDir: false,
    plugins: [browserBranches(browser)],
    build: {
      target: "es2022",
      outDir: browserOutput(browser),
      emptyOutDir: false,
      copyPublicDir: false,
      minify: true,
      sourcemap: false,
      lib: {
        entry: path.join(
          projectRoot,
          "src",
          entries[entry as keyof typeof entries],
        ),
        formats: ["es"] as ["es"],
        fileName: () => entry + ".mjs",
      },
    },
  } satisfies InlineConfig;
}
