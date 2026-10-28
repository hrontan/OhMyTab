import { getStorageKeys, setStorage, removeStorage } from "../browser/browser-api";
import { ruleStorageKey, ruleKeys, state, locked } from "./rule-storage-state";

// One bounded transaction snapshot, never included in portable exports. During
// import or recovery, readers use before and writers refuse to bypass it.
export const importSnapshotKey = "ohmytab_settings_import_v1";
type ImportSnapshot = {
  version: 1;
  id: string;
  before: Record<string, unknown>;
  syncBefore: Record<string, unknown>;
  syncKeys: string[];
  localBefore: Record<string, unknown>;
};
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const sameRecord = (a: Record<string, unknown>, b: Record<string, unknown>) =>
  JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
export async function readImportObservation(): Promise<{ epoch: string; pending?: ImportSnapshot }> {
  const raw = await getStorageKeys([importSnapshotKey], "local");
  if (!Object.hasOwn(raw, importSnapshotKey)) return { epoch: "none" };
  const value = raw[importSnapshotKey];
  if (record(value) && value.version === 1 && typeof value.committed === "string" && Object.keys(value).length === 2) {
    return { epoch: "complete:" + value.committed };
  }
  if (!record(value) || value.version !== 1 || typeof value.id !== "string" || !record(value.before) ||
      !record(value.syncBefore) || !record(value.localBefore) ||
      !Array.isArray(value.syncKeys) || !value.syncKeys.every(key => typeof key === "string") ||
      Object.keys(value.localBefore).some(key => key !== ruleStorageKey)) {
    throw new Error("Invalid import recovery snapshot; storage was not modified");
  }
  return { epoch: "pending:" + value.id, pending: value as ImportSnapshot };
}
async function snapshot() { return (await readImportObservation()).pending; }
export async function readPendingImport() { return (await snapshot())?.before; }
export async function hasPendingImport() { return !!await snapshot(); }

async function completeSnapshot(saved: ImportSnapshot) {
  // Replace all confidential snapshot data atomically with an opaque generation.
  // Readers spanning an entire transaction detect this generation and retry.
  const marker = { version: 1, committed: saved.id };
  try { await setStorage({ [importSnapshotKey]: marker }, "local"); }
  catch (error) { if ((await readImportObservation()).epoch !== "complete:" + saved.id) throw error; }
  if ((await readImportObservation()).epoch !== "complete:" + saved.id) throw new Error("Import completion could not be verified");
}

async function restoreSnapshot(saved: ImportSnapshot) {
  if (Object.keys(saved.syncBefore).length) await setStorage(saved.syncBefore);
  const absent = saved.syncKeys.filter(key => !Object.hasOwn(saved.syncBefore, key));
  if (absent.length) await removeStorage(absent);
  if (Object.keys(saved.localBefore).length) await setStorage(saved.localBefore, "local");
  else await removeStorage([ruleStorageKey], "local");
  if (!sameRecord(await getStorageKeys(saved.syncKeys), saved.syncBefore) ||
      !sameRecord(await getStorageKeys([ruleStorageKey], "local"), saved.localBefore)) {
    throw new Error("Original settings could not be verified; recovery remains required");
  }
  await completeSnapshot(saved);
}

export async function recoverSettingsImport(allowedKeys: string[]) {
  return locked(async () => {
    const saved = await snapshot();
    if (!saved) return;
    if (saved.syncKeys.some(key => !allowedKeys.includes(key)) ||
        Object.keys(saved.syncBefore).some(key => !saved.syncKeys.includes(key))) {
      throw new Error("Invalid import recovery keys; storage was not modified");
    }
    await restoreSnapshot(saved);
  });
}

export async function applySettingsImport(
  values: Record<string, unknown>, before: Record<string, unknown>,
  readCurrent: () => Promise<Record<string, unknown>>, keys: string[]
) {
  return locked(async () => {
    if (await snapshot()) throw new Error("Recover the previous settings import first");
    if (!sameRecord(await readCurrent(), before)) throw new Error("Settings changed after review; review the import again");
    const current = await state();
    const syncKeys = keys.filter(key => current.mode === "sync" || !ruleKeys.includes(key as typeof ruleKeys[number]));
    const saved: ImportSnapshot = {
      version: 1, id: globalThis.crypto.randomUUID(), before, syncKeys,
      syncBefore: await getStorageKeys(syncKeys),
      localBefore: await getStorageKeys([ruleStorageKey], "local"),
    };
    await setStorage({ [importSnapshotKey]: saved }, "local");
    if (!sameRecord((await snapshot())?.before ?? {}, before)) throw new Error("Import snapshot could not be verified; original settings retained");
    try {
      const syncValues = Object.fromEntries(syncKeys.map(key => [key, values[key]]));
      await setStorage(syncValues);
      const localValue = { mode: "local", rules: { urlmatch: values.urlmatch, urlmatch_pattern: values.urlmatch_pattern } };
      if (current.mode === "local") await setStorage({ [ruleStorageKey]: localValue }, "local");
      if (!sameRecord(await getStorageKeys(syncKeys), syncValues) ||
          current.mode === "local" && !sameRecord(await getStorageKeys([ruleStorageKey], "local"), { [ruleStorageKey]: localValue })) {
        throw new Error("Imported settings could not be verified");
      }
      await completeSnapshot(saved);
    } catch (error) {
      try {
        // Re-establish the read guard if commit acknowledgement was uncertain.
        await setStorage({ [importSnapshotKey]: saved }, "local");
        await restoreSnapshot(saved);
      }
      catch { throw new Error("Import failed; original effective settings are retained. Recovery is required before saving."); }
      throw error;
    }
  });
}
