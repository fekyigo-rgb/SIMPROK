# RM-02B0 — Production Fact Reconciliation

**Status:** `SANITIZED EVIDENCE DOCUMENT — NOT A RE-RUN OF PRODUCTION PREFLIGHT`
**Repository:** `fekyigo-rgb/SIMPROK`
**Target branch:** `feat/rm02-basic-price-import-foundation`
**Source:** Owner-supplied transcript of a successful, read-only production preflight run against `simprok_db`. That preflight was executed outside this session (by the Owner, using the separately reviewed `06-RM02B0-PRODUCTION-PREFLIGHT-READONLY.psql` / `07-RM02B0-PRODUCTION-PREFLIGHT-OWNER-LAUNCHER.ps1` artifact pair). **This session did not connect to `simprok_db` and does not re-run that preflight** — this document only records, sanitizes, and reconciles the facts the Owner already supplied.

This document exists to satisfy `08-RM02B0-PROVISIONAL-MIGRATION-DESIGN.md`'s requirement that migration steps 5–6 (Region foreign keys) and step 10 (BoqItem quantity widen) only proceed once production facts are known and reconciled against every assumption the provisional design made.

---

## 1. Observed production facts

Reported by the Owner, from the production preflight transcript. Not independently re-verified by this session (`DATABASE_CONNECTION_TO_SIMPROK_DB_COUNT=0` for this construction task).

```
transaction_read_only=on
ROLLBACK_REACHED=YES
PRODUCTION_WRITE_COUNT=0

BasicPrice_row_count=1
BasicPrice_status=PUBLISHED
BasicPrice_verificationStatus=PUBLISHED
BasicPrice_value=158333.33
BasicPrice_effectiveDate=NON_NULL
BasicPrice_workspaceId=NON_NULL (workspace-scoped)
BasicPrice_organizationId=NULL
BasicPrice_regionId=NULL
BasicPrice_sourceSubmissionId=NULL

PriceSubmission_row_count=0
PriceSubmissionRevision_row_count=0
PriceSubmissionReview_row_count=0
PriceSubmissionReviewDecision_row_count=0

BoqItem_row_count=143
BoqItem_quantity_range=-5.00..7386.00
BoqItem_max_stored_quantity_scale=2
BoqItem_rows_with_scale_greater_than_2=0

existing_non_null_region_id_count=0
proposed_new_table_name_collision_count=0
```

## 2. Owner-locked policy (unchanged by this document)

Restated for reconciliation only — not redefined here. Full text lives in `01-RM02B0-SCHEMA-CONTRACT.md` and the governing RM-02B construction prompt.

- OD-04: raw source numeric evidence retained; canonical money scale 2; BOQ quantity scale 6; no intermediate rounding; `ROUND_HALF_UP` only at the canonical boundary.
- Unresolved import rows are never discarded and never create a `PriceSubmission`.
- Region and effective date must be supplied by a human — no dummy, global-default, or current-date fallback.
- Verification and publication are separate decisions; import never auto-`VERIFIED` or auto-`PUBLISHED`.
- Negative BOQ quantity: **preserve-and-report only**. The existing `-5.00` row is not corrected, reclassified, or hidden by this task. No new BOQ enum/field/table/UI is introduced to classify it (`NEGATIVE_QUANTITY_SCOPE=PRESERVE_AND_REPORT_ONLY`).
- Legacy `BasicPrice` row disposition: `PROVISIONAL_PENDING_OWNER_DISPOSITION` — this task does not reclassify, unpublish, or backfill provenance for the existing row.

## 3. Architectural inference (this document's own reasoning, clearly separated from facts and policy above)

