# RM-02B0 — Schema Contract (Provisional)

STATUS: `PROVISIONAL_PENDING_PRODUCTION_PREFLIGHT`
OWNER_LOCKED: NO — this document is Claude Code's design proposal under Owner's already-locked policies (see §1). Nothing in this file overrides §1.1–§1.4 of the governing prompt; it translates those locks into a concrete schema.

This document is a design artifact only. No repository file, migration, or database was touched to produce it. All "current" facts cited below were re-verified by reading `backend/prisma/schema.prisma` and the named service files on `main` at commit `6ca0aa0d1d237dc97134eeb26d2117ba35a01181`.

---

## 1. Current Source Truth (re-verified)

| # | Fact | Evidence |
|---|---|---|
| 1 | `BasicPrice.status String @default("PUBLISHED")` | `backend/prisma/schema.prisma:1369` |
| 2 | `BasicPrice.verificationStatus PriceVerificationStatus @default(UNVERIFIED)` | `backend/prisma/schema.prisma:1363` |
| 3 | Public API requires `status='PUBLISHED' AND verificationStatus='PUBLISHED'` (both axes) | `backend/src/basic-price/basic-price.service.ts:21,67-71` |
| 4 | Current human-accept flow creates `BasicPrice{status:'PUBLISHED', verificationStatus:'VERIFIED'}` | `backend/src/reality-intake/price-submission-review.service.ts:194-199` |
| 5 | Current accept flow: `effectiveDate: revision.effectiveDate ?? new Date()` | `backend/src/reality-intake/price-submission-review.service.ts:191` |
| 6 | `PriceSubmission.resourceId` non-nullable | `backend/prisma/schema.prisma:1014` |
| 7 | `regionId` is a bare `String? @db.Uuid` on `PriceSubmission` and `BasicPrice` — no `Region` model exists anywhere in schema, no FK relation declared | confirmed via full-schema grep; only `enum LocationType` exists (terrain classification on `AHSP`, unrelated) |
| 8 | `BasicPrice.value Decimal @db.Decimal(18,2)` | `backend/prisma/schema.prisma:1361` |
| 9 | `PriceSubmissionRevision.value Decimal @db.Decimal(18,2)` | `backend/prisma/schema.prisma:1044` |
| 10 | `BoqItem.quantity Decimal @db.Decimal(18,2)` | `backend/prisma/schema.prisma:1518` |
| 11 | `PriceSubmission` → `PriceSubmissionRevision` → `PriceSubmissionReview` → `PriceSubmissionReviewDecision` lifecycle exists, human-accept-guarded via `assertHumanInWorkspace()` | `backend/src/reality-intake/price-submission-review.service.ts:452-475` |
| 12 | Basic Price public read routes are live | `backend/src/basic-price/basic-price.controller.ts` — `GET /basic-prices`, `GET /basic-prices/:id`, `GET /basic-prices/by-resource/:resourceId`, all guarded by `BASIC_PRICE_VIEW` |
| 13 | `simprok_rm01b_audit` provisioning artifact (`RM01B-CREATE-FORMAL-AUDIT-ROLE-PRODUCTION-V3.ps1`, outside repository, in a local design workspace) asserts and self-verifies exactly `DIRECT_COLUMN_SELECT_GRANT_COUNT == 45` column-level SELECT grants across an exact allowlist, `MUTATION_GRANT_COUNT == 0`, `DIRECT_FULL_TABLE_GRANT_COUNT == 0` | governance artifact, not repository-tracked; literal plaintext GRANT list was not locatable as a standalone file (likely applied via an archived/inline script) — the 10-table scope given in the governing prompt (§5.13) is treated as authoritative and structurally corroborated by this verification script's zero-mutation/zero-full-table-grant invariants |
| 14 | `simprok_rm01b_audit` has no privilege on `basic_prices`, `price_submissions`, `price_submission_revisions`, `price_submission_reviews`, `price_submission_review_decisions`, `boq_items`, `resource_catalog` | consistent with #13 — its allowlist is scoped to the 10 identity/governance tables listed in the governing prompt (organizations, workspaces, accounts, workspace_memberships, roles, membership_roles, projects, project_assignments, permissions, role_permissions), none of which include the Basic Price domain |

```
CURRENT_SOURCE_TRUTH_VERIFIED=YES
CURRENT_ACCEPT_FLOW_FILE=backend/src/reality-intake/price-submission-review.service.ts
CURRENT_PUBLIC_API_FILE=backend/src/basic-price/basic-price.service.ts
CURRENT_SCHEMA_FILE=backend/prisma/schema.prisma
RM01B_AUDIT_ROLE_PROVISION_FILE=<local design workspace>\RM01B-CREATE-FORMAL-AUDIT-ROLE-PRODUCTION-V3.ps1 (external, not repository-tracked)
RM01B_AUDIT_ROLE_TABLE_COUNT=10
RM01B_AUDIT_ROLE_RM02_VISIBILITY=INSUFFICIENT
SOURCE_TRUTH_CONTRADICTION_COUNT=0
```

Doctrine restated per instruction: `VERIFIED != PUBLISHED` is not a bug. `VERIFIED` means valid-per-review, still internal, not yet published. What does not yet exist is an **explicit publication capability** — that gap is designed in §6 below, not treated as a defect to silently patch.

---

## 2. Raw Numeric Evidence — Scientific Definition (§7 of governing prompt)

```
RAW_NUMERIC_DEFINITION_EXACT=
  RAW_NUMERIC_AUTHORITY = the exact round-trip decimal string representation
  of the IEEE-754 binary64 value that Excel stored for a numeric cell, as
  decoded by the approved backend parser (ExcelJS 4.4.0, the same library
  and version used by BoqXlsxIntakeAdapter). It is NOT "the number the
  workbook author intended" — that intent is frequently lost the moment a
  formula like "=1900000/12" is evaluated and stored as a float.

ORIGINAL_AUTHOR_INTENT_RECOVERABLE=NO_NOT_ALWAYS

Real proof from the reconfirmed source workbook (row 9, "Pekerja", column F):
  rawNumericRoundTripString = "158333.33333333334"
  numberFormat               = "_-* #,##0.00_-;-* #,##0.00_-;_-* \"-\"??_-;_-@_-"
  displayFormattedText       = "158,333.33"   (Excel-display only, via numFmt rounding)
  difference (raw - display) = 0.00333333334

The stored value and the displayed value are NOT the same fact. Neither is
automatically "the original author's intent" — the raw value is what Excel
computed (likely 1,900,000 ÷ 12, unrounded); the displayed value is what a
human reading the sheet would see. RM-02 must retain BOTH, and must never
claim either one is "the" original number without a human decision.
```

