import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * THE AHSP room connects the unresolved-resource UI to the EXISTING observation
 * lifecycle (PR #139). It must call the existing endpoints — never invent a
 * second door — gate curation on the governed permission, and show candidates
 * by name through the shared display module.
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

const room = codeOnly(readFileSync("src/pages/AhspRoomPage.tsx", "utf8"));

test("the room reuses the EXISTING observation endpoints, not a second door", () => {
  assert.ok(room.includes("apiFetch('/resource-observations')"), "lists observations");
  assert.ok(room.includes("/curate-existing"), "existing decision -> existing endpoint");
  assert.ok(room.includes("/curate-new"), "new decision -> existing endpoint");
  // No client-side canonical write, ever.
  assert.ok(!room.includes("resourceCatalog.create"), "the UI never writes a catalog directly");
  assert.ok(!room.includes("ResourceAdmissionService"), "minting is backend-only");
});

test("curation is gated on the governed identity-decision permission", () => {
  assert.ok(room.includes("hasPermission('AHSP_RESOURCE_IDENTITY_DECIDE')"));
  assert.ok(room.includes("canCurate"));
});

test("candidates and copy come from the shared display module, by name", () => {
  assert.ok(room.includes("describeCuratableObservation"));
  assert.ok(room.includes("previewCandidateNames"));
  assert.ok(room.includes("Sumber daya untuk ditinjau"));
  assert.ok(room.includes("Ini padanannya"));
  assert.ok(room.includes("Tetapkan sebagai sumber daya baru"));
});

test("curate-existing carries a catalogue id, curate-new carries a proven unit", () => {
  assert.ok(room.includes("selectedResourceCatalogId"));
  assert.ok(room.includes("unitDefinitionId"));
  // The id comes from the candidate choice, not typed by a human.
  assert.ok(room.includes("choice.resourceCatalogId"));
});
