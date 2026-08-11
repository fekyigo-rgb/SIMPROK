import assert from "node:assert/strict";
import test from "node:test";
import { assignStructuralNumbers } from "./rabRowNumbering.ts";
import {
  toPersistedRowDisplayList,
  type PersistedBoqItem,
} from "./rabPersistedDraftDisplay.ts";

// ─────────────────────────────────────────────────────────────────────────────
// RAB-TRACE-01 — NO is the row's official structural position
//
// The same row must carry the same number in Ruang Kerja and Ruang Hidup. The
// viewer used to fall back to the row's index in the response array, so the
// two rooms disagreed the moment a folder or a note existed.
// ─────────────────────────────────────────────────────────────────────────────

const row = (id: string, parentId: string | null, sortOrder: number, isNote = false) => ({
  id,
  parentId,
  sortOrder,
  isNote,
});

test("N-1. hierarchy is numbered 1, 1.1, 1.2, 2 — deterministically", () => {
  const numbered = assignStructuralNumbers([
    row("b", null, 2),
    row("a", null, 1),
    row("a2", "a", 4),
    row("a1", "a", 3),
  ]);

  assert.deepEqual(
    numbered.map((r) => [r.id, r.number, r.depth]),
    [
      ["a", "1", 0],
      ["a1", "1.1", 1],
      ["a2", "1.2", 1],
      ["b", "2", 0],
    ],
  );
});

test("N-2. numbering is driven by sortOrder, never by input order", () => {
  const forward = assignStructuralNumbers([row("x", null, 1), row("y", null, 2)]);
  const reversed = assignStructuralNumbers([row("y", null, 2), row("x", null, 1)]);

  assert.deepEqual(
    forward.map((r) => [r.id, r.number]),
    reversed.map((r) => [r.id, r.number]),
  );
});

test("N-3. a note holds its place but takes no number", () => {
  const numbered = assignStructuralNumbers([
    row("first", null, 1),
    row("note", null, 2, true),
    row("third", null, 3),
  ]);

  assert.deepEqual(
    numbered.map((r) => [r.id, r.number]),
    [
      ["first", "1"],
      ["note", ""],
      // The note occupies position 2, exactly as Ruang Kerja has always
      // numbered it — this is the existing law, not a new one.
      ["third", "3"],
    ],
  );
});

test("N-4. a row whose parent is absent is shown, not dropped", () => {
  const numbered = assignStructuralNumbers([row("orphan", "missing-parent", 1)]);
  assert.equal(numbered.length, 1);
  assert.equal(numbered[0].number, "1");
});

test("N-5. a parent cycle terminates AND preserves every row", () => {
  // A cycle cannot reach this surface through lawful editing — indentRow and
  // outdentRow only ever reparent within existing siblings — but a numbering
  // authority that silently dropped rows would hide data rather than show it.
  // The contract is therefore explicit: terminate, and lose nobody.
  const numbered = assignStructuralNumbers([
    { id: "a", parentId: "b", sortOrder: 1, isNote: false },
    { id: "b", parentId: "a", sortOrder: 2, isNote: false },
  ]);

  assert.deepEqual(
    numbered.map((r) => r.id).sort(),
    ["a", "b"],
    "a cycle must not make rows disappear",
  );
  for (const row of numbered) {
    assert.notEqual(row.number, "", `${row.id} lost its number`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// The two rooms must agree
// ─────────────────────────────────────────────────────────────────────────────

const item = (over: Partial<PersistedBoqItem> & { id: string }): PersistedBoqItem => ({
  wbsCode: "",
  name: "",
  itemType: "WORK_ITEM",
  quantity: "1.000000",
  unit: "m3",
  unitPrice: null,
  lineTotal: null,
  priceOrigin: null,
  calculationOccurrenceId: null,
  calculationAsOfDate: null,
  calculatedAt: null,
  calculationPolicyVersion: null,
  ...over,
});

test("N-6. the viewer numbers rows with the same authority, not by array index", () => {
  // Deliberately out of order, with a folder parent, so an index-based
  // fallback would give a different answer.
  const rows = toPersistedRowDisplayList([
    item({ id: "child", parentId: "folder", sortOrder: 3, name: "Child" }),
    item({ id: "folder", parentId: null, sortOrder: 1, itemType: "FOLDER", name: "Folder" }),
    item({ id: "second", parentId: null, sortOrder: 9, name: "Second" }),
  ]);

  assert.deepEqual(
    rows.map((r) => [r.id, r.number]),
    [
      ["folder", "1"],
      ["child", "1.1"],
      ["second", "2"],
    ],
  );

  // And it is the same answer the workspace authority gives for that tree.
  const workspaceAnswer = assignStructuralNumbers([
    row("child", "folder", 3),
    row("folder", null, 1),
    row("second", null, 9),
  ]);
  assert.deepEqual(
    rows.map((r) => [r.id, r.number]),
    workspaceAnswer.map((r) => [r.id, r.number]),
  );
});

test("N-7. a payload without structural fields still renders in a stable order", () => {
  // Older payloads carried neither parentId nor sortOrder; the viewer must not
  // crash or renumber unpredictably.
  const rows = toPersistedRowDisplayList([
    item({ id: "one", name: "One" }),
    item({ id: "two", name: "Two" }),
  ]);
  assert.deepEqual(
    rows.map((r) => [r.id, r.number]),
    [
      ["one", "1"],
      ["two", "2"],
    ],
  );
});