Minimum per-price-cell evidence fields (mandatory on `BasicPriceImportRow`, see §5):

```
NUMERIC_EVIDENCE_FIELDS=
  rawPriceCellType                       (ExcelJS cell.type, integer, evidence only)
  rawPriceNumericRoundTripString          (when cell.type is numeric)
  rawPriceTextValue                       (when cell.type is string)
  rawPriceNumberFormat                    (Excel numFmt string)
  rawPriceDisplayText                     (numFmt-rounded display text — NEVER canonical)

FORMULA_EVIDENCE_FIELDS=
  rawPriceFormulaText                     (e.g. "#REF!/160")
  rawPriceCachedResultRoundTripString     (formula's cached `.result`, round-tripped)
  rawPriceFormulaError                    (e.g. "#REF!", when result is an error object)

OBJECT_CELL_POLICY=
  Never coerce an unrecognized ExcelJS CellValue shape to `[object Object]`
  or `String(value)`. The adapter must exhaustively classify: plain
  string/number/boolean, Date, formula{formula,result}, richText[], error{error},
  hyperlink{text,hyperlink}. Any shape outside this enumerated set is a
  FUNCTIONAL_BLOCKER for that cell: resolutionStatus=NEEDS_REVIEW,
  CANONICAL_PRICE_AVAILABLE=NO. This is not hypothetical — the reconfirmed
  workbook's material-section resource-code column (D33 onward) and its
  "KET" column both contain shapes the BOQ adapter's simple cellText()
  helper does not resolve correctly (confirmed in RM-02A discovery).

DISPLAY_VALUE_IS_CANONICAL=NO
```

Formula without a cached result, or a formula whose cached result is an error object (both real, confirmed cases in the reconfirmed workbook — 16 `#REF!/160` cells in the labor "KET" column):

```
STATUS=NEEDS_REVIEW
CANONICAL_PRICE_AVAILABLE=NO
```

---

## 3. Region Authority Design (§9)

### 3.1 Decision matrix

| REGION_SCOPE_OPTION | ADVANTAGE | RISK | TENANT_IMPLICATION | GLOBAL_PRICE_IMPLICATION | LEGACY_NULL_REGION_IMPLICATION | RECOMMENDATION |
|---|---|---|---|---|---|---|
| GLOBAL_REGION_AUTHORITY (one shared canonical table, no tenant ownership) | Single source of truth; regions are real places, not tenant property; mirrors existing `UnitDefinition` (fully global, no `workspaceId`) | Region names visible cross-tenant (low sensitivity — place names are not secret) | `BasicPrice`/`PriceSubmission` keep their own existing `workspaceId` scoping independently of Region | An explicitly-scoped-nationwide price is a REAL Region row (e.g. `code:"ID-NASIONAL"`), never conflated with an unresolved/null region | Legacy `regionId=null` stays `null` — legitimately means "location not asserted," excluded from eligibility until resolved | **SELECTED** |
| WORKSPACE_OWNED_REGION | Full tenant autonomy over region taxonomy | Massive duplication (every workspace re-creates "DKI Jakarta"); geography is not tenant-specific data | Each workspace owns disjoint region sets — breaks cross-workspace price comparison | Ambiguous: "global" would need to mean "global within this workspace" | Same null semantics, but scoped per workspace | Rejected — overscope, no evidence a region is ever workspace-specific |
| ORGANIZATION_OWNED_REGION | Same rationale, one tier higher | Same duplication problem, one tier higher; `ResourceCatalog` doesn't even have `organizationId` today (see current-source-truth gap noted in RM-02A) | Same as above | Same ambiguity | Same | Rejected — same reasoning |
| PROJECT_LOCATION | Ties a region to a specific project's job site | Solves a different problem (where is the *project*, not where does the *price* apply) — out of RM-02 scope entirely | N/A | N/A | N/A | Out of scope — not a Basic Price identity concern |
| PRICE_COVERAGE_REGION | This *is* what `BasicPrice.regionId`/`PriceSubmission.regionId` already represent semantically | N/A | N/A | N/A | N/A | This is the actual FK target — satisfied by GLOBAL_REGION_AUTHORITY above |
| NEAREST_REGION_REFERENCE | Would let an unresolved location fall back to a "nearby" region automatically | **Exactly the auto-mapping the governing prompt forbids** ("Dilarang membuat region mapping otomatis" was already established in RM-02A; §9 here reiterates "Dilarang membuat Region hanya agar FK hijau") | — | — | — | Rejected — explicitly forbidden |
| UNKNOWN_LOCATION | A structurally real state distinct from "global" | None, if kept structurally distinct from global | — | — | `regionId IS NULL` **is** this state, by construction | Adopted as `regionId IS NULL`, never a dummy row |
| GLOBAL_PRICE_SCOPE | A conscious, human-asserted "this price applies everywhere" declaration | Must never be the *default* — only ever a deliberate, evidence-backed row | — | Represented as a REAL, explicitly-authorized `Region` row, never as `NULL` and never auto-created by this task | — | Adopted as a real row, seeded only by a future Owner-authorized step — never by RM-02B0 or RM-02B |

```
REGION_SCOPE_RECOMMENDATION=GLOBAL_REGION_AUTHORITY
REGION_IS_GLOBAL_AUTHORITY=YES
REGION_IS_TENANT_OWNED=NO
UNKNOWN_REGION_REPRESENTATION=regionId IS NULL (structurally distinct from any Region row; excluded from eligibility per §7 of this document)
GLOBAL_PRICE_REPRESENTATION=a real, explicitly Owner-authorized Region row (e.g. a future "ID-NASIONAL" row) — never NULL, never auto-created, never seeded by this task
REGION_SEED_REQUIRED=NO (not by this task)
REGION_SEED_SOURCE_POLICY=Any future Region row must be created by an explicit, Owner-authorized, evidence-backed step (naming convention + source justification recorded) — never inferred from a workbook, never defaulted, never created as part of RM-02B construction
```

### 3.2 Proposed Prisma model

```prisma
model Region {
  id        String   @id @default(uuid()) @db.Uuid
  code      String   @unique
  name      String
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  basicPrices             BasicPrice[]
  priceSubmissions        PriceSubmission[]
  basicPriceImportBatches BasicPriceImportBatch[]

  @@map("regions")
}
```

Deliberately omitted, with reasoning:

