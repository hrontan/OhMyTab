import path from "node:path";
import { fileURLToPath } from "node:url";

export const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
export type Browser = "chrome" | "firefox";
export const browsers: Browser[] = ["chrome", "firefox"];
export const isBrowser = (value: unknown): value is Browser =>
  value === "chrome" || value === "firefox";
export const outputPaths = (root = projectRoot) =>
  ["dist_chrome", "dist_firefox", "dist"].map((name) =>
    path.resolve(root, name),
  );
export function browserOutput(browser: unknown) {
  if (!isBrowser(browser)) throw new Error(`Unsupported browser: ${browser}`);
  return path.resolve(projectRoot, "dist_" + browser);
}
