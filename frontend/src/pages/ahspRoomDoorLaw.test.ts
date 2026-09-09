import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * ONE AHSP ROOM, ONE DOOR — in the Owner-approved mockup's shape.
 *
 * The room lives at /ahsp and asks GET /ahsp (workspace visibility). These are
 * SOURCE laws: they pin that the room consumes the real capability, is the only
 * standalone door, shows the mockup's columns/filters/selection, wires
 * "Usulkan ke SIMPROK" to the existing propose lifecycle, and never invents
 * data or leaks interpretation.
 */

const NEWLINE = String.fromCharCode(10);
const BACKSLASH = String.fromCharCode(92);
const toPosix = (p: string) => p.split(BACKSLASH).join("/");
const codeOnly = (source: string) =>
  source
    .split(NEWLINE)
    .filter((line) => {
      const t = line.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*") && !t.startsWith("{/*");
    })
    .join(NEWLINE);

const app = codeOnly(readFileSync("src/App.tsx", "utf8"));
const sidebar = codeOnly(readFileSync("src/components/layout/Sidebar.tsx", "utf8"));
const observatory = codeOnly(readFileSync("src/pages/ObservatoryPage.tsx", "utf8"));
const room = codeOnly(readFileSync("src/pages/AhspRoomPage.tsx", "utf8"));

const tsxFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(full);
    return entry.isFile() && entry.name.endsWith(".tsx") ? [full] : [];
  });

// ── A: the canonical door ────────────────────────────────────────────────────

test("A the sidebar AHSP entry opens the canonical room", () => {
  assert.match(sidebar, /name: 'AHSP', path: '\/ahsp'/);
  assert.ok(!sidebar.includes("ruang=ahsp"));
});

test("A App routes /ahsp and /ahsp/:ahspId behind the backend's own permission", () => {
  assert.match(app, /path="ahsp" element=\{<PermissionRoute permission="AHSP_VIEW"><AhspRoomPage \/><\/PermissionRoute>\}/);
  assert.match(app, /path="ahsp\/:ahspId" element=\{<PermissionRoute permission="AHSP_VIEW"><AhspDetailPage \/><\/PermissionRoute>\}/);
});

// ── B: no second room ────────────────────────────────────────────────────────

test("B exactly one file renders the AHSP room", () => {
  const renderers = tsxFiles("src")
    .filter((file) => codeOnly(readFileSync(file, "utf8")).includes("<AhspRoomPage"))
    .map(toPosix);
  assert.deepEqual(renderers, ["src/App.tsx"]);
});

test("B the legacy query door redirects instead of rendering a second room", () => {
  assert.ok(observatory.includes("placeholderRoom === 'ahsp'"));
  assert.match(observatory, /<Navigate to="\/ahsp" replace \/>/);
  assert.ok(!observatory.includes("AhspRoomPage"));
});

test("B every other placeholder room is untouched", () => {
  const placeholders = sidebar.match(/ruang=[a-z-]+/g) ?? [];
  assert.deepEqual(placeholders.sort(), [
    "ruang=bantuan",
    "ruang=insight-war-room",
    "ruang=metode-pelaksanaan",
    "ruang=pengaturan",
    "ruang=peralatan",
    "ruang=personel",
    "ruang=recovery",
    "ruang=risiko-bahaya",
  ]);
});

// ── C: real capability, and the right one ────────────────────────────────────

test("C the room consumes the workspace discovery endpoint, not the RAB picker", () => {
  assert.ok(room.includes("apiFetch('/ahsp')"));
  assert.ok(!room.includes("ahsp-occurrences"));
  assert.ok(!room.includes("eligible-versions"));
  assert.ok(!room.includes("ahsp-snapshot"));
});

test("C rows open the existing definition; import is a SEPARATE door, not inline", () => {
  assert.ok(room.includes("to={'/ahsp/' + row.id}"));
  assert.ok(room.includes("method: 'POST'"));
  // Gap F: import moved to its own door; the list no longer dumps the pipeline.
  assert.ok(room.includes("navigate('/ahsp/import')"));
  assert.ok(!room.includes("/ahsp/document/preview"));
  assert.ok(!room.includes("/ahsp/document/commit"));
  assert.ok(!room.includes("pekerjaan dikenali"));
  // Reason codes are never the room's user language.
  assert.ok(!room.includes("MISSING_OUTPUT_UNIT"));
  assert.ok(!room.includes("RESOURCE_UNRESOLVED"));
});

test("C the Owner mockup columns are present", () => {
  for (const col of ['Kode', 'Jenis Pekerjaan', 'Uraian', 'Satuan', 'Bidang', 'Aksi']) {
    assert.ok(room.includes(col), `missing column "${col}"`);
  }
});

test("C search and the five filters form the control area", () => {
  assert.ok(room.includes("Cari kode atau uraian pekerjaan"));
  assert.ok(room.includes("Reset Filter"));
  for (const f of ['Dasar AHSP', 'Bidang / Kategori', 'Subkategori', 'Jenis Pekerjaan']) {
    assert.ok(room.includes(f), `missing filter "${f}"`);
  }
});

test("C the selection bar wires Usulkan ke SIMPROK to the real propose lifecycle", () => {
  assert.ok(room.includes("AHSP dipilih"));
  assert.ok(room.includes("Usulkan ke SIMPROK"));
  assert.ok(room.includes("Hapus"));
  assert.ok(room.includes("Export"));
  // Usulkan is the existing propose route per selected AHSP, never faked.
  assert.ok(room.includes("'/ahsp/' + row.id + '/propose'"));
  assert.ok(room.includes("canProposeAhsp"));
  // No client-side minting or catalog write.
  assert.ok(!room.includes("resourceCatalog.create"));
});

test("C the header offers Panduan and Import", () => {
  assert.ok(room.includes("Panduan AHSP"));
  assert.ok(room.includes("Import AHSP"));
});

test("D the room sends no workspace or project of its own — the server decides tenancy", () => {
  assert.ok(!room.includes("workspaceId="));
  assert.ok(!room.includes("x-workspace-id"));
  assert.ok(!room.includes("projectId"));
  assert.ok(!room.includes("useParams"));
});

// ── Honesty ──────────────────────────────────────────────────────────────────

test("an API failure is never rendered as an empty room", () => {
  assert.ok(room.includes("phase: 'FAILED'"));
  assert.ok(room.includes("Belum ada AHSP yang tersedia"));
  assert.ok(!room.includes("rows: [] }"));
});

test("the room invents no data — the list is persisted GET /ahsp rows", () => {
  assert.ok(!room.includes("fixture"));
  assert.ok(!/const\s+\w*[Rr]ows\s*[:=]\s*\[\s*\{/.test(room));
  assert.ok(room.includes("pageRows.map((row)"));
  assert.ok(room.includes("apiFetch('/ahsp')"));
});

test("the room does not present SIMPROK interpretation as official AHSP identity", () => {
  assert.ok(!room.includes("Tipe metode"));
  assert.ok(!room.includes(">Lokasi<"));
  assert.ok(!room.includes(">Asal<"));
  assert.ok(!room.includes("MANUAL"));
  assert.ok(!room.includes("MOUNTAIN"));
  // Domain values (Bina Marga / Cipta Karya) come from data, never hardcoded.
  assert.ok(!room.includes("Bina Marga"));
  assert.ok(!room.includes("Cipta Karya"));
});

test("the room keeps the private-vs-catalog vocabulary and the canonical labels", () => {
  // Gap D: the redundant "AHSP Milik Saya" accordion is removed from below the
  // table; manual create moved to the Import/Add door. Ownership words remain.
  assert.ok(!room.includes("AHSP Milik Saya"));
  assert.ok(room.includes("AHSP Saya"));
  assert.ok(room.includes("Pustaka SIMPROK"));
  assert.ok(room.includes("AHSP yang tersedia"));
  assert.ok(room.includes("Cari AHSP"));
});
