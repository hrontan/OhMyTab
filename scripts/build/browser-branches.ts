import { createRequire } from "node:module";
import type { Plugin } from "vite";
import { loader } from "../runtime-boundaries.ts";
import { isBrowser } from "./build-paths.ts";

const require = createRequire(import.meta.url);
const ifdefLoader = loader(require("ifdef-loader") as unknown);

export function browserBranches(browser: unknown) {
  if (!isBrowser(browser))
    throw new Error("Select --mode chrome or --mode firefox");
  return {
    name: "extension-browser-branches",
    enforce: "pre",
    transform(source: string, id: string) {
      if (!/[/\\]src[/\\].*\.ts(?:\?.*)?$/.test(id)) return;
      let result: string | undefined;
      ifdefLoader.call(
        {
          query: { BROWSER: browser },
          callback(error, code) {
            if (error) throw error;
            result = code;
          },
        },
        source,
      );
      if (result === undefined)
        throw new Error("ifdef-loader did not call back synchronously");
      return { code: result, map: null };
    },
  } satisfies Plugin;
}
