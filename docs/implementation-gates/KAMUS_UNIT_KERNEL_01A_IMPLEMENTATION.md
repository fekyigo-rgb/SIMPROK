# KAMUS Unit Kernel 01A Implementation

Status: MERGED — PRODUCTION_ACTIVATION_PASS_SUBSTANTIVE — DOCUMENTATION_CLOSURE_PENDING_PM_REVIEW

Branch: `feat/kamus-unit-kernel-01a`

Baseline: `e204674790ec4ee1ba1a6232351ccac76ac04a6f`

## Delivered bounded scope

- Backend canonical `UnitDefinition`, `UnitAlias`, and directional `UnitConversionRule` models.
- Conservative NFKC alias resolver with fail-closed unknown, ambiguity, missing evidence, competing-rule, invalid-factor, and not-convertible outcomes.
- Bounded reference identities: PERSON_DAY, KG, M1, M2, M3, SAK, ROLL, and TRUCK. No assumed production package/capacity conversions.
- Phase 2 LABOR cutover consumes validated Unit Kernel metadata; the production kernel no longer owns a hard-coded alias set.
- Future occurrence evidence uses nullable canonical unit/rule identities and `quantityFactor`; legacy `conversionFactor` is no longer written authoritatively.
- New AHSP versions require a uniquely resolved output unit and reject submitted legacy conversion factors.
- Snapshots freeze raw and canonical output-unit identity and reject unresolved output units.
- Internal BOQ/AHSP output-unit compatibility evaluation returns metadata only. No BOQ/RAB quantity or money calculation was introduced.
- Frontend dictionaries remain prototype/preview and non-canonical; no frontend source was changed.

## PM remediation 01

- Removed normalized raw-string equality as the Basic Price unit-compatibility authority.
- `ProjectAhspService` now resolves AHSP-to-catalog units and every resource-matching Basic Price unit through `UnitKernelService`.
- The pure price-resolution kernel consumes typed per-candidate resolver metadata keyed by the Basic Price candidate identity and admits only canonical PERSON_DAY identity/factor-1 outcomes.
- Cross-alias regression intent is preserved: OH and Orang/Hari Basic Price aliases resolve against an Org/Hari catalog unit; Jam remains excluded; one compatible plus one Jam selects the compatible candidate; multiple compatible active candidates remain `NEEDS_REVIEW`.
- Production first-occurrence read-only audit: `BasicPrice` has no independent unit column; its effective unit comes from its ResourceCatalog. The exact selected source and resolved catalog both report `Org/Hari`.

## PM remediation 02

- Resolver metadata is bound to the exact raw source/target pair it certifies for both AHSP-to-catalog and every Basic Price candidate-to-catalog decision.
- Valid PERSON_DAY/factor-1 metadata cannot be reused for a different raw pair; negative kernel tests enforce fail-closed behavior.
- Missing, null, empty, and whitespace-only AHSP `outputUnit` values are rejected as `AHSP_OUTPUT_UNIT_UNRESOLVED` before UnitKernelService or database writes.
- No schema or migration change was introduced by this remediation.

## Database safety

- Legacy audit ran in one `REPEATABLE READ, READ ONLY` transaction.
- Existing non-null legacy factor values were numerically equal to 1.
- Exactly one additive migration was created.
- Migration applied to `simprok_test` by the official guarded E2E runner: YES.
- Migration applied to `simprok_db`: YES, as historical verified production activation evidence; this docs-only closure did not access the database.
- Existing Phase 2 occurrence/resolution was not modified, replayed, backfilled, or recalculated.

## Validation evidence

- `prisma format`: PASS
- `prisma validate`: PASS
- `prisma generate`: PASS
- Focused unit/regression: 6 suites / 65 tests PASS
- Backend unit: 37 suites / 321 tests PASS
- Backend build: PASS
- Official safe E2E: 19 suites / 190 tests PASS; database guard PASS; residual PASS; advisory lock released
- Frontend unchanged-regression build: PASS

