import assert from "node:assert/strict";
import test from "node:test";
import {
  describeReason,
  formatExactResourceCost,
  toPersistedCalculationDisplay,
  type PersistedCalculationWire,
} from "./rabPersistedCalculationDisplay.ts";
import { toResourceTrust } from "./rabResourceTrust.ts";

/**
 * RM-03 breakdown display. TEST_ONLY_SYNTHETIC_FIXTURE=YES, PRODUCTION_TRUTH=NO.
 */

const verifiedWire: PersistedCalculationWire = {
  status: "VERIFIED",
  boqItemId: "boq-1",
  priceOrigin: "SERVER_COST_KERNEL",
  stored: {
    volume: "10.000000",
    unit: "M1",
    unitPrice: "2004055.00",
    lineTotal: "20040550.00",
  },
  recomputed: { unitPrice: "2004055.00", lineTotal: "20040550.00" },
  integrity: {
    unitPriceMatches: true,
    lineTotalMatches: true,
    allResourceCostsReproduced: true,
  },
  provenance: {
    calculationOccurrenceId: "occ-1",
    ahspVersionId: "ahsp-v1",
    ahspOutputUnit: "M1",
    calculationAsOfDate: "2026-02-01",
    calculatedAt: "2026-02-01T09:30:00.000Z",
    calculationPolicyVersion: "GATE2A_RAB_KERNEL_PERSISTENCE_V1",
    resolutionPolicyVersion: "E1A_CONTEXTUAL_EXACT_REGION_V1",
    referenceRegionId: "region-1",
    referenceRegionName: "Kota Fixture",
    occurrenceGeneration: 1,
  },
  resources: [
    {
      resolutionId: "res-1",
      ahspResourceId: "ar-1",
      rawAhspResourceRef: "Pekerja",
      rawAhspResourceType: "LABOR",
      resourceCatalogId: "cat-1",
      resourceCatalogName: "Pekerja",
      coefficient: "0.600000",
      ahspUnit: "OH",
      selectedBasicPriceId: "bp-1",
      sourcePriceValue: "100000.00",
      sourceUnit: "OH",
      adaptedPriceValue: "100000.00",
      canonicalUnit: "PERSON_DAY",
      quantityFactor: "1",
      selectedSourceOrigin: "SUPPLIER",
      selectedFreshnessStatus: "CURRENT",
      selectedEffectiveDate: "2026-01-15",
      status: "RESOLVED",
      resolutionMethod: "EXACT_DETERMINISTIC",
      reasonCodes: ["EXACT_RESOURCE_NAME_MATCH"],
      explanation: "fixture",
      policyVersion: "E1A_CONTEXTUAL_EXACT_REGION_V1",
      resourceCost: "60000",
    },
  ],
};

test("RM03-D-01: a verified re-proof reports reproduction and keeps stored and recomputed both visible", () => {
  const display = toPersistedCalculationDisplay(verifiedWire);
  assert.equal(display.kind, "verified");
  assert.equal(display.reproduced, true);
  assert.equal(display.badge, "Terbukti ulang");
  assert.equal(display.storedUnitPriceDisplay, "Rp 2.004.055,00");
  assert.equal(display.recomputedUnitPriceDisplay, "Rp 2.004.055,00");
  assert.equal(display.storedLineTotalDisplay, "Rp 20.040.550,00");
  assert.equal(display.volumeDisplay, "10,000000");
  assert.equal(display.unit, "M1");
});

test("RM03-D-02: provenance is surfaced so a human can trace the number to its source", () => {
  const display = toPersistedCalculationDisplay(verifiedWire);
  assert.deepEqual(display.provenance, {
    asOfDate: "2026-02-01",
    calculatedAt: "2026-02-01T09:30:00.000Z",
    policyVersion: "GATE2A_RAB_KERNEL_PERSISTENCE_V1",
    resolutionPolicyVersion: "E1A_CONTEXTUAL_EXACT_REGION_V1",
    occurrenceId: "occ-1",
    ahspVersionId: "ahsp-v1",
    ahspOutputUnit: "M1",
    regionName: "Kota Fixture",
    generation: "1",
  });
});

test("RM03-D-03: each resource row carries its coefficient, Basic Price source, and exact cost", () => {
  const display = toPersistedCalculationDisplay(verifiedWire);
  assert.equal(display.resources.length, 1);
  assert.deepEqual(display.resources[0], {
    resolutionId: "res-1",
    name: "Pekerja",
    type: "LABOR",
    // Decimal(18,6) source digits are preserved exactly, not trimmed.
    coefficientDisplay: "0,600000",
    ahspUnit: "OH",
    sourcePriceDisplay: "Rp 100.000,00",
    adaptedPriceDisplay: "Rp 100.000,00",
    resourceCostDisplay: "Rp 60.000",
    basicPriceId: "bp-1",
    effectiveDate: "2026-01-15",
    sourceOrigin: "SUPPLIER",
    freshness: "CURRENT",
    status: "RESOLVED",
    reasonCodes: ["EXACT_RESOURCE_NAME_MATCH"],
    // The server's verdict, translated for the reader. Derived only from the
    // status and reason codes on this same row.
    trust: toResourceTrust({
      status: "RESOLVED",
      reasonCodes: ["EXACT_RESOURCE_NAME_MATCH"],
    }),
  });
});

