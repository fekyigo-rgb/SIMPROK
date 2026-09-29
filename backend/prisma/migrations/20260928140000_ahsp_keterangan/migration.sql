-- Additive nullable Keterangan on AHSP identity (beside Kode).
-- No backfill. Existing rows stay NULL.
ALTER TABLE "ahsps" ADD COLUMN "keterangan" TEXT;
