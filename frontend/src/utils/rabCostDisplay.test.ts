import assert from "node:assert/strict";
import test from "node:test";
import {
  addDecimalStrings,
  applyBatchResults,
  beginLoadingRows,
  computeDirectCostTotal,
  invalidateRow,
  markRequestFailed,
  sumDecimalStrings,
  toRabCostDisplay,
  type CostCalculationResponse,
  type CostRowStatus,
} from "./rabCostDisplay.ts";

const calculatedResponse: Extract<CostCalculationResponse, { status: "CALCULATED" }> = {
  status: "CALCULATED",
  boqItemId: "TEST_FIXTURE_ONLY",
  volume: "10",
  outputUnit: "M1",
  ahspUnitPrice: "2004055",
  lineTotal: "20040550",
  calculationPolicy: "COST_KERNEL_GRADE_A_V1",
};

test("displays exact backend values without recalculation", () => {
  assert.deepEqual(toRabCostDisplay({ kind: "calculated", response: calculatedResponse }), {
    badge: "Dihitung SIMPROK",
    unitPrice: "Rp 2.004.055",
    lineTotal: "Rp 20.040.550",
  });
});

test("fail-closed status never falls back to a manual number", () => {
  assert.deepEqual(toRabCostDisplay({ kind: "fail_closed", reason: "MISSING_ADAPTED_PRICE" }), {
    badge: "MISSING_ADAPTED_PRICE",
    unitPrice: "—",
    lineTotal: "—",
  });
});

test("invalidated status shows an honest recalculation prompt, not a stale price", () => {
  assert.deepEqual(toRabCostDisplay({ kind: "invalidated" }), {
    badge: "Perlu dihitung ulang",
    unitPrice: "—",
    lineTotal: "—",
  });
});

test("loading and request_failed statuses never show a price either", () => {
  assert.deepEqual(toRabCostDisplay({ kind: "loading" }), {
    badge: "Menghitung SIMPROK...",
    unitPrice: "—",
    lineTotal: "—",
  });
  assert.deepEqual(toRabCostDisplay({ kind: "request_failed" }), {
    badge: "Gagal memuat kalkulasi",
    unitPrice: "—",
    lineTotal: "—",
  });
});

test("addDecimalStrings adds integers exactly", () => {
  assert.equal(addDecimalStrings("20040550", "0"), "20040550");
  assert.equal(addDecimalStrings("20040550", "20040550"), "40081100");
});

test("addDecimalStrings adds fractional decimals without float drift", () => {
  assert.equal(addDecimalStrings("0.1", "0.2"), "0.3");
  assert.equal(addDecimalStrings("1.1", "2.22"), "3.32");
  assert.equal(addDecimalStrings("100000.00", "0.005"), "100000.005");
});

test("addDecimalStrings handles negative values", () => {
  assert.equal(addDecimalStrings("-5", "3"), "-2");
  assert.equal(addDecimalStrings("5", "-5"), "0");
  assert.equal(addDecimalStrings("-1.5", "-2.25"), "-3.75");
});

test("sumDecimalStrings folds a list exactly, empty list is zero", () => {
  assert.equal(sumDecimalStrings([]), "0");
  assert.equal(sumDecimalStrings(["20040550", "20040550", "1"]), "40081101");
});

test("beginLoadingRows builds a fresh map with the requested rows loading", () => {
  const next = beginLoadingRows(["a", "b"]);
  assert.deepEqual(next, { a: { kind: "loading" }, b: { kind: "loading" } });
});

test("applyBatchResults applies calculated and fail_closed results to loading rows", () => {
  const current: Record<string, CostRowStatus> = {
    TEST_FIXTURE_ONLY: { kind: "loading" },
    b: { kind: "loading" },
  };
  const next = applyBatchResults(current, [
    calculatedResponse,
    { status: "FAIL_CLOSED", boqItemId: "b", reason: "MISSING_ADAPTED_PRICE", calculationPolicy: "COST_KERNEL_GRADE_A_V1" },
  ]);
  assert.deepEqual(next.TEST_FIXTURE_ONLY, { kind: "calculated", response: calculatedResponse });
  assert.deepEqual(next.b, { kind: "fail_closed", reason: "MISSING_ADAPTED_PRICE" });
});

