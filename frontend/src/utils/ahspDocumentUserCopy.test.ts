import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { explainAhspItemReasons } from "./ahspDocumentUserCopy.ts";

test("technical reason codes stay internal; users get one human sentence", () => {
  assert.equal(
    explainAhspItemReasons(["MISSING_OUTPUT_UNIT"]),
    "Satuan hasil pekerjaan belum tertera di dokumen.",
  );
  assert.equal(
    explainAhspItemReasons(["RESOURCE_UNRESOLVED", "UNIT_UNRESOLVED"]),
    "Komponen belum dapat dicocokkan dengan data SIMPROK.",
  );
  assert.doesNotMatch(explainAhspItemReasons(["INVALID_COEFFICIENT"]), /INVALID_COEFFICIENT/);
  assert.match(explainAhspItemReasons([]), /belum cukup/);
});

test("the mapper does not invent units", () => {
  const source = readFileSync("src/utils/ahspDocumentUserCopy.ts", "utf8");
  assert.ok(!source.includes("m3"));
  assert.ok(!source.includes("OH"));
});
