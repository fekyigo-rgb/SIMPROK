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

test("candidates and copy come from the shared display module, by name", () => {
  assert.ok(importPage.includes("describeCuratableObservation"));
  assert.ok(importPage.includes("previewCandidateNames"));
  assert.ok(importPage.includes("Sumber daya untuk ditinjau"));
  assert.ok(importPage.includes("Ini padanannya"));
  assert.ok(importPage.includes("Tetapkan sebagai sumber daya baru"));
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
