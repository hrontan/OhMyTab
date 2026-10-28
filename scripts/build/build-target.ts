import { cp, lstat, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { build } from "vite";
import createConfig, { entries } from "../../vite.config.ts";
import { browserOutput, projectRoot } from "./build-paths.ts";

try {
  const browser = process.argv[2];
  const output = browserOutput(browser);
  // Remove an output junction itself; never let the bundler clean its target.
  const info = await lstat(output).catch((error) => {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
  });
  if (info)
    await rm(output, { recursive: !info.isSymbolicLink(), force: true });
  await mkdir(output, { recursive: true });
  for (const entry of Object.keys(entries))
    await build(createConfig(browser, entry));
  const assets = path.join(projectRoot, "public");
  for (const name of await readdir(assets)) {
    if (name === "chrome.json" || name === "firefox.json") continue;
    await cp(path.join(assets, name), path.join(output, name), {
      recursive: true,
    });
  }
  await cp(
    path.join(assets, browser + ".json"),
    path.join(output, "manifest.json"),
  );
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