test("RM03-D-03b: the breakdown states how many components are settled and how many need a human", () => {
  const display = toPersistedCalculationDisplay(verifiedWire);

  assert.equal(display.trustSummary.total, 1);
  assert.equal(display.trustSummary.settled, 1);
  assert.equal(display.trustSummary.attention, 0);
  assert.equal(display.trustSummary.allClear, true);
  assert.equal(display.resources[0].trust.state, "MACHINE_PROVEN");
  assert.equal(display.resources[0].trust.label, "Terbukti otomatis");
  assert.equal(display.resources[0].trust.decisionAvailable, false);
});

test("RM03-D-03c: an unresolved component becomes a truthful exception, never a fake choice", () => {
  const display = toPersistedCalculationDisplay({
    ...verifiedWire,
    resources: [
      {
        ...verifiedWire.resources![0],
        status: "UNRESOLVED",
        reasonCodes: ["RESOURCE_NOT_FOUND"],
      },
    ],
  });

  const trust = display.resources[0].trust;
  assert.equal(trust.state, "NOT_PROVABLE");
  assert.equal(trust.label, "Belum dapat dipastikan");
  assert.equal(trust.reason, "Sumber daya ini belum dikenali di katalog.");
  assert.equal(trust.decisionAvailable, false);
  assert.equal(display.trustSummary.attention, 1);
  assert.equal(display.trustSummary.allClear, false);
});

test("RM03-D-03d: an unavailable trace reports an empty, honest trust summary", () => {
  const display = toPersistedCalculationDisplay(null);
  assert.equal(display.kind, "unavailable");
  assert.equal(display.trustSummary.total, 0);
  assert.equal(display.trustSummary.headline, "Belum ada komponen untuk ditelusuri.");
});

test("RM03-D-04: a mismatch is shown as a mismatch, with both numbers kept and neither preferred", () => {
  const display = toPersistedCalculationDisplay({
    ...verifiedWire,
    status: "MISMATCH",
    stored: { ...verifiedWire.stored!, unitPrice: "1999999.00" },
    integrity: {
      unitPriceMatches: false,
      lineTotalMatches: true,
      allResourceCostsReproduced: true,
    },
  });
  assert.equal(display.kind, "mismatch");
  assert.equal(display.reproduced, false);
  assert.equal(display.storedUnitPriceDisplay, "Rp 1.999.999,00");
  assert.equal(display.recomputedUnitPriceDisplay, "Rp 2.004.055,00");
  assert.match(display.message, /perlu diperiksa manusia/);
});

test("RM03-D-05: an unpriced row is honest, not an error", () => {
  const display = toPersistedCalculationDisplay({
    status: "FAIL_CLOSED",
    boqItemId: "boq-1",
    reason: "NOT_CALCULATED",
  });
  assert.equal(display.kind, "unavailable");
  assert.equal(display.message, "Baris ini belum pernah dihitung SIMPROK.");
  assert.equal(display.resources.length, 0);
  assert.equal(display.provenance, null);
});

test("RM03-D-06: a manually priced row says so plainly instead of claiming a failure", () => {
  const display = toPersistedCalculationDisplay({
    status: "FAIL_CLOSED",
    boqItemId: "boq-1",
    reason: "MANUAL_PRICE_NOT_REPROVABLE",
  });
  assert.equal(display.kind, "unavailable");
  assert.match(display.message, /diisi manual/);
});

test("RM03-D-07: a kernel failure reason is appended to the row-level reason", () => {
  assert.equal(
    describeReason("RECOMPUTATION_FAIL_CLOSED", "UNRESOLVED_RESOURCE"),
    "Perhitungan ulang tidak dapat diselesaikan atas dasar yang tersimpan. Ada komponen yang belum punya Basic Price sah.",
  );
});

test("RM03-D-08: an unknown reason code is passed through rather than swallowed", () => {
  assert.equal(describeReason("SOMETHING_NEW"), "SOMETHING_NEW");
});

test("RM03-D-09: resource cost keeps full precision — it is never rounded to two places", () => {
  // 0.000001 x 10000.00 = 0.01; a coefficient-scale product can carry up to
  // eight fraction digits and every one of them must survive display.
  assert.equal(formatExactResourceCost("1234.56789012"), "Rp 1.234,56789012");
  assert.equal(formatExactResourceCost("60000"), "Rp 60.000");
  assert.equal(formatExactResourceCost(null), "—");
});

test("RM03-D-10: a malformed payload fails closed instead of rendering half a proof", () => {
  const display = toPersistedCalculationDisplay({
    status: "VERIFIED",
    boqItemId: "boq-1",
    // stored/recomputed/provenance absent despite the success status
  });
  assert.equal(display.kind, "unavailable");
  assert.equal(display.reproduced, false);
});

test("RM03-D-11: a null payload is an honest not-loaded state", () => {
  const display = toPersistedCalculationDisplay(null);
  assert.equal(display.kind, "unavailable");
  assert.equal(display.message, "Penelusuran belum dimuat.");
});

test("RM03-D-12: a resource with no catalog identity falls back to its raw AHSP reference", () => {
  const display = toPersistedCalculationDisplay({
    ...verifiedWire,
    resources: [
      {
        ...verifiedWire.resources![0],
        resourceCatalogName: null,
        rawAhspResourceRef: "Bahan tanpa katalog",
      },
    ],
  });
  assert.equal(display.resources[0].name, "Bahan tanpa katalog");
});
