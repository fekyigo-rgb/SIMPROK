-- BP-REGION-TRUTH-07S (additive only)
--
-- WHY_CURRENT_SCHEMA_IS_INSUFFICIENT:
-- `sourceRegionScopeLabel` stores WHICH scope a batch was read under ("SIRIMAU")
-- but nothing stores HOW it was read, nor whether the source gave that scope any
-- geographic meaning at all. Those are separate facts and neither is derivable
-- from the label:
--
--   * kind        — COLUMN and ROW_VALUE are computed at intake (USI-01) and were
--                   discarded at this boundary. A stored batch could not say
--                   which reading produced it.
--   * geography   — "SIRIMAU | TELUK AMBON | BAGUALA" and "GROSIR | ECERAN" are
--                   the SAME shape. Only a word the source itself writes
--                   ("KECAMATAN") separates a jurisdiction matrix from a trade-
--                   term matrix, and that word was recognised at intake and then
--                   thrown away.
--   * confirmed   — `Region` is a flat code/name table with no jurisdictional
--                   hierarchy, so SIMPROK holds no fact by which "SIRIMAU" could
--                   be PROVEN compatible with "Kecamatan Teluk Ambon Baguala".
--                   The compatibility is therefore asked of a human, once, and
--                   the answer needs somewhere truthful to live.
--
-- NOTHING IS INFERRED FOR EXISTING ROWS. All three columns are NULL on every
-- batch written before this migration and stay NULL. NULL means UNKNOWN — not
-- "not geographic" and not "confirmed". The readings that knew these answers are
-- over, and reconstructing them from a stored label afterwards would manufacture
-- provenance instead of recording it.
--
-- No column is dropped, renamed, retyped or backfilled. No CHECK constraint is
-- added or rewritten. No index is added: these are read alongside a batch that is
-- already being fetched by primary key, never searched by.

ALTER TABLE "basic_price_import_batches"
  ADD COLUMN "sourceRegionScopeKind" TEXT,
  ADD COLUMN "sourceRegionScopeGeographicEvidence" TEXT,
  ADD COLUMN "regionScopeConfirmedRegionId" UUID;
