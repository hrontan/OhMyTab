import { errorMessage, isMainModule } from "../runtime-boundaries.ts";
import { rm } from "node:fs/promises";
import { outputPaths } from "./build-paths.ts";

export async function cleanOutputs(root?: string) {
  for (const output of outputPaths(root))
    await rm(output, { recursive: true, force: true });
}

if (isMainModule(import.meta.url)) {
  try {
    await cleanOutputs();
  } catch (error) {
    console.error(errorMessage(error));
    process.exitCode = 1;
  }
}
