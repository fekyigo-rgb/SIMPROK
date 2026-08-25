import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { unitColumnOptions } from "./basicPriceColumnRole.ts";

/**
 * THE OWNER'S 934-ROW BATCH, PINNED AT THE SCREEN.
 *
 * The intake question "which column holds the SATUAN?" offered the very column
 * the same person had just named as the resource name, and clicking it was
 * accepted. Every row then carried its own name as its unit, 40 category
 * banners entered the review room as resources, and not one of the 934 rows
 * could close its identity pair.
 *
 * The backend now refuses that pair at the intake boundary, and that refusal is
 * proven by a real parse in
 * backend/src/basic-price/basic-price-column-role-collision.spec.ts. What is
 * proven HERE is the second layer: the impossible option is never drawn.
 */

const CANDIDATES = [
  { columnNumber: 2, samples: ["Resource A Uji", "Resource B Uji"] },
  { columnNumber: 3, samples: ["M3", "KG"] },
];

test("C-1. the column already named as the resource name is never offered as the unit", () => {
  const options = unitColumnOptions(CANDIDATES, 2);
  assert.deepEqual(
    options.map((candidate) => candidate.columnNumber),
    [3],
  );
});

test("C-2. every other option survives, so the question stays answerable", () => {
  const wider = [...CANDIDATES, { columnNumber: 5, samples: ["Ket", "Ket"] }];
  assert.deepEqual(
    unitColumnOptions(wider, 3).map((candidate) => candidate.columnNumber),
    [2, 5],
  );
});

test("C-3. with no name column answered yet, nothing is filtered away", () => {
  // The first half of the question must show the full list. Narrowing it
  // against an answer nobody has given would hide a real option.
  assert.deepEqual(
    unitColumnOptions(CANDIDATES, undefined).map((c) => c.columnNumber),
    [2, 3],
  );
});

test("C-4. the named column is NEVER reintroduced, even when removing it empties the list", () => {
  // The trap this closes: an earlier form fell back to the unpruned list when
  // filtering emptied it, which drew the named column as the only button in
  // the one document where it was the only candidate — the case most likely to
  // be clicked, and the click the backend refuses. An empty list is how
  // SIMPROK says "this document states no unit column", and
  // IntakeQuestionPanel already has an honest sentence for exactly that.
  const only = [CANDIDATES[0]];
  assert.deepEqual(unitColumnOptions(only, 2), []);
  assert.deepEqual(unitColumnOptions([], 2), []);
});

test("C-6. no answered name column ever survives into the offered unit options", () => {
  // Stated over every shape rather than one example, so a future edit cannot
  // restore the option through a branch this file forgot to name.
  const wider = [...CANDIDATES, { columnNumber: 5, samples: ["a", "b"] }];
  for (const list of [CANDIDATES, wider, [CANDIDATES[0]], []]) {
    for (const named of [2, 3, 5]) {
      assert.equal(
        unitColumnOptions(list, named).some((c) => c.columnNumber === named),
        false,
      );
    }
  }
});

test("C-5. the component asks this function rather than filtering on its own", () => {
  // IntakeQuestion.tsx cannot be imported by this runner, so the one thing
  // asserted from its source is the WIRING — a law proven against a helper the
  // component does not call would be proving nothing.
  const source = readFileSync(
    "src/components/basic-price/IntakeQuestion.tsx",
    "utf8",
  );
  const branch = source.slice(
    source.indexOf("case 'COLUMN_ROLE_SELECTION_REQUIRED'"),
  );
  assert.match(source, /import \{ unitColumnOptions \}/);
  assert.match(
    branch.slice(0, branch.indexOf("case '", 10)),
    /unitColumnOptions\(offered, answered\.selectedNameColumn\)/,
  );
});
