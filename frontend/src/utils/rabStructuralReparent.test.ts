import assert from "node:assert/strict";
import test from "node:test";

import {
  contiguousFollowingSiblings,
  orderRowsForPersistence,
  reparentRows,
  wouldCreateCycle,
} from "./rabStructuralReparent.ts";
import { insertRowRelativeTo } from "./rabStructuralInsert.ts";
import { assignStructuralNumbers } from "./rabRowNumbering.ts";

/**
 * RAB-FOCUS-01 — smart structural numbering.
 *
 * Every number asserted here comes from `assignStructuralNumbers`, never from
 * a literal this file invented: the point of the feature is that hierarchy and
 * order are the truth and the number is only their representation. If these
 * tests computed numbers themselves they would prove nothing about the product.
 */

const row = (
  id: string,
  parentId: string | null,
  sortOrder: number,
  isFolder = false,
) => ({
  id,
  parentId,
  sortOrder,
  isFolder,
});
const folder = (id: string, parentId: string | null, sortOrder: number) =>
  row(id, parentId, sortOrder, true);
/** Canonical law as the workspace states it: only a Sub Judul is a section. */
const isSection = (r: { isFolder?: boolean }) => r.isFolder === true;
const numbersOf = (rows: ReturnType<typeof row>[]) =>
  assignStructuralNumbers(rows.map((r) => ({ ...r, isNote: false })))
    .map((r) => `${r.id}:${r.number}`)
    .sort();

// ── N1. Flat siblings ───────────────────────────────────────────────────────
test("N1. flat siblings number 1, 2, 3", () => {
  const rows = [row("a", null, 0), row("b", null, 1), row("c", null, 2)];
  assert.deepEqual(numbersOf(rows), ["a:1", "b:2", "c:3"]);
});

// ── N2. Nested ──────────────────────────────────────────────────────────────
test("N2. children number beneath their parent", () => {
  const rows = [
    row("a", null, 0),
    row("b", "a", 0),
    row("c", "a", 1),
    row("d", null, 1),
  ];
  assert.deepEqual(numbersOf(rows), ["a:1", "b:1.1", "c:1.2", "d:2"]);
});

// ── N3. Grandchild ──────────────────────────────────────────────────────────
test("N3. three levels deep", () => {
  const rows = [
    row("a", null, 0),
    row("b", "a", 0),
    row("c", "b", 0),
    row("d", "b", 1),
  ];
  assert.deepEqual(numbersOf(rows), ["a:1", "b:1.1", "c:1.1.1", "d:1.1.2"]);
});

// ── N4. Insert a Sub Judul in the middle ────────────────────────────────────
test("N4. inserting a Sub Judul mid-list keeps every existing row's relative order", () => {
  const rows = [
    row("A", null, 0),
    row("B", null, 1),
    row("C", null, 2),
    row("D", null, 3),
  ];
  const next = insertRowRelativeTo(rows, "C", "above", row("SUB", null, 0));

  // Inserted between B and C, and nothing else changed places.
  assert.deepEqual(numbersOf(next), ["A:1", "B:2", "C:4", "D:5", "SUB:3"]);
  // Still a flat list: inserting a Sub Judul adopts nobody on its own (§16).
  assert.deepEqual(
    next.filter((r) => r.parentId !== null),
    [],
  );
});

// ── N5. Re-parent contiguous existing items ─────────────────────────────────
test("N5. selected rows become children of the chosen Sub Judul", () => {
  const rows = [
    row("A", null, 0),
    row("B", null, 1),
    row("SUB", null, 2),
    row("C", null, 3),
    row("D", null, 4),
  ];
  const { rows: next, movedIds, rejected } = reparentRows(rows, ["C", "D"], "SUB");

  assert.deepEqual(movedIds, ["C", "D"]);
  assert.deepEqual(rejected, []);
  assert.deepEqual(numbersOf(next), ["A:1", "B:2", "C:3.1", "D:3.2", "SUB:3"]);
});

test("N5b. adopted rows append after children the parent already had", () => {
  const rows = [
    row("SUB", null, 0),
    row("existing", "SUB", 0),
    row("C", null, 1),
  ];
  const { rows: next } = reparentRows(rows, ["C"], "SUB");
  assert.deepEqual(numbersOf(next), ["C:1.2", "SUB:1", "existing:1.1"]);
});

