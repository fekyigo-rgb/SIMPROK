import test from "node:test";
import assert from "node:assert/strict";
import {
  effectiveHistoryEntry,
  correctionCaptureMethod,
  correctionDate,
  historyMessage,
  monitoringReturnPath,
  projectCalendarDate,
  projectWorkDateDefault,
  plannedFact,
  semanticAuthorityLabel,
  semanticLeafRelationship,
  projectTimestampPresentation,
  timelinePresentation,
} from "./progressActual.ts";

test("MON03 workbench return keeps the exact selected item in a tiny URL seam", () => {
  assert.equal(
    monitoringReturnPath("project-1", "item-1"),
    "/field/project/project-1?item=item-1",
  );
});

test("MON04 semantic authority has calm truthful labels", () => {
  assert.equal(semanticAuthorityLabel("PROVEN"), "Sudah dikonfirmasi");
  assert.equal(semanticAuthorityLabel("NOT_PROVEN"), "Belum dikonfirmasi");
  assert.equal(semanticAuthorityLabel("STALE"), "Perlu ditinjau ulang");
  assert.equal(
    semanticAuthorityLabel("INVALID_PROVENANCE"),
    "Bukti konfirmasi tidak dapat digunakan",
  );
});

test("MON04 correction and independent-root meaning stay distinct", () => {
  assert.equal(semanticLeafRelationship(null), "Actual terpisah");
  assert.equal(
    semanticLeafRelationship("prior-entry"),
    "Koreksi dari Actual sebelumnya",
  );
});

test("MON03 UI reads planned quantity and unit from the governed planned object", () => {
  assert.deepEqual(plannedFact({ planned: { quantity: "10", unit: "m3" } }), {
    quantity: "10",
    unit: "m3",
  });
  assert.deepEqual(plannedFact({}), { quantity: null, unit: null });
});

test("MON03 timeline uses occurredAt and renders a valid date", () => {
  const view = timelinePresentation({
    action: "ACTUAL_ACCEPTED",
    occurredAt: "2026-08-15T01:02:03.000Z",
    actor: { displayName: "Field Authority" },
    reason: null,
  });
  assert.equal(view.key, "ACTUAL_ACCEPTED:2026-08-15T01:02:03.000Z");
  assert.notEqual(view.occurredAtLabel, "Invalid Date");
  assert.equal(view.occurredAtLabel.includes("2026"), true);
});

test("MON03 project timezone formatting is explicit and device-independent", () => {
  const jakarta = projectTimestampPresentation(
    "2026-08-15T00:00:00.000Z",
    "Asia/Jakarta",
  );
  const makassar = projectTimestampPresentation(
    "2026-08-15T00:00:00.000Z",
    "Asia/Makassar",
  );
  assert.notEqual(jakarta.occurredAtLabel, makassar.occurredAtLabel);
  assert.equal(jakarta.timeZoneBasis, "Waktu proyek (Asia/Jakarta)");
  assert.equal(makassar.timeZoneBasis, "Waktu proyek (Asia/Makassar)");
});

test("MON03 unknown project timezone displays UTC rather than device local time", () => {
  const unknown = projectTimestampPresentation(
    "2026-08-15T00:00:00.000Z",
    null,
  );
  const utc = projectTimestampPresentation("2026-08-15T00:00:00.000Z", "UTC");
  assert.equal(unknown.occurredAtLabel, utc.occurredAtLabel);
  assert.equal(
    unknown.timeZoneBasis,
    "UTC; zona waktu proyek belum ditetapkan",
  );
});

test("MON03 legacy null work date remains empty for correction", () => {
  assert.equal(correctionDate(null), "");
  assert.equal(correctionDate("2026-08-15T00:00:00.000Z"), "2026-08-15");
});

test("MON03 correction requires fresh provenance for a legacy capture method", () => {
  assert.equal(correctionCaptureMethod("LEGACY_UNSPECIFIED"), "");
  assert.equal(correctionCaptureMethod("LEGACY_IMPORT"), "");
  assert.equal(
    correctionCaptureMethod("FIELD_MEASUREMENT"),
    "FIELD_MEASUREMENT",
  );
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

test("MON03 work-date default comes from the Project timezone", () => {
  const boundary = new Date("2026-08-14T15:30:00.000Z");
  assert.equal(projectCalendarDate("Asia/Tokyo", boundary), "2026-08-15");
  assert.equal(projectCalendarDate("UTC", boundary), "2026-08-14");
  assert.equal(projectCalendarDate(null, boundary), "");
});

test("MON03 timezone loading never overwrites a manually selected work date", () => {
  const boundary = new Date("2026-08-14T15:30:00.000Z");
  assert.equal(
    projectWorkDateDefault("2026-08-12", true, "Asia/Tokyo", boundary),
    "2026-08-12",
  );
  assert.equal(
    projectWorkDateDefault("", false, "Asia/Tokyo", boundary),
    "2026-08-15",
  );
  assert.equal(projectWorkDateDefault("", false, null, boundary), "");
});
