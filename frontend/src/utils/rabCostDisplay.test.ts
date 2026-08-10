import assert from "node:assert/strict";
import test from "node:test";
import {
  addDecimalStrings,
  applyBatchResults,
  applyReloadIfCurrent,
  beginLoadingRows,
  buildPersistCalculationRequestBody,
  classifyPersistOutcome,
  computeDirectCostTotal,
  confirmPersistedRow,
  derivePersistFailureReason,
  describeCostEngineStatus,
  evaluatePersistActionReachability,
  formatBoqImportMeasurement,
  GENERIC_PERSIST_FAILURE_REASON,
  invalidateRow,
  isDraftDirtyForSource,
  isDraftPricingComplete,
  isDraftRevisionCurrent,
  isPersistResultFresh,
  isTerminalPersistedKernelRow,
  markRequestFailed,
  PERSISTED_KERNEL_FRAME_MESSAGE,
  resolveCostRowStatus,
  resolveSelectedRowIdAfterReload,
  SERVER_KERNEL_PERSISTED_BADGE,
  shouldInvalidateTerminalPersistResult,
  sumDecimalStrings,
  toLocalDateOnlyString,
  toRabCostDisplay,
  type CostCalculationResponse,
  type CostRowStatus,
  type PersistActionReachabilityInput,
  type PersistedRowConfirmationTarget,
  type PersistResultIdentity,
  type ReloadApplyCallbacks,
  type ReloadRequestIdentity,
} from "./rabCostDisplay.ts";

test('structural import rows never render quantity-zero or unit sentinels', () => {
  assert.equal(formatBoqImportMeasurement('FOLDER', '0', ''), '');
  assert.equal(formatBoqImportMeasurement('NOTE', '0', ''), '');
  assert.equal(formatBoqImportMeasurement('WORK_ITEM', '12', 'm3'), ' — 12 m3');
});

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

test("isDraftPricingComplete is true when every manual row has manualUnitPrice and every kernel row is calculated", () => {
  const rows = [
    { id: "manual-1", isKernelEligible: false, manualUnitPrice: true },
    { id: "kernel-1", isKernelEligible: true, manualUnitPrice: false },
  ];
  const statuses: Record<string, CostRowStatus> = {
    "kernel-1": { kind: "calculated", response: calculatedResponse },
  };
  assert.equal(isDraftPricingComplete(rows, statuses), true);
});

test("isDraftPricingComplete is false when a freshly-imported manual row has no price yet (never treated as Rp0)", () => {
  const rows = [{ id: "imported-1", isKernelEligible: false, manualUnitPrice: false }];
  assert.equal(isDraftPricingComplete(rows, {}), false);
});

test("isDraftPricingComplete is false while a kernel row is still loading/invalidated/fail-closed, not just when uncalculated", () => {
  const rows = [{ id: "kernel-1", isKernelEligible: true, manualUnitPrice: false }];
  assert.equal(isDraftPricingComplete(rows, { "kernel-1": { kind: "loading" } }), false);
  assert.equal(isDraftPricingComplete(rows, { "kernel-1": { kind: "invalidated" } }), false);
  assert.equal(isDraftPricingComplete(rows, { "kernel-1": { kind: "fail_closed", reason: "x" } }), false);
});

test("isDraftPricingComplete is vacuously true for an empty row set", () => {
  assert.equal(isDraftPricingComplete([], {}), true);
});

const readyReachabilityInput: PersistActionReachabilityInput = {
  projectId: "project-1",
  canEditDraft: true,
  selectedItem: { id: "item-1", ahspVersionId: "ahsp-1" },
  costRowStatus: { kind: "calculated", response: calculatedResponse },
  calculationAsOfDate: "2026-08-03",
  draftDirty: false,
  persistInFlight: false,
};

test("C-01: READY only for an editable, AHSP-linked WORK_ITEM with a calculated result and a valid date", () => {
  assert.equal(evaluatePersistActionReachability(readyReachabilityInput), "READY");
});

test("C-02: no active project or a non-editable draft blocks the action", () => {
  assert.equal(
    evaluatePersistActionReachability({ ...readyReachabilityInput, projectId: null }),
    "NO_PROJECT",
  );
  assert.equal(
    evaluatePersistActionReachability({ ...readyReachabilityInput, canEditDraft: false }),
    "DRAFT_NOT_EDITABLE",
  );
});

test("C-03: a missing selected item or a missing AHSP link blocks the action", () => {
  assert.equal(
    evaluatePersistActionReachability({ ...readyReachabilityInput, selectedItem: null }),
    "NO_SELECTED_WORK_ITEM",
  );
  assert.equal(
    evaluatePersistActionReachability({
      ...readyReachabilityInput,
      selectedItem: { id: "item-1", ahspVersionId: null },
    }),
    "AHSP_NOT_SELECTED",
  );
});

