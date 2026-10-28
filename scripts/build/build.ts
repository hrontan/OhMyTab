import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isBrowser, browsers, projectRoot } from "./build-paths.ts";

export function runBuilds(
  targets: readonly unknown[],
  child = fileURLToPath(new URL("./build-target.ts", import.meta.url)),
) {
  if (!targets.length || targets.some((target) => !isBrowser(target))) {
    console.error("Select chrome, firefox, or all");
    return 1;
  }
  for (const target of targets) {
    const result = spawnSync(process.execPath, [child, String(target)], {
      cwd: projectRoot,
      stdio: "inherit",
    });
    if (result.error) console.error(result.error.message);
    if (result.status !== 0) return result.status ?? 1;
  }
  return 0;
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  process.exitCode = runBuilds(
    process.argv[2] === "all" ? browsers : [process.argv[2]],
  );
}
