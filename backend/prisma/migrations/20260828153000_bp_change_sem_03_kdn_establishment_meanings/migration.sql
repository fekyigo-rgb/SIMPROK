-- BP-CHANGE-SEM-03 (additive follow-on)
--
-- WHY_CURRENT_SCHEMA_IS_INSUFFICIENT:
-- CHECK `basic_prices_kdn_pair_check` (BP-KDN-01, LOCKED) requires
-- `kdnEstablishment` whenever `kdnPercent` is stated. A later KDN correction
-- or new KDN observation therefore cannot persist the new percent with a NULL
-- establishment. Reusing SOURCE_IMPORT_ROW would claim import evidence proves
-- the new percent. Reusing MANUAL_ENRICHMENT would claim a stated-KDN change
-- was a null-fill. Both would collapse meanings.
--
-- This migration adds two establishment values only. No second KDN column.
-- No pair-check rewrite. Existing rows are unchanged.

ALTER TYPE "BasicPriceKdnEstablishment" ADD VALUE 'MANUAL_CORRECTION';
ALTER TYPE "BasicPriceKdnEstablishment" ADD VALUE 'MANUAL_NEW_OBSERVATION';