test("C-04: every non-calculated Cost Kernel status blocks the action — no manual-price fallback for a kernel row", () => {
  assert.equal(
    evaluatePersistActionReachability({ ...readyReachabilityInput, costRowStatus: { kind: "loading" } }),
    "COST_RESULT_LOADING",
  );
  assert.equal(
    evaluatePersistActionReachability({ ...readyReachabilityInput, costRowStatus: { kind: "invalidated" } }),
    "COST_RESULT_INVALIDATED",
  );
  assert.equal(
    evaluatePersistActionReachability({
      ...readyReachabilityInput,
      costRowStatus: { kind: "fail_closed", reason: "MISSING_ADAPTED_PRICE" },
    }),
    "COST_RESULT_FAIL_CLOSED",
  );
  assert.equal(
    evaluatePersistActionReachability({ ...readyReachabilityInput, costRowStatus: { kind: "request_failed" } }),
    "COST_REQUEST_FAILED",
  );
  assert.equal(
    evaluatePersistActionReachability({ ...readyReachabilityInput, costRowStatus: undefined }),
    "COST_RESULT_MISSING",
  );
});

test("C-05: only an exact YYYY-MM-DD shape passes the UI-format gate; real calendar validity stays backend-authoritative", () => {
  assert.equal(
    evaluatePersistActionReachability({ ...readyReachabilityInput, calculationAsOfDate: "" }),
    "INVALID_CALCULATION_DATE",
  );
  assert.equal(
    evaluatePersistActionReachability({
      ...readyReachabilityInput,
      calculationAsOfDate: "2026-08-03T10:00:00.000Z",
    }),
    "INVALID_CALCULATION_DATE",
  );
  assert.equal(
    evaluatePersistActionReachability({ ...readyReachabilityInput, calculationAsOfDate: "2026-8-3" }),
    "INVALID_CALCULATION_DATE",
  );
  assert.equal(
    evaluatePersistActionReachability({ ...readyReachabilityInput, calculationAsOfDate: "not-a-date" }),
    "INVALID_CALCULATION_DATE",
  );
  // "2026-02-30" has the exact right shape but is not a real calendar date —
  // the UI gate accepts it (shape only); the backend's parseDateOnlyUtc is
  // the one and only real-calendar-validity authority.
  assert.equal(
    evaluatePersistActionReachability({ ...readyReachabilityInput, calculationAsOfDate: "2026-02-30" }),
    "READY",
  );
});

test("C-06: the request-body builder returns exactly one own key, calculationAsOfDate — never price/total/occurrence/workspace/project/item fields", () => {
  const body = buildPersistCalculationRequestBody("2026-08-03");
  assert.deepEqual(Object.keys(body), ["calculationAsOfDate"]);
  assert.equal(body.calculationAsOfDate, "2026-08-03");
});

test("C-07: unsaved local draft edits block the action even when everything else is ready (dirty-state gate)", () => {
  assert.equal(
    evaluatePersistActionReachability({ ...readyReachabilityInput, draftDirty: true }),
    "UNSAVED_DRAFT_CHANGES",
  );
});

test("C-08: a persist request already in flight blocks a duplicate submission", () => {
  assert.equal(
    evaluatePersistActionReachability({ ...readyReachabilityInput, persistInFlight: true }),
    "PERSIST_IN_FLIGHT",
  );
});

test("C-09: classifyPersistOutcome — a network failure and a post-2xx reload failure both resolve to OUTCOME_UNKNOWN, never a confirmed state", () => {
  assert.equal(classifyPersistOutcome({ kind: "network_error" }, { kind: "not_attempted" }), "OUTCOME_UNKNOWN");
  assert.equal(classifyPersistOutcome({ kind: "response", ok: true }, { kind: "error" }), "OUTCOME_UNKNOWN");
  assert.equal(
    classifyPersistOutcome({ kind: "response", ok: true }, { kind: "not_attempted" }),
    "OUTCOME_UNKNOWN",
  );
});

test("C-10: classifyPersistOutcome — SUCCESS requires a 2xx POST plus a confirmed reload; a non-2xx POST is FAILED_CONFIRMED", () => {
  assert.equal(classifyPersistOutcome({ kind: "response", ok: true }, { kind: "success" }), "SUCCESS");
  assert.equal(
    classifyPersistOutcome({ kind: "response", ok: false }, { kind: "not_attempted" }),
    "FAILED_CONFIRMED",
  );
});

