# RM-02B0 — Provisional Migration Design

STATUS: `PROVISIONAL_PENDING_EXISTING_DATA_EVIDENCE`

No migration file was created in the repository. No migration was run. This document describes an *order and shape*, not executable SQL ready to apply — the exact final DDL depends on facts only the production preflight (`06-RM02B0-PRODUCTION-PREFLIGHT-READONLY.psql`, not yet run) can supply.

## Migration step order

| # | Step | Depends on | Additive/Widening only? |
|---|---|---|---|
| 1 | Create `regions` table (§9 of schema contract) | none | Additive |
| 2 | Create `basic_price_import_batches` table + enum `BasicPriceImportBatchStatus` | `regions`, `workspaces`, `organizations`, `accounts` | Additive |
| 3 | Create `basic_price_import_rows` table + enums (`BasicPriceImportRowSection`, `BasicPriceImportRowCollisionType`, `BasicPriceImportRowResolutionStatus`, `BasicPriceImportRowStatus`) | `basic_price_import_batches`, `resource_catalogs`, `unit_definitions`, `price_submissions` | Additive |
| 4 | Add Prisma-only virtual back-relation on `PriceSubmission` for the `BasicPriceImportRow` link | step 3 | Schema-only — **zero DDL**, no column added to `price_submissions` (the FK lives on `basic_price_import_rows.priceSubmissionId`, already created in step 3) |
| 5 | Add FK constraint `basic_prices.regionId -> regions.id` | step 1, **and** Owner disposition of every existing distinct `regionId` value (see §24.5 of the preflight) | Constraint addition only — no column added (`regionId` already exists as a bare UUID); **gated**, not automatic |
| 6 | Add FK constraint `price_submissions.regionId -> regions.id` | same as step 5 | Same gating |
| 7 | Add FK constraint `basic_price_import_batches.regionId -> regions.id` | step 1, 2 | New table, no legacy data to reconcile |
| 8 | Change `basic_prices.status` column default from `'PUBLISHED'` to `'UNPUBLISHED'` | none (default-only change, see §8 of schema contract) | Additive — **zero existing rows rewritten**; only affects future inserts that omit `status` |
| 9 | Create `basic_price_publication_audits` table | `basic_prices`, `accounts` | Additive |
| 10 | Widen `boq_items.quantity` from `Decimal(18,2)` to `Decimal(18,6)` | production preflight must first prove `STORED_SCALE_GT_2_COUNT = 0` (§24.4) | Widening `ALTER COLUMN TYPE` — lossless by construction (scale 2 → scale 6 can never lose data that was already scale ≤ 2) |
| 11 | Indexes for all new tables (`basic_price_import_batches`: workspaceId, organizationId, status; `basic_price_import_rows`: batchId, status, resolutionStatus, resourceCatalogId; `basic_price_publication_audits`: basicPriceId) | steps 2, 3, 9 | Additive |
| 12 | Uniqueness constraints: `regions.code` (step 1); `(workspaceId, importFingerprint)` on `basic_price_import_batches` (step 2); `(batchId, sourceRowNumber)` on `basic_price_import_rows` (step 3); `basic_price_import_rows.priceSubmissionId` (step 3) | respective table creation steps | Additive |
| 13 | Foreign keys not already covered above: `basic_price_import_rows.resourceCatalogId -> resource_catalogs.id` (Restrict), `.unitDefinitionId -> unit_definitions.id` (Restrict), `.priceSubmissionId -> price_submissions.id` (Restrict), `.collisionOfRowId -> basic_price_import_rows.id` (SetNull), `.batchId -> basic_price_import_batches.id` (Cascade) | step 3 | Additive |
| 14 | Check constraints | none proposed at RM-02 minimum scope — every invariant that could be a CHECK constraint (e.g. "status transitions only in allowed order") is instead enforced at the application/service layer, mirroring how `RabLifecyclePolicyService` enforces BOQ lifecycle rules today rather than a DB CHECK. A future Architect review may reconsider this. | — | — |
| 15 | Backfill gates | **none executed** — see below | — | — |
| 16 | Legacy transition gates | **none executed** — see below, pending §18 Owner disposition | — | — |

```
MIGRATION_STEP_COUNT=14 (steps 1-3, 5-13; step 4 is schema-only with zero DDL; steps 14-16 are explicitly empty/deferred, listed for completeness)
MIGRATION_ORDER=see table above
DATA_BACKFILL_REQUIRED=NO (see explicit prohibitions below)
HUMAN_MAPPING_REQUIRED=YES — for every existing non-null regionId value on basic_prices/price_submissions, before steps 5/6 can run (§24.5)
DESTRUCTIVE_OPERATION_COUNT=0
IRREVERSIBLE_OPERATION_COUNT=0 (step 10's widening ALTER is technically hard to cleanly reverse to scale 2 if any post-migration row ever uses scale 3-6, but reversing BEFORE any such row exists is lossless; flagged honestly in ROLLBACK_STRATEGY below rather than claimed irreversible or reversible unconditionally)
EXPECTED_LOCKED_TABLES=basic_prices (steps 5, 8), price_submissions (step 6), boq_items (step 10) — each briefly, for an ALTER TABLE / ALTER COLUMN; new-table creation steps (1-3, 9) take no lock on any existing table
ESTIMATED_LOCK_SCOPE=table-level ACCESS EXCLUSIVE lock for the duration of each individual ALTER statement only (standard PostgreSQL DDL behavior) — actual duration cannot be estimated without the production preflight's row counts (§24.1's BASIC_PRICE_ROW_COUNT, §24.4's BOQ_ITEM_ROW_COUNT)
ROLLBACK_STRATEGY=every step 1-3, 7, 9, 11-13 is a pure additive CREATE (trivially reversible via DROP, since nothing else depends on the new objects yet); step 8 (default-only change) is trivially reversible (`ALTER COLUMN status SET DEFAULT 'PUBLISHED'`); steps 5-6 (FK addition) are reversible via `DROP CONSTRAINT` as long as no application code has started relying on the FK being present; step 10 (widening) is reversible via a reverse `ALTER COLUMN TYPE` back to Decimal(18,2) ONLY IF no row has been written with scale > 2 in the interim — this is an honest limitation, not glossed over
BACKUP_REQUIRED=YES
```

