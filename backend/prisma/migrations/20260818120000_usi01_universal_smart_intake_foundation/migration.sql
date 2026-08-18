-- USI-01 UNIVERSAL SMART INTAKE FOUNDATION
--
-- STRICTLY ADDITIVE. No column is dropped, no column is renamed, no value is
-- rewritten, and every new column either is nullable or carries a DEFAULT that
-- is TRUE of every row that already exists. Nothing here can lose data, and
-- nothing here changes the meaning of a fact already recorded.
--
-- Each change below exists because an existing field could not represent the
-- truth without lying. That justification is stated inline.

-- ---------------------------------------------------------------------------
-- 1. INGESTION CHANNEL VOCABULARY
--
-- WHY: LAW 3 requires CHANNEL, SOURCE, ORIGIN and TRUST to stay independent.
-- "PriceSourceOrigin" answers "who did this price come from in the world" and
-- "PriceSourceType" answers "what kind of statement is it". Neither can answer
-- "how did these bytes reach SIMPROK", and overloading either would collapse
-- exactly the axes the law separates.
-- ---------------------------------------------------------------------------
CREATE TYPE "IngestionChannel" AS ENUM (
  'USER_UPLOAD',
  'SUPPLIER_BRIDGE',
  'EXTERNAL_API',
  'MOBILE',
  'GOVERNMENT_FEED'
);

CREATE TYPE "IngestionConnectorStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- ---------------------------------------------------------------------------
-- 2. SOURCE LOCATOR DIALECT
--
-- WHY: "basic_price_import_rows" stores four source positions in columns named
-- source*CellAddress, and every value in them today is spreadsheet A1 notation.
-- A delimited-text source has real positions too, but they are not cell
-- references, and section 12 forbids dressing them as such. Nothing existing
-- records WHICH coordinate system a row's locators are written in, so a reader
-- could only assume -- and would assume wrong the moment a CSV arrived.
-- ---------------------------------------------------------------------------
CREATE TYPE "SourceLocatorDialect" AS ENUM ('EXCEL_A1', 'CSV_RC');

-- ---------------------------------------------------------------------------
-- 3. INGESTION CONNECTORS
--
-- WHY: sections 9 and 10 make the Supplier Bridge architectural rather than
-- hypothetical, and require connector identity, workspace scope, least
-- privilege and revocation. No existing table represents a non-human sender:
-- "accounts" are humans who log in, and "workspace_memberships" grant human
-- capability. Reusing either would have meant issuing a supplier a human
-- login -- the exact shape section 9's security law forbids.
--
-- A connector is bound to ONE workspace and acts on behalf of ONE account, so a
-- supplier structurally cannot reach another tenant. Revocation is a STATUS,
-- never a delete, so a revoked connector's provenance survives on every batch
-- it produced. It carries NO database credentials in either direction.
-- ---------------------------------------------------------------------------
CREATE TABLE "ingestion_connectors" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "displayName" TEXT NOT NULL,
  "channel" "IngestionChannel" NOT NULL,
  "secretHash" TEXT NOT NULL,
  "status" "IngestionConnectorStatus" NOT NULL DEFAULT 'ACTIVE',
  "actsOnBehalfOfAccountId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "revokedByAccountId" UUID,
  CONSTRAINT "ingestion_connectors_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ingestion_connectors_workspaceId_idx" ON "ingestion_connectors"("workspaceId");
CREATE INDEX "ingestion_connectors_organizationId_idx" ON "ingestion_connectors"("organizationId");
CREATE INDEX "ingestion_connectors_status_idx" ON "ingestion_connectors"("status");