test("C-11: toLocalDateOnlyString reads local calendar fields (never a UTC slice) and round-trips near month/year boundaries", () => {
  assert.equal(toLocalDateOnlyString(new Date(2026, 0, 1)), "2026-01-01");
  assert.equal(toLocalDateOnlyString(new Date(2026, 6, 9, 23, 59, 59)), "2026-07-09");
  assert.equal(toLocalDateOnlyString(new Date(2026, 11, 31, 0, 0, 1)), "2026-12-31");
});

test("C-12: derivePersistFailureReason prefers a string message, joins a safe string array, and falls back honestly for anything else", () => {
  assert.equal(derivePersistFailureReason({ message: "RAB_NOT_FULLY_PRICED" }), "RAB_NOT_FULLY_PRICED");
  assert.equal(
    derivePersistFailureReason({ message: ["field1 invalid", "field2 invalid"] }),
    "field1 invalid; field2 invalid",
  );
  assert.equal(derivePersistFailureReason({ message: [123, null, "ok"] }), "ok");
  assert.equal(derivePersistFailureReason({}), GENERIC_PERSIST_FAILURE_REASON);
  assert.equal(derivePersistFailureReason(null), GENERIC_PERSIST_FAILURE_REASON);
  assert.equal(derivePersistFailureReason("not-an-object"), GENERIC_PERSIST_FAILURE_REASON);
  assert.equal(derivePersistFailureReason({ message: [123, null] }), GENERIC_PERSIST_FAILURE_REASON);
});

const confirmationTarget: PersistedRowConfirmationTarget = {
  boqItemId: "item-1",
  calculationAsOfDate: "2026-08-03",
};

const validConfirmedRow = {
  id: "item-1",
  priceOrigin: "SERVER_COST_KERNEL",
  calculationAsOfDate: "2026-08-03",
  unitPrice: "2004055.00",
  lineTotal: "20040550.00",
  calculationOccurrenceId: "occurrence-1",
};

test("C-13: reloaded persisted-row confirmation is fail-closed against every malformed/mismatched shape, and accepts one valid SERVER_COST_KERNEL row", () => {
  assert.equal(confirmPersistedRow(null, confirmationTarget), null);
  assert.equal(confirmPersistedRow(undefined, confirmationTarget), null);
  assert.equal(confirmPersistedRow({}, confirmationTarget), null);
  assert.equal(confirmPersistedRow({ ...validConfirmedRow, id: "wrong-item" }, confirmationTarget), null);
  assert.equal(
    confirmPersistedRow({ ...validConfirmedRow, calculationAsOfDate: "2026-08-04" }, confirmationTarget),
    null,
  );
  assert.equal(
    confirmPersistedRow({ ...validConfirmedRow, priceOrigin: "MANUAL_CLIENT" }, confirmationTarget),
    null,
  );
  assert.equal(confirmPersistedRow({ ...validConfirmedRow, priceOrigin: null }, confirmationTarget), null);
  // Runtime JSON numbers, not source literals — see B-15's identical rationale (no-loss-of-precision lint).
  assert.equal(
    confirmPersistedRow({ ...validConfirmedRow, unitPrice: Number("2004055.00") }, confirmationTarget),
    null,
  );
  assert.equal(
    confirmPersistedRow({ ...validConfirmedRow, lineTotal: Number("20040550.00") }, confirmationTarget),
    null,
  );
  assert.equal(
    confirmPersistedRow({ ...validConfirmedRow, unitPrice: "not-a-decimal" }, confirmationTarget),
    null,
  );
  assert.equal(
    confirmPersistedRow({ ...validConfirmedRow, calculationOccurrenceId: "" }, confirmationTarget),
    null,
  );

  const confirmed = confirmPersistedRow(validConfirmedRow, confirmationTarget);
  assert.deepEqual(confirmed, {
    unitPrice: "2004055.00",
    lineTotal: "20040550.00",
    calculationOccurrenceId: "occurrence-1",
  });
});

test("C-14: isDraftRevisionCurrent is exact equality only — no truthy/falsy coercion, revision 0 is a real, comparable value", () => {
  assert.equal(isDraftRevisionCurrent(5, 5), true);
  assert.equal(isDraftRevisionCurrent(5, 6), false);
  assert.equal(isDraftRevisionCurrent(0, 0), true);
  assert.equal(isDraftRevisionCurrent(0, 1), false);
  assert.equal(isDraftRevisionCurrent(1, 0), false);
});

test("C-15: BASELINE_SEED is dirty (a starting point, never an already-saved Working Draft) and blocks reachability through the existing UNSAVED_DRAFT_CHANGES state; WORKING_DRAFT stays clean and READY", () => {
  assert.equal(isDraftDirtyForSource("WORKING_DRAFT"), false);
  assert.equal(isDraftDirtyForSource("BASELINE_SEED"), true);
  assert.equal(
    evaluatePersistActionReachability({
      ...readyReachabilityInput,
      draftDirty: isDraftDirtyForSource("BASELINE_SEED"),
    }),
    "UNSAVED_DRAFT_CHANGES",
  );
  assert.equal(
    evaluatePersistActionReachability({
      ...readyReachabilityInput,
      draftDirty: isDraftDirtyForSource("WORKING_DRAFT"),
    }),
    "READY",
  );
});

