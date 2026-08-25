-- WHICH INTERPRETATION PRODUCED THESE ROWS.
--
-- A source whose columns carry no header, or which declares no resource families
-- of its own, admits MORE THAN ONE LAWFUL READING of the same bytes. The Owner's
-- workbook proved the cost: read with its resource-name column answered as the
-- unit column it produced 934 poisoned rows, and read honestly the identical
-- file produced 894 truthful ones. Nothing on this table could tell those two
-- readings apart, so the corrected import matched the poisoned batch's
-- fingerprint and was handed the poison back as a replay.
--
-- These columns are how a batch can be ASKED which reading produced it, and
-- they are fingerprint inputs so that a corrected reading becomes a new batch
-- rather than a replay of a wrong one.
--
-- ADDITIVE AND NULLABLE. Every existing row keeps NULL, and NULL is honest in
-- two ways at once: "the document decided this, no human answer was involved",
-- and for batches older than these columns, "not recorded". NOTHING IS
-- BACK-FILLED. SIMPROK does not reconstruct historical column roles from stored
-- cell addresses, because an inferred provenance is a fabricated one and a
-- fabricated provenance is worse than an absent one.
--
-- NO EXISTING VALUE IS REINTERPRETED, no default is written, no row is rewritten,
-- no constraint is dropped or altered, and no batch is retired. Retiring the
-- historical poisoned batch is a separate Owner decision and this migration
-- performs none of it.
ALTER TABLE "basic_price_import_batches" ADD COLUMN "interpretationResourceNameColumn" INTEGER;
ALTER TABLE "basic_price_import_batches" ADD COLUMN "interpretationSourceUnitColumn" INTEGER;
ALTER TABLE "basic_price_import_batches" ADD COLUMN "interpretationDeclaredSection" "BasicPriceImportRowSection";
