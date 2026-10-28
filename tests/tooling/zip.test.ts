import { record, string } from "../../scripts/runtime-boundaries.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  stat,
} from "node:fs/promises";
import { inflateRawSync, crc32 } from "node:zlib";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { packageBrowser, runZips } from "../../scripts/distribution/zip.ts";
function requiredFile(files: Map<string, Buffer>, name: string): Buffer {
  const value = files.get(name);
  assert.ok(value, name);
  return value;
}
const repository = fileURLToPath(new URL("../../", import.meta.url));
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ohmytab-zip-"));
  await mkdir(path.join(root, "public"));
  for (const browser of ["chrome", "firefox"]) {
    const manifest = record(
      JSON.parse(
        await readFile(
          path.join(repository, "public", browser + ".json"),
          "utf8",
        ),
      ) as unknown,
    );
    await writeFile(
      path.join(root, "public", browser + ".json"),
      JSON.stringify(manifest),
    );
    const assets: Record<string, string | Buffer> = {
      "manifest.json": JSON.stringify(manifest),
      "background.mjs": "export const target=" + JSON.stringify(browser),
      "options.mjs": 'console.log("options")',
      "options.html": '<script src="options.mjs"></script>',
      "preview.mjs": 'console.log("preview")',
      "preview.html": '<script src="preview.mjs"></script>',
      "undo.mjs": 'console.log("undo")',
      "undo.html": '<script src="undo.mjs"></script>',
      "_locales/en/messages.json": '{"name":{"message":"Portable ZIP"}}',
      "_locales/ja/messages.json": '{"name":{"message":"日本語"}}',
      "_locales/zh_CN/messages.json": '{"name":{"message":"中文"}}',
    };
    for (const icon of new Set([
      ...Object.values(record(manifest["icons"])),
      ...Object.values(
        record(
          record(manifest["action"] ?? {})["default_icon"] ??
            record(manifest["browser_action"] ?? {})["default_icon"] ??
            {},
        ),
      ),
    ]))
      assets[string(icon)] = Buffer.from([0, 1, 2, 3]);
    for (const [name, value] of Object.entries(assets)) {
      if (name.startsWith("_locales/")) {
        const source = path.join(root, "public", name);
        await mkdir(path.dirname(source), { recursive: true });
        await writeFile(source, value);
      }
      const filename = path.join(root, "dist_" + browser, name);
      await mkdir(path.dirname(filename), { recursive: true });
      await writeFile(filename, value);
    }
  }
  return root;
}
// Independent structural assertions read the central directory, then local payloads.
// Windows also consumes the actual candidate via the platform ZIP reader; browser
// installation of the fixed archives is a separate C01 obligation.
function entries(zip: Buffer) {
  const end = zip.length - 22;
  assert.equal(zip.readUInt32LE(end), 0x06054b50);
  const count = zip.readUInt16LE(end + 10),
    size = zip.readUInt32LE(end + 12),
    offset = zip.readUInt32LE(end + 16);
  assert.equal(offset + size, end);
  let cursor = offset;
  const result = new Map<string, Buffer>();
  for (let n = 0; n < count; n++) {
    assert.equal(zip.readUInt32LE(cursor), 0x02014b50);
    assert.equal(zip.readUInt16LE(cursor + 8), 0x800);
    assert.equal(zip.readUInt16LE(cursor + 10), 8);
    const compressed = zip.readUInt32LE(cursor + 20),
      length = zip.readUInt32LE(cursor + 24),
      namesize = zip.readUInt16LE(cursor + 28),
      extra = zip.readUInt16LE(cursor + 30),
      comment = zip.readUInt16LE(cursor + 32),
      local = zip.readUInt32LE(cursor + 42);
    const name = zip
      .subarray(cursor + 46, cursor + 46 + namesize)
      .toString("utf8");
    assert.equal(zip.readUInt32LE(local), 0x04034b50);
    assert.equal(
      zip
        .subarray(local + 30, local + 30 + zip.readUInt16LE(local + 26))
        .toString("utf8"),
      name,
    );
    const start =
        local +
        30 +
        zip.readUInt16LE(local + 26) +
        zip.readUInt16LE(local + 28),
      data = inflateRawSync(zip.subarray(start, start + compressed));
    assert.equal(data.length, length);
    assert.equal(crc32(data), zip.readUInt32LE(cursor + 16));
    assert.ok(!result.has(name));
    result.set(name, data);
    cursor += 46 + namesize + extra + comment;
  }
  assert.equal(cursor, end);
  return result;
}
for (const browser of ["chrome", "firefox"])
  test(
    browser +
      " ZIP auto-creates output and includes only root manifest/runtime assets",
    async () => {
      const root = await fixture();
      try {
        for (const name of [
          "chrome.json",
          "firefox.json",
          "background.mjs.map",
          "package.json",
          "README.md",
          "secret.env",
        ])
          await writeFile(path.join(root, "dist_" + browser, name), "excluded");
        await writeFile(
          path.join(root, "dist_" + browser, "image/dev.png"),
          "excluded",
        );
        await mkdir(path.join(root, "dist_" + browser, "_locales/dev"));
        await writeFile(
          path.join(root, "dist_" + browser, "_locales/dev/messages.json"),
          "excluded",
        );
        await mkdir(path.join(root, "dist_" + browser, "src"));
        await writeFile(
          path.join(root, "dist_" + browser, "src/dev.ts"),
          "excluded",
        );
        const filename = await packageBrowser(browser, root),
          zip = await readFile(filename),
          files = entries(zip);
        assert.deepEqual(
          JSON.parse(
            requiredFile(files, "manifest.json").toString(),
          ) as unknown,
          JSON.parse(
            await readFile(
              path.join(root, "public", browser + ".json"),
              "utf8",
            ),
          ) as unknown,
        );
        assert.equal(files.has("image/dev.png"), false);
        assert.equal(files.has("_locales/dev/messages.json"), false);
        assert.equal(files.has("options.html"), true);
        assert.equal(files.has("background.mjs"), true);
        assert.equal(files.has("options.mjs"), true);
        assert.equal(
          requiredFile(files, "_locales/ja/messages.json").toString(),
          '{"name":{"message":"日本語"}}',
        );
        for (const name of files.keys()) {
          assert.match(
            name,
            /^(manifest\.json|background\.mjs|options\.mjs|options\.html|preview\.mjs|preview\.html|undo\.mjs|undo\.html|image\/[^/]+\.png|_locales\/[^/]+\/messages\.json)$/,
          );
          assert.deepEqual(
            files.get(name),
            await readFile(path.join(root, "dist_" + browser, name)),
          );
        }
        const again = await packageBrowser(browser, root);
        assert.deepEqual(await readFile(again), zip);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
test("missing assets and wrong browser manifest fail before replacing an existing archive", async () => {
  const root = await fixture();
  try {
    const output = await packageBrowser("chrome", root),
      good = await readFile(output);
    await rm(path.join(root, "dist_chrome/options.mjs"));
    assert.equal(await runZips(["chrome", "firefox"], root), 1);
    assert.deepEqual(await readFile(output), good);
    await assert.rejects(stat(path.join(root, "dist/firefox.zip")), {
      code: "ENOENT",
    });
    await writeFile(path.join(root, "dist_chrome/options.mjs"), "restored");
    await writeFile(
      path.join(root, "dist_chrome/manifest.json"),
      await readFile(path.join(root, "public/firefox.json")),
    );
    await assert.rejects(
      packageBrowser("chrome", root),
      /does not match chrome/,
    );
    assert.deepEqual(await readFile(output), good);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("second-browser validation failure propagates and valid first archive remains readable", async () => {
  const root = await fixture();
  try {
    await rm(path.join(root, "dist_firefox/image/icon16.png"));
    assert.equal(await runZips(["chrome", "firefox"], root), 1);
    assert.equal(
      entries(await readFile(path.join(root, "dist/chrome.zip"))).has(
        "manifest.json",
      ),
      true,
    );
    await assert.rejects(stat(path.join(root, "dist/firefox.zip")), {
      code: "ENOENT",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("output creation error and invalid target return nonzero without choosing arbitrary paths", async () => {
  const root = await fixture();
  try {
    await writeFile(path.join(root, "dist"), "blocked");
    assert.equal(await runZips(["chrome"], root), 1);
    assert.equal(await runZips(["../outside"], root), 1);
    assert.equal(await runZips([], root), 1);
    assert.equal(await readFile(path.join(root, "dist"), "utf8"), "blocked");
    const result = spawnSync(
      process.execPath,
      [path.join(repository, "scripts/distribution/zip.ts"), "../outside"],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Select chrome, firefox, or all/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("ZIP npm scripts use the declared Node route, without OS zip or shell directory changes", async () => {
  const pkg = record(
    record(
      JSON.parse(
        await readFile(path.join(repository, "package.json"), "utf8"),
      ) as unknown,
    )["scripts"],
  );
  assert.equal(pkg["zip"], "node scripts/distribution/zip.ts all");
  assert.equal(pkg["zip-chrome"], "node scripts/distribution/zip.ts chrome");
  assert.equal(pkg["zip-firefox"], "node scripts/distribution/zip.ts firefox");
});

test("a missing non-default source locale is a release failure", async () => {
  const root = await fixture();
  try {
    await rm(path.join(root, "dist_firefox/_locales/ja/messages.json"));
    await assert.rejects(
      packageBrowser("firefox", root),
      /Missing release asset: _locales\/ja\/messages.json/,
    );
    await assert.rejects(stat(path.join(root, "dist/firefox.zip")), {
      code: "ENOENT",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