const baseResultIdentity: PersistResultIdentity = {
  projectId: "project-1",
  boqItemId: "item-1",
  calculationAsOfDate: "2026-08-03",
  draftRevision: 3,
  persistContextRevision: 0,
};

test("C-16: a persist result becomes stale when project, item, calculation date, or draft revision differs; the exact same identity remains current", () => {
  assert.equal(isPersistResultFresh(baseResultIdentity, baseResultIdentity), true);
  assert.equal(
    isPersistResultFresh(baseResultIdentity, { ...baseResultIdentity, projectId: "project-2" }),
    false,
  );
  assert.equal(
    isPersistResultFresh(baseResultIdentity, { ...baseResultIdentity, boqItemId: "item-2" }),
    false,
  );
  assert.equal(
    isPersistResultFresh(baseResultIdentity, { ...baseResultIdentity, calculationAsOfDate: "2026-08-04" }),
    false,
  );
  assert.equal(
    isPersistResultFresh(baseResultIdentity, { ...baseResultIdentity, draftRevision: 4 }),
    false,
  );
  // A structurally identical but distinct object must compare fresh by value, not by reference.
  assert.equal(
    isPersistResultFresh(baseResultIdentity, {
      projectId: "project-1",
      boqItemId: "item-1",
      calculationAsOfDate: "2026-08-03",
      draftRevision: 3,
      persistContextRevision: 0,
    }),
    true,
  );
});

test("C-17: describeCostEngineStatus never claims Engine belum aktif / Belum tersambung while a real Cost Kernel result exists for an AHSP-linked item", () => {
  const noAhsp = describeCostEngineStatus(false, undefined);
  assert.equal(noAhsp.statusLabel, "Engine belum aktif");
  assert.equal(noAhsp.sourceLabel, "Belum tersambung");

  const calculated = describeCostEngineStatus(true, { kind: "calculated", response: calculatedResponse });
  assert.notEqual(calculated.statusLabel, "Engine belum aktif");
  assert.notEqual(calculated.sourceLabel, "Belum tersambung");
  assert.notEqual(calculated.frameBadge, "Engine belum aktif");
  assert.equal(calculated.sourceLabel, "Cost Kernel SIMPROK");
  assert.equal(calculated.statusLabel, "Dihitung SIMPROK");

  const loading = describeCostEngineStatus(true, { kind: "loading" });
  assert.notEqual(loading.statusLabel, "Engine belum aktif");
  assert.equal(loading.statusLabel, "Menghitung SIMPROK...");

  const failClosed = describeCostEngineStatus(true, { kind: "fail_closed", reason: "MISSING_ADAPTED_PRICE" });
  assert.equal(failClosed.statusLabel, "MISSING_ADAPTED_PRICE");

  const invalidated = describeCostEngineStatus(true, { kind: "invalidated" });
  assert.equal(invalidated.statusLabel, "Perlu dihitung ulang");

  const requestFailed = describeCostEngineStatus(true, { kind: "request_failed" });
  assert.equal(requestFailed.statusLabel, "Gagal memuat kalkulasi");

  // ahspCodePresent=true but no CostRowStatus at all (e.g. snapshot-only association) — matches the pre-existing "Standby" behavior, still never "Engine belum aktif".
  const standby = describeCostEngineStatus(true, undefined);
  assert.equal(standby.statusLabel, "Standby");
  assert.notEqual(standby.statusLabel, "Engine belum aktif");
});

test("C-18: a terminal result cannot reappear after every reversible context value (project/item/date/draftRevision) returns to its original value — persistContextRevision is the permanent tiebreaker", () => {
  const original: PersistResultIdentity = {
    projectId: "project-A",
    boqItemId: "item-A",
    calculationAsOfDate: "2026-08-03",
    draftRevision: 5,
    persistContextRevision: 0,
  };
  assert.equal(isPersistResultFresh(original, original), true);

  // Context changes (e.g. the user switched items, edited the calculation
  // date, or switched projects and back) — persistContextRevision moves to 1.
  const afterContextChange: PersistResultIdentity = { ...original, persistContextRevision: 1 };
  assert.equal(isPersistResultFresh(original, afterContextChange), false);

  // Every reversible value is restored EXACTLY to its original value; only
  // persistContextRevision — which never decreases and never resets — stays
  // at 1. The old SUCCESS/FAILED_CONFIRMED must remain permanently invalid.
  const revertedButContextStillNew: PersistResultIdentity = {
    projectId: "project-A",
    boqItemId: "item-A",
    calculationAsOfDate: "2026-08-03",
    draftRevision: 5,
    persistContextRevision: 1,
  };
  assert.equal(isPersistResultFresh(original, revertedButContextStillNew), false);

  assert.equal(shouldInvalidateTerminalPersistResult("success"), true);
  assert.equal(shouldInvalidateTerminalPersistResult("failed_confirmed"), true);
  assert.equal(shouldInvalidateTerminalPersistResult("idle"), false);
  assert.equal(shouldInvalidateTerminalPersistResult("persisting"), false);
  assert.equal(shouldInvalidateTerminalPersistResult("reloading"), false);
  assert.equal(shouldInvalidateTerminalPersistResult("outcome_unknown"), false);
});

