import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * AHSP DETAIL — the Owner-approved detail view.
 *
 * It consumes GET /ahsp/:id (the capability the backend already had), appends
 * revisions through the existing version route, and submits for review through
 * the existing propose route. It must not borrow RAB bind/occurrence/snapshot
 * queries, must not surface internal governance as fact, and must speak human.
 *
 * The Owner mockup governs the visible shape (breadcrumb, AHSP Saya badge,
 * Usulkan ke SIMPROK, two-column Komponen/Informasi, Update/Riwayat). Prior
 * locks the mockup supersedes have been updated here; the honesty invariants
 * that survive are kept.
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

test("detail asks GET /ahsp/:id, the existing definition — not a RAB door", () => {
  assert.ok(detail.includes("apiFetch('/ahsp/' + ahspId)"));
  assert.ok(!detail.includes("ahsp-occurrences"));
  assert.ok(!detail.includes("eligible-versions"));
  assert.ok(!detail.includes("ahsp-snapshot"));
  assert.ok(!detail.includes("fixture"));
});

test("update is a version append; propose is the real submission — both existing routes", () => {
  assert.ok(detail.includes("'/ahsp/' + ahspId + '/versions'"));
  assert.ok(detail.includes("Update AHSP"));
  // "Usulkan ke SIMPROK" is wired to the existing propose lifecycle, never faked.
  assert.ok(detail.includes("Usulkan ke SIMPROK"));
  assert.ok(detail.includes("'/ahsp/' + ahspId + '/propose'"));
  // Internal governance is still never surfaced from this detail surface.
  assert.ok(!detail.includes("'/approve'"));
  assert.ok(!detail.includes("'/archive'"));
  assert.ok(!detail.includes("'/transfer'"));
  assert.ok(!detail.includes("/retire'"));
  assert.ok(!detail.includes("/snapshot'"));
});

test("detail is not a second sidebar door", () => {
  assert.equal((sidebar.match(/name: 'AHSP'/g) ?? []).length, 1);
  assert.ok(!sidebar.includes("path: '/ahsp/"));
});

test("official-domain names and interpretation are never hardcoded as fact", () => {
  // Bidang/Subkategori values come from backend DATA, never hardcoded literals.
  assert.ok(!detail.includes("Bina Marga"));
  assert.ok(!detail.includes("Cipta Karya"));
  assert.ok(!detail.includes("Kode AHSP"));
  assert.ok(!detail.includes("Tipe metode"));
  assert.ok(!detail.includes(">Lokasi<"));
  assert.ok(!detail.includes(">Asal<"));
  assert.ok(!detail.includes("methodType"));
  assert.ok(!detail.includes("locationType"));
  assert.ok(!detail.includes("MANUAL"));
  assert.ok(!detail.includes("MOUNTAIN"));
  assert.ok(!detail.includes("Disetujui oleh"));
  assert.ok(!detail.includes("Dipindahkan oleh"));
  assert.ok(!detail.includes("Ketersediaan"));
  assert.ok(!detail.includes("Halaman"));
  assert.ok(!detail.includes("Bagian"));
  assert.ok(!detail.includes("Berlaku sampai"));
});

test("the Owner-approved fields and status are present, in human words", () => {
  for (const field of ['Kode', 'Bidang / Kategori', 'Subkategori', 'Dasar AHSP', 'Status Usulan', 'Dibuat oleh', 'Tanggal dibuat', 'Informasi AHSP', 'Komponen Pembentuk AHSP', 'Tentang AHSP Ini']) {
    assert.ok(detail.includes(field), `missing "${field}"`);
  }
  // Status Usulan is translated, not an enum.
  assert.ok(detail.includes("describeAhspProposalStatus"));
});

test("update AHSP is an editor of the current recipe, not a blank composer", () => {
  assert.ok(detail.includes("draftsFromVersion"));
  // "a coefficient must be greater than zero" still holds; it now lives in
  // parseCoefficientInput (ahspCompositionDisplay), which is unit-tested, instead
  // of an inline filter that silently discarded whatever failed it.
  assert.ok(detail.includes("parseCoefficientInput"));
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

// ── Validity is not completeness (preserved semantic, new presentation) ──────

test("the AHSP yang berlaku section is present and validity is not completeness", () => {
  // Owner-approved section, and a locked law.
  assert.ok(detail.includes('aria-label="AHSP yang berlaku"'));
  // In force: the current AHSP SIMPROK uses — an authority statement, no expiry.
  assert.ok(detail.includes("AHSP yang saat ini digunakan SIMPROK"));
  // Completeness (a missing recipe) is its OWN state, worded as incompleteness,
  // never as out-of-force.
  assert.ok(detail.includes('aria-label="AHSP belum memiliki rumus"'));
  assert.ok(detail.includes("Belum ada rumus"));
  // Out-of-force is reserved for a withdrawn/superseded definition.
  assert.ok(detail.includes('aria-label="AHSP tidak berlaku"'));
  assert.ok(detail.includes("Tidak berlaku"));
  assert.ok(detail.includes("isHistoricalStatus(currentVersion?.status)"));
  // The merged condition that answered both with one badge stays gone.
  assert.ok(!detail.includes("archived || !currentVersion || isHistoricalStatus"));
  // No invented expiry for any state.
  assert.ok(!detail.includes("Kedaluwarsa"));
  assert.ok(!detail.includes("Berlaku sampai"));
});

// ── The recipe's proven identity survives the editor ─────────────────────────

test("a saved component is named, never re-typed as an identifier", () => {
  assert.ok(detail.includes("stored: true"));
  const guard = detail.indexOf("row.stored ? (");
  assert.ok(guard > -1, "a saved row must be distinguished from one the author adds");
  const elseBranch = detail.indexOf(") : (", guard);
  assert.ok(elseBranch > guard, "the guard must have both branches");
  const savedBranch = detail.slice(guard, elseBranch);
  assert.ok(savedBranch.includes("resolveDefinitionResourceName"));
  assert.ok(!savedBranch.includes("<input"));
  const binding = "value={row.resourceId}";
  assert.equal(detail.split(binding).length - 1, 1, "exactly one control may bind the stored identity");
  assert.ok(detail.indexOf(binding) > elseBranch, "the stored identity must not be bound to an unconditional text input");
});

test("the update payload still sends the stored identity, not the displayed name", () => {
  assert.ok(detail.includes("resourceId: row.resourceId.trim()"));
  assert.ok(!detail.includes("resourceId: row.resourceName"));
});

// ── An update sends the WHOLE recipe, so nothing may be dropped in silence ───

test("a component the form cannot read STOPS the save — it is never silently dropped", () => {
  // The old handler mapped with Number() and then .filter()ed the failures away,
  // so a stored component whose coefficient was typed "0,04" vanished from the
  // recipe while the author was told the update succeeded.
  assert.ok(!detail.includes("Number(row.coefficient)"));
  assert.ok(detail.includes("parseCoefficientInput(row.coefficient)"));
  // The unreadable row is named, and the refusal says what SIMPROK will not do.
  assert.ok(detail.includes("belum dapat dibaca"));
  assert.ok(detail.includes("tidak menyimpan sebagian resep"));
  // A stored row can never be treated as an unused slot.
  assert.ok(detail.includes("row.stored ||"));
});

test("an untouched form does not write a revision — history states real changes only", () => {
  assert.ok(detail.includes("const unchanged ="));
  assert.ok(detail.includes("Belum ada perubahan untuk disimpan"));
  // Fail-open: only an exact match counts as unchanged, so doubt never blocks a save.
  assert.ok(detail.includes("stored.length === resources.length"));
});