ALTER TABLE "ingestion_connectors"
  ADD CONSTRAINT "ingestion_connectors_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ingestion_connectors"
  ADD CONSTRAINT "ingestion_connectors_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ingestion_connectors"
  ADD CONSTRAINT "ingestion_connectors_actsOnBehalfOfAccountId_fkey"
  FOREIGN KEY ("actsOnBehalfOfAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A revoked connector must carry the moment it was revoked, and an active one
-- must not claim to have been. A status that disagrees with its own timestamp
-- is provenance nobody can trust.
ALTER TABLE "ingestion_connectors"
  ADD CONSTRAINT "ingestion_connectors_revocation_coherent"
  CHECK (
    ("status" = 'ACTIVE' AND "revokedAt" IS NULL)
    OR ("status" = 'REVOKED' AND "revokedAt" IS NOT NULL)
  );

-- USER_UPLOAD is the channel of a human at a browser. It is not a connector
-- channel, and a connector must never be able to impersonate one.
ALTER TABLE "ingestion_connectors"
  ADD CONSTRAINT "ingestion_connectors_channel_is_not_user_upload"
  CHECK ("channel" <> 'USER_UPLOAD');

-- ---------------------------------------------------------------------------
-- 4. BATCH-LEVEL INTAKE PROVENANCE
--
-- WHY (locator dialect): see (2). DEFAULT 'EXCEL_A1' is not a convenience --
-- it is TRUE of every batch that exists, because until this migration the only
-- reader was the XLSX one.
--
-- WHY (region scope label): section 8. A regional matrix states several
-- jurisdictions per row and a batch may carry exactly one of them. "regionId"
-- records the CANONICAL Region a human chose; nothing records the SOURCE'S OWN
-- WORDING for the column that was read ("SIRIMAU"). Without it a batch cannot
-- say which of three columns its numbers came from, and two batches off one
-- file become indistinguishable evidence.
--
-- WHY (ingestion channel/connector/external ref): sections 9 and 10, and
-- LAW 3. Nothing on the batch records how it arrived. DEFAULT 'USER_UPLOAD' is
-- true of every existing batch: the browser upload route was the only door.
-- ---------------------------------------------------------------------------
ALTER TABLE "basic_price_import_batches"
  ADD COLUMN "sourceLocatorDialect" "SourceLocatorDialect" NOT NULL DEFAULT 'EXCEL_A1',
  ADD COLUMN "sourceRegionScopeLabel" TEXT,
  ADD COLUMN "sourceStorageRef" TEXT,
  ADD COLUMN "sourceObservationKey" TEXT,
  ADD COLUMN "ingestionChannel" "IngestionChannel" NOT NULL DEFAULT 'USER_UPLOAD',
  ADD COLUMN "ingestionConnectorId" UUID,
  ADD COLUMN "ingestionDeliveryId" TEXT,
  ADD COLUMN "ingestionExternalSourceId" TEXT,
  ADD COLUMN "ingestionExternalRecordId" TEXT,
  ADD COLUMN "ingestionExternalVersion" TEXT,
  ADD COLUMN "sourceObservedAt" TIMESTAMP(3);

-- ---------------------------------------------------------------------------
-- 4b. ONE OBSERVATION, ONE FACT  (USI-01R2 section 6B)
--
-- WHY A DATABASE CONSTRAINT AND NOT AN APPLICATION CHECK: a read-then-insert
-- cannot hold under concurrency. Two simultaneous deliveries of the same
-- supplier observation can both read "nothing exists" and both insert, leaving
-- SIMPROK holding two rows for one stated observation. This index is what makes
-- exactly one of them win.
--
-- PostgreSQL treats NULLs as distinct in a unique index, so manual uploads --
-- which state no external record identity and therefore carry no observation
-- key -- are entirely unaffected and keep their existing fingerprint law.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX "basic_price_import_batches_workspaceId_sourceObservationKey_key"
  ON "basic_price_import_batches"("workspaceId", "sourceObservationKey");

CREATE INDEX "basic_price_import_batches_ingestionConnectorId_idx"
  ON "basic_price_import_batches"("ingestionConnectorId");

ALTER TABLE "basic_price_import_batches"
  ADD CONSTRAINT "basic_price_import_batches_ingestionConnectorId_fkey"
  FOREIGN KEY ("ingestionConnectorId") REFERENCES "ingestion_connectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A batch that names no connector must not claim a connector-only channel, and
-- a batch that names one must not claim to be a browser upload. Provenance that
-- contradicts itself is worse than provenance that is absent.
ALTER TABLE "basic_price_import_batches"
  ADD CONSTRAINT "basic_price_import_batches_ingestion_channel_coherent"
  CHECK (
    ("ingestionChannel" = 'USER_UPLOAD' AND "ingestionConnectorId" IS NULL)
    OR ("ingestionChannel" <> 'USER_UPLOAD' AND "ingestionConnectorId" IS NOT NULL)
  );

-- ---------------------------------------------------------------------------
-- 5. ROW-LEVEL RAW TRUTH
--
-- WHY (rawPriceCellType nullable): the column holds a spreadsheet cell's native
-- type. A delimited-text field has no such thing. Sections 12 and 18 both
-- forbid fabricating one, and the alternatives were all lies: writing 3
-- ("string") would claim a reader that never ran; writing 0 ("empty") would
-- claim the field was blank. Making it nullable is the only option that keeps
-- every reader truthful, and it changes nothing about the rows already stored
-- -- every one of them keeps its real Excel type.
--
-- WHY (rawSourceContext): LAW 2. A real-world price table carries columns this
-- domain has no field for -- the other jurisdictions in a matrix, a preparer's
-- unit suggestion, a provenance note, a source-language label. Discarding them
-- would let a normalized value silently replace source truth, which LAW 2
-- forbids in as many words. It is evidence only; nothing computes from it.
-- ---------------------------------------------------------------------------
ALTER TABLE "basic_price_import_rows"
  ALTER COLUMN "rawPriceCellType" DROP NOT NULL;

ALTER TABLE "basic_price_import_rows"
  ADD COLUMN "rawSourceContext" JSONB;

-- ---------------------------------------------------------------------------
-- 6. ROW-LEVEL CATEGORY TRUTH  (USI-01R GAP B / LAW 2.8)
--
-- WHY (sourceSection nullable): the column decides a row's ResourceType for
-- Unit Kernel lookup and ResourceCatalog matching. A real source can state a
-- category SIMPROK has no safe mapping for, and the three alternatives were
-- all lies: MATERIAL would file a bulldozer as a material, EQUIPMENT would be
-- an equally baseless guess, and dropping the row would destroy evidence.
-- NULL is the only truthful answer, and it fails closed downstream: such a row
-- can never resolve or submit until a human settles it. Every row written
-- before this migration keeps its real value.
--
-- WHY (sourceSectionProvenance): LAW 2.8 makes source evidence outrank a human
-- fallback, which is unenforceable unless a reader can tell the two apart. The
-- real IKK workbook states "category_name = ALAT" per row; a blanket uploader
-- declaration of MATERIAL must never silently overwrite that, and the audit
-- trail must show which authority won.
--
-- WHY (raw category code/name): LAW 2.2. "ALAT" and its code are the source's
-- own words. They are retained whether or not SIMPROK could map them -- an
-- unmappable category is precisely the case where a human most needs to read
-- what the document actually said.
-- ---------------------------------------------------------------------------
CREATE TYPE "BasicPriceImportRowSectionProvenance" AS ENUM (
  'SOURCE_ROW_CATEGORY',
  'SOURCE_SECTION_TITLE',
  'UPLOADER_DECLARED'
);

ALTER TABLE "basic_price_import_rows"
  ALTER COLUMN "sourceSection" DROP NOT NULL;

ALTER TABLE "basic_price_import_rows"
  ADD COLUMN "sourceSectionProvenance" "BasicPriceImportRowSectionProvenance",
  ADD COLUMN "rawSourceCategoryCode" TEXT,
  ADD COLUMN "rawSourceCategoryName" TEXT;

-- ---------------------------------------------------------------------------
-- 7. TRUTHFUL BACKFILL FOR PRE-USI-01R ROWS
--
-- Every row that already exists came from the RM-02 sectioned workbook parser,
-- whose ONLY way to assign a section was a section-title row in the document
-- itself. SOURCE_SECTION_TITLE is therefore not a guess about them -- it is the
-- one thing that is provably true of all of them.
-- ---------------------------------------------------------------------------
UPDATE "basic_price_import_rows"
  SET "sourceSectionProvenance" = 'SOURCE_SECTION_TITLE'
  WHERE "sourceSection" IS NOT NULL AND "sourceSectionProvenance" IS NULL;

-- Only NOW may the invariant be enforced: PostgreSQL validates a CHECK against
-- every existing row at ADD CONSTRAINT time, so stating it before the backfill
-- above would have failed on exactly the rows the backfill exists to describe.
--
-- A row that names a resource family must say who decided it, and a row that
-- names none must not claim an authority for a decision that was never made.
ALTER TABLE "basic_price_import_rows"
  ADD CONSTRAINT "basic_price_import_rows_section_provenance_coherent"
  CHECK (
    ("sourceSection" IS NULL AND "sourceSectionProvenance" IS NULL)
    OR ("sourceSection" IS NOT NULL AND "sourceSectionProvenance" IS NOT NULL)
  );
