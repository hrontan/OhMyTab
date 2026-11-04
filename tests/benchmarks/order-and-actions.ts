// Run only through a bounded external runner; measurements are not CI thresholds.
import type { InlineConfig, build as viteBuild } from "vite";
import {
  record,
  loader,
  errorMessage,
  errorStack,
} from "../../scripts/runtime-boundaries.ts";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import process from "node:process";
import { performance } from "node:perf_hooks";
import { createRequire } from "node:module";

import { fileURLToPath, pathToFileURL } from "node:url";

// Track only timers created inside this fixture; callbacks and native handles pass through.
export async function withFixtureLifecycle<T>(
  work: () => T | Promise<T>,
): Promise<T> {
  const names = [
    "setTimeout",
    "clearTimeout",
    "setInterval",
    "clearInterval",
    "chrome",
    "browser",
  ];
  const saved = new Map(
    names.map((name) => [
      name,
      Object.getOwnPropertyDescriptor(globalThis, name),
    ]),
  );
  const original = { setTimeout, clearTimeout, setInterval, clearInterval };
  const timeouts = new Set<ReturnType<typeof setTimeout>>(),
    intervals = new Set<ReturnType<typeof setInterval>>();
  Object.defineProperty(globalThis, "setTimeout", {
    configurable: true,
    writable: true,
    value: function (this: unknown, ...args: Parameters<typeof setTimeout>) {
      const handle: ReturnType<typeof setTimeout> = Reflect.apply(
        original.setTimeout,
        this,
        args,
      );
      timeouts.add(handle);
      return handle;
    },
  });
  Object.defineProperty(globalThis, "setInterval", {
    configurable: true,
    writable: true,
    value: function (this: unknown, ...args: Parameters<typeof setInterval>) {
      const handle: ReturnType<typeof setInterval> = Reflect.apply(
        original.setInterval,
        this,
        args,
      );
      intervals.add(handle);
      return handle;
    },
  });
  globalThis.clearTimeout = function (
    this: unknown,
    ...args: Parameters<typeof clearTimeout>
  ) {
    if (typeof args[0] === "object" && args[0] !== null) {
      timeouts.delete(args[0]);
      intervals.delete(args[0]);
    }
    return Reflect.apply(original.clearTimeout, this, args);
  };
  globalThis.clearInterval = function (
    this: unknown,
    ...args: Parameters<typeof clearInterval>
  ) {
    if (typeof args[0] === "object" && args[0] !== null) {
      timeouts.delete(args[0]);
      intervals.delete(args[0]);
    }
    return Reflect.apply(original.clearInterval, this, args);
  };
  try {
    return await work();
  } finally {
    try {
      for (const handle of timeouts)
        Reflect.apply(original.clearTimeout, globalThis, [handle]);
      for (const handle of intervals)
        Reflect.apply(original.clearInterval, globalThis, [handle]);
    } finally {
      for (const name of names) {
        const descriptor = saved.get(name);
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
    }
  }
}

export const writeResult = (
  value: unknown,
  stream: Pick<NodeJS.WriteStream, "write"> = process.stdout,
) =>
  new Promise<void>((resolve, reject) => {
    stream.write(JSON.stringify(value) + "\n", (error) =>
      error ? reject(error) : resolve(),
    );
  });

export async function runBenchmark(args = process.argv.slice(2)) {
  const root = path.resolve(args[3] ?? process.cwd());
  const dependencyRoot = path.resolve(args[4] ?? root);
  const require = createRequire(path.join(dependencyRoot, "package.json"));
  const vite = record(
    (await import(pathToFileURL(require.resolve("vite")).href)) as unknown,
  );
  if (
    typeof vite["build"] !== "function" ||
    typeof vite["version"] !== "string"
  )
    throw new Error("Invalid Vite exports");
  const build = vite["build"] as typeof viteBuild,
    viteVersion = vite["version"];
  const ifdefLoader = loader(require("ifdef-loader") as unknown);
  const [scenario, sizeString, browser = "chrome"] = args;
  const size = Number(sizeString);
  if (
    ![100, 1000, 5000].includes(size) ||
    !["order", "duplicates", "groups"].includes(scenario ?? "")
  )
    throw new Error("Invalid benchmark fixture");
  if (browser !== "chrome" && browser !== "firefox")
    throw new Error("Invalid browser branch");
  if (scenario === "groups" && browser !== "chrome")
    throw new Error("Grouping is Chrome-only");
  const digest = (value: string) =>
    crypto.createHash("sha256").update(value).digest("hex");
  const sourceHashes: Record<string, string> = {},
    modules = new Map<string, { exports: unknown }>();
  const nestedLayout = fs.existsSync(
    path.join(root, "src", "background", "background.ts"),
  );
  async function load(filename: string): Promise<unknown> {
    const canonical = path.resolve(
      filename.endsWith(".ts") ? filename : filename + ".ts",
    );
    const cached = modules.get(canonical);
    if (cached) return cached.exports;
    const output = await build({
      configFile: false,
      root,
      publicDir: false,
      logLevel: "silent",
      plugins: [
        {
          name: "benchmark-browser-source",
          transform(source, id) {
            if (!id.endsWith(".ts")) return;
            sourceHashes[path.relative(root, id).split(path.sep).join("/")] =
              digest(source);
            let preprocessed: string | undefined;
            ifdefLoader.call(
              {
                query: { BROWSER: browser },
                callback(error, code) {
                  if (error) throw error;
                  preprocessed = code;
                },
              },
              source,
            );
            if (preprocessed === undefined)
              throw new Error("ifdef-loader did not call back synchronously");
            return { code: preprocessed, map: null };
          },
        },
      ],
      build: {
        target: "es2022",
        write: false,
        minify: false,
        lib: { entry: canonical, formats: ["cjs"] },
        rolldownOptions: {
          treeshake: false,
          external: (id) => !id.startsWith(".") && !path.isAbsolute(id),
        },
      },
    } satisfies InlineConfig);
    const chunks = (Array.isArray(output) ? output : [output])
      .flatMap((result) => {
        if (!("output" in result)) throw new Error("Unexpected Vite watcher");
        return result.output;
      })
      .filter((item) => item.type === "chunk");
    if (chunks.length !== 1)
      throw new Error("Benchmark fixture must produce one CommonJS module");
    const chunk = chunks[0];
    if (!chunk) throw new Error("Missing CommonJS chunk");
    const code = chunk.code;
    const module: { exports: unknown } = { exports: {} };
    modules.set(canonical, module);
    new Function("require", "module", "exports", code)(
      require,
      module,
      module.exports,
    );
    return module.exports;
  }

  const calls: Record<string, number> = {};
  const count = <T = undefined>(name: string, value?: T): T | undefined => {
    calls[name] = (calls[name] ?? 0) + 1;
    return value;
  };
  const ids = Array.from({ length: size }, (_, index) => index);
  let tabs = ids.map((id) => ({
    id,
    windowId: 1,
    index: id,
    pinned: false,
    active: id === 0,
    discarded: false,
    incognito: false,
    ...(browser === "firefox" ? { cookieStoreId: "firefox-default" } : {}),
    groupId: -1,
    url: `https://example.com/item/${id % 100}`,
    title: String(id),
  }));
  const data = {
    glue: false,
    depclean: scenario === "duplicates",
    sorttab: false,
    refresh: false,
    comclose: false,
    closelocal: false,
    rxclose: false,
    urlmatch: false,
    grouping: scenario === "groups",
    grouping_min: 4,
    iconbadge: false,
    currentonly: false,
    preview_before: false,
    protect_domains: "",
    protect_audible: false,
    protect_groups: false,
    duplicate_keep: "last",
  };
  const event = () => ({ addListener() {} });
  let action: (() => unknown) | undefined;
  const area = (name: string, values: Record<string, unknown>) => ({
    get(
      defaults: string[] | Record<string, unknown>,
      callback?: (value: Record<string, unknown>) => void,
    ) {
      const value = Array.isArray(defaults)
        ? Object.fromEntries(
            defaults
              .filter((key) => Object.hasOwn(values, key))
              .map((key) => [key, values[key]]),
          )
        : { ...defaults, ...values };
      const result = count(
        name === "sync" ? "storage.get" : "storage." + name + ".get",
        structuredClone(value),
      );
      if (callback) {
        callback(result ?? {});
        return;
      }
      return Promise.resolve(result);
    },
    set(patch: Record<string, unknown>, callback?: () => void) {
      count("storage." + name + ".set");
      Object.assign(values, structuredClone(patch));
      if (callback) {
        callback();
        return;
      }
      return Promise.resolve();
    },
    remove(keys: string[], callback?: () => void) {
      count("storage." + name + ".remove");
      for (const key of keys) delete values[key];
      if (callback) {
        callback();
        return;
      }
      return Promise.resolve();
    },
  });
  const storage = {
    sync: area("sync", data),
    local: area("local", {}),
    session: area("session", {}),
    onChanged: event(),
  };
  const api = {
    storage,
    tabs: {
      async query(q: {
        pinned?: boolean;
        active?: boolean;
        windowId?: number;
        groupId?: number;
      }) {
        count("tabs.query");
        return tabs
          .filter(
            (t) =>
              (q.pinned == null || t.pinned === q.pinned) &&
              (!q.active || t.active) &&
              (q.windowId == null || t.windowId === q.windowId) &&
              (q.groupId == null || t.groupId === q.groupId),
          )
          .map((t) => ({ ...t }));
      },
      async get(id: number) {
        count("tabs.get");
        const tab = tabs.find((item) => item.id === id);
        if (!tab) throw new Error("No fixture tab");
        return { ...tab };
      },
      async remove(values: number[]) {
        count("tabs.remove");
        const selected = new Set(values);
        tabs = tabs.filter((t) => !selected.has(t.id));
      },
      async move() {
        count("tabs.move");
      },
      async group(details: { tabIds: number[] }) {
        count("tabs.group");
        const selected = new Set(details.tabIds);
        for (const tab of tabs) if (selected.has(tab.id)) tab.groupId = 1;
        return 1;
      },
      async ungroup(values: number[]) {
        count("tabs.ungroup");
        const selected = new Set(values);
        for (const tab of tabs) if (selected.has(tab.id)) tab.groupId = -1;
      },
      onUpdated: event(),
      onCreated: event(),
      onMoved: event(),
      onDetached: event(),
      onAttached: event(),
      onRemoved: event(),
      onActivated: event(),
      onReplaced: event(),
    },
    windows: {
      async getLastFocused() {
        return count("windows.getLastFocused", {
          id: 1,
          type: "normal",
          incognito: false,
        });
      },
      async getAll() {
        return count("windows.getAll", [
          { id: 1, type: "normal", incognito: false },
        ]);
      },
      onFocusChanged: event(),
    },
    action: {
      onClicked: {
        addListener(callback: () => unknown) {
          action = callback;
        },
      },
      async setTitle() {
        count("action.setTitle");
      },
      async setBadgeText() {
        count("action.setBadgeText");
      },
      async setBadgeBackgroundColor() {
        count("action.setBadgeBackgroundColor");
      },
    },
    tabGroups: {
      async query() {
        count("tabGroups.query");
        return tabs.some((t) => t.groupId === 1)
          ? [{ id: 1, title: "example.com" }]
          : [];
      },
      async update() {
        count("tabGroups.update");
      },
      async move() {
        count("tabGroups.move");
      },
    },
    contextMenus: { onClicked: event() },
    commands: { onCommand: event() },
    runtime: {
      onInstalled: event(),
      onStartup: event(),
      onMessage: event(),
      getURL: (file: string) =>
        (browser === "chrome"
          ? "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"
          : "moz-extension://00000000-0000-4000-8000-000000000000/") + file,
    },
    i18n: { getMessage: (key: string) => key },
  };
  Reflect.set(globalThis, "chrome", api);
  Reflect.set(globalThis, "browser", api);
  const fixtureSHA256 = digest(
    JSON.stringify({
      ids,
      urls: tabs.map((t) => t.url),
      scenario,
      browser,
      data,
    }),
  );
  let compute: () => unknown;
  if (scenario === "order") {
    const { minMoveOperations } = record(
      await load(
        path.join(root, "src", nestedLayout ? "operations/lcs" : "lcs"),
      ),
    );
    if (typeof minMoveOperations !== "function")
      throw new Error("Missing minMoveOperations");
    compute = () => {
      const value: unknown = minMoveOperations(ids, [...ids].reverse());
      return value;
    };
  } else {
    await load(
      path.join(
        root,
        "src",
        nestedLayout ? "background/background" : "background",
      ),
    );
    compute = () => {
      if (!action) throw new Error("Missing action callback");
      return action();
    };
  }
  globalThis.gc?.();
  const memoryBefore = process.memoryUsage();
  const started = performance.now();
  const result: unknown = await compute();
  const elapsedMs = performance.now() - started;
  const memoryAfter = process.memoryUsage();
  let plannedMoves = null;
  if (scenario === "order") {
    if (!Array.isArray(result)) throw new Error("Expected move array");
    plannedMoves = result.length;
    if (plannedMoves !== size - 1) throw new Error("Move count changed");
    const current = [...ids];
    for (const value of result as unknown[]) {
      const op = record(value);
      if (
        typeof op["from"] !== "number" ||
        typeof op["to"] !== "number" ||
        typeof op["value"] !== "number"
      )
        throw new Error("Invalid move shape");
      if (current[op["from"]] !== op["value"] || op["from"] === op["to"])
        throw new Error("Invalid move");
      const removed = current.splice(op["from"], 1)[0];
      if (removed === undefined) throw new Error("Invalid move index");
      current.splice(op["to"], 0, removed);
    }
    if (JSON.stringify(current) !== JSON.stringify([...ids].reverse()))
      throw new Error("Incorrect order");
  } else if (scenario === "duplicates") {
    const expected = ids.filter((id) => id + 100 >= size);
    if (JSON.stringify(tabs.map((t) => t.id)) !== JSON.stringify(expected))
      throw new Error("Duplicate survivor policy changed");
  } else if (tabs.some((t) => t.groupId !== 1))
    throw new Error("Grouping changed");
  const peakRSSBytes = process.resourceUsage().maxRSS * 1024;
  if (peakRSSBytes > 768 * 1024 * 1024) throw new Error("RSS bound exceeded");
  await writeResult({
    scenario,
    size,
    browser,
    fixtureSHA256,
    sourceHashes,
    elapsedMs,
    heapDeltaBytes: memoryAfter.heapUsed - memoryBefore.heapUsed,
    heapBeforeBytes: memoryBefore.heapUsed,
    heapAfterBytes: memoryAfter.heapUsed,
    peakRSSBytes,
    plannedMoves,
    actualAPICalls: Object.values(calls).reduce((sum, n) => sum + n, 0),
    calls,
    remainingTabs: tabs.length,
    correctness: "PASS",
    node: process.version,
    vite: viteVersion,
    compilerOptions: {
      target: "ES2022",
      module: "CommonJS",
      preprocess: browser,
      minify: false,
      treeshake: false,
    },
    limits: { heapMiB: 384, RSSMiB: 768, timeoutSeconds: 20 },
  });
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    await withFixtureLifecycle(async () => {
      try {
        await runBenchmark();
      } catch (error) {
        await writeResult({
          correctness: "FAIL",
          error: errorMessage(error),
          node: process.version,
        });
        throw error;
      }
    });
  } catch (error) {
    console.error(errorStack(error));
    process.exitCode = 1;
  }
}
