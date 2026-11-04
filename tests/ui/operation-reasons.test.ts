import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { operationReasonKeys } from "../../src/ui/operation-reasons";

test("base reason keys resolve to localized text while consumer additions stay separate", () => {
  for (const locale of ["en", "ja", "zh_CN"]) {
    const catalog = JSON.parse(readFileSync("public/_locales/" + locale + "/messages.json", "utf8")) as Record<string, { message: string }>;
    for (const key of Object.values(operationReasonKeys)) expect(catalog[key]?.message, locale + ":" + key).toBeTruthy();
  }
  expect(operationReasonKeys["extract"]).toBeUndefined();
  expect(operationReasonKeys["future-reason"]).toBeUndefined();
});