test("N5c. the source group closes the gap the departure left", () => {
  const rows = [
    row("SUB", null, 0),
    row("A", null, 1),
    row("B", null, 2),
    row("C", null, 3),
  ];
  const { rows: next } = reparentRows(rows, ["B"], "SUB");
  // A and C are now consecutive roots — no stale hole where B used to be.
  assert.deepEqual(numbersOf(next), ["A:2", "B:1.1", "C:3", "SUB:1"]);
});

// ── N6. Outdent ─────────────────────────────────────────────────────────────
test("N6. a child can leave its parent for the root", () => {
  const rows = [row("SUB", null, 0), row("C", "SUB", 0), row("D", "SUB", 1)];
  const { rows: next } = reparentRows(rows, ["C"], null);
  assert.deepEqual(numbersOf(next), ["C:2", "D:1.1", "SUB:1"]);
});

// ── N7. Move a parent — the subtree stays intact ────────────────────────────
test("N7. re-parenting a Sub Judul carries its children with it", () => {
  const rows = [
    row("TOP", null, 0),
    row("SUB", null, 1),
    row("C", "SUB", 0),
    row("D", "SUB", 1),
  ];
  const { rows: next } = reparentRows(rows, ["SUB"], "TOP");

  assert.deepEqual(numbersOf(next), ["C:1.1.1", "D:1.1.2", "SUB:1.1", "TOP:1"]);
  // The children were never touched — they still point at SUB.
  assert.equal(next.find((r) => r.id === "C")!.parentId, "SUB");
  assert.equal(next.find((r) => r.id === "D")!.parentId, "SUB");
});

test("N7b. naming a row and its own descendant moves only the ancestor", () => {
  const rows = [
    row("TOP", null, 0),
    row("SUB", null, 1),
    row("C", "SUB", 0),
  ];
  const { rows: next, movedIds, rejected } = reparentRows(
    rows,
    ["SUB", "C"],
    "TOP",
  );

  assert.deepEqual(movedIds, ["SUB"]);
  assert.deepEqual(rejected, [{ id: "C", reason: "ALREADY_CHILD_OF_MOVED" }]);
  // C stayed inside SUB rather than being lifted out of the parent that moved.
  assert.equal(next.find((r) => r.id === "C")!.parentId, "SUB");
  assert.deepEqual(numbersOf(next), ["C:1.1.1", "SUB:1.1", "TOP:1"]);
});

// ── N8. Structure changes close deterministically ───────────────────────────
test("N8. numbers close with no stale gap after a move", () => {
  const rows = [
    row("a", null, 0),
    row("b", null, 1),
    row("c", null, 2),
    row("d", null, 3),
  ];
  const { rows: next } = reparentRows(rows, ["b"], "a");
  const numbers = assignStructuralNumbers(
    next.map((r) => ({ ...r, isNote: false })),
  ).map((r) => r.number);

  assert.deepEqual(numbers.slice().sort(), ["1", "1.1", "2", "3"]);
  assert.equal(new Set(numbers).size, numbers.length, "no duplicate numbers");
});

// ── N9. Cycle prevention ────────────────────────────────────────────────────
test("N9. a row cannot become its own parent", () => {
  const rows = [row("a", null, 0)];
  assert.equal(wouldCreateCycle(rows, "a", "a"), true);
  const { movedIds, rejected } = reparentRows(rows, ["a"], "a");
  assert.deepEqual(movedIds, []);
  assert.deepEqual(rejected, [{ id: "a", reason: "CYCLE" }]);
});

test("N9b. an ancestor cannot become a child of its own descendant", () => {
  const rows = [
    row("a", null, 0),
    row("b", "a", 0),
    row("c", "b", 0),
  ];
  assert.equal(wouldCreateCycle(rows, "a", "c"), true);
  const { rows: next, rejected } = reparentRows(rows, ["a"], "c");
  assert.deepEqual(rejected, [{ id: "a", reason: "CYCLE" }]);
  // Refused outright — the tree is exactly as it was.
  assert.deepEqual(numbersOf(next), ["a:1", "b:1.1", "c:1.1.1"]);
});

test("N9c. moving to the root is never a cycle", () => {
  const rows = [row("a", null, 0), row("b", "a", 0)];
  assert.equal(wouldCreateCycle(rows, "b", null), false);
});

