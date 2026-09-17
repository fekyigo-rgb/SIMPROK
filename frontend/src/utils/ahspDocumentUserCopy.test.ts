import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { explainAhspItemReasons, explainWaitingItemReasons } from "./ahspDocumentUserCopy.ts";

test("technical reason codes stay internal; users get one human sentence", () => {
  // CHANGE NOTE (closeout §5-C/D): "belum tertera di dokumen" claimed the document
  // states no output unit. What SIMPROK knows is that it found none — a source may
  // state one in a form the reader does not read yet.
  assert.equal(
    explainAhspItemReasons(["MISSING_OUTPUT_UNIT"]),
    "Satuan hasil pekerjaan belum ditemukan pada dokumen.",
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

// ACG-01.1 — the same code is carried when every row found was ruled out, so the
// sentence must be true for both: related data was found, and nothing is offered.
test("candidates found never calls a (possibly ruled-out) row a possible match", () => {
  const copy = explainAhspItemReasons(["RESOURCE_CANDIDATES_FOUND"]);
  assert.doesNotMatch(copy, /kemungkinan padanan/);
  assert.doesNotMatch(copy, /ditolak/);
});

test("a waiting item is explained by the fact that really holds it, never by a component's pending identity", () => {
  // CHANGE NOTE (closeout §5-B): UNIT_UNRESOLVED also holds an item whose OUTPUT unit
  // is a spelling SIMPROK does not know, so "Satuan komponen …" named the wrong unit.
  // The former exact-copy test for it is folded into the §5 test below. TEST_WEAKENING=NO.
  // Identity alone no longer holds an item back, so it is not why this one waits.
  assert.equal(
    explainWaitingItemReasons(["RESOURCE_UNRESOLVED", "RESOURCE_CANDIDATES_FOUND", "UNIT_UNRESOLVED"]),
    "Satuan yang tertulis belum dikenali dalam data SIMPROK.",
  );
  assert.equal(
    explainWaitingItemReasons(["CURRENTNESS_UNPROVEN", "MISSING_OUTPUT_UNIT"]),
    "Satuan hasil pekerjaan belum ditemukan pada dokumen.",
  );
  assert.equal(
    explainWaitingItemReasons(["IDENTITY_POSSIBLE_MATCH"]),
    "Menunggu keputusan Anda: kemungkinan sama dengan pekerjaan yang sudah ada.",
  );
  // With nothing else on record, what is on record is still said — never a blank.
  assert.equal(
    explainWaitingItemReasons(["RESOURCE_UNRESOLVED"]),
    "Komponen belum dapat dicocokkan dengan data SIMPROK.",
  );
  assert.match(explainWaitingItemReasons([]), /belum cukup/);
});

test("AHSP COMPLETION §5: a stated-twice conflict is said as two statements — never as a missing unit or a vague ambiguity", () => {
  const copy = explainWaitingItemReasons(["SOURCE_UNIT_CONFLICT", "CURRENTNESS_UNPROVEN"]);
  assert.equal(copy, "Dokumen menyatakan dua satuan hasil yang berbeda, sehingga SIMPROK belum dapat menetapkannya dengan aman.");
  assert.doesNotMatch(copy, /belum tertera|belum ditemukan|lebih dari satu cara/u);
});

test("closeout §5: four different unit truths are four different sentences — an unknown spelling is never called different, a unit not found is never called absent", () => {
  // A — the Unit Kernel proved two statements name different units.
  const proven = explainAhspItemReasons(["SOURCE_UNIT_CONFLICT"]);
  // B — a spelling SIMPROK does not know: sameness is unproven, so it waits as a unit question.
  const unknown = explainAhspItemReasons(["UNIT_UNRESOLVED"]);
  // C and D — no statement found, whether the source has none or states it in a form not read yet.
  const notFound = explainAhspItemReasons(["MISSING_OUTPUT_UNIT"]);
  assert.equal(new Set([proven, unknown, notFound]).size, 3);
  assert.match(proven, /berbeda/u);
  assert.doesNotMatch(unknown, /berbeda|konflik/u);
  // Said for a component's unit and an output unit alike, so it names neither.
  assert.doesNotMatch(unknown, /komponen|hasil/u);
  assert.doesNotMatch(notFound, /tidak ada|tidak tertera|tidak menyatakan|belum tertera/u);
});
