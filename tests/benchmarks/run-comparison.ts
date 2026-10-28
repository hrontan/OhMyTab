import { parsePlan } from "./plan.ts";
import type { Cell, Selection } from "./plan.ts";
import {
  record,
  number,
  errorMessage,
  errorStack,
} from "../../scripts/runtime-boundaries.ts";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
export async function runComparison(planFile: string) {
  const plan = parsePlan(
    JSON.parse(await fs.readFile(path.resolve(planFile), "utf8")) as unknown,
  );
  if (
    plan.bounds.timeoutMilliseconds !== 20000 ||
    plan.bounds.maxOldSpaceMiB !== 384 ||
    plan.bounds.peakRSSMiB !== 768
  )
    throw new Error("Fixed benchmark bounds changed");
  if (
    plan.samples !== 3 ||
    JSON.stringify(plan.sizes) !== JSON.stringify([100, 1000, 5000])
  )
    throw new Error("Fixed sample matrix changed");
  if (!Array.isArray(plan.selectedSamples) || !plan.selectedSamples.length)
    throw new Error(
      "Explicit selectedSamples required; no automatic full comparison",
    );
  const sha = (b: string | Buffer) =>
    crypto.createHash("sha256").update(b).digest("hex");
  const workspace = await fs.realpath(plan.workspace);
  const inside = (p: string) => {
    const rel = path.relative(workspace, p);
    if (rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel))
      throw new Error("Path outside task workspace");
    return p;
  };
  for (const p of [
    plan.fixture,
    plan.node,
    plan.dependencyRoot,
    ...plan.roots.map((r) => r.path),
  ])
    inside(await fs.realpath(p));
  inside(path.resolve(plan.out));
  if (process.version !== plan.expectedNode)
    throw new Error("Runner Node version differs from approved pair");
  if (
    (await fs.realpath(process.execPath)).toLowerCase() !==
    (await fs.realpath(plan.node)).toLowerCase()
  )
    throw new Error("Runner executable differs from selected Node");
  if (sha(await fs.readFile(plan.fixture)) !== plan.fixtureSHA256)
    throw new Error("Reviewed fixture SHA mismatch");
  for (const d of plan.dependencyPackages) {
    const b = await fs.readFile(
      path.join(plan.dependencyRoot, d.path, "package.json"),
    );
    if (
      sha(b) !== d.packageJSONSHA256 ||
      record(JSON.parse(b.toString()) as unknown)["version"] !==
        d.installedVersion
    )
      throw new Error("Dependency metadata changed: " + d.path);
  }
  async function inputs() {
    const rows = [];
    for (const r of plan.roots)
      for (const [name, expected] of Object.entries(r.expected)) {
        const file = inside(await fs.realpath(path.join(r.path, name)));
        const actual = sha(await fs.readFile(file));
        rows.push({
          label: r.label,
          path: name,
          expected,
          actual,
          equal: expected === actual,
        });
      }
    return rows;
  }
  const before = await inputs();
  if (before.some((x) => !x.equal))
    throw new Error("Pair input mismatch before measurement");
  await fs.mkdir(plan.out, { recursive: true });
  inside(await fs.realpath(plan.out));
  if (
    await fs.stat(path.join(plan.out, "result.json")).then(
      () => true,
      () => false,
    )
  )
    throw new Error("Output already exists; preserve old evidence");
  const result: {
    planSHA256: string;
    fixtureSHA256: string;
    environment: {
      node: string;
      execPath: string;
      platform: string;
      arch: string;
    };
    before: Awaited<ReturnType<typeof inputs>>;
    records: Awaited<ReturnType<typeof run>>[];
    status: string;
    retry: number;
    selection?: {
      scheduled: number;
      total: number;
      notSelected: Selection[];
      claim: string;
    };
    remainingNotRun?: number;
    comparison?: Record<string, unknown>[];
    after?: Awaited<ReturnType<typeof inputs>>;
    inputsUnchanged?: boolean;
    cleanup?: {
      allStartedDirectChildClosesCollected: boolean;
      liveHandles: never[];
      network: boolean;
      installs: boolean;
      sourceEdits: boolean;
    };
  } = {
    planSHA256: sha(await fs.readFile(planFile)),
    fixtureSHA256: plan.fixtureSHA256,
    environment: {
      node: process.version,
      execPath: process.execPath,
      platform: process.platform,
      arch: process.arch,
    },
    before,
    records: [],
    status: "IN_PROGRESS",
    retry: 0,
  };
  await fs.writeFile(
    path.join(plan.out, "result.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  const fullCells: Cell[] = [];
  for (const r of plan.roots)
    for (const c of plan.cases)
      for (const size of plan.sizes)
        for (let sample = 0; sample < plan.samples; sample++)
          fullCells.push({ root: r, ...c, size, sample });
  const cellKey = (c: Cell | Selection) =>
    [
      "label" in c ? c.label : c.root.label,
      c.scenario,
      c.browser,
      c.size,
      c.sample,
    ].join("-");
  const selected = new Set(plan.selectedSamples.map(cellKey));
  if (selected.size !== plan.selectedSamples.length)
    throw new Error("Duplicate selected sample");
  const cells = plan.selectedSamples.map((selection) => {
    const cell = fullCells.find((c) => cellKey(c) === cellKey(selection));
    if (!cell) throw new Error("Selected sample outside fixed matrix");
    return cell;
  });
  result.selection = {
    scheduled: cells.length,
    total: fullCells.length,
    notSelected: fullCells
      .filter((c) => !selected.has(cellKey(c)))
      .map((c) => ({
        label: c.root.label,
        scenario: c.scenario,
        browser: c.browser,
        size: c.size,
        sample: c.sample,
      })),
    claim: "Not-selected samples are NOT_RUN here, not inferred REUSED",
  };
  async function run(cell: Cell) {
    const command = [
      plan.node,
      "--expose-gc",
      "--max-old-space-size=" + plan.bounds.maxOldSpaceMiB,
      plan.fixture,
      cell.scenario,
      String(cell.size),
      cell.browser,
      cell.root.path,
      plan.dependencyRoot,
    ];
    const started = new Date().toISOString();
    let stdout = "",
      stderr = "",
      timedOut = false,
      overflow = false,
      spawnError: string | null = null;
    const child = spawn(plan.node, command.slice(1), {
      cwd: cell.root.path,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stop = () => {
      if (child.exitCode === null && child.signalCode === null) child.kill();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, plan.bounds.timeoutMilliseconds);
    child.stdout.on("data", (b) => {
      stdout += b.toString();
      if (Buffer.byteLength(stdout) > 16 * 1024 * 1024) {
        overflow = true;
        stop();
      }
    });
    child.stderr.on("data", (b) => {
      stderr += b.toString();
      if (Buffer.byteLength(stderr) > 16 * 1024 * 1024) {
        overflow = true;
        stop();
      }
    });
    const exit = await new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
    }>((resolve) => {
      child.once("error", (e) => {
        spawnError = e.message;
      });
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
    clearTimeout(timer);
    const name = [
      cell.root.label,
      cell.scenario,
      cell.browser,
      cell.size,
      cell.sample,
    ].join("-");
    await fs.writeFile(path.join(plan.out, name + ".stdout.json"), stdout);
    await fs.writeFile(path.join(plan.out, name + ".stderr.log"), stderr);
    let measurement: Record<string, unknown> | null = null,
      parseError: string | null = null;
    try {
      measurement = record(JSON.parse(stdout) as unknown);
    } catch (e) {
      parseError = errorMessage(e);
    }
    const valid =
      !spawnError &&
      !timedOut &&
      !overflow &&
      exit.code === 0 &&
      measurement?.["correctness"] === "PASS" &&
      measurement["node"] === plan.expectedNode &&
      typeof measurement["peakRSSBytes"] === "number" &&
      measurement["peakRSSBytes"] <= plan.bounds.peakRSSMiB * 1024 * 1024;
    return {
      label: cell.root.label,
      scenario: cell.scenario,
      browser: cell.browser,
      size: cell.size,
      sample: cell.sample,
      command,
      started,
      ended: new Date().toISOString(),
      ownedNodePID: child.pid,
      exit,
      timedOut,
      overflow,
      spawnError,
      parseError,
      status: valid ? "PASS" : "FAIL",
      stdout: name + ".stdout.json",
      stdoutSHA256: sha(stdout),
      stderr: name + ".stderr.log",
      stderrSHA256: sha(stderr),
      measurement,
      cleanup: {
        ownedChildCloseCollected: true,
        timeoutCleared: true,
        shell: false,
        descendantProcessCreation:
          "Fixture and mocked product API contain no child spawn; only directly owned Node is terminated on timeout",
      },
    };
  }
  try {
    for (const cell of cells) {
      const row = await run(cell);
      result.records.push(row);
      await fs.writeFile(
        path.join(plan.out, "result.json"),
        JSON.stringify(result, null, 2) + "\n",
      );
      if (row.status !== "PASS") {
        result.status = "FAIL";
        result.remainingNotRun = cells.length - result.records.length;
        break;
      }
    }
    if (
      result.records.length === cells.length &&
      result.records.every((r) => r.status === "PASS")
    ) {
      result.status = "PASS";
      if (cells.length === fullCells.length) {
        const median = (a: number[]) => {
          const s = [...a].sort((a, b) => a - b);
          const value = s[Math.floor(s.length / 2)];
          if (value === undefined) throw new Error("Empty sample");
          return value;
        };
        result.comparison = [];
        for (const c of plan.cases)
          for (const size of plan.sizes) {
            const rows = (label: string) =>
              result.records
                .filter(
                  (r) =>
                    r.label === label &&
                    r.scenario === c.scenario &&
                    r.browser === c.browser &&
                    r.size === size,
                )
                .map((r) => record(r.measurement));
            const a = rows("baseline"),
              b = rows("final");
            result.comparison.push({
              ...c,
              size,
              samplesEach: 3,
              baselineMedianMs: median(a.map((r) => number(r["elapsedMs"]))),
              finalMedianMs: median(b.map((r) => number(r["elapsedMs"]))),
              baselineMaxRSSBytes: Math.max(
                ...a.map((r) => number(r["peakRSSBytes"])),
              ),
              finalMaxRSSBytes: Math.max(
                ...b.map((r) => number(r["peakRSSBytes"])),
              ),
              baselineMedianHeapDeltaBytes: median(
                a.map((r) => number(r["heapDeltaBytes"])),
              ),
              finalMedianHeapDeltaBytes: median(
                b.map((r) => number(r["heapDeltaBytes"])),
              ),
              baselineAPI: a.map((r) => r["calls"]),
              finalAPI: b.map((r) => r["calls"]),
              baselineRemaining: a.map((r) => r["remainingTabs"]),
              finalRemaining: b.map((r) => r["remainingTabs"]),
              baselineMoves: a.map((r) => r["plannedMoves"]),
              finalMoves: b.map((r) => r["plannedMoves"]),
              claim:
                "Same new environment only, disclose deterioration and added final session/undo overhead; no CI timing threshold",
            });
          }
      }
    }
  } finally {
    result.after = await inputs();
    result.inputsUnchanged = result.after.every((x) => x.equal);
    if (!result.inputsUnchanged) result.status = "FAIL";
    result.cleanup = {
      allStartedDirectChildClosesCollected: true,
      liveHandles: [],
      network: false,
      installs: false,
      sourceEdits: false,
    };
    await fs.writeFile(
      path.join(plan.out, "result.json"),
      JSON.stringify(result, null, 2) + "\n",
    );
  }
  if (result.status !== "PASS") process.exitCode = 1;
  return result;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const args = process.argv.slice(2);
    if (args[0] !== "--execute" || !args[1])
      throw new Error(
        "Root-reviewed explicit --execute and plan path required",
      );
    await runComparison(args[1]);
  } catch (error) {
    console.error(errorStack(error));
    process.exitCode = 1;
  }
}
