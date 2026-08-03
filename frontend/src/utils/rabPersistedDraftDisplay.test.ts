import assert from "node:assert/strict";
import test from "node:test";
import {
  formatExactMoney,
  formatExactPercent,
  formatExactQuantity,
  getPriceOriginBadge,
  toPersistedRowDisplay,
  toRecapDisplay,
  type PersistedBoqItem,
  type PersistedDraftRecap,
} from "./rabPersistedDraftDisplay.ts";

const baseItem: PersistedBoqItem = {
  id: "row-1",
  wbsCode: "1.1",
  name: "Pekerjaan uji",
  itemType: "WORK_ITEM",
  quantity: "2.000000",
  unit: "m3",
  unitPrice: "10.00",
  lineTotal: "25.00",
  priceOrigin: "SERVER_COST_KERNEL",
  calculationOccurrenceId: "occurrence-fixture-full-uuid-0001",
  calculationAsOfDate: "2026-07-31",
  calculatedAt: "2026-07-31T10:00:00.000Z",
  calculationPolicyVersion: "RAB_KERNEL_PERSISTENCE_GRADE_A_V1",
};

test("B-01: quantity with 6 fraction digits keeps every digit, grouped", () => {
  assert.equal(formatExactQuantity("999999999999.123456"), "999.999.999.999,123456");
});

test("B-02: unitPrice above Number.MAX_SAFE_INTEGER stays exact", () => {
  assert.equal(formatExactMoney("9007199254740993.01"), "Rp 9.007.199.254.740.993,01");
});

test("B-03: lineTotal at the Decimal(18,2) ceiling stays exact", () => {
  assert.equal(formatExactMoney("9999999999999999.99"), "Rp 9.999.999.999.999.999,99");
});

test("B-04: null money and null quantity never become zero", () => {
  assert.equal(formatExactMoney(null), "—");
  assert.equal(formatExactQuantity(null), "—");
  assert.notEqual(formatExactMoney(null), "Rp 0,00");
});

test("B-05: lineTotal from the server wins over quantity * unitPrice (2.000000 * 10.00 would be 20.00, not 25.00)", () => {
  const display = toPersistedRowDisplay(baseItem);
  assert.equal(display.lineTotalDisplay, "Rp 25,00");
  assert.notEqual(display.lineTotalDisplay, "Rp 20,00");
});

test("B-06: SERVER_COST_KERNEL produces the persisted badge", () => {
  assert.equal(getPriceOriginBadge("SERVER_COST_KERNEL"), "Dihitung SIMPROK · Tersimpan");
});

test("B-07: MANUAL_CLIENT produces the manual badge", () => {
  assert.equal(getPriceOriginBadge("MANUAL_CLIENT"), "Harga manual");
});

test("B-08: a null origin produces the not-yet-calculated badge", () => {
  assert.equal(getPriceOriginBadge(null), "Belum dihitung");
});

test("B-09: the full calculationOccurrenceId is carried through, not truncated", () => {
  const display = toPersistedRowDisplay(baseItem);
  assert.equal(display.provenance?.calculationOccurrenceId, "occurrence-fixture-full-uuid-0001");
  assert.equal(display.provenance?.calculationPolicyVersion, "RAB_KERNEL_PERSISTENCE_GRADE_A_V1");
  assert.equal(display.provenance?.calculationAsOfDate, "2026-07-31");
  assert.equal(display.provenance?.calculatedAt, "2026-07-31T10:00:00.000Z");
});

test("MANUAL_CLIENT and null-origin rows carry no provenance panel (nothing to show)", () => {
  assert.equal(toPersistedRowDisplay({ ...baseItem, priceOrigin: "MANUAL_CLIENT" }).provenance, null);
  assert.equal(toPersistedRowDisplay({ ...baseItem, priceOrigin: null }).provenance, null);
});

test("B-10: a COMPLETE recap renders the server's exact strings, never a recomputed sum", () => {
  // Deliberately internally "inconsistent" fixture (subtotal + marginAmount +
  // taxAmount != grandTotal as printed) — if the display recomputed the
  // grand total instead of echoing recap.grandTotal, this assertion would
  // fail on the mismatched digit.
  const recap: PersistedDraftRecap = {
    pricingStatus: "COMPLETE",
    subtotal: "1000000.00",
    marginPercent: "10.00",
    marginAmount: "100000.00",
    taxPercent: "11.00",
    ppnPercent: "11.00",
    taxAmount: "121000.00",
    grandTotal: "9999999.99",
  };
  const display = toRecapDisplay(recap);
  assert.equal(display.incomplete, false);
  assert.equal(display.subtotalDisplay, "Rp 1.000.000,00");
  assert.equal(display.marginAmountDisplay, "Rp 100.000,00");
  assert.equal(display.taxAmountDisplay, "Rp 121.000,00");
  assert.equal(display.grandTotalDisplay, "Rp 9.999.999,99");
});

test("B-11: an INCOMPLETE recap never shows a fabricated number, only the honest label", () => {
  const recap: PersistedDraftRecap = {
    pricingStatus: "INCOMPLETE",
    subtotal: null,
    marginPercent: "10.00",
    marginAmount: null,
    taxPercent: "11.00",
    ppnPercent: "11.00",
    taxAmount: null,
    grandTotal: null,
  };
  const display = toRecapDisplay(recap);
  assert.equal(display.incomplete, true);
  assert.equal(display.incompleteLabel, "Harga belum lengkap");
  assert.equal(display.subtotalDisplay, "—");
  assert.equal(display.marginAmountDisplay, "—");
  assert.equal(display.taxAmountDisplay, "—");
  assert.equal(display.grandTotalDisplay, "—");
  assert.notEqual(display.grandTotalDisplay, "Rp 0,00");
});

test("a missing recap (null) is treated the same as INCOMPLETE, not as zero", () => {
  const display = toRecapDisplay(null);
  assert.equal(display.incomplete, true);
  assert.equal(display.grandTotalDisplay, "—");
});

test("B-12: an invalid decimal contract fails closed, never renders zero", () => {
  assert.equal(formatExactMoney("not-a-number"), "Nilai tidak valid");
  assert.notEqual(formatExactMoney("not-a-number"), "Rp 0,00");
  assert.equal(formatExactQuantity("not-a-number"), "Nilai tidak valid");
});

test("B-13: scientific notation is rejected, not silently reformatted", () => {
  assert.equal(formatExactMoney("1e21"), "Nilai tidak valid");
  assert.equal(formatExactQuantity("2.5e3"), "Nilai tidak valid");
});

test("B-14: canonical money always renders with exactly two decimals", () => {
  assert.equal(formatExactMoney("10"), "Rp 10,00");
  assert.equal(formatExactMoney("10.5"), "Rp 10,50");
  assert.equal(formatExactPercent("10"), "10,00");
  assert.equal(formatExactPercent("7.5"), "7,50");
});

test("a money string with more than two fraction digits fails closed instead of being silently rounded", () => {
  assert.equal(formatExactMoney("10.005"), "Nilai tidak valid");
});

test("FOLDER and NOTE rows carry no money/quantity/badge — only WORK_ITEM rows price", () => {
  const folder = toPersistedRowDisplay({ ...baseItem, itemType: "FOLDER" });
  assert.equal(folder.quantityDisplay, "");
  assert.equal(folder.unitPriceDisplay, "");
  assert.equal(folder.lineTotalDisplay, "");
  assert.equal(folder.originBadge, "");
  assert.equal(folder.provenance, null);
});
