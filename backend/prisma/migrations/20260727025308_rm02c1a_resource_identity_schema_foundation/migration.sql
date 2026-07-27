-- RM-02C1a — Resource Identity & Provenance Schema Foundation
--
-- Scope: schema DDL only. Zero business-data DML (INSERT=0, UPDATE=0, DELETE=0).
-- See docs/implementation-gates/rm02c1a-schema-foundation/00-RM02C1A-SCHEMA-CONTRACT.md
--
-- GLOBAL_RESOURCE_WITH_PROVENANCE=NOT_SUPPORTED_IN_RM02C1A
-- GLOBAL_RESOURCE_SEMANTICS=DEFERRED
-- RM02C1B_TARGET_SCOPE=WORKSPACE_A_ONLY
--
-- NOTE ON EXCLUDED DRIFT: Prisma's auto-generated diff for this migration
-- also proposed renaming three pre-existing, unrelated foreign-key
-- constraints on "project_ahsp_resource_resolutions" (a naming mismatch
-- predating this slice, caused by manually-shortened constraint names in an
-- earlier migration). That rename is unrelated to the RM-02C1a resource
-- identity contract and has been deliberately excluded from this migration
-- to keep this slice bounded. It is not a regression introduced here.

-- DropIndex
DROP INDEX "resource_catalogs_workspaceId_code_key";

-- AlterTable
ALTER TABLE "resource_catalogs" ALTER COLUMN "code" DROP NOT NULL;

-- CreateIndex (manual, partial)
-- Prisma's schema DSL cannot express a partial/filtered unique index, so this
-- replacement for the dropped compound unique index is hand-written here:
-- workspace-scoped uniqueness applies only to non-null canonical codes.
-- Multiple NULL-code resources per workspace are legal (CANONICAL_CODE_POLICY
-- = NULLABLE_AND_HUMAN_VERIFIED_ONLY). Global (workspaceId IS NULL) resources
-- are excluded from this index entirely; global uniqueness is not part of
-- this slice's contract (GLOBAL_RESOURCE_SEMANTICS=DEFERRED).
CREATE UNIQUE INDEX "resource_catalogs_workspace_code_nonnull_key"
ON "resource_catalogs" ("workspaceId", "code")
WHERE "workspaceId" IS NOT NULL
  AND "code" IS NOT NULL;

-- CreateTable
CREATE TABLE "resource_source_identities" (
    "id" UUID NOT NULL,
    "resourceCatalogId" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "sourceSha256" VARCHAR(64) NOT NULL,
    "sourceFileName" TEXT NOT NULL,
    "parserContractVersion" TEXT NOT NULL,
    "sheetName" TEXT NOT NULL,
    "sourceRowNumber" INTEGER NOT NULL,
    "sourceSection" "ResourceType" NOT NULL,
    "sourceCodeCellAddress" TEXT,
    "sourceNameCellAddress" TEXT NOT NULL,
    "sourceUnitCellAddress" TEXT,
    "rawCode" TEXT,
    "rawName" TEXT NOT NULL,
    "rawUnit" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resource_source_identities_pkey" PRIMARY KEY ("id")
);

-- AddCheckConstraint
-- Canonical storage convention for this domain: sourceSha256 must be exactly
-- 64 uppercase hexadecimal characters. No trimming, no silent repair — an
-- invalid write is rejected outright.
ALTER TABLE "resource_source_identities"
ADD CONSTRAINT "resource_source_identities_source_sha256_format_check"
CHECK ("sourceSha256" ~ '^[0-9A-F]{64}$');

-- CreateIndex
CREATE INDEX "resource_source_identities_resourceCatalogId_idx" ON "resource_source_identities"("resourceCatalogId");

-- CreateIndex
-- No separate index on ("workspaceId") alone: it would be a redundant
-- prefix of the composite unique index below, which Postgres can already
-- use for workspaceId-only lookups.
CREATE INDEX "resource_source_identities_sourceSha256_idx" ON "resource_source_identities"("sourceSha256");

-- CreateIndex
CREATE UNIQUE INDEX "resource_source_identities_workspaceId_sourceSha256_sheetNa_key" ON "resource_source_identities"("workspaceId", "sourceSha256", "sheetName", "sourceRowNumber", "parserContractVersion");