// ── N10. Workspace / Viewer consistency ─────────────────────────────────────
test("N10. the same hierarchy numbers identically for both rooms", () => {
  const rows = [
    row("A", null, 0),
    row("SUB", null, 1),
    row("C", "SUB", 0),
    row("D", "SUB", 1),
  ];

  // Ruang Kerja holds rows in edit order; Ruang Hidup receives them in whatever
  // order the API returned. Same facts, so the same numbers.
  const workspaceOrder = rows;
  const viewerOrder = [rows[3], rows[0], rows[2], rows[1]];

  assert.deepEqual(numbersOf(workspaceOrder), numbersOf(viewerOrder));
  assert.deepEqual(numbersOf(viewerOrder), ["A:1", "C:2.1", "D:2.2", "SUB:2"]);
});

// ── Suggestion, not decision (§16, §17) ─────────────────────────────────────
test("S-A. suggests the plain items that follow the new Sub Judul", () => {
  const rows = [
    folder("SUB", null, 0),
    row("A", null, 1),
    row("B", null, 2),
    row("C", null, 3),
  ];
  assert.deepEqual(contiguousFollowingSiblings(rows, "SUB", isSection), [
    "A",
    "B",
    "C",
  ]);
});

test("S-B. the suggestion STOPS at the next Sub Judul at the same level", () => {
  const rows = [
    folder("SUB_A", null, 0),
    row("item1", null, 1),
    row("item2", null, 2),
    folder("SUB_B", null, 3),
    row("item3", null, 4),
  ];
  // item3 belongs to SUB_B by plain reading; proposing it would invite the
  // Owner to confirm something they did not intend.
  assert.deepEqual(contiguousFollowingSiblings(rows, "SUB_A", isSection), [
    "item1",
    "item2",
  ]);
  assert.deepEqual(contiguousFollowingSiblings(rows, "SUB_B", isSection), ["item3"]);
});

test("S-C. nested rows never extend the same-level range", () => {
  const rows = [
    folder("SUB", null, 0),
    row("C", null, 1),
    row("C_child", "C", 0),
    row("C_grandchild", "C_child", 0),
    folder("NEXT", null, 2),
    row("D", null, 3),
  ];
  // Only C is named: its descendants travel with it, and NEXT stops the walk.
  assert.deepEqual(contiguousFollowingSiblings(rows, "SUB", isSection), ["C"]);
});

test("S-C2. a section immediately after suggests nothing at all", () => {
  const rows = [folder("SUB", null, 0), folder("NEXT", null, 1), row("D", null, 2)];
  assert.deepEqual(contiguousFollowingSiblings(rows, "SUB", isSection), []);
});

test("S-D. asking for a suggestion mutates nothing", () => {
  const rows = [folder("SUB", null, 0), row("C", null, 1)];
  const before = JSON.stringify(rows);
  contiguousFollowingSiblings(rows, "SUB", isSection);
  assert.equal(JSON.stringify(rows), before);
  assert.deepEqual(numbersOf(rows), ["C:2", "SUB:1"]);
});

test("S-E. narrowing the suggestion produces exactly the narrowed structure", () => {
  const rows = [
    folder("SUB", null, 0),
    row("A", null, 1),
    row("B", null, 2),
    row("C", null, 3),
  ];
  const suggested = contiguousFollowingSiblings(rows, "SUB", isSection);
  assert.deepEqual(suggested, ["A", "B", "C"]);

  // The Owner unticks B. Only A and C move; B stays exactly where it was.
  const narrowed = suggested.filter((id) => id !== "B");
  const { rows: after, movedIds } = reparentRows(rows, narrowed, "SUB");

  assert.deepEqual(movedIds, ["A", "C"]);
  assert.deepEqual(numbersOf(after), ["A:1.1", "B:2", "C:1.2", "SUB:1"]);
  assert.equal(after.find((r) => r.id === "B")!.parentId, null);
});

