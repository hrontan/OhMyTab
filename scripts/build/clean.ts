import { errorMessage } from "../runtime-boundaries.ts";
import { rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { outputPaths } from "./build-paths.ts";

export async function cleanOutputs(root?: string) {
  for (const output of outputPaths(root))
    await rm(output, { recursive: true, force: true });
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  try {
    await cleanOutputs();
  } catch (error) {
    console.error(errorMessage(error));
    process.exitCode = 1;
  }
}