-- AddForeignKey
-- NOTE: resource_catalogs.workspaceId -> workspaces is ON DELETE CASCADE
-- (pre-existing), and this new FK is ON DELETE RESTRICT. Intended effect:
-- deleting a workspace that still has provenance-bearing resources fails
-- closed (the RESTRICT here blocks the cascade delete of the referenced
-- resource_catalogs row) rather than silently cascading away permanent
-- provenance evidence. This is deliberate, not an oversight.
ALTER TABLE "resource_source_identities" ADD CONSTRAINT "resource_source_identities_resourceCatalogId_fkey" FOREIGN KEY ("resourceCatalogId") REFERENCES "resource_catalogs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_source_identities" ADD CONSTRAINT "resource_source_identities_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- TENANCY ENFORCEMENT — DATABASE TRIGGERS (fail-closed, cannot be bypassed by
-- Prisma Client, raw SQL, or any other application-layer writer)
-- ============================================================================

-- TRIGGER 1 — provenance write enforcement.
-- On INSERT or UPDATE of resource_source_identities(resourceCatalogId,
-- workspaceId), reject the write unless the referenced ResourceCatalog
-- exists, has a non-null workspaceId, and that workspaceId matches the
-- provenance row's own workspaceId. This is what makes
-- GLOBAL_RESOURCE_WITH_PROVENANCE structurally impossible in this slice.
CREATE FUNCTION check_resource_source_identity_workspace_match()
RETURNS TRIGGER AS $$
DECLARE
  catalog_workspace_id UUID;
BEGIN
  SELECT "workspaceId" INTO catalog_workspace_id
  FROM "resource_catalogs"
  WHERE "id" = NEW."resourceCatalogId";

  IF catalog_workspace_id IS NULL THEN
    RAISE EXCEPTION 'RESOURCE_SOURCE_IDENTITY_WORKSPACE_MISMATCH: resource_catalogs.id % does not exist or has a NULL workspaceId; global/nonexistent resources cannot carry provenance in RM-02C1a', NEW."resourceCatalogId"
      USING ERRCODE = 'P0001';
  END IF;

  IF catalog_workspace_id <> NEW."workspaceId" THEN
    RAISE EXCEPTION 'RESOURCE_SOURCE_IDENTITY_WORKSPACE_MISMATCH: resource_source_identities.workspaceId % does not match resource_catalogs.workspaceId % for resourceCatalogId %', NEW."workspaceId", catalog_workspace_id, NEW."resourceCatalogId"
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER resource_source_identity_workspace_match_trigger
BEFORE INSERT OR UPDATE OF "resourceCatalogId", "workspaceId" ON "resource_source_identities"
FOR EACH ROW EXECUTE FUNCTION check_resource_source_identity_workspace_match();

-- TRIGGER 2 — resource scope immutability with provenance.
-- On UPDATE of resource_catalogs.workspaceId: allow an unchanged value;
-- reject any change (including a change to NULL / "global") once one or
-- more resource_source_identities rows already reference the resource.
CREATE FUNCTION check_resource_catalog_workspace_immutable_with_provenance()
RETURNS TRIGGER AS $$
DECLARE
  provenance_count INTEGER;
BEGIN
  SELECT count(*) INTO provenance_count
  FROM "resource_source_identities"
  WHERE "resourceCatalogId" = OLD."id";

  IF provenance_count > 0 THEN
    RAISE EXCEPTION 'RESOURCE_CATALOG_WORKSPACE_IMMUTABLE_WITH_PROVENANCE: resource_catalogs.id % has % existing resource_source_identities row(s); workspaceId cannot change from % to %', OLD."id", provenance_count, OLD."workspaceId", NEW."workspaceId"
      USING ERRCODE = 'P0002';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER resource_catalog_workspace_immutable_with_provenance_trigger
BEFORE UPDATE OF "workspaceId" ON "resource_catalogs"
FOR EACH ROW
WHEN (OLD."workspaceId" IS DISTINCT FROM NEW."workspaceId")
EXECUTE FUNCTION check_resource_catalog_workspace_immutable_with_provenance();