- **`existing_non_null_region_id_count=0`** ⇒ migration design steps 5/6 (`basic_prices.regionId → regions.id`, `price_submissions.regionId → regions.id`) can be added in the *same* migration as the new `regions` table, with **zero data risk and no human disposition step**, because PostgreSQL's FK-add constraint check has nothing non-null to violate against. This directly resolves the `08-RM02B0-PROVISIONAL-MIGRATION-DESIGN.md` §"Why steps 5/6 are gated separately" concern — the gating condition (existing non-null values) does not hold in this production database.
- **`BoqItem_rows_with_scale_greater_than_2=0`** ⇒ the `Decimal(18,2)→Decimal(18,6)` widen (migration step 10) is lossless for every currently stored row, confirming the migration design's `IRREVERSIBLE_OPERATION_COUNT=0` claim holds at the moment of migration.
- **The existing `-5.00` `BoqItem` row** is a real, legacy, unclassified negative quantity. Per Owner policy above, this task's migration widens its column type only — the stored value is not read, interpreted, or altered by any code this task adds. It is flagged here, explicitly, as a human-review item: **a real negative quantity exists in production BOQ data with no recorded adjustment/deduction classification**, and no classification mechanism is introduced by this task to resolve that.
- **`BasicPrice_status=PUBLISHED` on the sole existing row** — under this task's schema change (`status` default `PUBLISHED → UNPUBLISHED`), the existing row's own stored value is not touched (a default-only change never rewrites existing rows). The existing row remains exactly as it is today; only the default applied to *future* inserts that omit `status` changes.
- **`proposed_new_table_name_collision_count=0`** ⇒ `regions`, `basic_price_import_batches`, `basic_price_import_rows`, `basic_price_publication_audits` are all free table names in `simprok_db` at the time of preflight.

## 4. Non-blocking documentation-only debt

```
UTANG-RM02B0-FILE05-EMPTY-OUTPUT-01=
  05-RM02B0-RM02-AUDIT-ROLE-OWNER-LAUNCHER-PROPOSAL.ps1's mandatory
  [string[]] $OutputLines parameter lacks [AllowEmptyString()]. Real psql
  tabular output contains blank lines, which can trigger a PowerShell
  parameter-binding failure before Test-PsqlOutputContract can classify
  a run. Confirmed identical to a defect already fixed in file 07 for
  the read-only preflight launcher (V2.1.3), but never applied to file
  05 because file 05 was out of scope for that correction.

NON_BLOCKING_FOR_RM02B_CONSTRUCTION=YES
ROLE_PROVISIONING_ALREADY_COMPLETE=YES
FILE05_RERUN_AUTHORIZED=NO
FILE05_CHANGED=NO
```

File 05 is documented here only. It is not modified, re-run, or redesigned by this construction task.

## 5. RED execution artifact status (not versioned into this repository)

The RM02B0 V2.1.1–V2.1.3 design lineage's executable RED artifacts (role-provisioning launcher/SQL, production-preflight launcher/SQL — files 04–07 of that design set) remain external to this repository, exactly as they were built and reviewed: local design artifacts, never committed. They are not copied into this repository by this task — only their final, Architect-reviewed status is recorded here, so that nothing automatically runnable enters version control:

```
FILE_04_STATUS=PROPOSAL_ONLY_ROLE_PROVISIONING_ALREADY_EXECUTED_SEPARATELY
FILE_05_STATUS=PROPOSAL_ONLY_KNOWN_DEBT_SEE_SECTION_4_ABOVE
FILE_06_STATUS=PROPOSAL_ONLY_PRODUCTION_PREFLIGHT_ALREADY_EXECUTED_READ_ONLY_SEPARATELY
FILE_07_STATUS=PROPOSAL_ONLY_V2_1_3_CORRECTED_AND_VERIFIED
RED_ARTIFACTS_COMMITTED_TO_REPOSITORY=NO
RED_ARTIFACTS_WIRED_INTO_CI_OR_NPM_SCRIPTS=NO
```

Sanitized, non-executable **design contract** documents (schema contract, migration design, effective-date audit, audit-role contract, autopilot construction contract, test matrix, and their integrity manifest) are versioned separately under `docs/implementation-gates/rm02b0-design/` for historical/review reference — reviewed proposals, not automatic execution authority.

## 6. Open blocker — local test-database credential

```
BLOCKER_ID=RM02B-SIMPROK-TEST-CREDENTIAL-STALE-01
CLASSIFICATION=LOCAL_INFRASTRUCTURE_SECRET_BLOCKER
CAUSE=ENV_TEST_CREDENTIAL_REJECTED_BY_POSTGRESQL
SIMPROK_DB_CONNECTION_ATTEMPTED=NO
SECRET_CHANGED=NO
MIGRATION_TO_SIMPROK_TEST=BLOCKED
SAFE_E2E=BLOCKED
DISPOSABLE_POSTGRESQL_PROOF=PASS
MERGE_ELIGIBILITY=NO_UNTIL_BLOCKER_RESOLVED_AND_GATES_PASS
```

