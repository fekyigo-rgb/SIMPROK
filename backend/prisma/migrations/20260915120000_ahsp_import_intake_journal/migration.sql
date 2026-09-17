-- IMPORT-SEAM-02 — AHSP IMPORT INTAKE JOURNAL.
--
-- THE FACT THIS CLOSES. A document import kept nothing for a work item it could
-- not write: the uploaded bytes were never stored and the understanding lived
-- only for the request, so the ONLY way to continue a held item was to upload
-- the same file again, and an item blocked by a genuinely missing source fact
-- vanished without a trace.
--
-- WHY THESE TABLES. `ahsp_import_jobs` and `ahsp_import_lines` already exist in
-- the AHSP domain for exactly this concept and have no production writer. They
-- are extended, not replaced: no parallel intake table is created, and
-- `ahsp_import_evidences` is left untouched (its locator columns are a second
-- provenance vocabulary; the line knowledge carries the one vocabulary).
--
-- ADDITIVE ONLY. Every new column is nullable (or defaulted), no existing column
-- changes meaning, and no row is rewritten. Verified before this migration was
-- written: the latest permanent backup holds zero rows in all three tables.

-- AlterTable
ALTER TABLE "ahsp_import_jobs" ADD COLUMN     "createdByUserId" UUID,
ADD COLUMN     "documentKnowledge" JSONB,
ADD COLUMN     "knowledgeContractVersion" TEXT,
ADD COLUMN     "parserContractVersion" TEXT,
ADD COLUMN     "sourceFileName" TEXT,
ADD COLUMN     "sourceSha256" VARCHAR(64),
ADD COLUMN     "workspaceId" UUID;

-- AlterTable
ALTER TABLE "ahsp_import_lines" ADD COLUMN     "ahspId" UUID,
ADD COLUMN     "ahspVersionId" UUID,
ADD COLUMN     "reasonCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "workspaceId" UUID;

-- CreateIndex
CREATE INDEX "ahsp_import_jobs_workspaceId_createdAt_idx" ON "ahsp_import_jobs"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "ahsp_import_lines_workspaceId_status_idx" ON "ahsp_import_lines"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ahsp_import_lines_importJobId_lineNumber_key" ON "ahsp_import_lines"("importJobId", "lineNumber");

-- AddForeignKey
ALTER TABLE "ahsp_import_jobs" ADD CONSTRAINT "ahsp_import_jobs_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A DOCUMENT JOB STATES ITS WHOLE IDENTITY, OR NONE OF IT.
--
-- The same rule `ahsp_resources` applies to its source locator: a job that names
-- a workspace but not the bytes, or the bytes but not the contracts they were
-- read under, cannot be continued or deduplicated honestly. Rows that predate the
-- journal (all six NULL) remain lawful without a back-fill.
ALTER TABLE "ahsp_import_jobs"
  ADD CONSTRAINT "ahsp_import_jobs_document_identity_coherence_check"
  CHECK (
    (
      "workspaceId" IS NULL
      AND "sourceSha256" IS NULL
      AND "sourceFileName" IS NULL
      AND "parserContractVersion" IS NULL
      AND "knowledgeContractVersion" IS NULL
      AND "documentKnowledge" IS NULL
    )
    OR (
      "workspaceId" IS NOT NULL
      AND "sourceSha256" IS NOT NULL
      AND "sourceFileName" IS NOT NULL
      AND "parserContractVersion" IS NOT NULL
      AND "knowledgeContractVersion" IS NOT NULL
      AND "documentKnowledge" IS NOT NULL
    )
  );
