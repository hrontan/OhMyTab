import {
  array,
  record,
  string,
  errorMessage,
  errorStack,
} from "../../scripts/runtime-boundaries.ts";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { withFixtureLifecycle, writeResult } from "./order-and-actions.ts";
const here = path.dirname(fileURLToPath(import.meta.url));
const sha = (b: string) => crypto.createHash("sha256").update(b).digest("hex");
const output = string(process.env["BENCHMARK_LIFECYCLE_OUT"]);
if (process.argv[2] === "--lifecycle-child") {
  const kind = process.argv[3];
  const original = {
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    chrome: Object.getOwnPropertyDescriptor(globalThis, "chrome"),
    browser: Object.getOwnPropertyDescriptor(globalThis, "browser"),
  };
  let long,
    callbackRan = false,
    cancelledRan = false,
    intervalCount = 0;
  const foreign = new Promise<void>((resolve) =>
    original.setTimeout(resolve, 50),
  );
  try {
    const result = await withFixtureLifecycle(async () => {
      long = setTimeout(() => {
        throw new Error("Long timer was not cleared");
      }, 300000);
      assert.equal(long.hasRef(), true);
      assert.equal(long.refresh(), long);
      Reflect.set(globalThis, "chrome", { synthetic: true });
      Reflect.set(globalThis, "browser", { synthetic: true });
      const cancelled = setTimeout(() => {
        cancelledRan = true;
      }, 5);
      assert.equal(clearTimeout(cancelled), undefined);
      await new Promise<void>((resolve) => {
        const handle = setTimeout(
          function (this: NodeJS.Timeout, value: string) {
            assert.equal(value, "argument");
            assert.equal(this, handle);
            callbackRan = true;
            resolve();
          },
          5,
          "argument",
        );
      });
      await new Promise<void>((resolve) => {
        const handle = setInterval(() => {
          intervalCount++;
          clearTimeout(handle);
          resolve();
        }, 5);
      });
      const cross = setTimeout(() => {
        cancelledRan = true;
      }, 5);
      clearInterval(cross);
      await fs.writeFile(
        path.join(output, kind + ".json"),
        JSON.stringify({ durable: true, kind }),
      );
      if (kind === "assertion") assert.fail("Synthetic assertion failure");
      return 42;
    });
    assert.equal(result, 42);
  } catch (error) {
    assert.equal(kind, "assertion");
    assert.match(errorMessage(error), /Synthetic assertion failure/);
    process.exitCode = 1;
  }
  assert.equal(globalThis.setTimeout, original.setTimeout);
  assert.equal(globalThis.clearTimeout, original.clearTimeout);
  assert.equal(globalThis.setInterval, original.setInterval);
  assert.equal(globalThis.clearInterval, original.clearInterval);
  assert.deepEqual(
    Object.getOwnPropertyDescriptor(globalThis, "chrome"),
    original.chrome,
  );
  assert.deepEqual(
    Object.getOwnPropertyDescriptor(globalThis, "browser"),
    original.browser,
  );
  await foreign;
  assert.equal(callbackRan, true);
  assert.equal(cancelledRan, false);
  assert.equal(intervalCount, 1);
  await writeResult({
    correctness: "PASS",
    kind,
    restored: true,
    nativeHandle: true,
    foreignTimerPreserved: true,
  });
} else {
  test("fixture lifecycle and bounded runner: synthetic children only", async () => {
    assert.ok(output, "Explicit task-owned output required");
    await fs.mkdir(output, { recursive: true });
    const plan = record(
      JSON.parse(
        await fs.readFile(
          string(process.env["BENCHMARK_LIFECYCLE_PLAN"]),
          "utf8",
        ),
      ) as unknown,
    );
    const dependencyRoot = string(plan["dependencyRoot"]);
    type ChildResult = {
      name: string;
      args: string[];
      code: number | null;
      signal: NodeJS.Signals | null;
      timedOut: boolean;
      elapsedMs: number;
      stdout: string;
      stderr: string;
    };
    const records: ChildResult[] = [];
    async function child(name: string, args: string[]): Promise<ChildResult> {
      const started = Date.now();
      let stdout = "",
        stderr = "",
        timedOut = false;
      const proc = spawn(process.execPath, args, {
        windowsHide: true,
        shell: false,
        env: process.env,
      });
      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill();
      }, 20000);
      proc.stdout.on("data", (b) => (stdout += b));
      proc.stderr.on("data", (b) => (stderr += b));
      let outcome;
      try {
        outcome = await new Promise<{
          code: number | null;
          signal: NodeJS.Signals | null;
        }>((resolve, reject) => {
          proc.once("error", reject);
          proc.once("close", (code, signal) => resolve({ code, signal }));
        });
      } finally {
        clearTimeout(timer);
      }
      await fs.writeFile(path.join(output, name + ".stdout.log"), stdout);
      await fs.writeFile(path.join(output, name + ".stderr.log"), stderr);
      const row = {
        name,
        args,
        ...outcome,
        timedOut,
        elapsedMs: Date.now() - started,
        stdout,
        stderr,
      };
      records.push(row);
      assert.equal(timedOut, false, name + " timed out");
      return row;
    }
    try {
      for (const kind of ["normal", "assertion"]) {
        const row = await child(kind, [
          fileURLToPath(import.meta.url),
          "--lifecycle-child",
          kind,
        ]);
        assert.equal(row.code, kind === "normal" ? 0 : 1);
        assert.equal(
          record(JSON.parse(row.stdout) as unknown)["restored"],
          true,
        );
        assert.equal(
          record(
            JSON.parse(
              await fs.readFile(path.join(output, kind + ".json"), "utf8"),
            ) as unknown,
          )["durable"],
          true,
        );
      }
      const roots = [];
      for (const kind of ["success", "failure"]) {
        const dir = path.join(output, kind);
        await fs.mkdir(path.join(dir, "src"), { recursive: true });
        const source =
          'globalThis.chrome.action.onClicked.addListener(async()=>{ setTimeout(()=>{throw new Error("uncleared synthetic timer");},300000);' +
          (kind === "failure"
            ? "await globalThis.chrome.tabs.remove([0]);"
            : "") +
          "});";
        await fs.writeFile(path.join(dir, "src/background.ts"), source);
        roots.push({
          label: kind === "success" ? "baseline" : "final",
          path: dir,
          expected: { "src/background.ts": sha(source) },
        });
        const row = await child("benchmark-" + kind, [
          "--expose-gc",
          "--max-old-space-size=384",
          path.join(here, "order-and-actions.ts"),
          "duplicates",
          "100",
          "chrome",
          dir,
          dependencyRoot,
        ]);
        assert.equal(row.code, kind === "success" ? 0 : 1);
        const value = record(JSON.parse(row.stdout) as unknown);
        assert.equal(
          value["correctness"],
          kind === "success" ? "PASS" : "FAIL",
        );
        if (kind === "failure")
          assert.match(
            string(value["error"]),
            /Duplicate survivor policy changed/,
          );
        else assert.equal(value["remainingTabs"], 100);
      }
      const marker = path.join(output, "runner-starts.txt");
      const fixture = path.join(output, "synthetic-runner-fixture.mjs");
      const source =
        'import fs from "node:fs/promises";await fs.appendFile(' +
        JSON.stringify(marker) +
        ',"started\\n");console.log(JSON.stringify({correctness:"FAIL",node:process.version,peakRSSBytes:1}));process.exitCode=1;';
      await fs.writeFile(fixture, source);
      const selectedSamples = [0, 1].map((sample) => ({
        label: "baseline",
        scenario: "duplicates",
        browser: "chrome",
        size: 100,
        sample,
      }));
      const synthetic = {
        ...plan,
        roots,
        fixture,
        fixtureSHA256: sha(source),
        out: path.join(output, "runner-output"),
        selectedSamples,
      };
      const planFile = path.join(output, "synthetic-plan.json");
      await fs.writeFile(planFile, JSON.stringify(synthetic));
      const row = await child("runner-first-failure", [
        path.join(here, "run-comparison.ts"),
        "--execute",
        planFile,
      ]);
      assert.equal(row.code, 1);
      const result = record(
        JSON.parse(
          await fs.readFile(path.join(synthetic.out, "result.json"), "utf8"),
        ) as unknown,
      );
      assert.equal(result["status"], "FAIL");
      assert.equal(array(result["records"]).length, 1);
      assert.equal(result["remainingNotRun"], 1);
      assert.equal(result["inputsUnchanged"], true);
      assert.equal(
        record(result["cleanup"])["allStartedDirectChildClosesCollected"],
        true,
      );
      assert.equal(
        (await fs.readFile(marker, "utf8")).split("started").length - 1,
        1,
      );
      assert.equal(record(result["selection"])["scheduled"], 2);
      await fs.writeFile(
        path.join(output, "local-result.json"),
        JSON.stringify(
          {
            status: "PASS",
            scope: "Synthetic only; no actual product comparison",
            records,
          },
          null,
          2,
        ),
      );
    } catch (error) {
      await fs.writeFile(
        path.join(output, "local-result.json"),
        JSON.stringify(
          { status: "FAIL", error: errorStack(error), records },
          null,
          2,
        ),
      );
      throw error;
    }
  });
}
