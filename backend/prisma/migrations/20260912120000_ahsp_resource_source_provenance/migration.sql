-- ACG-01 CLOSURE 1 — AHSP RESOURCE SOURCE PROVENANCE.
--
-- THE FACT THIS CLOSES. `ahsp_resources.resourceId` is ONE column carrying TWO
-- kinds of fact: a hand-built recipe keeps the source's own words there, while
-- a document-canonicalised row stores the ResourceCatalog id the import already
-- proved. For the second kind the source spelling, its code and its locator
-- were gone the moment the row was written — so an accepted AHSP line could not
-- be traced back to the document row it came from, and the occurrence path had
-- to ask the identity kernel with `rawCode: null` even when the document
-- plainly stated a code (ACG-01 R2).
--
-- WHY NOT AN EXISTING COLUMN. `resourceId` is already overloaded and is read as
-- BOTH a catalog id and a raw spelling by `ahsp-resource-resolution.orchestrator`;
-- widening its meaning again is what created this gap. `baseUnit` holds the
-- RESOLVED unit, not the raw one. Nothing on ahsp_resources, ahsp_versions or
-- ahsps carries a sheet, a row, a cell or a file digest. The facts are
-- genuinely unrepresentable today.
--
-- WHY THESE NAMES. They are, byte for byte, the names `observed_resources` and
-- `resource_source_identities` already use for the same facts. One vocabulary
-- describes source provenance wherever SIMPROK records it; this migration
-- invents no second provenance system and duplicates no SourceEnvelope logic.
--
-- ADDITIVE AND NULLABLE, AND NULL MEANS UNKNOWN. Every existing row keeps its
-- exact current meaning and no back-fill is attempted: a row written before
-- this migration genuinely does not know where it came from, and inventing a
-- locator for it would be the fabrication this closure exists to prevent. A
-- hand-built AHSP supplies none of these and stays lawful forever.
--
-- NO originObservationId COLUMN. `observed_resources` is written only for
-- resources the import could NOT resolve, while an `ahsp_resources` row exists
-- only for a work item whose resources ALL resolved. The two sets are disjoint
-- by construction, so such a column would be NULL for every row ever written —
-- a speculative field, which the schema law forbids.

ALTER TABLE "ahsp_resources"
  ADD COLUMN "rawName"               TEXT,
  ADD COLUMN "rawCode"               TEXT,
  ADD COLUMN "rawUnit"               TEXT,
  ADD COLUMN "sourceSha256"          VARCHAR(64),
  ADD COLUMN "sourceFileName"        TEXT,
  ADD COLUMN "parserContractVersion" TEXT,
  ADD COLUMN "sheetName"             TEXT,
  ADD COLUMN "sourceRowNumber"       INTEGER,
  ADD COLUMN "sourceNameCellAddress" TEXT,
  ADD COLUMN "sourceCodeCellAddress" TEXT,
  ADD COLUMN "sourceUnitCellAddress" TEXT;

-- A PROVENANCE CLAIM IS WHOLE, OR IT IS ABSENT.
--
-- The same rule `rab_documents` already applies to its lock fact. A row that
-- names a sheet and a row number but cannot say WHICH FILE they belong to is
-- not traceable to anything — two documents both have a "Sheet1" row 14. So
-- either the document identity is present, or no locator is claimed at all.
--
-- Deliberately one-directional: it constrains only rows that claim a locator,
-- so every pre-existing row (all eleven columns NULL) is untouched and no
-- back-fill is needed. rawName/rawCode/rawUnit are NOT part of this check —
-- a source legitimately states a name while stating no code, and that is an
-- absent fact, not an incoherent one.
ALTER TABLE "ahsp_resources"
  ADD CONSTRAINT "ahsp_resources_source_locator_coherence_check"
  CHECK (
    (
      "sheetName" IS NULL
      AND "sourceRowNumber" IS NULL
      AND "sourceNameCellAddress" IS NULL
      AND "sourceCodeCellAddress" IS NULL
      AND "sourceUnitCellAddress" IS NULL
    )
    OR (
      "sourceSha256" IS NOT NULL
      AND "sourceFileName" IS NOT NULL
      AND "parserContractVersion" IS NOT NULL
    )
  );

-- The occurrence path asks the identity kernel by source code, so the column is
-- looked up rather than only stored. Kept a plain index because Prisma cannot
-- express a partial one, and a schema the datamodel cannot describe would drift
-- against every future migrate diff.
CREATE INDEX "ahsp_resources_rawCode_idx" ON "ahsp_resources"("rawCode");
