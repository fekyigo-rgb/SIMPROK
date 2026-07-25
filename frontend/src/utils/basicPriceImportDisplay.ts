// Pure display/derivation helpers for the RM-02 Basic Price import journey.
// Mirrors the shape returned by backend BasicPriceImportService#summarize().

export interface BasicPriceImportRowSummary {
  id: string;
  status: 'PARSED' | 'NEEDS_REVIEW' | 'READY_FOR_SUBMISSION' | 'REJECTED' | 'SUBMISSION_CREATED';
  resolutionStatus: string;
  code: string | null;
  name: string;
  unit: string | null;
  rawPriceDisplayText: string | null;
  proposedCanonicalPrice: string | null;
  section: 'LABOR' | 'MATERIAL' | 'EQUIPMENT';
  sourceRowNumber: number;
  collisionType: 'NONE' | 'EXACT_DUPLICATE' | 'SAME_IDENTITY_SAME_VALUE' | 'SAME_IDENTITY_DIFFERENT_VALUE' | 'CODE_COLLISION' | 'NAME_COLLISION' | 'UNIT_COLLISION';
  collisionOfRowId: string | null;
  resourceCatalogId: string | null;
  unitDefinitionId: string | null;
  reasonCodes: string[];
  version: number;
}

export interface BasicPriceImportBatchSummary {
  batchId: string;
  status: 'PREVIEWED' | 'READY_FOR_REVIEW' | 'NEEDS_REVIEW' | 'APPROVED_FOR_SUBMISSION' | 'PARTIALLY_SUBMITTED' | 'SUBMITTED' | 'REJECTED' | 'SUPERSEDED';
  importFingerprint: string;
  effectiveDate: string | null;
  regionId: string | null;
  version: number;
  totalRows: number;
  needsReviewRows: number;
  readyForSubmissionRows: number;
  rejectedRows: number;
  submittedRows: number;
  rows: BasicPriceImportRowSummary[];
}

const BATCH_STATUS_LABELS: Record<BasicPriceImportBatchSummary['status'], string> = {
  PREVIEWED: 'Preview',
  READY_FOR_REVIEW: 'Siap ditinjau',
  NEEDS_REVIEW: 'Perlu ditinjau',
  APPROVED_FOR_SUBMISSION: 'Sedang diajukan',
  PARTIALLY_SUBMITTED: 'Sebagian diajukan',
  SUBMITTED: 'Diajukan',
  REJECTED: 'Ditolak',
  SUPERSEDED: 'Digantikan batch baru',
};

export const batchStatusLabel = (status: BasicPriceImportBatchSummary['status']): string =>
  BATCH_STATUS_LABELS[status] ?? status;

const ROW_STATUS_LABELS: Record<BasicPriceImportRowSummary['status'], string> = {
  PARSED: 'Terbaca',
  NEEDS_REVIEW: 'Perlu ditinjau',
  READY_FOR_SUBMISSION: 'Siap diajukan',
  REJECTED: 'Ditolak',
  SUBMISSION_CREATED: 'Sudah diajukan',
};

export const rowStatusLabel = (status: BasicPriceImportRowSummary['status']): string =>
  ROW_STATUS_LABELS[status] ?? status;

const SECTION_LABELS: Record<BasicPriceImportRowSummary['section'], string> = {
  LABOR: 'Upah',
  MATERIAL: 'Bahan',
  EQUIPMENT: 'Peralatan',
};

export const rowSectionLabel = (section: BasicPriceImportRowSummary['section']): string =>
  SECTION_LABELS[section] ?? section;

const COLLISION_LABELS: Record<BasicPriceImportRowSummary['collisionType'], string | null> = {
  NONE: null,
  EXACT_DUPLICATE: 'Duplikat persis baris lain',
  SAME_IDENTITY_SAME_VALUE: 'Identitas sama, nilai sama dengan baris lain',
  SAME_IDENTITY_DIFFERENT_VALUE: 'Identitas sama, nilai BERBEDA dengan baris lain',
  CODE_COLLISION: 'Kode bentrok dengan baris lain',
  NAME_COLLISION: 'Nama bentrok dengan baris lain',
  UNIT_COLLISION: 'Satuan bentrok dengan baris lain',
};

/** null when there is nothing to warn about — callers render no badge. */
export const collisionWarningLabel = (collisionType: BasicPriceImportRowSummary['collisionType']): string | null =>
  COLLISION_LABELS[collisionType];

/**
 * Batch-level progress line for the review page header. Never claims
 * completeness while any row is still NEEDS_REVIEW.
 */
export const formatBatchProgress = (batch: BasicPriceImportBatchSummary): string => {
  if (batch.totalRows === 0) return 'Tidak ada baris pada batch ini.';
  const reviewed = batch.totalRows - batch.needsReviewRows;
  return `${reviewed} dari ${batch.totalRows} baris sudah ditinjau (${batch.readyForSubmissionRows} siap diajukan, ${batch.rejectedRows} ditolak).`;
};

/**
 * Submit is only ever offered once every row has left NEEDS_REVIEW and at
 * least one row is actually READY_FOR_SUBMISSION — matches the backend's
 * own fail-closed preconditions (submitBatch throws otherwise), so this
 * only controls button availability, never a security decision.
 */
export const canSubmitBatch = (batch: BasicPriceImportBatchSummary): boolean =>
  batch.status === 'READY_FOR_REVIEW' && batch.needsReviewRows === 0 && batch.readyForSubmissionRows > 0;

export const isRowMutable = (row: BasicPriceImportRowSummary): boolean => row.status === 'NEEDS_REVIEW';
