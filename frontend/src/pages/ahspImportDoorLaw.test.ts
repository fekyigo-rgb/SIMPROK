import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * IMPORT AHSP IS ITS OWN DOOR (gap F). Upload -> Pahami dokumen -> Tinjau hasil
 * -> Simpan yang terbukti lives at /ahsp/import, on the EXISTING canonical
 * pipeline (no second importer). The list page no longer carries the import
 * surface. Manual create — the relocated "AHSP Milik Saya" capability — lives
 * here too, on the same POST /ahsp, never a second create engine.
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
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*") && !t.startsWith("{/*");
    })
    .join(NEWLINE);

const app = codeOnly(readFileSync("src/App.tsx", "utf8"));
const importPage = codeOnly(readFileSync("src/pages/AhspImportPage.tsx", "utf8"));
const room = codeOnly(readFileSync("src/pages/AhspRoomPage.tsx", "utf8"));

test("App routes /ahsp/import behind the AHSP permission, as its own door", () => {
  assert.match(
    app,
    /path="ahsp\/import" element=\{<PermissionRoute permission="AHSP_VIEW"><AhspImportPage \/><\/PermissionRoute>\}/,
  );
});

test("the room's Import action navigates to the door — it no longer toggles an inline panel", () => {
  assert.ok(room.includes("Import AHSP"));
  assert.ok(room.includes("navigate('/ahsp/import')"));
  assert.ok(!room.includes("setShowImport"));
});

test("the import door uses the EXISTING canonical pipeline endpoints, no second importer", () => {
  assert.ok(importPage.includes("/ahsp/document/preview"));
  assert.ok(importPage.includes("/ahsp/document/commit"));
  assert.ok(importPage.includes("pekerjaan dikenali"));
  assert.ok(importPage.includes("siap digunakan"));
  assert.ok(importPage.includes("masih perlu dilengkapi"));
  assert.ok(importPage.includes("item.status === 'READY'"));
  // Human words, never reason codes.
  assert.ok(!importPage.includes("MISSING_OUTPUT_UNIT"));
  assert.ok(!importPage.includes("RESOURCE_UNRESOLVED"));
});

test("the relocated manual-create lives here on the same POST /ahsp, and left the list", () => {
  assert.ok(importPage.includes("apiFetch('/ahsp', {"));
  assert.ok(importPage.includes("method: 'POST'"));
  assert.ok(importPage.includes("Buat AHSP milik saya"));
  assert.ok(importPage.includes("Simpan AHSP milik saya"));
  // The list no longer creates.
  assert.ok(!room.includes("createWorkspaceAhsp"));
  assert.ok(!room.includes("Simpan AHSP milik saya"));
});

test("the reader can return to the canonical list", () => {
  assert.ok(importPage.includes('to="/ahsp"'));
  assert.ok(importPage.includes("Kembali ke Daftar AHSP"));
});

test("the import door surfaces AHSP duplicate intelligence as a HUMAN DECISION, not a silent skip", () => {
  // Sameness copy comes from the shared display module (no raw verdict token rendered).
  assert.ok(importPage.includes("describeSameness"));
  // The Owner-approved decision verbs are present in the review.
  assert.ok(importPage.includes("Gunakan yang sudah ada"));
  assert.ok(importPage.includes("Simpan sebagai AHSP berbeda"));
  assert.ok(importPage.includes("Lewati"));
  // The decision reaches the backend on the SAME commit upload — never frontend-only.
  assert.ok(importPage.includes("body.append('decisions'"));
  assert.ok(importPage.includes("USE_EXISTING"));
  assert.ok(importPage.includes("KEEP_SEPARATE"));
  // The door still opens the existing AHSP as the reference, reusing the detail route.
  assert.ok(importPage.includes("Buka AHSP yang ada"));
});

test("AUTOMATION: many identical AHSPs cost ONE line and ONE optional action, not N decision blocks", () => {
  // Exact identities are deterministic, so they are aggregated above the list.
  assert.ok(importPage.includes("identicalAggregateLine"));
  // A real toggle, so a mis-click is undoable without discarding other decisions.
  assert.ok(importPage.includes("toggleAllExisting"));
  assert.ok(importPage.includes("allIdenticalAdopted"));
  // Adoptability is read from the ONE display module, never re-derived in the page.
  assert.ok(importPage.includes("describeSameness(item)?.canUseExisting === true"));
  // Deleted twins are counted and spoken separately from the offered action.
  assert.ok(importPage.includes("identicalDeletedAggregateLine"));
  // POSSIBLY is NEVER aggregated — each keeps its own candidates and its own decision.
  assert.ok(importPage.includes("identityVerdict === 'IDENTICAL'"));
  // An IDENTICAL row renders no per-item decision buttons; only the door to what exists.
  assert.ok(importPage.includes("sameness.verdict === 'IDENTICAL'"));
  assert.ok(importPage.includes("Buka AHSP yang ada"));
});

test("an already-known AHSP is never announced as 'siap digunakan' — it will not be written", () => {
  // It is READY, but commit skips it as a duplicate. Saying 'siap digunakan' would
  // promise a save that never happens.
  assert.ok(importPage.includes("' · sudah ada di SIMPROK'"));
  assert.ok(importPage.includes("item.identityVerdict === 'IDENTICAL'"));
});

test("a commit SPENDS its decisions — the controls close so one intent cannot be recorded twice", () => {
  assert.ok(importPage.includes("setSettled(true)"));
  assert.ok(importPage.includes("setSettled(false)"));
  assert.ok(importPage.includes("settled ? null :"));
});

test("an item that cannot be admitted is still TOLD it already exists, but is offered no decision", () => {
  // Sameness and readiness are different questions: an exact twin whose components
  // are still uncurated must still show its reference (the ordinary first import of
  // an official document), so the identity is never hidden...
  assert.ok(importPage.includes("const sameness = describeSameness(item);"));
  // ...while the decision is withheld unless the item could actually be admitted,
  // because commit() refuses a non-READY item before it reads any decision.
  assert.ok(importPage.includes("const decidable = item.status === 'READY' && !settled;"));
  assert.ok(importPage.includes("decidable ? ("));
});

test("a duplicate decision never rides a stale document to commit (reset + flagged-only)", () => {
  // Stale decisions are dropped on a new file AND on a fresh understanding.
  assert.ok(importPage.includes("setDecisions({})"));
  // Only an item the classifier STILL flags carries a decision to the backend —
  // a decision left on a now-DISTINCT item is never silently transmitted.
  assert.ok(importPage.includes("item.identityVerdict === 'IDENTICAL'"));
  assert.ok(importPage.includes("item.identityVerdict === 'POSSIBLY_IDENTICAL'"));
});
