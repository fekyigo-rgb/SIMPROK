-- BP-CHANGE-SEM-03
--
-- WHY_CURRENT_SCHEMA_IS_INSUFFICIENT:
-- CHECK I4a allowed a WORKSPACE_PRIVATE row only with `sourceImportRowId`
-- (import origin) or `supersedesBasicPriceId` (correction). A later lawful
-- market/KDN observation is neither: it must not reuse the predecessor's
-- unique import-row evidence, and it must not wear a supersession pointer
-- that would claim the older fact was an error.
--
-- This migration adds ONE boolean defaulting false (existing rows unchanged)
-- and widens I4a by a third evidence channel. No second price model. No
-- second temporal engine. New observation ≠ correction remains a CHECK.

ALTER TABLE "basic_prices" ADD COLUMN "recordsNewObservation" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "basic_prices" DROP CONSTRAINT "basic_prices_private_requires_import_row_provenance_check";

ALTER TABLE "basic_prices" ADD CONSTRAINT "basic_prices_private_requires_import_row_provenance_check" CHECK (
  "assetScope" <> 'WORKSPACE_PRIVATE'
  OR "sourceImportRowId" IS NOT NULL
  OR "supersedesBasicPriceId" IS NOT NULL
  OR (
    "recordsNewObservation" = TRUE
    AND "reportedByAccountId" IS NOT NULL
    AND "sourceImportRowId" IS NULL
    AND "supersedesBasicPriceId" IS NULL
  )
);

ALTER TABLE "basic_prices" ADD CONSTRAINT "basic_prices_new_observation_is_new_observation_check" CHECK (
  "recordsNewObservation" = FALSE
  OR (
    "assetScope" = 'WORKSPACE_PRIVATE'
    AND "sourceImportRowId" IS NULL
    AND "supersedesBasicPriceId" IS NULL
    AND "reportedByAccountId" IS NOT NULL
  )
);

CREATE UNIQUE INDEX "basic_prices_private_new_observation_idempotency_key"
ON "basic_prices" (
  "workspaceId",
  "resourceId",
  COALESCE("regionId", '00000000-0000-0000-0000-000000000000'::uuid),
  "effectiveDate",
  "value",
  COALESCE("kdnPercent", ('-1'::numeric)),
  "reportedByAccountId"
)
WHERE "recordsNewObservation" = TRUE
  AND "assetScope" = 'WORKSPACE_PRIVATE';
