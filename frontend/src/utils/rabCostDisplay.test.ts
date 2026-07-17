import assert from "node:assert/strict";
import test from "node:test";
import { toRabCostDisplay } from "./rabCostDisplay.ts";

test("displays exact backend values without recalculation", () => {
  const response = {
    status: "CALCULATED" as const,
    boqItemId: "TEST_FIXTURE_ONLY",
    volume: "999",
    outputUnit: "M1",
    ahspUnitPrice: "2004055",
    lineTotal: "20040550",
    calculationPolicy: "COST_KERNEL_GRADE_A_V1" as const,
  };
  assert.deepEqual(toRabCostDisplay(response), {
    badge: "Dihitung SIMPROK",
    unitPrice: "Rp 2.004.055",
    lineTotal: "Rp 20.040.550",
  });
});

test("fail-closed response never falls back to a manual number", () => {
  assert.deepEqual(
    toRabCostDisplay({
      status: "FAIL_CLOSED",
      boqItemId: "OWNER_SUPPLIED_EXAMPLE_NON_PRODUCTION",
      reason: "MISSING_ADAPTED_PRICE",
      calculationPolicy: "COST_KERNEL_GRADE_A_V1",
    }),
    { badge: "MISSING_ADAPTED_PRICE", unitPrice: "—", lineTotal: "—" },
  );
});