// ── Persistence ordering (task-owned repair) ────────────────────────────────
test("persistence order always places a parent before its children", () => {
  // The order a re-parent leaves behind: the adopted child sits earlier in the
  // array than the Sub Judul that now owns it.
  const rows = [row("C", "SUB", 0), row("A", null, 0), row("SUB", null, 1)];
  const ordered = orderRowsForPersistence(rows).map((r) => r.id);

  assert.deepEqual(ordered, ["A", "SUB", "C"]);
  ordered.forEach((id, index) => {
    const parentId = rows.find((r) => r.id === id)!.parentId;
    if (parentId) assert.ok(ordered.indexOf(parentId) < index, `${id} after parent`);
  });
});

test("persistence order emits every row exactly once, even in a cycle", () => {
  // No lawful edit produces this; a payload that silently dropped rows would
  // be worse than one that saves them at the root.
  const rows = [row("a", "b", 0), row("b", "a", 0), row("ok", null, 0)];
  const ordered = orderRowsForPersistence(rows).map((r) => r.id);
  assert.equal(ordered.length, 3);
  assert.deepEqual([...ordered].sort(), ["a", "b", "ok"]);
});

test("persistence order walks siblings in sortOrder, not array order", () => {
  const rows = [row("second", null, 1), row("first", null, 0)];
  assert.deepEqual(
    orderRowsForPersistence(rows).map((r) => r.id),
    ["first", "second"],
  );
});

// ── §13 SCALE PROOF — a large RAB must stay light ───────────────────────────

/** 1,000 rows: 20 sections of 49 items, plus one grandchild per section. */
const buildLargeRab = () => {
  const rows: ReturnType<typeof row>[] = [];
  let order = 0;
  for (let s = 0; s < 20; s += 1) {
    rows.push(folder(`S${s}`, null, order++));
    for (let i = 0; i < 48; i += 1) rows.push(row(`S${s}_i${i}`, `S${s}`, i));
    rows.push(row(`S${s}_deep`, `S${s}_i0`, 0));
  }
  return rows;
};

test("SCALE. 1,000-row batch re-parent stays correct", () => {
  const rows = buildLargeRab();
  assert.equal(rows.length, 1000);

  // Adopt 300 items from ten sections into one destination.
  const selection = rows
    .filter((r) => !r.isFolder && /_i\d+$/.test(r.id) && Number(r.id.split("_i")[1]) < 30)
    .slice(0, 300)
    .map((r) => r.id);
  assert.equal(selection.length, 300);

  const { rows: after, movedIds, rejected } = reparentRows(rows, selection, "S0");
  assert.equal(movedIds.length, 300);
  assert.deepEqual(rejected, []);

  const numbered = assignStructuralNumbers(
    after.map((r) => ({ ...r, isNote: false })),
  );
  // Every row still present, every number unique, nothing orphaned or duplicated.
  assert.equal(numbered.length, 1000);
  assert.equal(new Set(numbered.map((r) => r.number)).size, 1000);
  // The subtree stayed intact: S0_deep still hangs off S0_i0, which moved.
  assert.equal(after.find((r) => r.id === "S0_deep")!.parentId, "S0_i0");
  assert.equal(after.find((r) => r.id === "S0_i0")!.parentId, "S0");
  // Dense, tie-free ordering in the destination group.
  const destination = after
    .filter((r) => r.parentId === "S0")
    .map((r) => r.sortOrder)
    .sort((a, b) => a - b);
  assert.deepEqual(destination, [...destination.keys()]);
});

test("SCALE. selecting more rows does not multiply tree traversal", () => {
  /**
   * The regression this guards: the first implementation rebuilt the child map
   * inside a descendant walk and ran that walk per selected PAIR, so reads grew
   * with k². Counting parentId reads through a Proxy measures the traversal
   * shape directly, and is deterministic — no wall-clock, no CI flake.
   */
  const instrument = (source: ReturnType<typeof row>[]) => {
    let reads = 0;
    const proxied = source.map(
      (r) =>
        new Proxy(r, {
          get(target, prop, receiver) {
            if (prop === "parentId") reads += 1;
            return Reflect.get(target, prop, receiver);
          },
        }),
    );
    return { proxied, reads: () => reads };
  };

  const measure = (selectedCount: number) => {
    const { proxied, reads } = instrument(buildLargeRab());
    const selection = proxied
      .filter((r) => !r.isFolder && /_i\d+$/.test(r.id))
      .slice(0, selectedCount)
      .map((r) => r.id);
    reparentRows(proxied, selection, "S19");
    return reads();
  };

  const small = measure(10);
  const large = measure(300);

  // 30x the selection must not cost anything like 30x — let alone 900x. The
  // per-row work is a bounded ancestor walk over a shared index, so the growth
  // is additive, not multiplicative.
  assert.ok(
    large < small * 3,
    `reads grew from ${small} (k=10) to ${large} (k=300) — traversal is multiplying with the selection`,
  );
  // And the absolute cost stays proportional to the document, not to k².
  assert.ok(large < 20000, `expected a few passes over 1,000 rows, saw ${large} reads`);
});

