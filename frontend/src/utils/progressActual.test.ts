import test from "node:test";
import assert from "node:assert/strict";
import {
  effectiveHistoryEntry,
  historyMessage,
  localCalendarDate,
  plannedFact,
} from "./progressActual.ts";

test("MON03 UI reads planned quantity and unit from the governed planned object", () => {
  assert.deepEqual(plannedFact({ planned: { quantity: "10", unit: "m3" } }), {
    quantity: "10",
    unit: "m3",
  });
  assert.deepEqual(plannedFact({}), { quantity: null, unit: null });
});

test("MON03 history errors never become the empty-history claim", () => {
  assert.equal(
    historyMessage({ kind: "loaded", count: 0 }),
    "Belum ada Actual yang dicatat.",
  );
  assert.equal(
    historyMessage({ kind: "error", message: "Riwayat gagal dimuat (500)." }),
    "Riwayat gagal dimuat (500).",
  );
  assert.equal(
    historyMessage({ kind: "error", message: "Jaringan terputus." }),
    "Jaringan terputus.",
  );
});

test("MON03 effective identity comes only from the backend projection", () => {
  const entries = [{ id: "created-later" }, { id: "backend-effective" }];
  assert.equal(
    effectiveHistoryEntry(entries, "backend-effective")?.id,
    "backend-effective",
  );
  assert.equal(effectiveHistoryEntry(entries, null), null);
});

test("MON03 local calendar default does not drift to UTC on a +09 midnight boundary", () => {
  const boundary = new Date("2026-08-14T15:30:00.000Z");
  const fakeLocal = {
    getFullYear: () => 2026,
    getMonth: () => 7,
    getDate: () => 15,
  } as Date;
  assert.equal(boundary.toISOString().slice(0, 10), "2026-08-14");
  assert.equal(localCalendarDate(fakeLocal), "2026-08-15");
});
