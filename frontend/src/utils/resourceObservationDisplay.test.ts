import assert from "node:assert/strict";
import test from "node:test";
import {
  describeCuratableObservation,
  groupIdenticalObservations,
  observationOccurrenceLine,
  previewCandidateNames,
  looksLikeInternalIdentifier,
} from "./resourceObservationDisplay.ts";

/**
 * The curation surface must speak human, show candidates by NAME, never
 * auto-select, and never leak a code or UUID.
 */

// A — the curator sees candidates by name, with the id kept for the action only.
test("A: candidates are shown by name; the catalogue id rides along for the action, unseen", () => {
  const view = describeCuratableObservation({
    id: "obs-1",
    rawName: "Agregat XYZ Premium",
    rawUnit: "m3",
    resourceType: "MATERIAL",
    candidates: [
      { resourceCatalogId: "6f2b1c4a-9d3e-4a71-b8c2-5e7f0a1d2b3c", name: "Kerikil / Agregat" },
      { resourceCatalogId: "7a1b2c3d-4e5f-4a71-b8c2-5e7f0a1d2b3c", name: "Agregat Kasar" },
    ],
    suggestedUnitDefinitionId: "unit-m3",
  });
  assert.equal(view.title, "Agregat XYZ Premium (m3)");
  assert.deepEqual(view.candidateChoices.map((c) => c.name), ["Kerikil / Agregat", "Agregat Kasar"]);
  // The id is present for curate-existing, but only the NAME is reader-facing.
  assert.equal(view.candidateChoices[0].resourceCatalogId, "6f2b1c4a-9d3e-4a71-b8c2-5e7f0a1d2b3c");
  assert.match(view.candidateLine ?? "", /Kerikil \/ Agregat/);
  assert.doesNotMatch(view.candidateLine ?? "", /6f2b1c4a/);
  assert.equal(looksLikeInternalIdentifier(view.candidateLine ?? ""), false);
  assert.equal(looksLikeInternalIdentifier(view.guidance), false);
  assert.equal(view.canProposeNew, true);
  assert.equal(view.newUnitDefinitionId, "unit-m3");
});

test("candidates are de-duplicated and dropped if they carry no id", () => {
  const view = describeCuratableObservation({
    id: "obs-2",
    rawName: "Semen",
    candidates: [
      { resourceCatalogId: "id-1", name: "Semen Portland" },
      { resourceCatalogId: "id-2", name: "Semen Portland" },
      { resourceCatalogId: "", name: "Bocor" },
    ],
    suggestedUnitDefinitionId: null,
  });
  assert.deepEqual(view.candidateChoices.map((c) => c.name), ["Semen Portland"]);
});

test("a long candidate list is trimmed, never dumped", () => {
  const view = describeCuratableObservation({
    id: "obs-3",
    rawName: "Kayu",
    candidates: ["A", "B", "C", "D", "E", "F"].map((n, i) => ({ resourceCatalogId: "id-" + i, name: n })),
    suggestedUnitDefinitionId: null,
  });
  assert.match(view.candidateLine ?? "", /dan 2 lainnya/);
});

// no candidate → not "does not exist", and new-proposal offered honestly.
test("no candidate reads as not-yet-proven, never as rejected or non-existent", () => {
  const view = describeCuratableObservation({
    id: "obs-4",
    rawName: "Bahan Langka 92311",
    rawUnit: "kg",
    candidates: [],
    suggestedUnitDefinitionId: "unit-kg",
  });
  assert.equal(view.candidateLine, null);
  assert.match(view.guidance, /belum menemukan padanan/);
  assert.doesNotMatch(view.guidance, /tidak ada|tidak ditemukan|ditolak/i);
});

// canProposeNew is false when the Unit Kernel could not prove a unit.
test("proposing new is withheld until a unit is proven", () => {
  const view = describeCuratableObservation({
    id: "obs-5",
    rawName: "Bahan",
    rawUnit: "zzz",
    candidates: [],
    suggestedUnitDefinitionId: null,
  });
  assert.equal(view.canProposeNew, false);
  assert.equal(view.newUnitDefinitionId, null);
});

// Preview candidate names — resolved resources contribute none; names only.
test("preview shows candidate names for unresolved resources only", () => {
  const names = previewCandidateNames([
    { rawName: "Pekerja", group: "LABOR", resolvedResourceCatalogId: "cat-1", identityCandidates: ["Pekerja"] },
    { rawName: "Kawat bendrat", group: "MATERIAL", resolvedResourceCatalogId: null, identityCandidates: ["Kawat benrad", "Kawat BRC"] },
    { rawName: "PC", group: "MATERIAL", resolvedResourceCatalogId: null, identityCandidates: ["Semen Portlan"] },
  ]);
  assert.deepEqual(names, ["Kawat benrad", "Kawat BRC", "Semen Portlan"]);
});

test("the identifier guard actually catches uuids and reason codes", () => {
  assert.equal(looksLikeInternalIdentifier("6f2b1c4a-9d3e-4a71-b8c2-5e7f0a1d2b3c"), true);
  assert.equal(looksLikeInternalIdentifier("RESOURCE_NOT_FOUND"), true);
  assert.equal(looksLikeInternalIdentifier("SIMPROK menemukan padanan"), false);
});

/**
 * ONE QUESTION, ASKED ONCE.
 *
 * A real Bina Marga import puts "Alat Bantu (Ls)" on screen sixty-six times —
 * the same question, once per analysis. Folding it is machine work. What must
 * NOT fold is anything the decision actually depends on, so the tests below
 * spend most of their weight proving what stays apart.
 */