test("C-19: resolveSelectedRowIdAfterReload preserves the current selection when still present, falls back to the first WORK_ITEM, never depends on index, and never fabricates a selection", () => {
  const rows = [
    { id: "folder-1", type: "folder" },
    { id: "item-1", type: "item" },
    { id: "item-2", type: "item" },
    { id: "note-1", type: "note" },
  ];
  // The current selection (the second item, not the first row of any type) still exists — preserved exactly.
  assert.equal(resolveSelectedRowIdAfterReload("item-2", rows), "item-2");
  // The current selection no longer exists — falls back to the first WORK_ITEM (never the first row overall — folder-1 is at index 0).
  assert.equal(resolveSelectedRowIdAfterReload("item-gone", rows), "item-1");
  // Only FOLDER/NOTE rows exist — no WORK_ITEM to fall back to.
  const noWorkItems = [{ id: "folder-1", type: "folder" }, { id: "note-1", type: "note" }];
  assert.equal(resolveSelectedRowIdAfterReload("item-gone", noWorkItems), "");
  // Empty rows.
  assert.equal(resolveSelectedRowIdAfterReload("anything", []), "");
  assert.equal(resolveSelectedRowIdAfterReload("", []), "");
  // A blank current selection with rows available still falls back to the first WORK_ITEM, not preserved as blank.
  assert.equal(resolveSelectedRowIdAfterReload("", rows), "item-1");
});

const baseReloadIdentity: ReloadRequestIdentity = {
  projectId: "project-A",
  generation: 1,
  draftRevision: 3,
};

/**
 * C-20-R2: exercises the exact helper reloadDraft() wires all three of its
 * state-application callbacks through (applyReloadIfCurrent) — not the
 * underlying identity predicate in isolation — so a wiring regression (e.g.
 * a call site skipping the helper) would be caught here.
 */
const makeReloadApplyCounters = () => {
  const counts = { applyRecap: 0, applyRows: 0, loadCostCalculations: 0 };
  const callbacks: ReloadApplyCallbacks = {
    applyRecap: () => { counts.applyRecap += 1; },
    applyRows: () => { counts.applyRows += 1; },
    loadCostCalculations: () => { counts.loadCostCalculations += 1; },
  };
  return { counts, callbacks };
};

test("C-20: applyReloadIfCurrent — Project A's captured identity resolving against a live Project B applies zero of the three callbacks", () => {
  const { counts, callbacks } = makeReloadApplyCounters();
  const applied = applyReloadIfCurrent(
    baseReloadIdentity,
    { ...baseReloadIdentity, projectId: "project-B" },
    callbacks,
  );
  assert.equal(applied, false);
  assert.deepEqual(counts, { applyRecap: 0, applyRows: 0, loadCostCalculations: 0 });
});

test("C-20: applyReloadIfCurrent — a stale persist generation (superseded by a newer attempt on the same project) applies zero of the three callbacks", () => {
  const { counts, callbacks } = makeReloadApplyCounters();
  const applied = applyReloadIfCurrent(
    baseReloadIdentity,
    { ...baseReloadIdentity, generation: 2 },
    callbacks,
  );
  assert.equal(applied, false);
  assert.deepEqual(counts, { applyRecap: 0, applyRows: 0, loadCostCalculations: 0 });
});

test("C-20: applyReloadIfCurrent — a stale draft revision (a local edit made while the request was in flight) applies zero of the three callbacks", () => {
  const { counts, callbacks } = makeReloadApplyCounters();
  const applied = applyReloadIfCurrent(
    baseReloadIdentity,
    { ...baseReloadIdentity, draftRevision: 4 },
    callbacks,
  );
  assert.equal(applied, false);
  assert.deepEqual(counts, { applyRecap: 0, applyRows: 0, loadCostCalculations: 0 });
});

