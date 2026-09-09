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
