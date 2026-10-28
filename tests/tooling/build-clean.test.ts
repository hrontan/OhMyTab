import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  symlink,
  rm,
  stat,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { runBuilds } from "../../scripts/build/build.ts";
import { cleanOutputs } from "../../scripts/build/clean.ts";
import { browserOutput, outputPaths } from "../../scripts/build/build-paths.ts";
import createConfig, { entries } from "../../vite.config.ts";
import { browserBranches } from "../../scripts/build/browser-branches.ts";

for (const [failure, status, expected] of [
  ["chrome", 31, "chrome"],
  ["firefox", 32, "chromefirefox"],
] as const) {
  test(`${failure} child failure propagates and stops the parent sequence`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ohmytab-build-test-"));
    try {
      const log = path.join(root, "calls");
      const child = path.join(root, "child.mjs");
      await writeFile(
        child,
        `import {appendFileSync} from 'node:fs'; appendFileSync(${JSON.stringify(log)},process.argv[2]); process.exit(process.argv[2]===${JSON.stringify(failure)}?${status}:0);`,
      );
      assert.equal(runBuilds(["chrome", "firefox"], child), status);
      assert.equal(await readFile(log, "utf8"), expected);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

test("invalid browser cannot choose a path outside declared outputs", () => {
  assert.equal(runBuilds(["../outside"]), 1);
  assert.throws(() => browserOutput("../outside"), /Unsupported browser/);
});

test("clean deletes exactly declared outputs and is repeatable", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ohmytab-clean-test-"));
  try {
    for (const directory of [
      ...outputPaths(root),
      path.join(root, "dist_archive"),
      path.join(root, "distribution"),
    ]) {
      await mkdir(directory);
      await writeFile(path.join(directory, "keep"), "sentinel");
    }
    await writeFile(path.join(root, "tsconfig.tmp.json"), "unrelated");
    await cleanOutputs(root);
    await cleanOutputs(root);
    for (const directory of outputPaths(root))
      await assert.rejects(stat(directory), { code: "ENOENT" });
    for (const directory of ["dist_archive", "distribution"])
      assert.equal(
        await readFile(path.join(root, directory, "keep"), "utf8"),
        "sentinel",
      );
    assert.equal(
      await readFile(path.join(root, "tsconfig.tmp.json"), "utf8"),
      "unrelated",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a declared output symlink is removed without deleting its target", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "ohmytab-clean-link-test-"),
  );
  try {
    const outside = path.join(root, "preserved");
    const project = path.join(root, "project");
    await mkdir(outside);
    await mkdir(project);
    await writeFile(path.join(outside, "keep"), "sentinel");
    await symlink(
      outside,
      path.join(project, "dist_chrome"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await cleanOutputs(project);
    assert.equal(
      await readFile(path.join(outside, "keep"), "utf8"),
      "sentinel",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("both production configurations retain standalone browser entries and safe outputs", () => {
  assert.deepEqual(Object.keys(entries), [
    "background",
    "options",
    "preview",
    "undo",
  ]);
  for (const target of ["chrome", "firefox"]) {
    for (const entry of Object.keys(entries)) {
      const config = createConfig(target, entry);
      assert.equal(config.build.target, "es2022");
      assert.equal(config.build.minify, true);
      assert.equal(config.build.outDir, browserOutput(target));
      assert.equal(config.build.emptyOutDir, false);
      assert.deepEqual(config.build.lib.formats, ["es"]);
      assert.equal(config.build.lib.fileName(), entry + ".mjs");
      assert.equal(
        "rolldownOptions" in config.build
          ? config.build.rolldownOptions
          : undefined,
        undefined,
      );
      assert.equal(config.publicDir, false);
    }
  }
  assert.throws(
    () => createConfig("../outside", "background"),
    /Select --mode/,
  );
  assert.throws(
    () => createConfig("chrome", "../outside"),
    /Unsupported entry/,
  );
});

test("shared preprocessing selects browser branches before TypeScript transformation", () => {
  const source =
    '/// #if BROWSER === "chrome"\nconst value: string = "chrome";\n/// #else\nconst value: string = "firefox";\n/// #endif\n';
  for (const browser of ["chrome", "firefox"]) {
    const plugin = browserBranches(browser);
    assert.equal(plugin.enforce, "pre");
    const result = plugin.transform(source, "/project/src/example.ts?test");
    assert.ok(result);
    assert.ok(result.code.includes('= "' + browser + '"'));
    assert.ok(
      !result.code.includes(
        '= "' + (browser === "chrome" ? "firefox" : "chrome") + '"',
      ),
    );
    assert.equal(
      plugin.transform(source, "/project/tests/example.ts"),
      undefined,
    );
    assert.throws(() =>
      plugin.transform(
        "/// #if BROWSER ===\nconst invalid = true;\n/// #endif\n",
        "/project/src/broken.ts",
      ),
    );
  }
});
