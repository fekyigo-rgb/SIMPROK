import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  availableInsertPositions,
  descendantIdsOf,
  insertRowRelativeTo,
} from "./rabStructuralInsert.ts";
import { assignStructuralNumbers } from "./rabRowNumbering.ts";

/**
 * RAB-TABLE-UX-01R-FINAL — inserting where the Owner chose.
 *
 * These prove the two things that make a hierarchical RAB behave like a
 * document rather than a list: a row lands among the right SIBLINGS, and the
 * numbers that follow come from the existing numbering authority rather than
 * from anything computed here.
 */

const row = (id: string, parentId: string | null, sortOrder: number) => ({
  id,
  parentId,
  sortOrder,
});
const numbersOf = (rows: ReturnType<typeof row>[]) =>
  assignStructuralNumbers(rows.map((r) => ({ ...r, isNote: false }))).map(
    (r) => `${r.id}:${r.number}`,
  );

const FLAT = [row("a", null, 0), row("b", null, 1), row("c", null, 2)];

test("inserts above a row and pushes the rest down", () => {
  const next = insertRowRelativeTo(FLAT, "b", "above", row("new", null, 0));
  assert.deepEqual(numbersOf(next), ["a:1", "new:2", "b:3", "c:4"]);
});

test("inserts below a row", () => {
  const next = insertRowRelativeTo(FLAT, "b", "below", row("new", null, 0));
  assert.deepEqual(numbersOf(next), ["a:1", "b:2", "new:3", "c:4"]);
});

/**
 * POSITION IS NOT IDENTITY. Every pre-existing row keeps its id; only the
 * position field moves. A row whose visible NO changed is still the same BOQ
 * item to the server.
 */
test("existing rows keep their identity when numbering shifts", () => {
  const next = insertRowRelativeTo(FLAT, "a", "above", row("new", null, 0));
  assert.deepEqual(next.map((r) => r.id).sort(), ["a", "b", "c", "new"]);
  assert.deepEqual(numbersOf(next), ["new:1", "a:2", "b:3", "c:4"]);
  // The originals are still the same objects' ids, not recreated ones.
  for (const id of ["a", "b", "c"]) {
    assert.ok(next.find((r) => r.id === id), `${id} was recreated or lost`);
  }
});

test("a new child joins the end of the section it was added to", () => {
  const tree = [
    row("s", null, 0),
    row("s1", "s", 0),
    row("s2", "s", 1),
    row("z", null, 1),
  ];
  const next = insertRowRelativeTo(tree, "s", "inside", row("new", null, 0));
  assert.deepEqual(numbersOf(next), ["s:1", "s1:1.1", "s2:1.2", "new:1.3", "z:2"]);
});

/**
 * A SUBTREE IS ONE UNIT. Inserting "below" a section must land after that
 * whole section, not inside it — the failure a flat-array index would produce.
 */
test("inserting below a section lands after its children, not inside them", () => {
  const tree = [
    row("s", null, 0),
    row("s1", "s", 0),
    row("s2", "s", 1),
    row("z", null, 1),
  ];
  const next = insertRowRelativeTo(tree, "s", "below", row("new", null, 0));
  assert.deepEqual(numbersOf(next), ["s:1", "s1:1.1", "s2:1.2", "new:2", "z:3"]);
  assert.equal(next.find((r) => r.id === "new")!.parentId, null, "the new row was captured by the section");
});

test("inserting beside a child stays inside that child's section", () => {
  const tree = [
    row("s", null, 0),
    row("s1", "s", 0),
    row("s2", "s", 1),
  ];
  const next = insertRowRelativeTo(tree, "s1", "below", row("new", null, 0));
  assert.deepEqual(numbersOf(next), ["s:1", "s1:1.1", "new:1.2", "s2:1.3"]);
  assert.equal(next.find((r) => r.id === "new")!.parentId, "s");
});

test("siblings never share a sortOrder, so order cannot depend on array luck", () => {
  const tree = [row("a", null, 5), row("b", null, 5), row("c", null, 5)];
  const next = insertRowRelativeTo(tree, "b", "above", row("new", null, 0));
  const roots = next.filter((r) => r.parentId === null).map((r) => r.sortOrder);
  assert.equal(new Set(roots).size, roots.length, "two siblings share a position");
});

test("only a row that can hold children offers 'inside'", () => {
  assert.deepEqual(availableInsertPositions(true), ["above", "below", "inside"]);
  assert.deepEqual(availableInsertPositions(false), ["above", "below"]);
});

test("an unknown target appends at root rather than losing the row", () => {
  const next = insertRowRelativeTo(FLAT, "nope", "below", row("new", null, 0));
  assert.equal(next.length, 4);
  assert.equal(next.find((r) => r.id === "new")!.parentId, null);
});

test("descendants are collected transitively, for an honest delete warning", () => {
  const tree = [
    row("s", null, 0),
    row("s1", "s", 0),
    row("s1a", "s1", 0),
    row("z", null, 1),
  ];
  assert.deepEqual(descendantIdsOf(tree, "s").sort(), ["s1", "s1a"]);
  assert.deepEqual(descendantIdsOf(tree, "z"), []);
});

/**
 * This module states no numbers of its own — that is assignStructuralNumbers'
 * job, and a second numbering authority is how hierarchy quietly drifts. The
 * check reads the CODE with comments stripped, so the prose above (which talks
 * about numbering precisely to say it does none) cannot make it pass or fail.
 */
test("no second numbering authority is introduced here", () => {
  const code = readFileSync("src/utils/rabStructuralInsert.ts", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(code, /\.join\(\s*['"]\.['"]\s*\)/, "a dotted number is composed here");
  assert.doesNotMatch(code, /\$\{[^}]*\}\.\$\{/, "a dotted number is built by template");
  assert.doesNotMatch(code, /assignStructuralNumbers|StructuralNumber/, "numbering was re-implemented");
});
