-- AHSP Import ↔ Classification Connection — additive only.
--
-- WHY:
--   Pre-AHSP human-assisted classification context has no durable store on the
--   existing import journal. Penerbit/Instansi Sumber is TRULY_MISSING on AHSP
--   Version (Dasar/Acuan already lives as regulationReference).
--
-- THIS MIGRATION:
--   * AHSPImportJob.assistedClassificationContext Json? — temp declaration
--     before AHSP materialization (reuse import-job owner, not a parallel workflow)
--   * AHSPVersion.issuerInstitution String? — Penerbit / Instansi Sumber
--
-- DOES NOT:
--   * alter source identity / digest / idempotencyKey
--   * backfill classification assignments
--   * touch Slice-1 / assignment foundation migrations
--   * invent a generic metadata engine

ALTER TABLE "ahsp_import_jobs"
  ADD COLUMN "assistedClassificationContext" JSONB;

ALTER TABLE "ahsp_versions"
  ADD COLUMN "issuerInstitution" TEXT;