## Closed boundaries preserved

Backend HTTP/API end-to-end proof remains closed; bounded application-code proof passed during production activation and was not rerun during the documentation closure. Frontend production work, 01B, package-price adaptation, material/equipment Project AHSP resolution, AHSP unit-price, Cost Kernel, Execution Factor, BOQ/RAB arithmetic, override, and snapshot backfill remain closed.

## Production activation truth sync

### Status and evidence layers

- `KAMUS_UNIT_KERNEL_01A_IMPLEMENTATION_STATUS=MERGED`
- `KAMUS_UNIT_KERNEL_01A_PRODUCTION_ACTIVATION_STATUS=PASS_SUBSTANTIVE`
- `COLUMN_EVIDENCE_ADDENDUM_V1_1=PASS`
- `BACKEND_HTTP_RUNTIME_STATUS=NOT_PROVEN`
- `KAMUS_UNIT_KERNEL_01B_STATUS=CLOSED`
- `NEXT_PRODUCT_SLICE_OPENED=NO`
- PR #30 is merged; prior base `e204674790ec4ee1ba1a6232351ccac76ac04a6f`; canonical main/merge commit `773e88c47e0f225cdf294da923c4a99a7b501a61`.
- The three canonical homes are `UnitDefinition`, `UnitAlias`, and `UnitConversionRule`. `AHSPVersion` has output-unit identity; the Phase 2 PERSON_DAY path uses the resolver; hard-coded aliases are no longer a second canonical home; new legacy `conversionFactor` writes are rejected.
- The evidence layers are not interchangeable: merged source; schema/reference data in `simprok_db`; bounded application-code proof; backend HTTP/frontend/RAB activation.
- `01A is active in canonical source, schema/reference data in simprok_db, and the bounded backend application path. Backend HTTP, frontend integration, 01B monetary adaptation, Cost Kernel, and RAB arithmetic remain unproven or closed.`

### Historical production database and backup evidence

No database access occurred during this docs-only sync. Historical verified evidence records database `simprok_db`, migration `20260717010000_kamus_unit_kernel_01a`, one finished record, not rolled back, one applied step, and zero failed migrations. Counts are `UnitDefinition=8`, `UnitAlias=11`, `UnitConversionRule=0`, with zero canonical-unit duplicates. `AHSPVersion.outputUnit` and `outputUnitDefinitionId` are available. Global SAK-to-KG, ROLL-to-M1, and TRUCK-capacity rules each count 0. The zero conversion-rule count is positive fail-closed evidence: package and capacity assumptions were not invented without evidence.

Backup evidence: `C:\SIMPROK_BACKUPS\simprok_db_20260717_131222_pre_kamus_unit_kernel_01a.dump`; 226479 bytes; SHA-256 `53ea17c92c64372144945b6e81c2a78c94e31d97db76ecb43cd9a43db45b3c33`; PostgreSQL 17.10; validation `PG_RESTORE_LIST_PASS`. Restore execution is not claimed.

### Locked-column evidence

- Occurrence `8d1c421f-bfb9-467e-8d67-2cd54dd60a06`: locked projection match YES; no mutation detected in locked projection YES.
- Resolution `c616807f-93db-4f6a-b63e-91011b364915`: locked projection match YES; no mutation detected in locked projection YES.
- Resolution status `RESOLVED`; selection mode `AUTO_SELECTED`; method `EXACT_DETERMINISTIC`; canonical unit `PERSON_DAY`; source unit `Org/Hari`; source price and adapted price `158333.33`; stored legacy `conversionFactor=1.000000`; stored `quantityFactor=NULL`.
- `resourceCatalogId=e29aac23-70ff-42ab-b9ca-e96472ba6cf0`; Basic Price `a3266896-da53-4306-9cae-e25535d4e31e`; both Workspace `10000000-0000-4000-8000-000000000004`; source origin `FIELD_REPORT`; Basic Price status `PUBLISHED`.
- Reason codes: `EXACT_RESOURCE_NAME_MATCH`, `RESOURCE_TYPE_MATCH`, `LABOR_DAY_UNIT_EQUIVALENT`, `SINGLE_ELIGIBLE_BASIC_PRICE`.
- `No mutation was detected within the locked occurrence and resolution column projections.`
- `Absolute immutability was not proven.`

