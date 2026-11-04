import {
  array,
  record,
  string,
  number,
} from "../../scripts/runtime-boundaries.ts";
export interface Root {
  label: string;
  path: string;
  expected: Record<string, string>;
}
export interface Case {
  scenario: string;
  browser: string;
}
export interface Selection extends Case {
  label: string;
  size: number;
  sample: number;
}
export interface Cell extends Case {
  root: Root;
  size: number;
  sample: number;
}
export function parsePlan(value: unknown) {
  const p = record(value),
    b = record(p["bounds"]);
  return {
    bounds: {
      timeoutMilliseconds: number(b["timeoutMilliseconds"]),
      maxOldSpaceMiB: number(b["maxOldSpaceMiB"]),
      peakRSSMiB: number(b["peakRSSMiB"]),
    },
    samples: number(p["samples"]),
    sizes: array(p["sizes"]).map(number),
    selectedSamples: array(p["selectedSamples"]).map((value) => {
      const s = record(value);
      return {
        label: string(s["label"]),
        scenario: string(s["scenario"]),
        browser: string(s["browser"]),
        size: number(s["size"]),
        sample: number(s["sample"]),
      };
    }),
    workspace: string(p["workspace"]),
    fixture: string(p["fixture"]),
    node: string(p["node"]),
    dependencyRoot: string(p["dependencyRoot"]),
    out: string(p["out"]),
    expectedNode: string(p["expectedNode"]),
    fixtureSHA256: string(p["fixtureSHA256"]),
    roots: array(p["roots"]).map((value) => {
      const r = record(value);
      return {
        label: string(r["label"]),
        path: string(r["path"]),
        expected: Object.fromEntries(
          Object.entries(record(r["expected"])).map(([key, value]) => [
            key,
            string(value),
          ]),
        ),
      };
    }),
    cases: array(p["cases"]).map((value) => {
      const c = record(value);
      return { scenario: string(c["scenario"]), browser: string(c["browser"]) };
    }),
    dependencyPackages: array(p["dependencyPackages"]).map((value) => {
      const d = record(value);
      return {
        path: string(d["path"]),
        packageJSONSHA256: string(d["packageJSONSHA256"]),
        installedVersion: string(d["installedVersion"]),
      };
    }),
  };
}