## Explicit prohibitions (verbatim from Owner policy, restated as migration constraints)

```
For missing effective date:   DO_NOT_BACKFILL_CURRENT_DATE=YES (honored — no migration step writes a current-date value into any effectiveDate column)
For unknown Region:           DO_NOT_CREATE_DUMMY_REGION=YES (honored — step 1 creates an EMPTY regions table; no seed row is inserted by any step in this document)
For VERIFIED legacy prices:   DO_NOT_AUTO_PUBLISH=YES (honored — step 8 only changes the DEFAULT for new rows; it does not touch a single existing row's status value)
For existing PUBLISHED/PUBLISHED prices: DO_NOT_CHANGE_WITHOUT_PREFLIGHT_AND_OWNER_DISPOSITION=YES (honored — no step reads, writes, or reclassifies any existing basic_prices row; §18's legacy disposition remains open and this migration design does not pre-empt it)
```

## Why steps 5/6 (Region FK) are gated separately from step 1 (Region table creation)

Creating the `regions` table is safe unconditionally — it is empty and affects nothing. Adding the FK constraint from `basic_prices.regionId`/`price_submissions.regionId` to `regions.id` is a **different** kind of operation: PostgreSQL will refuse to add a FK constraint if any existing non-null `regionId` value doesn't match a row in `regions`. Since `regions` starts empty (dummy seeding forbidden), **every** existing non-null `regionId` value would, by construction, fail such a constraint the moment it's added. This is not a bug in the design — it is the honest consequence of the fact (already established in RM-02A discovery, reconfirmed in the schema contract) that `regionId` has never had a real FK target before. Adding the constraint therefore requires, first, a **human disposition of each existing distinct value** — is it a real place that should become a real `regions` row, or is it meaningless legacy data that should be nulled out with Owner's explicit sign-off? That disposition is exactly what the production preflight's §24.5 section surfaces (`EXISTING_REGION_ID_DISTINCT_COUNT`, `EXISTING_REGION_ID_SET_SANITIZED`) and exactly what this task is not authorized to decide.

## Migration item detail table (per governing prompt §23 format)

| MIGRATION_ITEM | WHY_REQUIRED | LOSS_IF_NOT_ADDED | MINIMUM_FIELD_OR_CONSTRAINT | ALTERNATIVE_WITHOUT_MIGRATION | RECOMMENDATION |
|---|---|---|---|---|---|
| `regions` table | `regionId` has no backing table anywhere today | Location identity permanently unverifiable | real table + `code` unique + FK | none viable | Add (step 1) |
| `basic_price_import_batches` / `basic_price_import_rows` | no persisted staging/provenance model exists for Basic Price import at all | Cannot resume multi-session row resolution; cannot retain raw numeric evidence; cannot bound import to a reviewable unit | both tables as designed in `01-RM02B0-SCHEMA-CONTRACT.md` §5–§6 | none — BOQ's stateless-preview pattern does not fit (see rationale in schema contract §5) | Add (steps 2–3) |
| `basic_prices.status` default change | current default `'PUBLISHED'` is an active landmine (confirmed via code comment in `basic-price.service.ts` acknowledging it as "controlled schema debt") | Any future naive `basicPrice.create()` call becomes silently live | `@default("UNPUBLISHED")` | Rely entirely on application-layer discipline never to omit `status` — fragile, already proven risky by the existing codebase's own defensive comment | Add (step 8) |
| `basic_price_publication_audits` | no audit trail exists for the *publication* decision specifically (only for submission status transitions) | An explicit human-gated publish action would be unaudited | table as designed | Overload `PriceSubmissionAudit` with a synthetic BasicPrice-shaped entry — rejected as a type/semantic mismatch | Add (step 9) |
| `boq_items.quantity` scale widen | Owner-locked (§1.1 `BOQ_QUANTITY_SCALE=6`); real construction quantities like `12.345` are currently rejected outright (`QUANTITY_SCALE_EXCEEDS_CURRENT_SCHEMA`, confirmed live in RM-02A) | Quantity precision loss / continued outright rejection of valid decimal quantities | `ALTER COLUMN quantity TYPE Decimal(18,6)` | none — this is an Owner-locked requirement, not optional | Add (step 10), gated on preflight §24.4 proof |

```
PRODUCTION_DATA_PREFLIGHT_REQUIRED=YES
PRODUCTION_DATA_PREFLIGHT_MODE=SEPARATE_READ_ONLY
PRODUCTION_DATA_PREFLIGHT_SCOPE=PENDING_ARCHITECT_REVIEW
MIGRATION_EXECUTION_AUTHORIZED=NO
```

This design remains provisional. It is translated into an actual Prisma migration file only after: (1) the production preflight runs and its facts are reconciled against every assumption above, and (2) Architect produces a final (non-provisional) schema contract incorporating those facts.