const obs = (over: Record<string, unknown> = {}) => ({
  id: "obs-" + Math.random().toString(36).slice(2),
  rawName: "Alat Bantu",
  rawCode: null,
  rawUnit: "Ls",
  resourceType: "EQUIPMENT",
  candidates: [{ resourceCatalogId: "cat-alat-bantu", name: "Alat Bantu" }],
  suggestedUnitDefinitionId: "unit-ls",
  ...over,
});

test("G1: the same question asked many times becomes ONE group carrying every id", () => {
  const groups = groupIdenticalObservations([
    obs({ id: "a" }),
    obs({ id: "b" }),
    obs({ id: "c" }),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].occurrences, 3);
  // First-seen order, so the answer is recorded in the order the document asked.
  assert.deepEqual(groups[0].ids, ["a", "b", "c"]);
  assert.equal(groups[0].view.title, "Alat Bantu (Ls)");
});

test("G2: a question asked once is still its own group, and says nothing about counts", () => {
  const groups = groupIdenticalObservations([obs({ id: "only" })]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].occurrences, 1);
  assert.equal(observationOccurrenceLine(groups[0]), null);
});

test("G3: the repeat is stated honestly, with the real number", () => {
  const groups = groupIdenticalObservations([obs(), obs(), obs(), obs()]);
  const line = observationOccurrenceLine(groups[0]) as string;
  assert.match(line, /4 kali/u);
  assert.match(line, /Satu keputusan berlaku untuk semuanya/u);
  // Never a code or an id.
  assert.equal(looksLikeInternalIdentifier(line), false);
});

// ---------------- what must NEVER fold ----------------

test("G4: DIFFERENT candidate sets are never merged — different evidence is a different question", () => {
  const groups = groupIdenticalObservations([
    obs({ id: "one", candidates: [{ resourceCatalogId: "cat-a", name: "Alat Bantu" }] }),
    obs({
      id: "two",
      candidates: [
        { resourceCatalogId: "cat-a", name: "Alat Bantu" },
        { resourceCatalogId: "cat-b", name: "Alat Bantu Lain" },
      ],
    }),
  ]);
  assert.equal(groups.length, 2);
});

test("G5: a different unit, class, or source code is never merged", () => {
  assert.equal(
    groupIdenticalObservations([obs({ id: "1" }), obs({ id: "2", rawUnit: "Jam" })]).length,
    2,
  );
  assert.equal(
    groupIdenticalObservations([obs({ id: "3" }), obs({ id: "4", resourceType: "MATERIAL" })]).length,
    2,
  );
  assert.equal(
    groupIdenticalObservations([obs({ id: "5" }), obs({ id: "6", rawCode: "E.13.b" })]).length,
    2,
  );
});

test("G6: a different spelling is never merged — the reader is shown what the source wrote", () => {
  const groups = groupIdenticalObservations([
    obs({ id: "x", rawName: "Alat Bantu" }),
    obs({ id: "y", rawName: "alat bantu" }),
  ]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((g) => g.view.title), ["Alat Bantu (Ls)", "alat bantu (Ls)"]);
});

test("G7: a different proven unit is never merged, even when the words match exactly", () => {
  const groups = groupIdenticalObservations([
    obs({ id: "p" }),
    obs({ id: "q", suggestedUnitDefinitionId: "unit-something-else" }),
  ]);
  assert.equal(groups.length, 2);
});

// ---------------- human authority is untouched ----------------

test("G8: grouping decides NOTHING — every candidate is still offered, none is selected", () => {
  const groups = groupIdenticalObservations([
    obs({
      candidates: [
        { resourceCatalogId: "cat-a", name: "Sewa Water Tank truck" },
        { resourceCatalogId: "cat-b", name: "Sewa Dump Truck 3 Ton" },
      ],
    }),
    obs({
      candidates: [
        { resourceCatalogId: "cat-a", name: "Sewa Water Tank truck" },
        { resourceCatalogId: "cat-b", name: "Sewa Dump Truck 3 Ton" },
      ],
    }),
  ]);
  assert.equal(groups.length, 1);
  // Both alternatives survive folding; the choice is still the human's.
  assert.deepEqual(groups[0].view.candidateChoices.map((c) => c.name), [
    "Sewa Water Tank truck",
    "Sewa Dump Truck 3 Ton",
  ]);
  // Nothing in the group marks a winner.
  assert.equal(Object.prototype.hasOwnProperty.call(groups[0], "selected"), false);
  assert.match(groups[0].view.guidance, /Pilih padanan/u);
});

test("G9: an unanswerable observation still refuses to offer 'new' — fail-closed survives folding", () => {
  const groups = groupIdenticalObservations([
    obs({ id: "u1", candidates: [], suggestedUnitDefinitionId: null }),
    obs({ id: "u2", candidates: [], suggestedUnitDefinitionId: null }),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].occurrences, 2);
  assert.equal(groups[0].view.canProposeNew, false);
  assert.match(groups[0].view.guidance, /belum menemukan padanan/u);
});

test("G10: empty and malformed input yield nothing rather than a fabricated group", () => {
  assert.deepEqual(groupIdenticalObservations([]), []);
  assert.deepEqual(groupIdenticalObservations(null), []);
  assert.deepEqual(groupIdenticalObservations(undefined), []);
  // An observation with no id cannot be acted on, so it is not offered as work.
  assert.deepEqual(groupIdenticalObservations([obs({ id: "" })]), []);
});