The `backend/.env.test` `DATABASE_URL` credential (target: `simprok_test`, the only database this task's migration/e2e work is authorized to touch) was rejected by the local PostgreSQL server (`password authentication failed for user "postgres"`), confirmed via a direct `psql` connection using the exact same connection string — not a Prisma-specific quoting artifact. Per PM/Gatekeeper decision: this session does not read, test, or connect using `.env` (which targets `simprok_db`) at all; does not guess, rotate, print, or otherwise handle this or any other secret; and does not attempt to repair `.env.test` itself, since secret handling is outside RM-02B's authorized scope. The migration itself is fully proven independently of this blocker (§ disposable migration proof above and the migration file's own header comment). `npx prisma migrate deploy` against `simprok_test` and `npm run test:e2e:safe` remain blocked until the credential is restored separately (by the Owner/PM, outside this task) and re-run.

## 7. Reconciliation verdict

```
PRODUCTION_FACT_RECONCILIATION_STATUS=COMPLETE
MIGRATION_STEP_5_6_GATING_REQUIRED=NO (existing_non_null_region_id_count=0)
MIGRATION_STEP_10_LOSSLESS_CONFIRMED=YES (rows_with_scale_greater_than_2=0)
LEGACY_BASIC_PRICE_ROW_DISPOSITION=PROVISIONAL_PENDING_OWNER_DISPOSITION (unchanged by this task)
NEGATIVE_QUANTITY_SCOPE=PRESERVE_AND_REPORT_ONLY
NEW_BOQ_CLASSIFICATION_SCHEMA_COUNT=0
NEW_BOQ_CLASSIFICATION_UI_COUNT=0
DATABASE_CONNECTION_TO_SIMPROK_DB_COUNT=0
```

## 8. Known limitations / discovered construction gaps

Honestly recorded per the Doktrin Cermin — none of these block the DB-independent gates, all are either pre-existing structural necessities the design docs under-specified, or explicit, bounded deferrals within this task's allowed scope.

```
GAP=SUBMIT_PRECONDITION_SOURCE_ORIGIN_REQUIRED
  01-RM02B0-SCHEMA-CONTRACT.md's submitBatch precondition list did not
  name sourceOrigin, but PriceSubmission.sourceOrigin has no schema
  default and is never fabricated by this task -- basic-price-import.
  service.ts#submitBatch fails closed with SOURCE_ORIGIN_REQUIRED_
  BEFORE_SUBMISSION when absent, alongside the documented effectiveDate/
  regionId preconditions. A structural necessity discovered during
  construction, not a policy change.

GAP=REVIEW_PROJECTION_EXTENDED_BEYOND_MINIMAL_SUMMARY
  BasicPriceImportService#summarize()'s row projection was extended
  (code, unit, rawPriceDisplayText, proposedCanonicalPrice, collisionType,
  collisionOfRowId, resourceCatalogId, unitDefinitionId, reasonCodes,
  version) beyond the minimal status/name fields first implemented --
  the review UI cannot let a human actually resolve a row without this
  data, since this projection is the only row data the frontend ever
  receives. Additive only; no unit test asserted an exact row shape.

GAP=NO_RESOURCE_UNIT_CATALOG_SEARCH_ENDPOINT
  Resolving an import row requires a resourceCatalogId and
  unitDefinitionId. No controller in this repository exposes a
  ResourceCatalog/UnitDefinition search or browse endpoint yet (confirmed
  by grep -- none exists), and file 09's allowlist does not include one.
  BasicPriceReviewPage.tsx therefore accepts these as raw manually-typed
  UUIDs, honestly (Kerangka Jujur: the form exists before the engine, but
  never fakes a lookup capability that isn't there). A catalog-search
  endpoint is a natural, separate follow-up task.

GAP=BASIC_PRICE_PERMISSIONS_NOT_SEEDED_ANYWHERE
  BASIC_PRICE_IMPORT/RESOLVE/SUBMIT/VERIFY/PUBLISH/REVIEW_VIEW remain
  USED_NOT_SEEDED in every real environment (see
  DECLARED_NOT_SEEDED_PERMISSION_CODES, common/constants/permissions.ts).
  Until a separate, Owner/PM-governed seeding task grants them to real
  roles, every route this task adds fails closed with 403 for every real
  user, and the new Sidebar door renders PermissionRoute's honest "Access
  Denied" state for everyone -- by design (Hukum Pintu: no door may look
  live before its engine is actually reachable). The e2e spec proves both
  the current fail-closed default and the granted happy path by upserting
  the Permission catalog rows and an ad-hoc Role itself, exercising the
  real PermissionsGuard/WorkspacePermissionResolverService path rather
  than bypassing it.
```

Soli Deo Gloria.