test("C-20: applyReloadIfCurrent — project, generation, and draft revision all matching applies each of the three callbacks exactly once", () => {
  const { counts, callbacks } = makeReloadApplyCounters();
  const applied = applyReloadIfCurrent(baseReloadIdentity, baseReloadIdentity, callbacks);
  assert.equal(applied, true);
  assert.deepEqual(counts, { applyRecap: 1, applyRows: 1, loadCostCalculations: 1 });
});

// ─────────────────────────────────────────────────────────────────────────────
// RM-03D1 — READ CONSISTENCY FOR AN ALREADY-PERSISTED SERVER_COST_KERNEL ROW
//
// The defect these cover: the LIVE batch (GET /boq/cost-calculations) follows
// workingOccurrenceId, which Gate-2A's persist deliberately clears. For a row
// that is already persisted it therefore answers FAIL_CLOSED/
// OCCURRENCE_NOT_FOUND — correctly, for the question it was asked. Reading
// that as "this row has no price" made the recap say "belum dihitung" and the
// detail panel print OCCURRENCE_NOT_FOUND, while the very same /boq/draft
// payload already carried the stored money.
//
// Nothing below computes a price. Every asserted figure is a decimal string
// the server produced.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A TERMINAL persisted row exactly as GET /boq/draft delivers it: stored money,
 * a calculation occurrence, and no working occurrence — nothing new is being
 * worked on.
 */
const persistedServerRow = {
  priceOrigin: "SERVER_COST_KERNEL" as const,
  persistedUnitPrice: "197005.00",
  persistedLineTotal: "129826295.00",
  workingOccurrenceId: null,
  calculationOccurrenceId: "occ-calculation",
};

/**
 * The same stored money, but a NEW calculation is currently active on the row.
 * This is the "Perhitungan ulang tertunda" state — not a terminal row.
 */
const pendingRecalculationRow = {
  ...persistedServerRow,
  workingOccurrenceId: "occ-working",
};

/** The LIVE answer for that same row once its working pointer is cleared. */
const liveOccurrenceNotFound: CostRowStatus = {
  kind: "fail_closed",
  reason: "OCCURRENCE_NOT_FOUND",
};

test("RM-03D1 T2: a persisted row whose LIVE read is OCCURRENCE_NOT_FOUND is described by its stored price, not by the live failure", () => {
  const resolved = resolveCostRowStatus(persistedServerRow, liveOccurrenceNotFound);
  assert.equal(resolved?.kind, "persisted");

  const display = toRabCostDisplay(resolved!);
  assert.equal(display.badge, SERVER_KERNEL_PERSISTED_BADGE);
  assert.equal(display.unitPrice, "Rp 197.005,00");
  assert.equal(display.lineTotal, "Rp 129.826.295,00");
  // The contradiction the Owner saw must be gone from the description itself.
  assert.notEqual(display.badge, "OCCURRENCE_NOT_FOUND");
});

test("RM-03D1 T5: a row with NO persisted price still reports its live failure honestly", () => {
  const unpersisted = {
    priceOrigin: null,
    persistedUnitPrice: null,
    persistedLineTotal: null,
    workingOccurrenceId: null,
    calculationOccurrenceId: null,
  };
  const resolved = resolveCostRowStatus(unpersisted, liveOccurrenceNotFound);
  assert.deepEqual(resolved, liveOccurrenceNotFound);
  assert.equal(toRabCostDisplay(resolved!).badge, "OCCURRENCE_NOT_FOUND");
});

test("RM-03D1: a half-persisted row (origin without both exact amounts) is NOT treated as priced", () => {
  const missingLineTotal = { ...persistedServerRow, persistedLineTotal: null };
  assert.deepEqual(resolveCostRowStatus(missingLineTotal, liveOccurrenceNotFound), liveOccurrenceNotFound);
});

test("RM-03D1: a MANUAL_CLIENT row never becomes a persisted kernel state", () => {
  const manual = {
    ...persistedServerRow,
    priceOrigin: "MANUAL_CLIENT" as const,
    persistedUnitPrice: "1000.00",
    persistedLineTotal: "2000.00",
  };
  assert.deepEqual(resolveCostRowStatus(manual, liveOccurrenceNotFound), liveOccurrenceNotFound);
});

test("RM-03D1: an edited row keeps 'Perlu dihitung ulang' — a stale stored total never masks invalidation", () => {
  const resolved = resolveCostRowStatus(persistedServerRow, { kind: "invalidated" });
  assert.equal(resolved?.kind, "invalidated");
  assert.equal(toRabCostDisplay(resolved!).badge, "Perlu dihitung ulang");
});

test("RM-03D1: a fresh LIVE calculation outranks the stored price", () => {
  const resolved = resolveCostRowStatus(persistedServerRow, { kind: "calculated", response: calculatedResponse });
  assert.equal(resolved?.kind, "calculated");
});