Historical hashes exist, but the inline activation projection/serialization procedure was not persisted and is not reproducible. `HASH_RERUN=NO`. The hashes are not repeatable canonical evidence; this does not indicate a data mismatch. Locked-column comparison is the reproducible closure evidence, and no byte-for-byte hash proof is claimed.

### Bounded application proof and runtime boundary

- `BOUNDED_RESOLVER_PROOF=PASS_FROM_PRODUCTION_ACTIVATION_TRANSCRIPT_NOT_RERUN`; `BOUNDED_RESOLVER_PROOF_RERUN=NO`.
- Historical proof resolves OH and Orang/Hari to PERSON_DAY, factor 1, `IDENTITY`; fails closed for an unknown alias and for SAK to KG without an evidence rule; re-resolves the first occurrence to `158333.33`, PERSON_DAY, factor 1; and performs no persistence.
- `BACKEND_HTTP_LIVE=NOT_PROVEN`; `PORT3000_LISTENER_COUNT_AT_V1_1_ADDENDUM=0`; API end-to-end proven NO; frontend Unit Kernel connected NO.
- 01B, Cost Kernel, Execution Factor, frontend production, and RAB arithmetic remain closed.

### Evidence-addendum history

- V1.0: prompt `SIMPROK-KAMUS-UNIT-KERNEL-01A-PRODUCTION-ACTIVATION-EVIDENCE-ADDENDUM-V1_0-FINAL`; executor `CLAUDE_CODE`; verdict `STOP_READ_ONLY_LAW_VIOLATED_AND_REPRODUCIBLE_PROCEDURE_UNAVAILABLE`. The hash procedure was not reproducible, no persisted bounded-proof harness was available, and at least two temp-file writes occurred. Repository/database writes, migration/activation rerun, and detected runtime damage were all absent.
- V1.1: prompt `SIMPROK-KAMUS-UNIT-KERNEL-01A-COLUMN-EVIDENCE-ADDENDUM-V1_1-FINAL`; executor `CLAUDE_CODE`; verdict `READ_ONLY_COLUMN_EVIDENCE_ADDENDUM_PASS`. Repository, backup, database, migration, reference counts, occurrence and resolution projections, and ownership matched in a `REPEATABLE READ, READ ONLY` transaction. Filesystem/repository/database/Git/GitHub/backend/API writes were 0. No hash rerun or bounded-proof rerun occurred; HTTP remained unproven; 01B remained closed.

### Owner operational clarification — executor coordination

This operational clarification does not amend Foundation, Kitab, or ADR and is not a universal constitutional amendment. Authorized executor classes: `CODEX`, `CLAUDE_CODE`, `CURSOR_AGENT`. Model and version labels are informational unless the Owner explicitly pins an exact model for a specific task. PR #31 docs-only truth sync executor class: CODEX; reported model label: CODEX_GPT_5; continued under Owner follow-up authorization. One Owner-appointed executor is the only writer for one task/branch/worktree; no mid-task executor change occurs without a new Owner decision; other executors review read-only; concurrent stage/commit/push/merge/database writes are forbidden. Handoff carries branch, HEAD, worktree, database/migration state, and last verdict. Autopilot 4 Guarded is an operating discipline, not an executor. Single writer is per task, not a permanent vendor/model monopoly.

### Documentation closure state

- `DOCUMENTATION_CLOSURE_STATUS=PENDING_PM_REVIEW`
- `OWNER_ACCEPTANCE=PENDING`
- `OWNER_MERGE_DECISION=PENDING`
- `PR_MERGE_AUTHORIZED=NO`
