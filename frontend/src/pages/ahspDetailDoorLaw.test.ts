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

// ── Validity is not completeness ─────────────────────────────────────────────

test("an AHSP with no formula yet is not declared out of force", () => {
  // The two states are separately labelled and separately worded.
  assert.ok(detail.includes('aria-label="AHSP belum memiliki rumus"'));
  assert.ok(detail.includes("Belum ada rumus"));
  assert.ok(detail.includes('aria-label="AHSP tidak berlaku"'));
  assert.ok(detail.includes("Tidak berlaku"));
  // The merged condition that answered both questions with one badge is gone.
  assert.ok(
    !detail.includes("archived || !currentVersion || isHistoricalStatus"),
    "a missing recipe must not be routed through the out-of-force branch",
  );
  // Out of force is reserved for a withdrawn or superseded definition.
  assert.ok(detail.includes("archived || isHistoricalStatus(currentVersion.status)"));
});

test("no expiry is invented for either state", () => {
  assert.ok(!detail.includes("Berlaku sampai"));
  assert.ok(!detail.includes("Kedaluwarsa"));
  assert.ok(!detail.includes("expiredDate ?"));
});

// ── The recipe's proven identity survives the editor ─────────────────────────

test("a saved component is named, never re-typed as an identifier", () => {
  assert.ok(detail.includes("stored: true"), "rows seeded from the saved recipe are marked as such");

  // A saved row and a row the author adds are not the same control.
  const guard = detail.indexOf("row.stored ? (");
  assert.ok(guard > -1, "a saved row must be distinguished from one the author adds");
  const elseBranch = detail.indexOf(") : (", guard);
  assert.ok(elseBranch > guard, "the guard must have both branches");

  // A saved component states its NAME, through the one shared naming rule.
  const savedBranch = detail.slice(guard, elseBranch);
  assert.ok(
    savedBranch.includes("resolveDefinitionResourceName"),
    "a saved component must be named by the same rule the recipe table uses",
  );
  assert.ok(
    !savedBranch.includes("<input"),
    "a saved component's identity must never be typed",
  );

  // THE REGRESSION THIS FORBIDS: an identity control that is always a text
  // box. Asserting the binding is simply absent would condemn the legitimate
  // control a NEW row still needs, and asserting it with a trailing newline
  // held only on a CRLF checkout. The law is about WHERE the control lives,
  // so position is what is measured.
  const binding = "value={row.resourceId}";
  const bindings = detail.split(binding).length - 1;
  assert.equal(bindings, 1, "exactly one control may bind the stored identity");
  assert.ok(
    detail.indexOf(binding) > elseBranch,
    "the stored identity must not be bound to an unconditional text input",
  );
});

test("the update payload still sends the stored identity, not the displayed name", () => {
  assert.ok(detail.includes("resourceId: row.resourceId.trim()"));
  assert.ok(!detail.includes("resourceId: row.resourceName"));
});
