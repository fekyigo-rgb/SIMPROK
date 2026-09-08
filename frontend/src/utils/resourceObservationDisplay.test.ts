import assert from "node:assert/strict";
import test from "node:test";
import {
  describeCuratableObservation,
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
