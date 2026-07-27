import assert from "node:assert/strict";
import test from "node:test";
import {
  batchStatusLabel,
  canSubmitBatch,
  collisionWarningLabel,
  formatBatchProgress,
  isRowMutable,
  rowSectionLabel,
  rowStatusLabel,
  type BasicPriceImportBatchSummary,
  type BasicPriceImportRowSummary,
} from "./basicPriceImportDisplay.ts";
import { buildLookupPath, createLatestRequestGate } from "./catalogSearch.ts";

const baseRow = (overrides: Partial<BasicPriceImportRowSummary> = {}): BasicPriceImportRowSummary => ({
  id: "row-1",
  status: "NEEDS_REVIEW",
  resolutionStatus: "UNRESOLVED",
  code: null,
  name: "Pekerja",
  unit: "OH",
  rawPriceDisplayText: "158,333.33",
  proposedCanonicalPrice: "158333.33",
  section: "LABOR",
  sourceRowNumber: 9,
  collisionType: "NONE",
  collisionOfRowId: null,
  resourceCatalogId: null,
  unitDefinitionId: null,
  reasonCodes: [],
  version: 0,
  ...overrides,
});

const baseBatch = (overrides: Partial<BasicPriceImportBatchSummary> = {}): BasicPriceImportBatchSummary => ({
  batchId: "batch-1",
  status: "NEEDS_REVIEW",
  importFingerprint: "FINGERPRINT",
  effectiveDate: null,
  regionId: null,
  version: 0,
  totalRows: 3,
  needsReviewRows: 1,
  readyForSubmissionRows: 1,
  rejectedRows: 1,
  submittedRows: 0,
  rows: [],
  ...overrides,
});

test("batchStatusLabel translates every known status to an Indonesian label", () => {
  assert.equal(batchStatusLabel("NEEDS_REVIEW"), "Perlu ditinjau");
  assert.equal(batchStatusLabel("SUBMITTED"), "Diajukan");
});

test("rowStatusLabel translates row statuses", () => {
  assert.equal(rowStatusLabel("READY_FOR_SUBMISSION"), "Siap diajukan");
  assert.equal(rowStatusLabel("REJECTED"), "Ditolak");
});

test("rowSectionLabel translates workbook sections", () => {
  assert.equal(rowSectionLabel("LABOR"), "Upah");
  assert.equal(rowSectionLabel("MATERIAL"), "Bahan");
  assert.equal(rowSectionLabel("EQUIPMENT"), "Peralatan");
});

test("collisionWarningLabel is null for NONE — callers render no badge", () => {
  assert.equal(collisionWarningLabel("NONE"), null);
});

test("collisionWarningLabel surfaces a same-value collision distinctly from a different-value one", () => {
  const sameValue = collisionWarningLabel("SAME_IDENTITY_SAME_VALUE");
  const differentValue = collisionWarningLabel("SAME_IDENTITY_DIFFERENT_VALUE");
  assert.ok(sameValue && sameValue.length > 0);
  assert.ok(differentValue && differentValue.length > 0);
  assert.notEqual(sameValue, differentValue);
});

test("formatBatchProgress reports zero rows honestly", () => {
  const batch = baseBatch({ totalRows: 0, needsReviewRows: 0, readyForSubmissionRows: 0, rejectedRows: 0 });
  assert.equal(formatBatchProgress(batch), "Tidak ada baris pada batch ini.");
});

test("formatBatchProgress counts reviewed rows as total minus still-pending", () => {
  const batch = baseBatch({ totalRows: 10, needsReviewRows: 4, readyForSubmissionRows: 5, rejectedRows: 1 });
  assert.equal(formatBatchProgress(batch), "6 dari 10 baris sudah ditinjau (5 siap diajukan, 1 ditolak).");
});

test("canSubmitBatch is false while any row is still NEEDS_REVIEW, even if READY_FOR_REVIEW", () => {
  const batch = baseBatch({ status: "READY_FOR_REVIEW", needsReviewRows: 1, readyForSubmissionRows: 2 });
  assert.equal(canSubmitBatch(batch), false);
});

test("canSubmitBatch is false when zero rows are ready — nothing to submit", () => {
  const batch = baseBatch({ status: "READY_FOR_REVIEW", needsReviewRows: 0, readyForSubmissionRows: 0 });
  assert.equal(canSubmitBatch(batch), false);
});

test("canSubmitBatch is true only once fully reviewed and at least one row is ready", () => {
  const batch = baseBatch({ status: "READY_FOR_REVIEW", needsReviewRows: 0, readyForSubmissionRows: 1 });
  assert.equal(canSubmitBatch(batch), true);
});

test("canSubmitBatch is false for a batch not yet in READY_FOR_REVIEW (e.g. already SUBMITTED)", () => {
  const batch = baseBatch({ status: "SUBMITTED", needsReviewRows: 0, readyForSubmissionRows: 1 });
  assert.equal(canSubmitBatch(batch), false);
});

test("isRowMutable is true only for NEEDS_REVIEW rows", () => {
  assert.equal(isRowMutable(baseRow({ status: "NEEDS_REVIEW" })), true);
  assert.equal(isRowMutable(baseRow({ status: "READY_FOR_SUBMISSION" })), false);
  assert.equal(isRowMutable(baseRow({ status: "REJECTED" })), false);
  assert.equal(isRowMutable(baseRow({ status: "SUBMISSION_CREATED" })), false);
});

test("lookup paths target the dedicated routes and preserve explicit filters", () => {
  assert.equal(
    buildLookupPath("resources", { q: "Kawat BRC", type: "MATERIAL", page: 2, limit: 20 }),
    "/basic-price-import-lookups/resources?q=Kawat+BRC&type=MATERIAL&page=2&limit=20",
  );
  assert.equal(
    buildLookupPath("units", { q: "M3", dimension: "VOLUME", kind: "CANONICAL" }),
    "/basic-price-import-lookups/units?q=M3&dimension=VOLUME&kind=CANONICAL",
  );
});

test("latest request gate prevents an older search response from replacing a newer result", () => {
  const gate = createLatestRequestGate();
  const older = gate.begin();
  const newer = gate.begin();
  assert.equal(gate.isLatest(older), false);
  assert.equal(gate.isLatest(newer), true);
  gate.invalidate();
  assert.equal(gate.isLatest(newer), false);
});
