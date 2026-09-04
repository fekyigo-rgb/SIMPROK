import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * ONE AHSP ROOM, ONE DOOR.
 *
 * AHSP had capability but no room: the sidebar pointed at ?ruang=ahsp, which
 * rendered Beranda with a "menunggu engine" badge. The room now exists at
 * /ahsp and asks GET /ahsp — the workspace VISIBILITY list, deliberately not
 * the RAB binding predicate.
 *
 * These are SOURCE laws, matching this suite's established style: a render test
 * proves one path, whereas reading every navigation site forbids the whole
 * class. They pin two things — the room consumes the real capability, and it is
 * the only standalone door.
 */

const NEWLINE = String.fromCharCode(10);
const BACKSLASH = String.fromCharCode(92);
const toPosix = (p: string) => p.split(BACKSLASH).join("/");

/** Comments describe the law; they must never be mistaken for the code. */
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
  assert.ok(!sidebar.includes("ruang=ahsp"), "the placeholder door must not remain");
});

test("A App routes /ahsp to the room behind the backend's own permission", () => {
  assert.match(
    app,
    /path="ahsp" element=\{<PermissionRoute permission="AHSP_VIEW"><AhspRoomPage \/><\/PermissionRoute>\}/,
  );
});

test("A App routes /ahsp/:ahspId to the existing definition, not a second room", () => {
  assert.match(
    app,
    /path="ahsp\/:ahspId" element=\{<PermissionRoute permission="AHSP_VIEW"><AhspDetailPage \/><\/PermissionRoute>\}/,
  );
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
  assert.ok(!observatory.includes("AhspRoomPage"), "Beranda must not render the room");
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

test("C the room consumes the workspace discovery endpoint", () => {
  assert.ok(room.includes("apiFetch('/ahsp')"), "must call GET /ahsp");
  // The RAB-contextual endpoints belong to the binding path, not to discovery.
  assert.ok(!room.includes("ahsp-occurrences"), "must not borrow the RAB picker");
  assert.ok(!room.includes("eligible-versions"), "must not borrow binding eligibility");
  assert.ok(!room.includes("ahsp-snapshot"), "must not borrow the project snapshot");
});

test("C the room opens the existing definition by id, never a project bind", () => {
  assert.ok(room.includes("to={'/ahsp/' + row.id}"), "a row must open GET /ahsp/:id");
  assert.ok(room.includes("Menunggu mesin"), "import stays honest until intake is connected");
});

test("C the room sends no workspace of its own — the server decides tenancy", () => {
  assert.ok(!room.includes("workspaceId="), "no workspace may be put on the query");
  assert.ok(!room.includes("x-workspace-id"), "no workspace header may be forged here");
});

test("D the room never takes a project", () => {
  assert.ok(!room.includes("projectId"), "workspace discovery must not become project truth");
  assert.ok(!room.includes("useParams"), "no route parameter is required to enter");
});

// ── Honesty ──────────────────────────────────────────────────────────────────

test("an API failure is never rendered as an empty room", () => {
  assert.ok(room.includes("phase: 'FAILED'"), "failure is its own state");
  assert.ok(room.includes("Belum ada AHSP yang tersedia"), "empty is its own state");
  assert.ok(!room.includes("rows: [] }"), "no failure path may fabricate an empty list");
});

test("the room invents no data", () => {
  assert.ok(!room.includes("fixture"), "no fixture may stand in for database truth");
  assert.ok(!/const\s+\w*[Rr]ows\s*[:=]\s*\[\s*\{/.test(room), "no hardcoded AHSP rows");
  // The version count is the database's, never counted in the browser.
  assert.ok(room.includes("_count?.versions"), "version count comes from the payload");
  assert.ok(!room.includes(".length}"), "no count may be derived for display");
});
