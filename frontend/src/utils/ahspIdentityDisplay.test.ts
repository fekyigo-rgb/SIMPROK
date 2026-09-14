import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { presentAhspIdentity } from "./ahspIdentityDisplay.ts";

/**
 * ACG-01 OWNER BROWSER GAP — FINDING A. An imported AHSP's source code travels
 * in the identity column `workType`; since CLOSURE 2 it is also recorded as
 * `code`. The recorded code is shown as Kode and never repeated as Jenis
 * Pekerjaan. Only recorded truth moves — no shape rule, no invented work type.
 */

test("A1: a recorded code equal to the identity value is the code, and Jenis Pekerjaan is not invented", () => {
  assert.deepEqual(
    presentAhspIdentity({ code: "1.7.7.1.1.b (a)", workType: "1.7.7.1.1.b (a)" }),
    { code: "1.7.7.1.1.b (a)", workType: null },
  );
});

test("A2: a manual AHSP keeps the Jenis Pekerjaan a person typed", () => {
  assert.deepEqual(presentAhspIdentity({ code: null, workType: "Galian" }), {
    code: null,
    workType: "Galian",
  });
});

test("A3: a row whose code was never recorded is shown exactly as stored (Owner ruling: no shape rule)", () => {
  // Code-shaped, but nothing recorded says it is a code — it is not moved.
  assert.deepEqual(presentAhspIdentity({ code: null, workType: "1.7.7.1.1.b (a)" }), {
    code: null,
    workType: "1.7.7.1.1.b (a)",
  });
  assert.deepEqual(presentAhspIdentity({ code: "", workType: "A.1" }), {
    code: null,
    workType: "A.1",
  });
});

test("A4: a recorded code that differs from the work type leaves both as stored", () => {
  assert.deepEqual(presentAhspIdentity({ code: "A.2.3.1", workType: "Pekerjaan Tanah" }), {
    code: "A.2.3.1",
    workType: "Pekerjaan Tanah",
  });
});

test("A5: equality is byte-exact, never case- or space-folded", () => {
  assert.deepEqual(presentAhspIdentity({ code: "1.7.7.1.1.B (A)", workType: "1.7.7.1.1.b (a)" }), {
    code: "1.7.7.1.1.B (A)",
    workType: "1.7.7.1.1.b (a)",
  });
});

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

test("A6: every reader of Jenis Pekerjaan on the room and the detail goes through the ONE mapping", () => {
  const room = codeOnly(readFileSync("src/pages/AhspRoomPage.tsx", "utf8"));
  const detail = codeOnly(readFileSync("src/pages/AhspDetailPage.tsx", "utf8"));
  assert.ok(room.includes("presentAhspIdentity"));
  assert.ok(detail.includes("presentAhspIdentity"));
  // The table cell, the filter vocabulary, the filter itself and the export all
  // read the mapped value; none reads the raw identity column as a work type.
  assert.ok(!room.includes("orDash(row.workType)"));
  assert.ok(!room.includes("allRows.map((r) => r.workType)"));
  assert.ok(!room.includes("(row.workType ?? '') !== jenis"));
  assert.ok(!room.includes("r.workType ?? ''"));
  assert.ok(!detail.includes("orDash(ahsp.workType)"));
});