- **`parentRegionId` (hierarchy)** — omitted. The governing prompt allows a parent field "hanya bila source/domain membuktikan perlu." The reconfirmed workbook contains **zero** location data of any kind (RM-02A finding), so there is no evidence a hierarchy is needed yet. Adding it speculatively would be overscope. If a future workbook or Owner requirement proves a hierarchy is needed, this is a strict additive migration (`parentRegionId String? @db.Uuid` + self-relation), not a breaking one.
- **A per-row "authority scope" discriminator column** — omitted. The governing prompt's minimal-field list anticipates this in case the recommendation were a *mixed* global/tenant model. Because §3.1's recommendation resolves cleanly to a single global-authority table (no tenant ownership at all), a discriminator column would carry no information and is deliberately not added.

```
REGION_MODEL_PRISMA_PROPOSAL=see above
REGION_FK_PLAN=
  BasicPrice.regionId            String? @db.Uuid  -> add FK: region Region? @relation(fields:[regionId], references:[id], onDelete: Restrict)
  PriceSubmission.regionId       String? @db.Uuid  -> add FK: region Region? @relation(fields:[regionId], references:[id], onDelete: Restrict)
  BasicPriceImportBatch.regionId String? @db.Uuid  -> FK: region Region? @relation(fields:[regionId], references:[id], onDelete: Restrict)
  onDelete: Restrict chosen uniformly — a Region must never be silently
  cascade-deleted while price data still references it (fail-closed,
  consistent with SIMPROK's immutability doctrine for priced evidence).
```

---

## 4. Effective Date Contract (§10)

See the dedicated artifact `02-RM02B0-EFFECTIVE-DATE-CALLSITE-AUDIT.md` for the full callsite audit. Summary contract:

```
EFFECTIVE_DATE_SOURCE=human, supplied at BasicPriceImportBatch level before the batch may leave NEEDS_REVIEW/READY_FOR_REVIEW toward APPROVED_FOR_SUBMISSION
BATCH_LEVEL_EFFECTIVE_DATE_REQUIRED=YES (application-enforced transition guard, not a bare NOT NULL column — see §5.2 below for why)
ROW_OVERRIDE_SUPPORTED=YES (BasicPriceImportRow.effectiveDateOverride, nullable, optional per-row deviation from the batch date)
RM02_VALIDATION_LAYER=a dedicated guard analogous to RabLifecyclePolicyService, evaluated inside the same bounded transaction that creates PriceSubmission rows — rejects with MissingEffectiveDate-class error if batch.effectiveDate IS NULL at that point
RM02_FALLBACK_REACHABLE=NO
SHARED_FALLBACK_ACTION=RETAIN_PENDING_CALLSITE_AUDIT
HUMAN_DATE_EVIDENCE_FIELDS=effectiveDateSetByAccountId, effectiveDateSetAt (both on BasicPriceImportBatch)
MISSING_DATE_FAIL_CLOSED_REASON=EFFECTIVE_DATE_REQUIRED_BEFORE_SUBMISSION
UTANG_RM02_EFFECTIVE_DATE_FALLBACK_01=OPEN
```

---

## 5. BasicPriceImportBatch Design (§11)

### 5.1 Proposed Prisma model

```prisma
enum BasicPriceImportBatchStatus {
  PREVIEWED
  READY_FOR_REVIEW
  NEEDS_REVIEW
  APPROVED_FOR_SUBMISSION
  PARTIALLY_SUBMITTED
  SUBMITTED
  REJECTED
  SUPERSEDED
}

model BasicPriceImportBatch {
  id                  String   @id @default(uuid()) @db.Uuid
  workspaceId         String   @db.Uuid
  organizationId      String   @db.Uuid
  uploadedByAccountId String   @db.Uuid

  sourceFileName        String
  sourceSha256           String
  sourceByteLength       Int
  selectedSheetName      String
  parserContractVersion  String

  regionId                     String?   @db.Uuid
  effectiveDate                DateTime?
  effectiveDateSetByAccountId  String?   @db.Uuid
  effectiveDateSetAt           DateTime?

  sourceType              PriceSourceType?
  sourceOrigin            PriceSourceOrigin?
  sourceOrganizationName  String?
  sourceVendorName        String?

  priceCoverageDeclared Boolean  @default(false)
  transportIncluded     Boolean?
  loadingIncluded       Boolean?
  unloadingIncluded     Boolean?
  deliveredToProject    Boolean?

  importFingerprint String
  status            BasicPriceImportBatchStatus @default(PREVIEWED)

  reviewedByAccountId String?  @db.Uuid
  reviewedAt          DateTime?
  rejectionReason     String?  @db.Text

  version   Int      @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  region Region?                 @relation(fields: [regionId], references: [id], onDelete: Restrict)
  rows   BasicPriceImportRow[]

  @@unique([workspaceId, importFingerprint])
  @@index([workspaceId])
  @@index([organizationId])
  @@index([status])
  @@map("basic_price_import_batches")
}
```

