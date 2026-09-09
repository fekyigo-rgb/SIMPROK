-- AHSP CLASSIFICATION ATTRIBUTES + "USULKAN KE SIMPROK" PROPOSAL MARKER.
--
-- Purely additive columns on the EXISTING "ahsps" row. This is NOT a second
-- AHSP truth, a second identity, or a second governance engine:
--
--   * code / fieldCategory / subCategory / classification are descriptive
--     attributes the Owner-approved detail view shows (Kode, Bidang/Kategori,
--     Subkategori, Jenis Pekerjaan klasifikasi). They carry no interpretation
--     of their own — they are what the source states.
--
--   * proposedAt (+ proposedBy provenance) is the ONE workflow marker the
--     "Usulkan ke SIMPROK" button needs: it distinguishes an AHSP that has not
--     yet been submitted for review ("Belum diusulkan") from one that has. The
--     review OUTCOME still rides on the existing reviewStatus (PENDING ->
--     APPROVED | REJECTED) and the existing approvedBy provenance — no new
--     status enum, no new decision table, no auto-publish.
--
-- Idempotent (ADD COLUMN IF NOT EXISTS) and reversible in spirit: no data is
-- rewritten, nothing is dropped, and every column is nullable so existing rows
-- keep their exact meaning (all pre-existing AHSPs read as "Belum diusulkan"
-- until a human proposes them).

ALTER TABLE "ahsps" ADD COLUMN IF NOT EXISTS "code" TEXT;
ALTER TABLE "ahsps" ADD COLUMN IF NOT EXISTS "fieldCategory" TEXT;
ALTER TABLE "ahsps" ADD COLUMN IF NOT EXISTS "subCategory" TEXT;
ALTER TABLE "ahsps" ADD COLUMN IF NOT EXISTS "classification" TEXT;

ALTER TABLE "ahsps" ADD COLUMN IF NOT EXISTS "proposedAt" TIMESTAMP(3);
ALTER TABLE "ahsps" ADD COLUMN IF NOT EXISTS "proposedByUserId" UUID;
ALTER TABLE "ahsps" ADD COLUMN IF NOT EXISTS "proposedByName" TEXT;
ALTER TABLE "ahsps" ADD COLUMN IF NOT EXISTS "proposedByEmail" TEXT;

CREATE INDEX IF NOT EXISTS "ahsps_proposedAt_idx" ON "ahsps"("proposedAt");
