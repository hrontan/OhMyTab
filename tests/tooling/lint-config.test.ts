import { array, record } from "../../scripts/runtime-boundaries.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const cli = path.join(root, "node_modules/oxlint/bin/oxlint");
const fixtures: [string, string, number, string | null, string | null][] = [
  ["undefined.mjs", "missingGlobal();", 1, "no-undef", "error"],
  [
    "duplicate.mjs",
    "export function duplicate(value, value) { return value; }",
    1,
    null,
    "error",
  ],
  ["octal.mjs", "export const value = 012;", 1, null, "error"],
  ["octal.ts", "export const value: number = 012;", 1, null, "error"],
  [
    "explicit-any.ts",
    "export const value: any = 1;",
    1,
    "no-explicit-any",
    "error",
  ],
  [
    "wrapper.ts",
    "export type Value = String;",
    1,
    "no-wrapper-object-types",
    "error",
  ],
  [
    "directive.ts",
    "// @ts-expect-error\nexport const value = 1;",
    1,
    "ban-ts-comment",
    "error",
  ],
  ["unused.ts", "const unused = 1; export {};", 0, "no-unused-vars", "warning"],
  [
    "type-only-use.ts",
    "const value = 1; export type Value = typeof value;",
    0,
    "no-unused-vars",
    "warning",
  ],
  ["ignored.ts", "const _unused = 1; export {};", 0, null, null],
];

for (const [name, source, status, rule, severity] of fixtures) {
  test("lint migration retains " + name, async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "ohmytab-lint-test-"),
    );
    try {
      const fixture = path.join(directory, name);
      await writeFile(fixture, source);
      const result = spawnSync(
        process.execPath,
        [
          cli,
          "--config",
          path.join(root, ".oxlintrc.json"),
          "--no-ignore",
          "--format",
          "json",
          fixture,
        ],
        { cwd: root, encoding: "utf8" },
      );
      assert.ifError(result.error);
      assert.equal(result.status, status, result.stdout + result.stderr);
      const report = record(JSON.parse(result.stdout) as unknown);
      if (severity) {
        assert.ok(
          array(report["diagnostics"]).some((value) => {
            const item = record(value);
            return (
              item["severity"] === severity &&
              (!rule ||
                (typeof item["code"] === "string" &&
                  item["code"].includes(rule)))
            );
          }),
          result.stdout,
        );
      } else {
        assert.deepEqual(report["diagnostics"], [], result.stdout);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test("service worker chrome global stays readonly and file scoped", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "ohmytab-lint-worker-"),
  );
  try {
    const config = path.join(directory, ".oxlintrc.json");
    await writeFile(config, await readFile(path.join(root, ".oxlintrc.json")));
    const fixture = path.join(directory, "resource/store/src/generate.mjs");
    await mkdir(path.dirname(fixture), { recursive: true });
    for (const [source, rule] of [
      [
        "/* global chrome -- evaluated inside the extension service worker */\nchrome.tabs.query({});",
        null,
      ],
      ["chrome.tabs.query({}); missingWorkerGlobal();", "no-undef"],
      ["chrome = {};", "no-global-assign"],
    ] as const) {
      await writeFile(fixture, source);
      const result = spawnSync(
        process.execPath,
        [cli, "--config", config, "--no-ignore", "--format", "json", fixture],
        { cwd: directory, encoding: "utf8" },
      );
      assert.ifError(result.error);
      assert.equal(result.status, rule ? 1 : 0, result.stdout + result.stderr);
      const report = record(JSON.parse(result.stdout) as unknown);
      if (rule)
        assert.ok(
          array(report["diagnostics"]).some((value) => {
            const code = record(value)["code"];
            return typeof code === "string" && code.includes(rule);
          }),
          result.stdout,
        );
      else assert.deepEqual(report["diagnostics"], [], result.stdout);
    }
    const other = path.join(directory, "resource/store/src/other.mjs");
    await writeFile(other, "chrome.tabs.query({});");
    const result = spawnSync(
      process.execPath,
      [cli, "--config", config, "--no-ignore", "--format", "json", other],
      { cwd: directory, encoding: "utf8" },
    );
    assert.ifError(result.error);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.ok(
      array(record(JSON.parse(result.stdout) as unknown)["diagnostics"]).some(
        (value) => {
          const code = record(value)["code"];
          return typeof code === "string" && code.includes("no-undef");
        },
      ),
      result.stdout,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