test("RM-03D1: a persisted row with no live answer at all is still described by its stored price", () => {
  const resolved = resolveCostRowStatus(persistedServerRow, undefined);
  assert.equal(resolved?.kind, "persisted");
});

test("RM-03D1 T4: the recap counts an already-persisted row as priced", () => {
  const rows = [{ id: "r75", isKernelEligible: true, manualUnitPrice: false }];
  const statuses: Record<string, CostRowStatus> = {
    r75: resolveCostRowStatus(persistedServerRow, liveOccurrenceNotFound)!,
  };
  assert.equal(isDraftPricingComplete(rows, statuses), true);
});

test("RM-03D1 T3: the recap subtotal is the server's exact persisted lineTotal, never volume * unitPrice", () => {
  const rows = [{ id: "r75", isKernelEligible: true, manualAmount: 999_999_999 }];
  const statuses: Record<string, CostRowStatus> = {
    r75: resolveCostRowStatus(persistedServerRow, liveOccurrenceNotFound)!,
  };
  // manualAmount is deliberately absurd to prove it is ignored for kernel rows.
  assert.equal(computeDirectCostTotal(rows, statuses), "129826295.00");
});

test("RM-03D1 T6: a genuinely unpriced WORK_ITEM still makes the recap incomplete", () => {
  const rows = [
    { id: "r75", isKernelEligible: true, manualUnitPrice: false },
    { id: "never-priced", isKernelEligible: true, manualUnitPrice: false },
  ];
  const statuses: Record<string, CostRowStatus> = {
    r75: resolveCostRowStatus(persistedServerRow, liveOccurrenceNotFound)!,
    "never-priced": resolveCostRowStatus(
      {
        priceOrigin: null,
        persistedUnitPrice: null,
        persistedLineTotal: null,
        workingOccurrenceId: null,
        calculationOccurrenceId: null,
      },
      liveOccurrenceNotFound,
    )!,
  };
  assert.equal(isDraftPricingComplete(rows, statuses), false);
  // and the priced row still contributes only its own exact stored total
  assert.equal(
    computeDirectCostTotal(
      [
        { id: "r75", isKernelEligible: true, manualAmount: 0 },
        { id: "never-priced", isKernelEligible: true, manualAmount: 0 },
      ],
      statuses,
    ),
    "129826295.00",
  );
});

test("RM-03D1: 'already persisted' is never 'ready to persist' — the persist action stays unreachable", () => {
  const reachability = evaluatePersistActionReachability({
    projectId: "p1",
    canEditDraft: true,
    selectedItem: { id: "r75", ahspVersionId: "v4" },
    costRowStatus: { kind: "persisted", unitPrice: "197005.00", lineTotal: "129826295.00" },
    calculationAsOfDate: "2026-08-08",
    draftDirty: false,
    persistInFlight: false,
  } as PersistActionReachabilityInput);
  assert.notEqual(reachability, "READY");
});

test("RM-03D1: the drawer never shows 'Engine belum aktif' copy for a persisted Cost Kernel row", () => {
  const persisted: CostRowStatus = { kind: "persisted", unitPrice: "197005.00", lineTotal: "129826295.00" };
  const copy = describeCostEngineStatus(true, persisted);
  assert.equal(copy.statusLabel, SERVER_KERNEL_PERSISTED_BADGE);
  assert.equal(copy.frameBadge, SERVER_KERNEL_PERSISTED_BADGE);
  assert.equal(copy.sourceLabel, "Cost Kernel SIMPROK");
  assert.match(copy.frameMessage, /dihitung oleh Cost Kernel SIMPROK/);
  assert.doesNotMatch(copy.statusLabel, /OCCURRENCE_NOT_FOUND/);
});

test("RM-03D1: a fail-closed row without a persisted price still shows its honest failure in the drawer", () => {
  const copy = describeCostEngineStatus(true, { kind: "fail_closed", reason: "OCCURRENCE_NOT_FOUND" });
  assert.equal(copy.statusLabel, "OCCURRENCE_NOT_FOUND");
});

// ─────────────────────────────────────────────────────────────────────────────
// RM-03D1 ONE-BOLT — PERSISTED vs WORKING OCCURRENCE PRECISION
//
// "I have a valid stored calculation and nothing new is being worked on" is a
// different state from "I have an old stored calculation, but a new
// calculation is currently active". Money alone cannot tell them apart; the
// occurrence pointers can.
// ─────────────────────────────────────────────────────────────────────────────

test("BOLT T1: a TERMINAL persisted row (no working occurrence) uses its stored price on the by-design live miss", () => {
  assert.equal(isTerminalPersistedKernelRow(persistedServerRow), true);
  const resolved = resolveCostRowStatus(persistedServerRow, liveOccurrenceNotFound);
  assert.equal(resolved?.kind, "persisted");
});

