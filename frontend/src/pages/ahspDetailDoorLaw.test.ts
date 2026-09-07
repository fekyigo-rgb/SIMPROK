import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * AHSP DETAIL is the room's own definition surface, not a second room.
 *
 * It consumes GET /ahsp/:id — the capability the backend already had — and
 * must not borrow RAB bind, occurrence, or snapshot queries.
 */

const NEWLINE = String.fromCharCode(10);
const codeOnly = (source: string) =>
  source
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

const detail = codeOnly(readFileSync("src/pages/AhspDetailPage.tsx", "utf8"));
const sidebar = codeOnly(readFileSync("src/components/layout/Sidebar.tsx", "utf8"));

test("detail asks GET /ahsp/:id, the existing definition", () => {
  assert.ok(detail.includes("apiFetch('/ahsp/' + ahspId)"));
  assert.ok(!detail.includes("ahsp-occurrences"));
  assert.ok(!detail.includes("eligible-versions"));
  assert.ok(!detail.includes("ahsp-snapshot"));
  assert.ok(!detail.includes("fixture"));
});

test("detail updates AHSP through the existing version append route", () => {
  assert.ok(detail.includes("'/ahsp/' + ahspId + '/versions'"));
  assert.ok(detail.includes("Update AHSP"));
  assert.ok(!detail.includes("'/ahsp/' + state.ahsp.id + '/approve'"));
  assert.ok(!detail.includes("'/ahsp/' + state.ahsp.id + '/archive'"));
  assert.ok(!detail.includes("'/ahsp/' + state.ahsp.id + '/transfer'"));
  assert.ok(!detail.includes("'/ahsp/versions/' + selectedVersion.id + '/retire'"));
  assert.ok(!detail.includes("'/ahsp/versions/' + selectedVersion.id + '/snapshot'"));
  assert.ok(!detail.includes("APPROVED_COMMUNITY_ASSET"));
  assert.ok(!detail.includes("SIMPROK_ASSET"));
  assert.ok(!detail.includes("Pilih Version"));
  assert.ok(!detail.includes("Gunakan Version"));
  assert.ok(!detail.includes("Versi yang ditampilkan"));
  assert.ok(!detail.includes("Tambah versi"));
});

test("detail is not a second sidebar door", () => {
  assert.equal((sidebar.match(/name: 'AHSP'/g) ?? []).length, 1);
  assert.ok(!sidebar.includes("path: '/ahsp/"));
});

test("kode and official-domain names are never invented", () => {
  assert.ok(!detail.includes("Kode AHSP"));
  assert.ok(!detail.includes("orDash(null)"));
  assert.ok(!detail.includes("Bina Marga"));
  assert.ok(!detail.includes("Cipta Karya"));
});

test("interpretation and internal governance are not official AHSP facts", () => {
  assert.ok(!detail.includes("Tipe metode"));
  assert.ok(!detail.includes("Tipe Metode"));
  assert.ok(!detail.includes(">Lokasi<"));
  assert.ok(!detail.includes(">Asal<"));
  assert.ok(!detail.includes("Asal AHSP"));
  assert.ok(!detail.includes("Workspace ini"));
  assert.ok(!detail.includes("methodType"));
  assert.ok(!detail.includes("locationType"));
  assert.ok(!detail.includes("OTHER"));
  assert.ok(!detail.includes("MANUAL"));
  assert.ok(!detail.includes("MOUNTAIN"));
  assert.ok(!detail.includes("Disetujui oleh"));
  assert.ok(!detail.includes("Dipindahkan oleh"));
  assert.ok(detail.includes("Riwayat"));
  assert.ok(detail.includes("AHSP yang saat ini digunakan SIMPROK"));
  assert.ok(detail.includes("Riwayat perubahan AHSP"));
  assert.ok(!detail.includes("ruang kerja RAB"));
  assert.ok(!detail.includes("yang dipakai untuk penggunaan baru"));
  assert.ok(!detail.includes("Ketersediaan"));
  assert.ok(!detail.includes("Halaman"));
  assert.ok(!detail.includes("Bagian"));
  assert.ok(!detail.includes("Berlaku sampai"));
  assert.ok(!detail.includes("Usulkan ke SIMPROK"));
});

test("update AHSP is an editor of the current recipe, not a blank composer", () => {
  assert.ok(detail.includes("draftsFromVersion"));
  assert.ok(detail.includes("row.coefficient > 0"));
  assert.ok(detail.includes("setResourceDrafts(draftsFromVersion(current))"));
  assert.ok(!detail.includes("setOutputUnit('')"));
  assert.ok(!detail.includes("setResourceDrafts([emptyResource()])"));
});

test("components are grouped from stored version resources", () => {
  assert.ok(detail.includes("groupAhspDefinitionResources"));
  assert.ok(detail.includes("currentVersion?.resources"));
});

test("the reader can return to the canonical list", () => {
  assert.ok(detail.includes('to="/ahsp"'));
});
