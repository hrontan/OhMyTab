import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { crc32, deflateRawSync } from "node:zlib";
import { array, record, errorMessage } from "../runtime-boundaries.ts";
import type { Browser } from "../build/build-paths.ts";
import { isBrowser, browsers, projectRoot } from "../build/build-paths.ts";

// This release contains only these entry points and static asset directories.
// Do not recursively archive the build directory: stale development files may exist.
const runtimeAsset =
  /^(?:background\.mjs|options\.mjs|options\.html|preview\.mjs|preview\.html|undo\.mjs|undo\.html|image\/[^/]+\.(?:png|svg|ico)|_locales\/[^/]+\/messages\.json)$/;
async function releaseFiles(directory: string, prefix = "") {
  const files: string[] = [];
  for (const entry of await readdir(path.join(directory, prefix), {
    withFileTypes: true,
  })) {
    const name = prefix + entry.name;
    if (entry.isSymbolicLink())
      throw new Error("Symlink in release input: " + name);
    if (
      entry.isDirectory() &&
      (name === "image" ||
        name === "_locales" ||
        /^_locales\/[^/]+$/.test(name))
    ) {
      files.push(...(await releaseFiles(directory, name + "/")));
    } else if (entry.isFile() && runtimeAsset.test(name)) files.push(name);
  }
  return files.sort();
}
function localAsset(reference: unknown) {
  if (
    typeof reference !== "string" ||
    !reference ||
    reference.includes("\\") ||
    reference.startsWith("/") ||
    reference.split("/").includes("..") ||
    /^[a-z]+:/i.test(reference)
  ) {
    throw new Error("Invalid release asset reference: " + reference);
  }
  return reference;
}
async function validatedFiles(browser: Browser, root: string) {
  const directory = path.join(root, "dist_" + browser);
  if (!(await lstat(directory)).isDirectory())
    throw new Error("Build output must be a directory: " + directory);
  const manifestPath = path.join(directory, "manifest.json");
  if (!(await lstat(manifestPath)).isFile())
    throw new Error("Manifest must be a regular file");
  const manifestBytes = await readFile(manifestPath);
  const manifest = record(JSON.parse(manifestBytes.toString()) as unknown);
  const expected = JSON.parse(
    await readFile(path.join(root, "public", browser + ".json"), "utf8"),
  ) as unknown;
  if (JSON.stringify(manifest) !== JSON.stringify(expected))
    throw new Error("Build manifest does not match " + browser);
  const names = await releaseFiles(directory);
  const required = new Set([
    "background.mjs",
    "options.mjs",
    "options.html",
    "preview.mjs",
    "preview.html",
    "undo.mjs",
    "undo.html",
  ]);
  const add = (value: unknown) => {
    if (value) required.add(localAsset(value));
  };
  add(record(manifest["background"] ?? {})["service_worker"]);
  for (const value of array(
    record(manifest["background"] ?? {})["scripts"] ?? [],
  ))
    add(value);
  add(record(manifest["options_ui"] ?? {})["page"]);
  add(manifest["options_page"]);
  for (const value of Object.values(record(manifest["icons"] ?? {})))
    add(value);
  const icon =
    record(manifest["action"] ?? {})["default_icon"] ??
    record(manifest["browser_action"] ?? {})["default_icon"];
  for (const value of typeof icon === "string"
    ? [icon]
    : Object.values(record(icon ?? {})))
    add(value);
  if (manifest["default_locale"])
    required.add(
      "_locales/" + localAsset(manifest["default_locale"]) + "/messages.json",
    );
  for (const locale of await readdir(path.join(root, "public", "_locales"), {
    withFileTypes: true,
  })) {
    if (locale.isDirectory())
      required.add("_locales/" + localAsset(locale.name) + "/messages.json");
  }
  for (const name of names.filter((name) => name.endsWith(".html"))) {
    const html = await readFile(path.join(directory, name), "utf8");
    for (const match of html.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/gi))
      add(match[1]);
  }
  for (const name of required)
    if (!names.includes(name))
      throw new Error("Missing release asset: " + name);
  const files = [{ name: "manifest.json", data: manifestBytes }];
  for (const name of names.filter((name) => required.has(name)))
    files.push({ name, data: await readFile(path.join(directory, name)) });
  return files;
}

// Bounded classic ZIP, UTF-8 names, deflate, fixed 1980 timestamp for reproducibility.
// ZIP64, arbitrary directory archiving and extraction are deliberately outside this tool.
function releaseZip(files: { name: string; data: Buffer }[]) {
  if (files.length > 65535)
    throw new Error("Too many release files for classic ZIP");
  const chunks: Buffer[] = [],
    central: Buffer[] = [];
  let offset = 0;
  for (const { name, data } of files) {
    const filename = Buffer.from(name),
      compressed = deflateRawSync(data);
    if (
      filename.length > 65535 ||
      data.length > 0xffffffff ||
      compressed.length > 0xffffffff ||
      offset > 0xffffffff
    )
      throw new Error("Release exceeds classic ZIP limits");
    const checksum = crc32(data),
      header = Buffer.alloc(30),
      record = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(8, 8);
    header.writeUInt16LE(33, 12);
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(filename.length, 26);
    record.writeUInt32LE(0x02014b50);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0x800, 8);
    record.writeUInt16LE(8, 10);
    record.writeUInt16LE(33, 14);
    record.writeUInt32LE(checksum, 16);
    record.writeUInt32LE(compressed.length, 20);
    record.writeUInt32LE(data.length, 24);
    record.writeUInt16LE(filename.length, 28);
    record.writeUInt32LE(offset, 42);
    chunks.push(header, filename, compressed);
    central.push(record, filename);
    offset += header.length + filename.length + compressed.length;
  }
  const index = Buffer.concat(central),
    end = Buffer.alloc(22);
  if (offset > 0xffffffff || index.length > 0xffffffff)
    throw new Error("Release exceeds classic ZIP limits");
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(index.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, index, end]);
}

export async function packageBrowser(browser: unknown, root = projectRoot) {
  if (!isBrowser(browser)) throw new Error("Unsupported browser: " + browser);
  const archive = releaseZip(await validatedFiles(browser, root));
  const output = path.join(root, "dist"),
    destination = path.join(output, browser + ".zip");
  await mkdir(output, { recursive: true });
  const temporary = destination + "." + process.pid + ".tmp";
  try {
    await writeFile(temporary, archive, { flag: "wx" });
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
  console.log("Packaged " + destination);
  return destination;
}
export async function runZips(targets: readonly unknown[], root = projectRoot) {
  if (!targets.length || targets.some((target) => !isBrowser(target))) {
    console.error("Select chrome, firefox, or all");
    return 1;
  }
  try {
    for (const target of targets) await packageBrowser(target, root);
    return 0;
  } catch (error) {
    console.error(errorMessage(error));
    return 1;
  }
}
if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  process.exitCode = await runZips(
    process.argv[2] === "all" ? browsers : [process.argv[2]],
  );
}
