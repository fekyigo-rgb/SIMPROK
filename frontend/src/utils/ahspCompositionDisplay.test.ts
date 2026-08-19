import assert from "node:assert/strict";
import test from "node:test";

import {
  attentionComponents,
  formatCoefficient,
  groupAhspComposition,
  hasAnyComponent,
  summariseAhspComposition,
} from "./ahspCompositionDisplay.ts";
import { toResourceTrust } from "./rabResourceTrust.ts";

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
    trust: toResourceTrust({ status: "RESOLVED", reasonCodes: [] }),
  });
  assert.equal(bahan.rows[0].unit, "m3");
  assert.equal(bahan.rows[0].coefficient, "1.2");
});

/**
 * An unproven component is part of the recipe and stays visible. Hiding it
 * would make an incomplete analysis look complete — the exact cosmetic lie
 * SIMPROK forbids. Mortar is the live example (MULTIPLE_CANDIDATES).
 */
test("MEUX-1. a genuine ambiguity asks for a decision; a missing resource never does", () => {
  const groups = groupAhspComposition([
    // The machine narrowed it to legitimate alternatives — a human can settle it.
    {
      rawAhspResourceRef: "Mortar",
      rawAhspResourceType: "MATERIAL",
      ahspUnit: "m3",
      ahspCoefficient: "0.480000",
      status: "NEEDS_REVIEW",
      reasonCodes: ["MULTIPLE_CANDIDATES_NEEDS_REVIEW"],
    },
    // Nothing to choose between — this must never become "silakan pilih".
    {
      rawAhspResourceRef: "Bahan Hantu",
      rawAhspResourceType: "MATERIAL",
      ahspUnit: "m3",
      ahspCoefficient: "1.000000",
      status: "UNRESOLVED",
      reasonCodes: ["RESOURCE_NOT_FOUND"],
    },
  ]);

  const bahan = groups[1];
  const mortar = bahan.rows.find((r) => r.name === "Mortar")!;
  const hantu = bahan.rows.find((r) => r.name === "Bahan Hantu")!;

  assert.equal(mortar.trust.state, "NEEDS_HUMAN_DECISION");
  assert.equal(mortar.trust.label, "Perlu keputusan Anda");
  assert.equal(mortar.trust.decisionAvailable, true);

  assert.equal(hantu.trust.state, "NOT_PROVABLE");
  assert.equal(hantu.trust.label, "Belum dapat dipastikan");
  assert.equal(hantu.trust.reason, "Sumber daya ini belum dikenali di katalog.");
  assert.equal(hantu.trust.decisionAvailable, false);
});

test("MEUX-2. a 24-component analysis reports its 3 exceptions, not 24 rows to audit", () => {
  const many = [
    ...Array.from({ length: 21 }, (_, i) => ({
      rawAhspResourceRef: `Bahan ${i + 1}`,
      rawAhspResourceType: "MATERIAL",
      ahspUnit: "m3",
      ahspCoefficient: "1.000000",
      status: "RESOLVED",
      reasonCodes: ["EXACT_RESOURCE_NAME_MATCH"],
    })),
    {
      rawAhspResourceRef: "Mortar",
      rawAhspResourceType: "MATERIAL",
      ahspUnit: "m3",
      ahspCoefficient: "0.480000",
      status: "NEEDS_REVIEW",
      reasonCodes: ["MULTIPLE_CANDIDATES_NEEDS_REVIEW"],
    },
    {
      rawAhspResourceRef: "Bahan Hantu",
      rawAhspResourceType: "MATERIAL",
      ahspUnit: "m3",
      ahspCoefficient: "1.000000",
      status: "UNRESOLVED",
      reasonCodes: ["RESOURCE_NOT_FOUND"],
    },
    {
      rawAhspResourceRef: "Pekerja",
      rawAhspResourceType: "LABOR",
      ahspUnit: "OH",
      ahspCoefficient: "0.660000",
      status: "UNRESOLVED",
      reasonCodes: ["UNIT_NOT_SUPPORTED"],
    },
  ];

  const groups = groupAhspComposition(many);
  const summary = summariseAhspComposition(groups);

  assert.equal(summary.total, 24);
  assert.equal(summary.settled, 21);
  assert.equal(summary.needsDecision, 1);
  assert.equal(summary.notProvable, 2);
  assert.equal(summary.attention, 3);
  assert.equal(
    summary.headline,
    "SIMPROK sudah menyelesaikan 21 dari 24 komponen. 1 perlu keputusan Anda, 2 belum dapat dipastikan.",
  );

  // The user is handed exactly the three that need them — across all groups.
  const attention = attentionComponents(groups);
  assert.equal(attention.length, 3);
  assert.deepEqual(attention.map((r) => r.name).sort(), [
    "Bahan Hantu",
    "Mortar",
    "Pekerja",
  ]);
  // And the 21 healthy components are still inspectable, just not shouting.
  assert.equal(groups.flatMap((g) => g.rows).length, 24);
});

test("MEUX-3. a fully proven analysis stays quiet", () => {
  const groups = groupAhspComposition(
    rows.map((r) => ({ ...r, status: "RESOLVED", reasonCodes: ["EXACT_RESOURCE_NAME_MATCH"] })),
  );
  const summary = summariseAhspComposition(groups);
  assert.equal(summary.allClear, true);
  assert.equal(attentionComponents(groups).length, 0);
  assert.equal(
    summary.headline,
    "Seluruh 5 komponen sudah beres. Tidak ada yang perlu Anda lakukan.",
  );
});

test("MEUX-4. a component with no reason codes still fails closed, never optimistic", () => {
  // Older occurrences may carry a status with no codes. Silence is not proof.
  const groups = groupAhspComposition([
    {
      rawAhspResourceRef: "Lama",
      rawAhspResourceType: "MATERIAL",
      ahspUnit: "m3",
      ahspCoefficient: "1.000000",
      status: "NEEDS_REVIEW",
    },
  ]);
  const row = groups[1].rows[0];
  assert.equal(row.trust.state, "NOT_PROVABLE");
  assert.equal(row.trust.decisionAvailable, false);
});

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