Why `BasicPriceImportBatch` is persisted from `PREVIEWED` onward, unlike BOQ's stateless preview: BOQ's preview→approve is a single atomic action a user completes in one sitting. Basic Price import requires resolving potentially hundreds of ambiguous resource/unit rows (the reconfirmed workbook has 275) — real human review work that plausibly spans multiple sessions. A stateless preview (BOQ's pattern) cannot survive across sessions; RM-02 therefore needs a persisted, resumable working state. This is a deliberate, evidence-based departure from the BOQ precedent, not an inconsistency.

```
BASIC_PRICE_IMPORT_BATCH_PRISMA_PROPOSAL=see above
BATCH_STATUS_ENUM=PREVIEWED, READY_FOR_REVIEW, NEEDS_REVIEW, APPROVED_FOR_SUBMISSION, PARTIALLY_SUBMITTED, SUBMITTED, REJECTED, SUPERSEDED
BATCH_UNIQUE_CONSTRAINTS=(workspaceId, importFingerprint)
BATCH_INDEXES=workspaceId, organizationId, status
BATCH_FINGERPRINT_INPUTS=workspaceId, organizationId, sourceSha256, selectedSheetName, parserContractVersion, regionId, effectiveDate, sourceType, sourceOrigin, sourceOrganizationName, sourceVendorName, priceCoverageDeclared, transportIncluded, loadingIncluded, unloadingIncluded, deliveredToProject
BATCH_IMMUTABLE_FIELDS=sourceFileName, sourceSha256, sourceByteLength, selectedSheetName, parserContractVersion, importFingerprint, workspaceId, organizationId, uploadedByAccountId
BATCH_MUTABLE_FIELDS=regionId, effectiveDate*, sourceType/sourceOrigin/sourceOrganizationName/sourceVendorName, coverage booleans, status, reviewedByAccountId, reviewedAt, rejectionReason, version (mutable only until status leaves NEEDS_REVIEW/READY_FOR_REVIEW — see state machine in §12)
```

Per §19: "Same workbook + different region/date/source/coverage MUST_CREATE_DIFFERENT_FINGERPRINT=YES" — satisfied structurally because every one of those fields is a fingerprint input.

---

## 6. BasicPriceImportRow Design (§12)

```prisma
enum BasicPriceImportRowSection {
  LABOR
  MATERIAL
  EQUIPMENT
}

enum BasicPriceImportRowCollisionType {
  NONE
  EXACT_DUPLICATE
  SAME_IDENTITY_SAME_VALUE
  SAME_IDENTITY_DIFFERENT_VALUE
  CODE_COLLISION
  NAME_COLLISION
  UNIT_COLLISION
}

enum BasicPriceImportRowResolutionStatus {
  UNRESOLVED
  RESOURCE_UNKNOWN
  RESOURCE_AMBIGUOUS
  RESOURCE_TYPE_CONFLICT
  UNIT_UNKNOWN
  UNIT_AMBIGUOUS
  UNIT_CONVERSION_REQUIRED
  RESOLVED
}

enum BasicPriceImportRowStatus {
  PARSED
  NEEDS_REVIEW
  READY_FOR_SUBMISSION
  REJECTED
  SUBMISSION_CREATED
}

model BasicPriceImportRow {
  id      String @id @default(uuid()) @db.Uuid
  batchId String @db.Uuid

  sourceSection          BasicPriceImportRowSection
  sourceRowNumber        Int
  sourceCodeCellAddress  String
  sourceNameCellAddress  String
  sourceUnitCellAddress  String
  sourcePriceCellAddress String

  rawResourceCodeText String?
  rawResourceNameText String
  rawUnitText         String?

  rawPriceCellType                     Int
  rawPriceNumericRoundTripString       String?
  rawPriceTextValue                    String?
  rawPriceFormulaText                  String?
  rawPriceCachedResultRoundTripString  String?
  rawPriceFormulaError                 String?
  rawPriceNumberFormat                 String?
  rawPriceDisplayText                  String?

  proposedCanonicalPrice Decimal? @db.Decimal(18, 2)
  canonicalRoundingMode  String?

  resourceCatalogId    String?       @db.Uuid
  resolvedResourceType ResourceType?
  unitDefinitionId     String?       @db.Uuid

  collisionType    BasicPriceImportRowCollisionType @default(NONE)
  collisionOfRowId String?                          @db.Uuid

  resolutionStatus BasicPriceImportRowResolutionStatus @default(UNRESOLVED)
  reasonCodes      String[]

  status BasicPriceImportRowStatus @default(PARSED)

  resolvedByAccountId String?   @db.Uuid
  resolvedAt           DateTime?

  effectiveDateOverride DateTime?

  priceSubmissionId String? @unique @db.Uuid

  version   Int      @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  batch           BasicPriceImportBatch @relation(fields: [batchId], references: [id], onDelete: Cascade)
  resourceCatalog ResourceCatalog?      @relation(fields: [resourceCatalogId], references: [id], onDelete: Restrict)
  unitDefinition  UnitDefinition?       @relation(fields: [unitDefinitionId], references: [id], onDelete: Restrict)
  priceSubmission PriceSubmission?      @relation(fields: [priceSubmissionId], references: [id], onDelete: Restrict)
  collisionOfRow  BasicPriceImportRow?  @relation("RowCollision", fields: [collisionOfRowId], references: [id], onDelete: SetNull)
  collidingRows   BasicPriceImportRow[] @relation("RowCollision")

  @@unique([batchId, sourceRowNumber])
  @@index([batchId])
  @@index([status])
  @@index([resolutionStatus])
  @@index([resourceCatalogId])
  @@map("basic_price_import_rows")
}
```

`PriceSubmission` needs one additive, non-breaking counterpart: a virtual back-relation field (`importRow BasicPriceImportRow?`) — this is a Prisma-schema-only addition; it requires **no new column** on `price_submissions` because the foreign key lives on `BasicPriceImportRow.priceSubmissionId`.

```
BASIC_PRICE_IMPORT_ROW_PRISMA_PROPOSAL=see above
ROW_STATUS_ENUM=PARSED, NEEDS_REVIEW, READY_FOR_SUBMISSION, REJECTED, SUBMISSION_CREATED
ROW_COLLISION_ENUM=NONE, EXACT_DUPLICATE, SAME_IDENTITY_SAME_VALUE, SAME_IDENTITY_DIFFERENT_VALUE, CODE_COLLISION, NAME_COLLISION, UNIT_COLLISION
ROW_RESOLUTION_ENUM=UNRESOLVED, RESOURCE_UNKNOWN, RESOURCE_AMBIGUOUS, RESOURCE_TYPE_CONFLICT, UNIT_UNKNOWN, UNIT_AMBIGUOUS, UNIT_CONVERSION_REQUIRED, RESOLVED
ROW_UNIQUE_CONSTRAINTS=(batchId, sourceRowNumber)
ROW_INDEXES=batchId, status, resolutionStatus, resourceCatalogId
RAW_EVIDENCE_IMMUTABILITY_MECHANISM=application-layer discipline: the resolution/submission service is the only writer permitted to touch non-raw* columns (resourceCatalogId, resolutionStatus, status, etc.); every raw* column is set exactly once, at row-creation time, inside the same transaction that creates the batch's rows, and never referenced in any subsequent UPDATE statement. This is enforced by code review + a dedicated regression test (test matrix B11), not a database trigger — a trigger is noted below as optional hardening, deliberately not proposed as mandatory to avoid overscope for RM-02's bounded minimum.
  OPTIONAL_HARDENING (not proposed for RM-02B minimum scope): a BEFORE UPDATE trigger rejecting any change to raw* columns once set. Left to a future Architect decision if application-layer discipline proves insufficient in practice.
PRICE_SUBMISSION_LINK_CONSTRAINT=BasicPriceImportRow.priceSubmissionId is @unique — a row may link to at most one PriceSubmission, and a PriceSubmission may be linked from at most one row (1:1)
UNRESOLVED_ROW_CONTRACT_PASS=YES — an UNRESOLVED row (resolutionStatus != RESOLVED, or status in {PARSED, NEEDS_REVIEW, REJECTED}) structurally CANNOT have a non-null priceSubmissionId, because the row→submission transition is only ever executed by the same guarded transaction that requires resolutionStatus=RESOLVED and status=READY_FOR_SUBMISSION as preconditions (see state machine, §12.B). No PriceSubmission means no BasicPrice means no Cost Kernel eligibility — matches §1.2 exactly.
```

---

## 7. Canonical Rounding Contract (§13)

```
DECIMAL_LIBRARY=Prisma's bundled Decimal (decimal.js via @prisma/client/runtime/library.js) — already the canonical library in production code (backend/src/project/project.service.ts:112, backend/src/project/boq-import.service.ts)
RAW_TO_CANONICAL_ALGORITHM=
  1. Parse the raw round-trip string into a Prisma.Decimal (arbitrary precision, no float intermediate).
  2. Never round during parsing.
  3. Compute proposedCanonicalPrice = rawDecimal.toDecimalPlaces(2, Decimal.ROUND_HALF_UP) — a SEPARATE, explicitly-labeled field, never overwriting the raw evidence.
  4. proposedCanonicalPrice becomes PriceSubmissionRevision.value / eventual BasicPrice.value ONLY after a human resolves/submits the row — never automatically.
ROUNDING_MODE_EXPLICIT=ROUND_HALF_UP (Decimal.ROUND_HALF_UP), matches the accounting numFmt already used in the real source workbook
ROUNDING_EXECUTION_LAYER=backend exact-decimal authority only (never frontend, never native JS Number/toFixed)
ROUNDING_AUDIT_FIELDS=BasicPriceImportRow.rawPriceNumericRoundTripString (never rounded), BasicPriceImportRow.proposedCanonicalPrice (rounded, scale 2), BasicPriceImportRow.canonicalRoundingMode (explicit string, e.g. "ROUND_HALF_UP")
CANONICAL_SCALE=2 (money, per OD-04 §1.1 CANONICAL_MONEY_SCALE=2)
RAW_EVIDENCE_SCALE_LIMIT=none — rawPriceNumericRoundTripString is a String column, not Decimal; it stores the full round-trip representation regardless of scale (confirmed real examples have scale up to 14)
INTERMEDIATE_ROUNDING_COUNT=0
```

Worked proof, using the real reconfirmed source value (row 9, "Pekerja"):

```
raw evidence (never rounded)      = "158333.33333333334"
proposedCanonicalPrice (ROUND_HALF_UP, scale 2) = 158333.33
```

Exact-tie test case (mandatory per §13 "Sertakan exact-tie tests" — see test matrix B06):

```
raw = "0.125" (three decimal digits, exact half at the third position relative to scale-2 rounding: 0.125 rounded to 2dp)
ROUND_HALF_UP(0.125, 2) = 0.13   (the tie rounds up, by definition of HALF_UP)
```

---

## 8. Publication and Verification Model (§15)

### 8.1 Option comparison

| OPTION | SCHEMA_CHANGE | MIGRATION_RISK | LEGACY_COMPATIBILITY | SEMANTIC_CLARITY | PUBLIC_API_IMPACT | ROLLBACK_COMPLEXITY | RECOMMENDATION |
|---|---|---|---|---|---|---|---|
| A: convert `status` to a typed publication enum | Column type change on a live, read table | Highest — every existing string comparison (`'PUBLISHED'`) in `basic-price.service.ts` and `price-submission-review.service.ts` must move in lockstep | Requires deciding legacy row disposition FIRST (§18 is still `PROVISIONAL`) — premature to type-convert before that's known | Highest | Requires coordinated deploy | Highest (enum rollback needs a reverse cast) | Recommended as a **future** follow-up, once §18 legacy disposition is Owner-decided — not now |
| B: add a new `publicationStatus` enum column, keep legacy `status` temporarily | Additive column only | Low | High — old column untouched | Medium — two parallel concepts coexist temporarily | None immediately (old reads still work) | Low (drop the new column if abandoned) | Viable, but leaves semantic debt without a forcing function to resolve it |
| C: retain existing fields, neutralize the unsafe default, add a strict transition service | No column type change; only a `@default` value change (`"PUBLISHED"` → `"UNPUBLISHED"`) + a new audit table | Lowest — existing reads/writes of `status` as a string keep working; only the *default for new rows* changes, and only code paths that create a `BasicPrice` need to be reviewed | Full — legacy rows and their exact string values are untouched | `status` remains an untyped `String` (unresolved long-term), but behavior is safe now | None (existing reads unaffected — legacy `'PUBLISHED'` rows keep meaning `'PUBLISHED'`) | Lowest | **SELECTED for RM-02B minimum scope** |

**Selection rationale**: §18 (legacy transition policy) is explicitly `PROVISIONAL_PENDING_PRODUCTION_PREFLIGHT_AND_OWNER_DISPOSITION` — it is not yet known what legacy `BasicPrice` rows actually look like in production, or what Owner wants done with them. Converting `status` into a typed enum (Option A) before that disposition is known risks baking in an assumption about legacy data this task is explicitly forbidden from making. Option C is the only choice that fully satisfies every hard requirement in §15 **without** touching legacy row semantics or requiring the still-open legacy-disposition question to be answered first.

```
PUBLICATION_MODEL_RECOMMENDATION=OPTION_C (retain existing fields; neutralize unsafe default; add strict transition service + dedicated publication audit table)
PUBLICATION_STATUS_ENUM=none added — status remains String, but the value space in active use for new rows becomes {"UNPUBLISHED","PUBLISHED"} by convention, enforced by the transition service, not by a DB CHECK constraint (to avoid constraining legacy rows whose values are not yet known)
DEFAULT_PUBLICATION_STATUS=UNPUBLISHED  (schema change: BasicPrice.status @default("UNPUBLISHED"), replacing @default("PUBLISHED"))
VERIFICATION_ACCEPT_RESULT=acceptPriceSubmissionReview() MUST be changed (in RM-02B implementation, not in this design task) to create BasicPrice WITHOUT explicitly setting status — it defaults to "UNPUBLISHED" — while verificationStatus continues to be set to 'VERIFIED' exactly as today. This directly removes the "hidden publication inside review ACCEPT" defect.
PUBLICATION_TRANSITION=a new, dedicated service method (e.g. BasicPricePublicationService.publish(basicPriceId, actorAccountId)) is the ONLY code path permitted to write status:'PUBLISHED'. Preconditions: verificationStatus == 'VERIFIED' (never before); actor is human (never SYSTEM/AI); idempotent (publishing an already-PUBLISHED price returns the existing state, does not error, does not double-audit).
CURRENT_STATUS_FIELD_MIGRATION_PLAN=single migration step changing only the column DEFAULT clause; zero data rewrite; see 08-RM02B0-PROVISIONAL-MIGRATION-DESIGN.md item 9
UNSAFE_DEFAULT_PUBLISHED_REMOVAL_PLAN=neutralized (default changed to "UNPUBLISHED"), not deleted — the column and the literal value "PUBLISHED" both remain valid and meaningful, only the *default-when-unspecified* behavior changes
```

### 8.2 New audit model

```prisma
model BasicPricePublicationAudit {
  id             String   @id @default(uuid()) @db.Uuid
  basicPriceId   String   @db.Uuid
  action         String
  actorAccountId String   @db.Uuid
  reason         String?  @db.Text
  createdAt      DateTime @default(now())

  basicPrice BasicPrice @relation(fields: [basicPriceId], references: [id], onDelete: Cascade)

  @@index([basicPriceId])
  @@map("basic_price_publication_audits")
}
```

`action` is kept as a flexible `String` (mirroring `PriceSubmissionAudit`'s existing `reason: String?` pattern) rather than an enum, so a future `'UNPUBLISH'`/`'WITHDRAW'` action can be added without a migration — at RM-02's minimum scope, `'PUBLISH'` is the only value ever written. `actorAccountId` is non-nullable by design: **a publication audit row with no human actor should be structurally impossible.**

---

## 9. Publication RBAC and Authority (§16)

| OPERATION | PERMISSION | WORKSPACE_SCOPE | ORGANIZATION_SCOPE | AUTHORITY_LEVEL | SELF_ACTION_ALLOWED | FOUR_EYES_REQUIRED | AUDIT_EVENT_REQUIRED |
|---|---|---|---|---|---|---|---|
| Import workbook / preview / create batch | `BASIC_PRICE_IMPORT` (new) | YES | YES (via workspace→org) | Execution (User) | — | NO | batch creation is itself an audit event (createdAt/uploadedByAccountId) |
| Resolve imported row | `BASIC_PRICE_RESOLVE` (new) | YES | YES | Execution (User) | — | NO | row resolution timestamped (resolvedByAccountId/resolvedAt) |
| Submit resolved row → PriceSubmission | `BASIC_PRICE_SUBMIT` (new) | YES | YES | Execution (User) | — | NO | `PriceSubmissionAudit` (existing mechanism) |
| Verify (accept/reject/request-correction) | `BASIC_PRICE_VERIFY` (new) | YES | YES | Execution (User) | **NO** — recommend the verifier must not be the same account that imported/resolved the row (see below) | **YES (recommended)** | `PriceSubmissionAudit`/`PriceSubmissionReviewDecision` (existing) |
| Publish verified BasicPrice | `BASIC_PRICE_PUBLISH` (new) | YES | YES | Execution (User) | **NO** — recommend the publisher must not be the same account that verified it | **YES (recommended)** | `BasicPricePublicationAudit` (new, §8.2) |
| View internal review (batches/rows/submissions pre-publication) | `BASIC_PRICE_REVIEW_VIEW` (new) | YES | YES | Execution (User) | — | NO | read-only, no audit needed |
| View public price | `BASIC_PRICE_VIEW` (existing, reused) | YES | YES | Execution (User) | — | NO | read-only |

```
RBAC_RECOMMENDATION_COMPLETE=YES
NEW_PERMISSION_REQUIRED=BASIC_PRICE_IMPORT, BASIC_PRICE_RESOLVE, BASIC_PRICE_SUBMIT, BASIC_PRICE_VERIFY, BASIC_PRICE_PUBLISH, BASIC_PRICE_REVIEW_VIEW
EXISTING_PERMISSION_REUSE=BASIC_PRICE_VIEW (public read, already exists and already used by basic-price.controller.ts); BASIC_PRICE_MANAGE (already defined in backend/src/common/constants/permissions.ts:41 but currently unused by any controller — NOT assumed sufficient on its own per instruction; left available for a future Owner decision to use it as a coarse "admin can do everything Basic-Price" bundle role, distinct from the fine-grained operation permissions above)
FOUR_EYES_RECOMMENDATION=YES for VERIFY and PUBLISH specifically — honestly flagged as a NEW, STRICTER behavior than what exists today: the current `assertHumanInWorkspace()` in price-submission-review.service.ts only requires "a human in the workspace," not "a human who did not import/resolve/verify this specific item." Introducing real four-eyes enforcement is a recommendation for RM-02, not a description of existing behavior, and adds workflow friction Owner should consciously accept.
SELF_REVIEW_RECOMMENDATION=NO (importer/resolver should not verify their own submission)
SELF_PUBLISH_RECOMMENDATION=NO (verifier should not publish their own verification) — together these create a 3-actor minimum chain (import/resolve -> verify -> publish) for money-bearing data, consistent with the doctrine's explicit "AI/system tidak boleh publish" and general four-eyes spirit for financial data.
```

---

## 10. Shared Basic Price Eligibility Policy (§17)

```
ELIGIBILITY_POLICY_NAME=BasicPriceEligibilityPolicy (proposed, not implemented)
ELIGIBILITY_POLICY_FILE=backend/src/basic-price/basic-price-eligibility.policy.ts (proposed path — NOT created by this task)
ELIGIBILITY_INPUT=a BasicPrice row (id, status, verificationStatus, regionId, resourceId, effectiveDate, workspaceId, sourceSubmissionId, freshnessStatus) plus its resolved ResourceCatalog/UnitDefinition/Region identity
ELIGIBILITY_OUTPUT={ eligible: boolean, reasonCode: EligibilityReasonCode }
ELIGIBILITY_REASON_CODES=
  NOT_PUBLISHED (status != 'PUBLISHED')
  NOT_VERIFICATION_TERMINAL (verificationStatus != 'PUBLISHED')
  RESOURCE_IDENTITY_MISSING
  UNIT_IDENTITY_MISSING
  REGION_IDENTITY_MISSING (regionId IS NULL — per §9, null is never treated as global)
  EFFECTIVE_DATE_MISSING
  SOURCE_IDENTITY_MISSING
  FRESHNESS_EXPIRED (freshnessStatus == 'EXPIRED')
  UNRESOLVED_COLLISION_PRESENT
  REJECTED
  INCOMPLETE_NEW_IMPORT_PROVENANCE (for RM-02-imported prices specifically: missing linked BasicPriceImportRow/batch evidence)
  ELIGIBLE (terminal pass)
PUBLIC_API_REUSE_PLAN=basic-price.service.ts's three read methods (findAllForWorkspace/findOneForWorkspace/findByResource) should call this policy instead of re-implementing the `status='PUBLISHED' AND verificationStatus='PUBLISHED'` predicate inline — a refactor recommendation for RM-02B, not performed now
AHSP_REUSE_PLAN=ahsp-resource-price-resolution.kernel.ts's existing reason codes (SINGLE_ELIGIBLE_BASIC_PRICE / NO_BASIC_PRICE_CANDIDATE / etc.) should filter candidates through this same policy before resolution — noted as a future integration point, NOT implemented, NOT touched by RM-02
COST_KERNEL_REUSE_PLAN=same — noted as a future integration point only. This task does not implement or execute the Cost Kernel.
```

Note on §1.4's requirement `BASIC_PRICE_PUBLIC_API_RULE = BASIC_PRICE_AHSP_RESOLUTION_RULE = BASIC_PRICE_COST_KERNEL_RULE`: this shared policy is precisely the mechanism that makes that equality structurally true — one function, three call sites, not three independently-maintained copies of the same rule that could silently drift apart.

---

## 11. Legacy Basic Price Transition Policy (§18)

```
RM02_IMPORTED_PRICE_POLICY=STRICT_NEW_PROVENANCE_REQUIRED
LEGACY_BASIC_PRICE_POLICY=PROVISIONAL_PENDING_PRODUCTION_PREFLIGHT_AND_OWNER_DISPOSITION
```

| OPTION | PUBLIC_API_IMPACT | COST_KERNEL_IMPACT | AUDIT_RISK | OWNER_WORKLOAD | RECOMMENDATION |
|---|---|---|---|---|---|
| 1. Temporary grandfathering with explicit legacy reason code | None immediately — legacy rows keep serving as they do today, tagged internally | Legacy rows remain eligible until Owner revisits | Low — behavior unchanged, just labeled | Low now, deferred later | Reasonable interim default *if* Owner wants zero behavior change today |
| 2. Human recertification (每 legacy row re-verified against the new eligibility policy) | None until recertification completes | Frozen until recertified | Lowest long-term | **High** — proportional to legacy row count, unknown until preflight | Best long-term integrity, but workload unknown without preflight data |
| 3. Quarantine (legacy rows excluded from new eligibility policy until reviewed) | **Could break existing consumers immediately** if any legacy price currently serves live traffic | Immediately restrictive | Low | Medium | Risky without knowing how many legacy rows exist / are in active use |
| 4. Evidence-backed migration (attempt to reconstruct missing provenance from whatever historical trace exists) | None if successful | Restored once migrated | Depends on evidence quality — risk of fabricating provenance if evidence is thin | Medium-high | Only viable if real historical evidence exists — unknown without preflight |
| 5. Phased sunset (legacy rows remain eligible for a bounded grace period, then expire) | Predictable, bounded | Predictable, bounded | Low | Medium (requires monitoring) | Good balance, but the deadline is a policy choice only Owner can set |

```
LEGACY_POLICY_OPTIONS=see table above (5 options)
LEGACY_POLICY_RECOMMENDATION=Option 1 (temporary grandfathering, explicit reason code) as the SAFEST interim choice — it is the only option that changes nothing about current behavior while the real legacy-row facts are still unknown (preflight not yet run). This is a recommendation only; final choice is Owner's after production preflight facts are in hand.
LEGACY_REASON_CODE=LEGACY_PRE_RM02_PROVENANCE (proposed constant, not yet backed by a schema field — would live as a value inside BasicPricePublicationAudit.reason or a future dedicated flag, pending Owner disposition)
LEGACY_AUTOMATIC_ELIGIBILITY=NO
LEGACY_AUTOMATIC_INVALIDATION=NO
```

Until Owner disposition: current public legacy behavior is NOT changed by this design, and no future Cost Kernel path may consume legacy rows automatically. Where relevant, RM-02B implementation must return `LEGACY_DISPOSITION_REQUIRED` rather than silently deciding.

---

## 12. Concurrency, Replay, Idempotency (§19) and State Machines (§20)

### 12.1 Concurrency/replay contract

```
IMPORT_BATCH_UNIQUE_FINGERPRINT=(workspaceId, importFingerprint) unique constraint on BasicPriceImportBatch — mirrors BOQ's fingerprint pattern (BoqImportService.fingerprint())
ROW_DETERMINISTIC_IDENTITY=(batchId, sourceRowNumber) unique constraint on BasicPriceImportRow
BATCH_ROW_LOCK=explicit `SELECT ... FOR UPDATE` on the target BasicPriceImportBatch row, via a raw parameterized Prisma.sql statement (mirrors BoqImportService.approve()'s proven pattern) — never a broad workspace/project-wide lock
IMPORT_APPROVE_LOCK=same batch-row lock, held for the duration of the bounded transaction that creates PriceSubmission rows from READY_FOR_SUBMISSION rows
ROW_RESOLUTION_LOCK=explicit `SELECT ... FOR UPDATE` on the individual BasicPriceImportRow being resolved
PUBLICATION_ROW_LOCK=explicit `SELECT ... FOR UPDATE` on the target BasicPrice row during BasicPricePublicationService.publish()
OPTIMISTIC_VERSION_POLICY=every new model (BasicPriceImportBatch, BasicPriceImportRow) carries a `version Int @default(0)` column as defense-in-depth alongside the row lock — mutations increment `version`; a caller-supplied stale `version` on a resolve/submit/publish request fails closed (I06 in test matrix)
REPLAY_POLICY=
  same fingerprint + same tenant => return the EXISTING batch, never duplicate rows (I01)
  same file + different metadata => different fingerprint => new candidate batch (I02)
  modified file (different sha256) presented against an old fingerprint => fail closed (I03)
CONCURRENT_APPROVE_SEMANTICS=serialized via the batch row lock; the second concurrent request observes the first's already-committed state and returns an idempotent result, never a duplicate PriceSubmission (I04, I05)
CONCURRENT_PUBLISH_SEMANTICS=serialized via the BasicPrice row lock; the second concurrent publish request observes status already 'PUBLISHED' and returns the existing state idempotently (G10, G11)
IDEMPOTENT_RESPONSE_CONTRACT=every mutating endpoint (import approve, row submit, verify, publish) returns the SAME shape whether it performed the mutation or found it already done — callers cannot distinguish "I just did this" from "this was already done" except via a response flag, never via a different HTTP status/error
```

Per instruction: no broad workspace/project-wide lock is used anywhere in this design — every lock target is the single exact row being mutated, exactly like the proven BOQ pattern.

### 12.2 State machines

**A. BasicPriceImportBatch**

| FROM | TO | ACTOR | PERMISSION | PRECONDITIONS | DB_LOCK | AUDIT_EVENT | IDEMPOTENT | FAIL_CLOSED_REASON |
|---|---|---|---|---|---|---|---|---|
| (none) | PREVIEWED | Human | BASIC_PRICE_IMPORT | valid workbook, sha256 computed, fingerprint computed | none (insert) | batch created | on same fingerprint: return existing batch | INVALID_WORKBOOK |
| PREVIEWED | READY_FOR_REVIEW | System (automatic, after row parsing) | — | all rows parsed | batch row lock | — | YES | PARSE_FAILURE |
| READY_FOR_REVIEW | NEEDS_REVIEW | System (automatic) | — | ≥1 row NOT in RESOLVED/READY_FOR_SUBMISSION | batch row lock | — | YES | — |
| NEEDS_REVIEW | READY_FOR_REVIEW | Human (via row resolution) | BASIC_PRICE_RESOLVE | all rows resolved or explicitly rejected | row lock per row | row resolution audit | YES | — |
| READY_FOR_REVIEW | APPROVED_FOR_SUBMISSION | Human | BASIC_PRICE_SUBMIT | batch.effectiveDate IS NOT NULL, batch.regionId IS NOT NULL, ≥1 row READY_FOR_SUBMISSION | batch row lock | batch approval audit | YES (already-approved returns idempotently) | EFFECTIVE_DATE_REQUIRED_BEFORE_SUBMISSION / REGION_REQUIRED_BEFORE_SUBMISSION |
| APPROVED_FOR_SUBMISSION | PARTIALLY_SUBMITTED / SUBMITTED | System (within the bounded transaction) | — | each READY_FOR_SUBMISSION row creates exactly one PriceSubmission | row lock per row | PriceSubmissionAudit per row | YES | ROW_SUBMISSION_COUNT_MISMATCH |
| any non-terminal | REJECTED | Human | BASIC_PRICE_SUBMIT or BASIC_PRICE_RESOLVE (batch-level reject) | — | batch row lock | rejection audit (reason required) | YES | — |
| SUBMITTED | SUPERSEDED | Human (via a new batch approved for the same resource scope) | BASIC_PRICE_IMPORT | a newer batch reaches SUBMITTED for overlapping resources | batch row lock | supersession audit | YES | — |

**B. BasicPriceImportRow**

| FROM | TO | ACTOR | PERMISSION | PRECONDITIONS | DB_LOCK | AUDIT_EVENT | IDEMPOTENT | FAIL_CLOSED_REASON |
|---|---|---|---|---|---|---|---|---|
| (none) | PARSED | System | — | raw evidence extracted from workbook | none (insert) | — | — | UNRECOGNIZED_CELL_SHAPE |
| PARSED | NEEDS_REVIEW | System (automatic) | — | resolutionStatus != RESOLVED, or collisionType != NONE | none | — | YES | — |
| PARSED | READY_FOR_SUBMISSION | System (automatic) | — | resolutionStatus == RESOLVED, collisionType == NONE, canonical price available | none | — | YES | FORMULA_ERROR_NO_CANONICAL_PRICE |
| NEEDS_REVIEW | READY_FOR_SUBMISSION | Human | BASIC_PRICE_RESOLVE | human sets resourceCatalogId + unitDefinitionId, resolves collision | row lock | resolution audit | YES | — |
| NEEDS_REVIEW / READY_FOR_SUBMISSION | REJECTED | Human | BASIC_PRICE_RESOLVE | reason required | row lock | rejection audit | YES | — |
| READY_FOR_SUBMISSION | SUBMISSION_CREATED | System (within batch-approve transaction) | — | batch reaches APPROVED_FOR_SUBMISSION, row still READY_FOR_SUBMISSION at lock time | row lock | PriceSubmission linked | YES (already-linked row returns idempotently) | ROW_VERSION_STALE |

**C. PriceSubmission** (existing lifecycle — documented, not modified by this design)

| FROM | TO | ACTOR | PRECONDITIONS | AUDIT_EVENT | Evidence |
|---|---|---|---|---|---|
| (none) | SUBMITTED | System (from RM-02 row submission) | resolved row | PriceSubmissionAudit fromStatus:null | mirrors `business-subscription.service.ts:146-157` pattern — `actorType:'SYSTEM'` |
| SUBMITTED | UNDER_REVIEW | System (existing `processSubmittedPriceSubmissionReviewOnce`) | review not yet opened | PriceSubmissionAudit | `price-submission-review.service.ts:42-118` |
| UNDER_REVIEW | VERIFIED | Human | `assertHumanInWorkspace` | PriceSubmissionAudit + PriceSubmissionReviewDecision(ACCEPT) | `price-submission-review.service.ts:120-227` |
| UNDER_REVIEW | REJECTED / NEEDS_CORRECTION | Human | `assertHumanInWorkspace` | PriceSubmissionAudit + PriceSubmissionReviewDecision | `price-submission-review.service.ts:229-241` |

**D. Publication** (new)

| FROM | TO | ACTOR | PERMISSION | PRECONDITIONS | DB_LOCK | AUDIT_EVENT | IDEMPOTENT | FAIL_CLOSED_REASON |
|---|---|---|---|---|---|---|---|---|
| UNPUBLISHED | PUBLISHED | Human ONLY | BASIC_PRICE_PUBLISH | verificationStatus == 'VERIFIED'; actor != verifying actor (four-eyes, recommended) | BasicPrice row lock | BasicPricePublicationAudit(action:'PUBLISH') | YES — already-PUBLISHED returns existing state | NOT_YET_VERIFIED / SELF_PUBLISH_DENIED |

**E. Optional withdrawal** — per instruction, policy only, not implemented: a future `PUBLISHED -> UNPUBLISHED` transition would require its own permission (`BASIC_PRICE_UNPUBLISH`, not proposed now), its own audit action value (`'UNPUBLISH'`, already representable in the flexible `action: String` field without a migration), and Owner sign-off on when withdrawal is legitimate (e.g. price found to be erroneous). Not designed further here — explicitly out of RM-02 minimum scope.

Rules restated and satisfied by the tables above: parser success never auto-submits (PARSED→READY_FOR_SUBMISSION still requires resolution, and READY_FOR_SUBMISSION→SUBMISSION_CREATED still requires a separate human-gated batch approval); unresolved rows never create a submission; verification never auto-publishes (separate state, separate permission, separate actor recommended); publication never precedes verification (hard precondition); system/AI can never publish (actor is always human, permission-gated); every terminal decision is audited (PriceSubmissionAudit / PriceSubmissionReviewDecision / BasicPricePublicationAudit).

---

*End of schema contract. Status: PROVISIONAL_PENDING_PRODUCTION_PREFLIGHT. See `08-RM02B0-PROVISIONAL-MIGRATION-DESIGN.md` for how this contract translates into a migration sequence, and `03-RM02B0-RM02-AUDIT-ROLE-CONTRACT.md` for how production facts will be gathered before this contract can move beyond provisional status.*