test("applyBatchResults skips a row edited (invalidated) while the request was in flight", () => {
  const current: Record<string, CostRowStatus> = {
    TEST_FIXTURE_ONLY: { kind: "invalidated" },
  };
  const next = applyBatchResults(current, [calculatedResponse]);
  // The late response must not resurrect a row the user has already edited.
  assert.deepEqual(next.TEST_FIXTURE_ONLY, { kind: "invalidated" });
});

test("markRequestFailed only affects rows still loading, leaving other rows untouched", () => {
  const current: Record<string, CostRowStatus> = {
    a: { kind: "loading" },
    b: { kind: "calculated", response: calculatedResponse },
    c: { kind: "invalidated" },
  };
  const next = markRequestFailed(current, ["a", "b", "c"]);
  assert.deepEqual(next.a, { kind: "request_failed" });
  assert.deepEqual(next.b, { kind: "calculated", response: calculatedResponse });
  assert.deepEqual(next.c, { kind: "invalidated" });
});

test("invalidateRow moves a calculated row to invalidated", () => {
  const current: Record<string, CostRowStatus> = {
    a: { kind: "calculated", response: calculatedResponse },
  };
  assert.deepEqual(invalidateRow(current, "a"), { a: { kind: "invalidated" } });
});

test("invalidateRow is a no-op for a row with no kernel entry (manual row)", () => {
  const current: Record<string, CostRowStatus> = {};
  const next = invalidateRow(current, "manual-row");
  assert.equal(next, current);
});

test("computeDirectCostTotal uses exact backend lineTotal for calculated kernel rows and never re-multiplies volume * unitPrice", () => {
  const rows = [{ id: "kernel-1", isKernelEligible: true, manualAmount: 999_999 }];
  const statuses: Record<string, CostRowStatus> = {
    "kernel-1": { kind: "calculated", response: calculatedResponse },
  };
  // manualAmount is deliberately wrong/huge to prove it is ignored for kernel rows.
  assert.equal(computeDirectCostTotal(rows, statuses), "20040550");
});

test("computeDirectCostTotal contributes zero for invalidated, loading, and fail-closed kernel rows (no manual fallback)", () => {
  const rows = [
    { id: "invalidated-1", isKernelEligible: true, manualAmount: 5000 },
    { id: "loading-1", isKernelEligible: true, manualAmount: 5000 },
    { id: "fail-1", isKernelEligible: true, manualAmount: 5000 },
  ];
  const statuses: Record<string, CostRowStatus> = {
    "invalidated-1": { kind: "invalidated" },
    "loading-1": { kind: "loading" },
    "fail-1": { kind: "fail_closed", reason: "MISSING_ADAPTED_PRICE" },
  };
  assert.equal(computeDirectCostTotal(rows, statuses), "0");
});

test("computeDirectCostTotal sums manual rows via JS number and combines exactly with kernel rows", () => {
  const rows = [
    { id: "kernel-1", isKernelEligible: true, manualAmount: 0 },
    { id: "manual-1", isKernelEligible: false, manualAmount: 1000 },
    { id: "manual-2", isKernelEligible: false, manualAmount: 2500.5 },
  ];
  const statuses: Record<string, CostRowStatus> = {
    "kernel-1": { kind: "calculated", response: calculatedResponse },
  };
  assert.equal(computeDirectCostTotal(rows, statuses), "20044050.5");
});

test("computeDirectCostTotal returns zero for an all-manual-unset, all-kernel-pending board", () => {
  const rows = [{ id: "kernel-1", isKernelEligible: true, manualAmount: 0 }];
  assert.equal(computeDirectCostTotal(rows, {}), "0");
});
