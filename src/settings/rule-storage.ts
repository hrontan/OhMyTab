import { getStorage, setStorage, removeStorage } from "../browser/browser-api";
import { ruleStorageKey, ruleKeys, type RuleMode, type Rules, defaults, same, state, locked } from "./rule-storage-state";
import { readPendingImport } from "./settings-import-recovery";

export async function readRules(): Promise<Rules> {
  const current = await state();
  if (current.mode === "local") return current.rules!;
  const synced = await getStorage(defaults);
  // A cutover may remove sync keys between the first selector read and get().
  // Recheck the atomic local record without waiting on an in-flight writer.
  const confirmed = await state();
  return confirmed.mode === "local" ? confirmed.rules! : synced;
}

// Other settings remain in sync, including unsupported Chrome preferences.
export async function writeRuleSettings(values: Record<string, unknown>): Promise<void> {
  const write = async () => {
    if (await readPendingImport()) throw new Error("Recover the interrupted settings import before saving");
    if (!ruleKeys.some(key => key in values)) return setStorage(values);
    const current = await state();
    if (current.mode === "sync") return setStorage(values);
    const others = Object.fromEntries(Object.entries(values).filter(([key]) => !ruleKeys.includes(key as typeof ruleKeys[number])));
    const rules = { ...current.rules! };
    if ("urlmatch" in values) rules.urlmatch = values.urlmatch as boolean;
    if ("urlmatch_pattern" in values) rules.urlmatch_pattern = values.urlmatch_pattern as string;
    if (Object.keys(others).length) await setStorage(others);
    if (ruleKeys.some(key => key in values)) {
      await setStorage({ [ruleStorageKey]: { mode: "local", rules } }, "local");
      const confirmed = await state();
      if (confirmed.mode !== "local" || !same(confirmed.rules!, rules)) throw new Error("URL-rule save could not be verified");
    }
  };
  if (globalThis.navigator?.locks) return locked(write);
  // Preserve ordinary sync settings on an environment without Web Locks.
  if (ruleKeys.some(key => key in values) && (await state()).mode !== "sync") throw new Error("Local URL-rule writes require Web Locks");
  return write();
}

async function syncResidue() {
  const raw = await getStorage<Record<string, unknown>>({ urlmatch: null, urlmatch_pattern: null });
  return ruleKeys.some(key => raw[key] !== null && raw[key] !== undefined);
}
export async function getRuleStorageStatus() {
  const current = await state();
  return { mode: current.mode, syncResidual: current.mode === "local" && await syncResidue() };
}

async function cleanSync(expected?: Rules): Promise<boolean> {
  if (expected && !same(await getStorage(defaults), expected)) return false;
  await removeStorage([...ruleKeys]);
  return !await syncResidue();
}

export async function switchRuleStorage(mode: RuleMode) {
  return locked(async () => {
    if (await readPendingImport()) throw new Error("Recover the interrupted settings import before switching storage");
    const current = await state();
    if (current.mode === mode) return getRuleStorageStatus();
    const rules = current.mode === "local" ? current.rules! : await getStorage(defaults);
    if (typeof rules.urlmatch !== "boolean" || typeof rules.urlmatch_pattern !== "string") {
      throw new Error("Invalid source URL rules; source retained");
    }
    if (mode === "local") {
      // Atomic local record installs both the rules and their selector. The old
      // sync snapshot remains intact until the destination readback succeeds.
      await setStorage({ [ruleStorageKey]: { mode: "sync", prepared: rules } }, "local");
      const staged = (await getStorage<Record<string, unknown>>({ [ruleStorageKey]: null }, "local"))[ruleStorageKey] as { prepared?: Rules } | null;
      if (!staged?.prepared || !same(staged.prepared, rules)) throw new Error("URL-rule destination could not be verified; sync remains active");
      await setStorage({ [ruleStorageKey]: { mode, rules } }, "local");
      const confirmed = await state();
      if (confirmed.mode !== "local" || !same(confirmed.rules!, rules)) throw new Error("URL-rule migration could not be verified; sync retained");
      try { await cleanSync(rules); } catch { /* Report residual rather than erase the verified local rules. */ }
    } else {
      // Keep the complete local snapshot until sync has acknowledged and echoed it.
      await setStorage(rules);
      if (!same(await getStorage(defaults), rules)) throw new Error("URL-rule migration could not be verified; local retained");
      await setStorage({ [ruleStorageKey]: { mode: "sync" } }, "local");
      if ((await state()).mode !== "sync") throw new Error("URL-rule selector could not be verified; local snapshot retained");
    }
    return getRuleStorageStatus();
  });
}

// Explicit retry may remove a newer remote sync copy; the UI explains this.
export async function removeSyncRules() {
  return locked(async () => {
    if (await readPendingImport()) throw new Error("Recover the interrupted settings import before removing rules");
    if ((await state()).mode !== "local") throw new Error("Switch URL rules to local before removing the sync copy");
    await cleanSync();
    return getRuleStorageStatus();
  });
}
