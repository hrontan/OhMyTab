import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { SourceTextModule, createContext } from "node:vm";
import path from "node:path";
import { browserOutput } from "../build/build-paths.ts";

const event = { addListener() {} };
const api = {
  storage: { onChanged: event },
  tabs: Object.fromEntries(
    [
      "onUpdated",
      "onCreated",
      "onMoved",
      "onDetached",
      "onAttached",
      "onRemoved",
      "onActivated",
      "onReplaced",
    ].map((key) => [key, event]),
  ),
  windows: { onFocusChanged: event },
  action: { onClicked: event },
  contextMenus: { onClicked: event },
  commands: { onCommand: event },
  runtime: { onInstalled: event, onStartup: event, onMessage: event },
};
for (const browser of ["chrome", "firefox"]) {
  for (const name of [
    "background.mjs",
    "options.mjs",
    "preview.mjs",
    "undo.mjs",
  ]) {
    const code = await readFile(
      path.join(browserOutput(browser), name),
      "utf8",
    );
    const context = createContext({
      chrome: api,
      browser: api,
      console,
      URL,
      document: { addEventListener() {} },
    });
    const module = new SourceTextModule(code, { context });
    assert.deepEqual(
      module.dependencySpecifiers,
      [],
      `${browser}/${name} contains external imports`,
    );
    assert.doesNotMatch(
      code,
      /\bimport\s*\(|\brequire\s*\(|["']node:/,
      `${browser}/${name} contains runtime Node or dynamic imports`,
    );
    await module.link(() => {
      throw new Error("Unexpected external import");
    });
    await module.evaluate();
    console.log(
      `${browser}/${name}: compressed module parsed and initialized with browser/DOM surfaces; no Node globals or external imports`,
    );
  }
}
