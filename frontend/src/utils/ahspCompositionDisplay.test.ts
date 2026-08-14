import assert from "node:assert/strict";
import test from "node:test";

import {
  formatCoefficient,
  groupAhspComposition,
  hasAnyComponent,
} from "./ahspCompositionDisplay.ts";

/**
 * RAB-TABLE-UX-01R GAP-08 — the AHSP recipe is GROUPED existing domain data,
 * never a second analysis. These pin the two things that could quietly go
 * wrong: a component landing in the wrong group, and a coefficient being
 * "tidied" into a different number.
 */

const rows = [
  { rawAhspResourceRef: "Pekerja", rawAhspResourceType: "LABOR", ahspUnit: "OH", ahspCoefficient: "0.660000", status: "RESOLVED" },
  { rawAhspResourceRef: "Mandor", rawAhspResourceType: "LABOR", ahspUnit: "OH", ahspCoefficient: "0.066000", status: "RESOLVED" },
  { rawAhspResourceRef: "Batu Belah", rawAhspResourceType: "MATERIAL", ahspUnit: "m3", ahspCoefficient: "1.200000", status: "RESOLVED" },
  { rawAhspResourceRef: "Mortar", rawAhspResourceType: "MATERIAL", ahspUnit: "m3", ahspCoefficient: "0.480000", status: "NEEDS_REVIEW" },
  { rawAhspResourceRef: "Alat Bantu", rawAhspResourceType: "EQUIPMENT", ahspUnit: "Ls", ahspCoefficient: "1.000000", status: "RESOLVED" },
];

test("groups Tenaga, Bahan and Peralatan in the order an analysis is written", () => {
  const groups = groupAhspComposition(rows);
  assert.deepEqual(
    groups.map((g) => g.key),
    ["TENAGA", "BAHAN", "PERALATAN"],
  );
  assert.deepEqual(
    groups.map((g) => g.label),
    ["Tenaga", "Bahan", "Peralatan"],
  );
  assert.deepEqual(groups.map((g) => g.rows.length), [2, 2, 1]);
  assert.deepEqual(groups[0].rows.map((r) => r.name), ["Pekerja", "Mandor"]);
  assert.deepEqual(groups[2].rows.map((r) => r.name), ["Alat Bantu"]);
});

test("carries each component's own unit and coefficient", () => {
  const [tenaga, bahan] = groupAhspComposition(rows);
  assert.deepEqual(tenaga.rows[0], {
    name: "Pekerja",
    unit: "OH",
    coefficient: "0.66",
    unresolved: false,
  });
  assert.equal(bahan.rows[0].unit, "m3");
  assert.equal(bahan.rows[0].coefficient, "1.2");
});

/**
 * An unproven component is part of the recipe and stays visible. Hiding it
 * would make an incomplete analysis look complete — the exact cosmetic lie
 * SIMPROK forbids. Mortar is the live example (MULTIPLE_CANDIDATES).
 */
test("an unresolved component is still listed, and marked", () => {
  const bahan = groupAhspComposition(rows)[1];
  const mortar = bahan.rows.find((r) => r.name === "Mortar");
  assert.ok(mortar, "an unresolved component was dropped from the recipe");
  assert.equal(mortar.unresolved, true);
  assert.equal(mortar.coefficient, "0.48");
  assert.equal(bahan.rows.find((r) => r.name === "Batu Belah")?.unresolved, false);
});

test("trims padding zeros without ever changing the value", () => {
  assert.equal(formatCoefficient("0.660000"), "0.66");
  assert.equal(formatCoefficient("1.000000"), "1");
  assert.equal(formatCoefficient("12"), "12");
  assert.equal(formatCoefficient("0.000001"), "0.000001");
  assert.equal(formatCoefficient("0.000000"), "0");
  assert.equal(formatCoefficient(0.5), "0.5");
  // Never invents a number where the source states none.
  assert.equal(formatCoefficient(null), "—");
  assert.equal(formatCoefficient(""), "—");
  // Anything that is not a plain decimal is shown verbatim, not mangled.
  assert.equal(formatCoefficient("1,5e3"), "1,5e3");
});

test("an empty or absent analysis reports honestly rather than inventing rows", () => {
  const empty = groupAhspComposition([]);
  assert.equal(empty.length, 3, "the three groups are always named");
  assert.equal(hasAnyComponent(empty), false);
  assert.equal(hasAnyComponent(groupAhspComposition(null)), false);
  assert.equal(hasAnyComponent(groupAhspComposition(rows)), true);
});

test("an unknown resource type is not silently filed under a real group", () => {
  const groups = groupAhspComposition([
    { rawAhspResourceRef: "Sesuatu", rawAhspResourceType: "OTHER", ahspUnit: "x", ahspCoefficient: "1" },
  ]);
  assert.equal(hasAnyComponent(groups), false);
});

test("reads lowercase source types the same way", () => {
  const groups = groupAhspComposition([
    { rawAhspResourceRef: "Pekerja", rawAhspResourceType: "labor", ahspUnit: "OH", ahspCoefficient: "1" },
  ]);
  assert.equal(groups[0].rows.length, 1);
});
