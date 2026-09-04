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

test("detail activates existing governed routes, never a second engine", () => {
  assert.ok(detail.includes("'/ahsp/' + state.ahsp.id + '/approve'"));
  assert.ok(detail.includes("'/ahsp/' + state.ahsp.id + '/archive'"));
  assert.ok(detail.includes("'/ahsp/' + state.ahsp.id + '/transfer'"));
  assert.ok(detail.includes("'/ahsp/' + ahspId + '/versions'"));
  assert.ok(detail.includes("'/ahsp/versions/' + selectedVersion.id + '/retire'"));
  assert.ok(detail.includes("'/ahsp/versions/' + selectedVersion.id + '/snapshot'"));
  assert.ok(detail.includes("APPROVED_COMMUNITY_ASSET"));
  assert.ok(!detail.includes("SIMPROK_ASSET"));
});

test("detail is not a second sidebar door", () => {
  assert.equal((sidebar.match(/name: 'AHSP'/g) ?? []).length, 1);
  assert.ok(!sidebar.includes("path: '/ahsp/"));
});

test("kode AHSP is displayed only when stored, never invented", () => {
  assert.ok(detail.includes("Kode AHSP"));
  assert.ok(detail.includes("orDash(null)"));
  assert.ok(!detail.includes("Bina Marga"));
  assert.ok(!detail.includes("Cipta Karya"));
});

test("components are grouped from stored version resources", () => {
  assert.ok(detail.includes("groupAhspDefinitionResources"));
  assert.ok(detail.includes("selectedVersion?.resources"));
});

test("the reader can return to the canonical list", () => {
  assert.ok(detail.includes('to="/ahsp"'));
});