// ── §36 OWNER SCENARIO — mandatory behavioural proof ────────────────────────
test("§36 Owner scenario: insert a Sub Judul mid-RAB, then adopt C, D, E", () => {
  // 1  PARENT A / 1.1 Item A … 1.5 Item E
  const before = [
    row("PARENT_A", null, 0),
    row("itemA", "PARENT_A", 0),
    row("itemB", "PARENT_A", 1),
    row("itemC", "PARENT_A", 2),
    row("itemD", "PARENT_A", 3),
    row("itemE", "PARENT_A", 4),
  ];
  assert.deepEqual(numbersOf(before), [
    "PARENT_A:1",
    "itemA:1.1",
    "itemB:1.2",
    "itemC:1.3",
    "itemD:1.4",
    "itemE:1.5",
  ]);

  // The user inserts a new Sub Judul above Item C.
  const withSub = insertRowRelativeTo(
    before,
    "itemC",
    "above",
    row("SUB", null, 0),
  );
  // It takes position 1.3 and adopts NOBODY on its own.
  assert.deepEqual(numbersOf(withSub), [
    "PARENT_A:1",
    "SUB:1.3",
    "itemA:1.1",
    "itemB:1.2",
    "itemC:1.4",
    "itemD:1.5",
    "itemE:1.6",
  ]);

  // SIMPROK may SUGGEST the rows below it; the human still chooses.
  assert.deepEqual(contiguousFollowingSiblings(withSub, "SUB", isSection), [
    "itemC",
    "itemD",
    "itemE",
  ]);

  // The user deliberately selects Item C, D, E → "Jadikan Anak dari SUB".
  const { rows: after, movedIds, rejected } = reparentRows(
    withSub,
    ["itemC", "itemD", "itemE"],
    "SUB",
  );

  assert.deepEqual(movedIds, ["itemC", "itemD", "itemE"]);
  assert.deepEqual(rejected, []);

  // Expected persisted/rendered result.
  assert.deepEqual(numbersOf(after), [
    "PARENT_A:1",
    "SUB:1.3",
    "itemA:1.1",
    "itemB:1.2",
    "itemC:1.3.1",
    "itemD:1.3.2",
    "itemE:1.3.3",
  ]);

  // Parent ids correct.
  const parentOf = (id: string) => after.find((r) => r.id === id)!.parentId;
  assert.equal(parentOf("itemC"), "SUB");
  assert.equal(parentOf("itemD"), "SUB");
  assert.equal(parentOf("itemE"), "SUB");
  assert.equal(parentOf("SUB"), "PARENT_A");

  // Sibling order correct, densely and without ties.
  const sortOf = (id: string) => after.find((r) => r.id === id)!.sortOrder;
  assert.deepEqual(
    [sortOf("itemC"), sortOf("itemD"), sortOf("itemE")],
    [0, 1, 2],
  );

  // No unrelated row moved: A and B kept both their parent and their position.
  assert.equal(parentOf("itemA"), "PARENT_A");
  assert.equal(parentOf("itemB"), "PARENT_A");
  assert.equal(sortOf("itemA"), 0);
  assert.equal(sortOf("itemB"), 1);

  // The payload sent to saveDraftBoq lists SUB before the rows it now owns, so
  // the server's tempId map can resolve them (without this they re-root).
  const payloadOrder = orderRowsForPersistence(after).map((r) => r.id);
  assert.ok(payloadOrder.indexOf("SUB") < payloadOrder.indexOf("itemC"));
  assert.ok(payloadOrder.indexOf("PARENT_A") < payloadOrder.indexOf("SUB"));

  // Reload / Viewer: the same persisted facts, arriving in any order, number
  // identically — there is only one numbering authority.
  const reloaded = [...after].reverse();
  assert.deepEqual(numbersOf(reloaded), numbersOf(after));
});
