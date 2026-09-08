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

test("candidates found is not reported as nothing found", () => {
  const copy = explainAhspItemReasons(["RESOURCE_CANDIDATES_FOUND", "RESOURCE_UNRESOLVED"]);
  assert.match(copy, /menemukan/);
  assert.match(copy, /belum terbukti/);
  assert.doesNotMatch(copy, /tidak ada|tidak ditemukan/i);
  assert.doesNotMatch(copy, /RESOURCE_CANDIDATES_FOUND/);
});

test("an unknown component unit is named as a unit question, not as ambiguity", () => {
  assert.equal(
    explainAhspItemReasons(["UNIT_UNRESOLVED"]),
    "Satuan komponen belum dikenali dalam data SIMPROK.",
  );
});
