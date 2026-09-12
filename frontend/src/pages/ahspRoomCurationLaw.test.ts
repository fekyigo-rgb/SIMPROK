import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * THE unresolved-resource curation UI connects to the EXISTING observation
 * lifecycle (PR #139). It must call the existing endpoints — never invent a
 * second door — gate curation on the governed permission, and show candidates
 * by name through the shared display module.
 *
 * Gap F moved this surface OUT of the AHSP list and onto the dedicated Import
 * AHSP door, so the list stays a clean library. The law is unchanged — only its
 * home is. These assertions now read the import door, and confirm the list is
 * no longer the curation dump.
 */

const NEWLINE = String.fromCharCode(10);
const CARRIAGE_RETURN = String.fromCharCode(13);
const codeOnly = (source: string) =>
  source
    .split(CARRIAGE_RETURN)
    .join("")
    .split(NEWLINE)
    .filter((line) => {
      const t = line.trim();
      return (
        !t.startsWith("//") &&
        !t.startsWith("*") &&
        !t.startsWith("/*") &&
        !t.startsWith("{/*")
      );
    })
    .join(NEWLINE);

const importPage = codeOnly(readFileSync("src/pages/AhspImportPage.tsx", "utf8"));
const room = codeOnly(readFileSync("src/pages/AhspRoomPage.tsx", "utf8"));

test("the import door reuses the EXISTING observation endpoints, not a second door", () => {
  assert.ok(importPage.includes("apiFetch('/resource-observations')"), "lists observations");
  assert.ok(importPage.includes("/curate-existing"), "existing decision -> existing endpoint");
  assert.ok(importPage.includes("/curate-new"), "new decision -> existing endpoint");
  // No client-side canonical write, ever.
  assert.ok(!importPage.includes("resourceCatalog.create"), "the UI never writes a catalog directly");
  assert.ok(!importPage.includes("ResourceAdmissionService"), "minting is backend-only");
});

test("curation is gated on the governed identity-decision permission", () => {
  assert.ok(importPage.includes("hasPermission('AHSP_RESOURCE_IDENTITY_DECIDE')"));
  assert.ok(importPage.includes("canCurate"));
});

// LEGACY_TEST_CHANGE_REGISTER: OLD_EXPECTATION named `describeCuratableObservation`
// directly. The page now reaches it through `groupIdenticalObservations`, exported
// from the SAME module, whose returned `view` is produced by exactly that function.
// The law under test — candidates and copy come from the shared display module
// rather than being hand-rolled in the page — is unchanged, and is held more
// tightly than before: the page now takes the grouping from that module too and
// formats nothing of its own. TEST_WEAKENING=NO.
test("candidates and copy come from the shared display module, by name", () => {
  assert.ok(importPage.includes("groupIdenticalObservations"));
  assert.ok(importPage.includes("previewCandidateNames"));
  assert.ok(importPage.includes("Sumber daya untuk ditinjau"));
  assert.ok(importPage.includes("Tetapkan sebagai sumber daya baru"));
});

/**
 * ACG-01 CLOSURE 4 — THE LABEL CHANGED, AND THIS RECORDS WHY.
 *
 * This suite used to assert the page contained "Ini padanannya". That label was
 * printed on EVERY nominated row, including one nominated for no reason beyond
 * sharing a single five-letter word with the source name — "Tanah Biasa" beside
 * "Klem biasa", "Dump Truck" beside "Water Tank Truck". SIMPROK was declaring an
 * equivalence it had never proved, on its own behalf, and the reader was left to
 * referee a list the machine had not refereed.
 *
 * The page now CONFIRMS rather than declares, and a shared-word nomination is
 * not rendered as a button at all. The law this file protects — that copy and
 * candidates come from the shared display module and the page formats nothing of
 * its own — is unchanged and is asserted above. TEST_WEAKENING=NO.
 */
test("SIMPROK asks for confirmation and never declares a match on its own behalf", () => {
  assert.ok(
    !importPage.includes("Ini padanannya"),
    "the page must not assert an equivalence SIMPROK has not proved",
  );
  assert.ok(importPage.includes("Benar, ini sama dengan"));
});

test("a nomination too weak to act on is shown but never actionable", () => {
  // It is rendered as a sentence...
  assert.ok(importPage.includes("view.weakPossibilityLine"));
  // ...and only confirmable candidates are ever turned into buttons.
  assert.ok(importPage.includes("view.candidateChoices.map"));
  assert.ok(
    !importPage.includes("view.weakPossibilities.map"),
    "weak possibilities must never become clickable choices",
  );
});

test("what SIMPROK understood is stated before anything is asked of the reader", () => {
  assert.ok(importPage.includes("view.understanding"));
});

test("curate-existing carries a catalogue id, curate-new carries a proven unit", () => {
  assert.ok(importPage.includes("selectedResourceCatalogId"));
  assert.ok(importPage.includes("unitDefinitionId"));
  // The id comes from the candidate choice, not typed by a human.
  assert.ok(importPage.includes("choice.resourceCatalogId"));
});

test("the AHSP list no longer hosts the curation dump", () => {
  assert.ok(!room.includes("Sumber daya untuk ditinjau"));
  assert.ok(!room.includes("/resource-observations"));
  assert.ok(!room.includes("describeCuratableObservation"));
});
