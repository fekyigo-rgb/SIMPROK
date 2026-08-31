-- BP-DETAIL-MAINT-02
--
-- WHY_CURRENT_SCHEMA_IS_INSUFFICIENT:
-- A WORKSPACE_PRIVATE price cannot lawfully carry `supersedesBasicPriceId`
-- because S2 requires the successor to be PUBLISHED+PUBLISHED, and a private
-- price is forbidden publication clothing. The unique import-row provenance
-- check also forbids a second private row from sharing the predecessor's
-- evidence, so a post-create money correction could not be represented without
-- forcing the user back through Import.
--
-- This migration adds NO columns and NO second currentness table. It widens
-- two CHECKs so a private unpublished successor may name its predecessor, and
-- may omit `sourceImportRowId` because that unique evidence link already sits
-- on the predecessor. Catalog publication supersession is unchanged.

ALTER TABLE "basic_prices" DROP CONSTRAINT "basic_prices_supersession_successor_is_published_check";

ALTER TABLE "basic_prices" ADD CONSTRAINT "basic_prices_supersession_successor_is_published_check" CHECK (
  "supersedesBasicPriceId" IS NULL
  OR ("status" = 'PUBLISHED' AND "verificationStatus" = 'PUBLISHED')
  OR (
    "assetScope" = 'WORKSPACE_PRIVATE'
    AND "status" = 'UNPUBLISHED'
    AND "verificationStatus" = 'UNVERIFIED'
  )
);

ALTER TABLE "basic_prices" DROP CONSTRAINT "basic_prices_private_requires_import_row_provenance_check";

ALTER TABLE "basic_prices" ADD CONSTRAINT "basic_prices_private_requires_import_row_provenance_check" CHECK (
  "assetScope" <> 'WORKSPACE_PRIVATE'
  OR "sourceImportRowId" IS NOT NULL
  OR "supersedesBasicPriceId" IS NOT NULL
);