test("BOLT T2: an OLD stored price must NOT hide a live failure while a NEW working occurrence is active", () => {
  assert.equal(isTerminalPersistedKernelRow(pendingRecalculationRow), false);
  const resolved = resolveCostRowStatus(pendingRecalculationRow, liveOccurrenceNotFound);
  assert.deepEqual(resolved, liveOccurrenceNotFound);
  assert.equal(toRabCostDisplay(resolved!).badge, "OCCURRENCE_NOT_FOUND");
});

test("BOLT T2b: a pending-recalculation row is NOT counted as priced by the recap, and contributes nothing", () => {
  const statuses: Record<string, CostRowStatus> = {
    pending: resolveCostRowStatus(pendingRecalculationRow, liveOccurrenceNotFound)!,
  };
  assert.equal(
    isDraftPricingComplete([{ id: "pending", isKernelEligible: true, manualUnitPrice: false }], statuses),
    false,
  );
  assert.equal(
    computeDirectCostTotal([{ id: "pending", isKernelEligible: true, manualAmount: 0 }], statuses),
    "0",
  );
});

test("BOLT T3: a fail-closed reason OTHER than the by-design miss is never hidden behind stored money", () => {
  const otherFailure: CostRowStatus = { kind: "fail_closed", reason: "MISSING_ADAPTED_PRICE" };
  const resolved = resolveCostRowStatus(persistedServerRow, otherFailure);
  assert.deepEqual(resolved, otherFailure);
  assert.equal(toRabCostDisplay(resolved!).badge, "MISSING_ADAPTED_PRICE");
});

test("BOLT T4: an edited terminal row still shows 'Perlu dihitung ulang'", () => {
  const resolved = resolveCostRowStatus(persistedServerRow, { kind: "invalidated" });
  assert.equal(resolved?.kind, "invalidated");
});

test("BOLT T5: a fresh live calculation outranks the stored price, terminal or not", () => {
  const live: CostRowStatus = { kind: "calculated", response: calculatedResponse };
  assert.equal(resolveCostRowStatus(persistedServerRow, live)?.kind, "calculated");
  assert.equal(resolveCostRowStatus(pendingRecalculationRow, live)?.kind, "calculated");
});

test("BOLT T6: a row with no stored truth at all still fails honestly", () => {
  const unpriced = {
    priceOrigin: null,
    persistedUnitPrice: null,
    persistedLineTotal: null,
    workingOccurrenceId: "occ-working",
    calculationOccurrenceId: null,
  };
  assert.equal(isTerminalPersistedKernelRow(unpriced), false);
  assert.deepEqual(resolveCostRowStatus(unpriced, liveOccurrenceNotFound), liveOccurrenceNotFound);
});

test("BOLT: a terminal row without a calculationOccurrenceId is not terminal — money alone is not a lifecycle", () => {
  const noProvenance = { ...persistedServerRow, calculationOccurrenceId: null };
  assert.equal(isTerminalPersistedKernelRow(noProvenance), false);
  assert.deepEqual(resolveCostRowStatus(noProvenance, liveOccurrenceNotFound), liveOccurrenceNotFound);
});

test("BOLT E: a terminal row does not look unpriced while the live read has not answered yet", () => {
  assert.equal(resolveCostRowStatus(persistedServerRow, undefined)?.kind, "persisted");
  assert.equal(resolveCostRowStatus(persistedServerRow, { kind: "loading" })?.kind, "persisted");
  assert.equal(resolveCostRowStatus(persistedServerRow, { kind: "request_failed" })?.kind, "persisted");
  // ...but a row that is NOT terminal keeps the honest transient state.
  assert.deepEqual(resolveCostRowStatus(pendingRecalculationRow, { kind: "loading" }), { kind: "loading" });
  assert.deepEqual(resolveCostRowStatus(pendingRecalculationRow, undefined), undefined);
});

test("BOLT T7: the persisted drawer copy points at the breakdown already on screen, and claims nothing false", () => {
  const copy = describeCostEngineStatus(true, {
    kind: "persisted",
    unitPrice: "197005.00",
    lineTotal: "129826295.00",
  });
  assert.equal(copy.statusLabel, SERVER_KERNEL_PERSISTED_BADGE);
  assert.equal(copy.frameMessage, PERSISTED_KERNEL_FRAME_MESSAGE);
  assert.doesNotMatch(copy.statusLabel, /OCCURRENCE_NOT_FOUND/);
  assert.doesNotMatch(copy.frameBadge, /Engine belum aktif/);
  // The calculated-state promise ("...akan tampil setelah engine ... tersambung")
  // must not be repeated for a row whose breakdown is already rendered.
  assert.doesNotMatch(copy.frameMessage, /akan tampil setelah/);
});
