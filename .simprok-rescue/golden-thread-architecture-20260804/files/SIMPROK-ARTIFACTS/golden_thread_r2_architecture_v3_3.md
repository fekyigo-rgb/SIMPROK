# SIMPROK — GOLDEN THREAD R2 ARCHITECTURE V3.3

Dalam Nama Tuhan Yesus Kristus.

```text
DOCUMENT_VERSION=V3_3
DOCUMENT_ID=SIMPROK-GOLDEN-THREAD-R2-ARCHITECTURE-GATE-V3_3
FILENAME=golden_thread_r2_architecture_v3_3.md
ARCHITECTURE_AUTHOR=Claude Arsitek
DOCUMENT_EXECUTOR=Codex GPT-5.6
PM_GATEKEEPER=ChatGPT
CONSTITUTION_AUDITOR=Gemini
OWNER=Feky de Fretes
REPOSITORY_BASE=703984d18e52fbe8da987fab6dae460a0977f113
IMPLEMENTATION_AUTHORIZED=NO
```

## 1. Scope, authority, and source reconciliation

This is a design-only architecture artifact. It authorizes no implementation, source, schema, migration, production-data, branch, commit, push, or PR action.

Source labels used by this document are normative:

```text
[REPO_VERIFIED] repository/schema/source directly read at the stated base
[DB_READ_ONLY_VERIFIED] evidence obtained in an explicit READ ONLY transaction
[V3_1_SOURCE] exact material present in the fully read V3.1 artifact
[V3_2_SOURCE] reserved for an exact V3.2 artifact; none was available in the repository
[VIA_PM_RECON] exact V3.2 accepted decisions or RECON-01 material supplied by PM/Owner
[ARCHITECT_DECISION] V3.3 architecture choice closing an identified gap
[OWNER_LOCK] explicit locked Owner decision
```

```text
V3_1_FULL_FILE_READ=YES
V3_1_PATH=C:\SIMPROK\SIMPROK-ARTIFACTS\golden_thread_r2_architecture_v3_1.md
V3_2_FULL_FILE_READ=NO
V3_2_EXACT_FILE_FOUND=NO
V3_2_NEAREST_CANDIDATE=golden_thread_r2_architecture.md
V3_2_NEAREST_CANDIDATE_PROVEN_VERSION=V3_0
V3_2_CONTENT_INVENTED=NO
```

The absence of the exact V3.2 file is disclosed, not concealed. Accepted V3.2 decisions explicitly supplied in the PM delta package are incorporated as `[VIA_PM_RECON]`. No unavailable V3.2 prose is attributed as `[V3_2_SOURCE]`.

Repository guard evidence `[REPO_VERIFIED]`:

```text
ROOT=C:\SIMPROK
HEAD=703984d18e52fbe8da987fab6dae460a0977f113
BRANCH=main
REMOTE=https://github.com/fekyigo-rgb/SIMPROK.git
PRE_EXISTING_UNTRACKED=SIMPROK-ARTIFACTS/
PRE_EXISTING_UNTRACKED=backend/.claude/
```

## 2. Final architecture laws preserved from V3.2

The following are retained without weakening `[VIA_PM_RECON]`:

- `Project.status` is not a RAB lifecycle source.
- Reserved lifecycle states are not fabricated.
- A new planning project begins with an empty Working Draft; there is no auto-approved RAB and no auto-active baseline.
- Existing baselines are never mutated or backfilled by R2.
- `BoqItem` uses soft deletion; `BoqStructure` is not soft-deleted in R2.
- Application history and occurrence/resolution history are append-only.
- Application → `BoqItem` and Application → Occurrence both use `ON DELETE RESTRICT`.
- Transactions use `READ COMMITTED`, explicit `FOR UPDATE`, and the canonical lock order.
- A unique-violation loser rolls back before re-reading the winner.
- Permission activation is atomic.
- Pagu Blindness and tenant isolation are mandatory.
- Kernel money is never client-authoritative; fake zero is forbidden.
- No production backfill occurs.
- Manual mode and kernel mode are separate, first-class modes.

## 3. Canonical domain model

### 3.1 Application authority

`[ARCHITECT_DECISION]` The canonical application contains only application-owned identity and lifecycle:

```prisma
model ProjectRabLineAhspApplication {
  id                      String                   @id @default(uuid()) @db.Uuid
  boqItemId               String                   @db.Uuid
  projectAhspOccurrenceId String                   @unique @db.Uuid
  status                  RabLineApplicationStatus @default(ACTIVE)
  selectedByAccountId     String?                  @db.Uuid
  supersededAt            DateTime?
  createdAt               DateTime                 @default(now())
  updatedAt               DateTime                 @updatedAt

  boqItem               BoqItem               @relation(fields: [boqItemId], references: [id], onDelete: Restrict)
  projectAhspOccurrence ProjectAhspOccurrence @relation(fields: [projectAhspOccurrenceId], references: [id], onDelete: Restrict)

  @@index([boqItemId, status])
  @@map("project_rab_line_ahsp_applications")
}
```

A partial unique index enforces at most one `ACTIVE` Application per `boqItemId`. `projectAhspOccurrenceId` is unique. Application must not duplicate `workspaceId`, `projectId`, `ahspVersionId`, `idempotencyKey`, or resolution status.

Canonical AHSP authority path:

```text
Application.projectAhspOccurrenceId
→ ProjectAhspOccurrence.ahspVersionId
```

`ahspVersionId` is removed from the Application design. `[VIA_PM_RECON]`

### 3.2 Cross-project and cross-workspace consistency

`[ARCHITECT_DECISION]` R2 uses runtime transaction enforcement rather than duplicate scope columns, a trigger, or composite FKs:

1. one canonical write service owns every Application mutation;
2. trusted `ProjectAccess` supplies project/workspace scope;
3. after the common structure lock, the service reloads the active `BoqItem` through its Working Draft structure and project;
4. it reloads the occurrence and asserts exact `projectId` and `workspaceId` equality;
5. mismatch causes `STOP_CROSS_PROJECT_APPLICATION_LINK` before Application mutation;
6. a database invariant audit query checks every Application join for project/workspace mismatch;
7. any non-zero mismatch count is a corruption STOP condition;
8. integration/E2E tests cover same-project success and cross-project/cross-workspace rejection.

This avoids unconstrainted duplicated authority on Application. Trigger/composite-FK migration and query cost are intentionally not introduced in the minimum slice.

### 3.3 History and deletion

`[V3_1_SOURCE] [VIA_PM_RECON]` Add `BoqItem.deletedAt DateTime?`. All ordinary Draft removal is a soft delete. Active queries require `deletedAt IS NULL`. Historical lines, Applications, occurrences, and resolutions remain immutable and append-only. Re-adding equivalent work creates a new UUID. `BoqStructure` is not soft-deleted in R2. Restoration and physical cleanup are outside R2.

## 4. Lifecycle projection

`[ARCHITECT_DECISION]` Lifecycle uses entity existence, never `Project.status` or item counts:

```text
NO_RAB
= no Working Draft structure AND no active baseline

WORKING_DRAFT
= Working Draft structure exists, even with zero items

hasDraftItems
= count(active BoqItem WHERE deletedAt IS NULL) > 0
```

An empty Working Draft is the normal new-project state. An active baseline is derived only from real active baseline/RabDocument identity. Review, approval, lock, addendum, and archive states remain unreachable until their real workflow identities exist. Existing baseline behavior is unchanged.

## 5. Stable Draft API and concurrency

### 5.1 Correct types

`[REPO_VERIFIED]` Canonical item types are:

```ts
type BoqItemType = 'FOLDER' | 'WORK_ITEM' | 'NOTE';

type ParentRef =
  | { id: string }
  | { clientKey: string }
  | null;
```

`GROUP` is invalid. `{}` and objects containing both `id` and `clientKey` are rejected. Foreign, cross-project, cross-structure, or cross-tenant identity returns `404`, not `400`, to prevent existence disclosure. Domain-invalid local graphs return `400`.

### 5.2 Locking and reconciliation

All draft save, selection, and reselection transactions use `READ COMMITTED` and lock the same `BoqStructure` row:

```sql
SELECT "id", "draftRevision"
FROM "boq_structures"
WHERE "id" = $1
FOR UPDATE;
```

Canonical lock order:

```text
trusted ProjectAccess traversal
→ BoqStructure FOR UPDATE
→ active BoqItem reload
→ ACTIVE Application reload
→ occurrence/resource reads
→ mutations
```

Stable Draft Hardening adds `draftRevision` and required `expectedDraftRevision`. It is not a mandatory dependency of the initial AHSP-selection machine slice. Reconciliation validates the complete payload before mutation, preserves retained UUIDs, resolves the entire parent graph, soft-deletes omitted rows, and increments `draftRevision` exactly once.

## 6. Full-resource AHSP selection contract

Exact endpoint `[V3_1_SOURCE] [VIA_PM_RECON]`:

```text
POST /projects/:projectId/boq/items/:boqItemId/ahsp-selection
```

Minimum request:

```ts
interface AhspSelectionRequest {
  ahspVersionId: string;
  idempotencyKey: string;
}
```

`expectedDraftRevision` is added together with Stable Draft Hardening, not invented as an initial-slice dependency.

Within one transaction, the endpoint must:

1. verify trusted `ProjectAccess` and `RAB_DRAFT_EDIT`;
2. verify the `BoqItem` is an active (`deletedAt IS NULL`) Working Draft row;
3. verify the `AHSPVersion` is tenant-visible;
4. load every `AHSPResource` for that exact version;
5. reject a zero-resource version;
6. resolve every resource deterministically;
7. insert exactly one `ProjectAhspOccurrence`;
8. bulk-insert exactly N `ProjectAhspResourceResolution` rows;
9. prove N equals the exact AHSP resource count and resource-ID set;
10. insert the new Application as `ACTIVE`;
11. supersede the old ACTIVE Application without mutating its occurrence;
12. return the completeness summary.

Required response fields:

```text
expectedResourceCount
persistedResolutionCount
resolvedCount
unresolvedCount
needsReviewCount
calculationReady
applicationId
occurrenceId
```

Invariant:

```text
PERSISTED_RESOLUTION_COUNT=EXPECTED_AHSP_RESOURCE_COUNT
PERSISTED_RESOURCE_ID_SET=EXPECTED_AHSP_RESOURCE_ID_SET
```

Human selection may be persisted when some resources are unresolved or need review. `calculationReady=false` and Cost Kernel fails closed until the set is exact and every required resolution is calculation-ready.

## 7. Idempotency and concurrency contract

Idempotency is scoped by the existing Phase 2 uniqueness law and validated against the full requested identity. The service distinguishes new key, active replay, superseded replay, legacy Phase 2 collision, different-line collision, and different-version collision.

On a concurrent unique violation:

```text
ROLLBACK loser transaction completely
→ begin clean read path
→ re-read canonical winner
→ return winner only if payload identity matches
→ otherwise 409
```

No failed transaction is reused for winner reads. Same-structure selection and save serialize on the common structure lock.

## 8. Batched resolver and benchmark gate

Required query shape `[VIA_PM_RECON]`:

```text
Load Project / Working Draft / BoqItem
Load AHSPVersion + all AHSPResource
Targeted ResourceCatalog lookup
Batch BasicPrice lookup
Batch UnitAlias lookup
Batch UnitConversionRule lookup
In-memory deterministic resolution
One occurrence insert
Bulk resolution insert
Application supersede + insert
```

Forbidden:

```text
all-catalog unfiltered scan
one BasicPrice query per catalog
one unit query per resource
one resolution insert per resource
```

Benchmark fixtures:

```text
1 resource    current bounded occurrence evidence
13 resources  Cost Kernel R1 regression fixture
50 resources
100 resources
repository-informed maximum from read-only inventory
```

Prisma query-event evidence, or equivalent SQL/query-plan evidence, must show actual query shape, parameter/filter sets, and absence of Basic Price and Unit Kernel N+1 behavior. Spy call count alone is insufficient. No hard latency or query ceiling becomes law before measured benchmark evidence.

## 9. Legacy and Phase 2 policy

```text
BoqItem.ahspVersionId=LEGACY_READ_ONLY
R2_SELECTION_ENDPOINT_WRITES_LEGACY_FIELD=NO
R2_COST_KERNEL_READS_LEGACY_FIELD=NO
AUTO_REPAIR=NO
BACKFILL=NO
```

The existing Phase 2 `POST /projects/:projectId/ahsp-occurrences`, GET endpoint, DTOs, guards, and tests remain unchanged. Tests may not be edited merely to manufacture PASS.

Historical occurrence:

```text
OCCURRENCE_ID=8d1c421f-bfb9-467e-8d67-2cd54dd60a06
CLASSIFICATION=BOUNDED_PHASE2_EVIDENCE
ROUTINE_R2_APPLICATION_BACKFILL=FORBIDDEN
```

Golden Thread R2 must create a new complete occurrence for one real Working Draft `BoqItem` only after implementation and Owner data-write authority. No production backfill is permitted.

## 10. Cost Kernel and frontend contract

Canonical path:

```text
BoqItem
→ ACTIVE Application
→ ProjectAhspOccurrence
→ complete ProjectAhspResourceResolution set
→ Cost Kernel
→ backend decimal-string result
→ frontend display
```

Cost Kernel R2 never guesses an occurrence by `projectId + ahspVersionId`, reads a `SUPERSEDED` Application, falls back to `BoqItem.ahspVersionId`, calculates without an Application, treats a partial set as complete, emits fake zero, or writes its result to `BoqItem.unitPrice/lineTotal`.

### 10.1 Precision and calculation authority

```text
Prisma.Decimal=CALCULATION_AUTHORITY
JavaScript Number=FORBIDDEN_FOR_MONEY
INTERMEDIATE_ROUNDING=0
FRONTEND_RECOMPUTES_KERNEL_MONEY=0
MANUAL_MODE=FIRST_CLASS
KERNEL_MODE=FIRST_CLASS
ONE_LINE_ONE_ACTIVE_MODE
```

The contract distinguishes:

```text
canonical calculation value
manual persisted unit price
kernel-derived unit price
canonical line total
canonical recap total
display line value
display recap value
rounding boundary
rounding mode
```

Canonical calculation values remain exact `Prisma.Decimal` through the arithmetic path. Manual persisted unit price belongs only to MANUAL mode. Kernel-derived price and totals are returned as backend decimal strings and are not persisted to `BoqItem`. Display values are projections, never calculation inputs. Rounding occurs only at an Owner-locked boundary. The rounding mode is pending and is not invented here.

### 10.2 Quantity precision

`Decimal(18,2) → Decimal(18,6)` is not pure widening: integer capacity falls from 16 digits to 12. Architect proposal:

```text
BoqItem.quantity=Decimal(24,6)
OWNER_DECISION_OD_04=PENDING
```

Before migration, a read-only inventory must report:

```text
MAX_ABS_QUANTITY
MAX_INTEGER_DIGITS
MAX_DECIMAL_SCALE
ROWS_EXCEEDING_TARGET
```

The migration may be called lossless only after inventory PASS.

### 10.3 Frontend and stale results

The frontend displays explicit `MANUAL` or `KERNEL` mode, never recomputes kernel money, truthfully displays unresolved/needs-review states, consumes backend decimal strings as authority, and shows Harga Satuan/Jumlah only when calculation-ready.

A result becomes `STALE` whenever quantity, unit, AHSP selection, or any relevant occurrence/resource-resolution input changes. Stale money is not displayed as current and cannot be submitted/approved. Recalculation creates a new response/evidence identity; historical occurrence/application evidence is not mutated.

## 11. Permissions

`[OWNER_LOCK]`:

```text
OD-01 DIRECTOR → RAB_VIEW + RAB_DRAFT_EDIT
```

Permission activation is atomic: permission catalog, role grant, guarded routes, positive E2E, negative E2E, and rollback evidence form one gate. `PROJECT_CREATE` never implies `RAB_DRAFT_EDIT`. FOREMAN is denied `RAB_DRAFT_EDIT` unless a future Owner decision changes the mapping.

Declared but inactive until real workflows exist:

```text
RAB_SUBMIT_REVIEW
RAB_APPROVE
RAB_LOCK
RAB_ADDENDUM_CREATE
```

These permissions are catalog design only; no route or role gains them in R2 minimum activation.

## 12. Security and activation sequence

```text
M-0  Precision decision and schema inventory
M-0.5 Candidate BOQ input preparation
M-1  History foundation
M-2  Application bridge + resolver + money guard
M-3A Isolated test/shadow database proof
S-1  Tenant isolation positive/negative E2E
S-2  Permission activation positive/negative E2E
M-3B Real Owner data activation with backup and Owner authority
S-3  initiateSetup correction after GATE-MONITORING-01
H-1  Stable Draft concurrency and API contract hardening
H-2  Lifecycle projection and frontend navigation consolidation
```

`M-3A_ISOLATED_TEST_PROOF` and `M-3B_REAL_OWNER_DATA_ACTIVATION` are separate gates. No new Golden Thread R2 row may be written to `simprok_db` before S-1 and S-2 PASS.

### 12.1 M-0.5 Candidate BOQ input preparation

```text
STATUS=DESIGNED_NOT_AUTHORIZED
M-0.5=NO_SOURCE_OR_SCHEMA_CHANGE
M-0.5=BOQ_DATA_WRITE_REQUIRING_SEPARATE_OWNER_AUTHORITY
```

Prerequisites:

1. output unit proven;
2. OD-04 locked;
3. Owner Data-Write Authority;
4. pre-write backup and DB guard;
5. exact candidate row specification;
6. post-write read-only verification.

No candidate row is created by this architecture task.

## 13. Latest read-only evidence

### 13.1 Golden Thread bounded evidence

The following supplied audit evidence is incorporated exactly `[DB_READ_ONLY_VERIFIED]`:

```text
REPOSITORY_HEAD=703984d18e52fbe8da987fab6dae460a0977f113
READ_ONLY_TRANSACTION=PASS
TRANSACTION_READ_ONLY_VALUE=on
DATABASE_IDENTITY=simprok_db
DATABASE_WRITE_COUNT=0

OCCURRENCE_ID=8d1c421f-bfb9-467e-8d67-2cd54dd60a06
OCCURRENCE_EXISTS=YES
OCCURRENCE_WORKSPACE_MATCH=YES
OCCURRENCE_PROJECT_MATCH=YES

EXPECTED_AHSP_RESOURCE_COUNT=1
PERSISTED_RESOLUTION_COUNT=1
RESOURCE_ID_SET_MATCH=YES
FULL_AHSP_RESOURCE_SET_PROVEN=YES
RESOURCE_COMPONENT_DECIMAL=63333.33200000

WORKING_DRAFT_ID=dec139d9-a978-4cbd-8e29-9fa88ec23b93
WORKING_DRAFT_ITEM_COUNT=0
CANDIDATE_WORKING_DRAFT_BOQ_ITEM=NONE

APPLICATION_TABLE_EXISTS=NO
APPLICATION_LINK_EXISTS=NO
PRODUCTION_GOLDEN_THREAD_LIVE=NO

BOUNDED_OCCURRENCE_AHSP_UNIT_PRICE_PROVEN=YES
BOUNDED_OCCURRENCE_AHSP_UNIT_PRICE=63333.33200000
RAB_KERNEL_LINE_TOTAL_PROVEN=NO
```

This proves the unit price only for the bounded occurrence: its exact AHSP resource set contains one resource, the expected resolution exists and is `RESOLVED`, and adapted price plus coefficient exist. It is not a live RAB line because no active Working Draft item and no Application link exist.

### 13.2 R2 output-unit micro-audit

Schema verification `[REPO_VERIFIED]`: `AHSPVersion.outputUnit` is nullable text; `AHSPVersion.outputUnitDefinitionId` is a nullable FK to `unit_definitions.id`. The canonical UnitDefinition fields are `id`, `code`, `displayName`, `symbol`, `dimension`, `kind`, and `isActive`. `BoqItem.unit` is text. No SQL name was guessed.

The following was queried inside `BEGIN; SET TRANSACTION READ ONLY; ... ROLLBACK;` `[DB_READ_ONLY_VERIFIED]`:

```text
R2_OUTPUT_UNIT_MICRO_AUDIT

REPOSITORY_IDENTITY=PASS
REPOSITORY_HEAD=703984d18e52fbe8da987fab6dae460a0977f113
REPOSITORY_WORKTREE_CHANGED_BY_AUDIT=NO

READ_ONLY_TRANSACTION=PASS
TRANSACTION_READ_ONLY_VALUE=on
DATABASE_IDENTITY=simprok_db
DATABASE_WRITE_COUNT=0
SOURCE_WRITE_COUNT=0
SCHEMA_WRITE_COUNT=0
MIGRATION_WRITE_COUNT=0

AHSP_VERSION_EXISTS=YES
AHSP_VERSION_COUNT=1
AHSP_VERSION_ID=bfdf2bc0-2bf1-4fc6-bcfa-98dea0f2bbcf
AHSP_VERSION_WORKSPACE_ID=10000000-0000-4000-8000-000000000004
AHSP_VERSION_STATUS=PUBLISHED
RAW_AHSP_OUTPUT_UNIT=NULL
OUTPUT_UNIT_DEFINITION_ID=NULL
OUTPUT_UNIT_DEFINITION_EXISTS=NO
CANONICAL_OUTPUT_UNIT=NOT_PROVEN

OCCURRENCE_EXISTS=YES
OCCURRENCE_VERSION_MATCH=YES

WORKING_DRAFT_EXISTS=YES
WORKING_DRAFT_ACTIVE_ITEM_COUNT=0

OUTPUT_UNIT_CLASSIFICATION=OUTPUT_UNIT_MISSING
RECOMMENDED_CANDIDATE_BOQ_UNIT=NONE
CANDIDATE_BOQ_ITEM_CREATED=NO

PRODUCTION_GOLDEN_THREAD_LIVE=NO
IMPLEMENTATION_AUTHORIZED=NO
OWNER_DATA_WRITE_AUTHORIZED=NO

FINAL_VERDICT=PASS_WITH_UNIT_RESOLUTION_GAP
```

The required verdict vocabulary has no dedicated `STOP_OUTPUT_UNIT_MISSING`; therefore `PASS_WITH_UNIT_RESOLUTION_GAP` records that the read-only audit itself passed while candidate preparation is blocked by missing output identity. It does not mean the unit is ready. M-0.5 cannot proceed until output identity is lawfully established under a separate authority.

## 14. Mandatory test matrix

### Domain and history

- one `BoqItem` has at most one ACTIVE Application;
- two lines selecting the same AHSPVersion create two different occurrences;
- reselection supersedes the old Application;
- old occurrence and resolutions remain unchanged;
- soft-delete preserves all history;
- hard-delete of a referenced line is rejected.

### Completeness

- zero-resource version is rejected;
- N resources produce exactly N resolutions and an exact resource-ID set;
- `UNRESOLVED`/`NEEDS_REVIEW` produces no kernel money;
- one-resource exact-set fixture produces AHSP unit price `63333.33200000`.

### Tenant and security

- foreign project, unassigned account, foreign `BoqItem`, foreign Application, and foreign occurrence return `404`;
- cross-workspace permission and spoofed workspace header return `403`;
- DIRECTOR is authorized only after atomic activation;
- FOREMAN is denied `RAB_DRAFT_EDIT`.

### Idempotency and concurrency

- new key; active replay; superseded replay; legacy Phase 2 collision;
- different line/version collision;
- concurrent same-key and concurrent different selections;
- save versus selection follows the canonical lock order;
- unique loser rolls back before winner re-read.

### Money and frontend

- `Prisma.Decimal` only and no intermediate rounding;
- JavaScript Number money is rejected;
- client `unitPrice` is rejected on a kernel-managed line;
- manual lines remain supported as first-class;
- frontend never recomputes kernel money;
- fake zero is forbidden;
- pagu is absent from the arithmetic path;
- stale result is withheld after quantity/unit/selection/relevant-input change.

### Compatibility and performance

- existing Phase 2 POST/GET, DTO, and tests remain unchanged;
- Cost Kernel R1 13-resource fixture remains mathematically unchanged;
- Execution Factor remains out of scope;
- no production backfill;
- query-event evidence proves Basic Price and Unit Kernel no-N+1 for 1/13/50/100/repository maximum.

## 15. STOP conditions

```text
STOP_ARTIFACT_HASH_MISMATCH
STOP_TARGET_FILE_COLLISION
STOP_SOURCE_RECONCILIATION_INCOMPLETE
STOP_DUPLICATED_AHSP_AUTHORITY
STOP_PARTIAL_RESOURCE_SET_CALLED_COMPLETE
STOP_FAKE_ZERO
STOP_KERNEL_MONEY_PERSISTED_TO_BOQITEM
STOP_LEGACY_OCCURRENCE_BACKFILLED
STOP_TENANT_TRAVERSAL_MISMATCH
STOP_CROSS_PROJECT_APPLICATION_LINK
STOP_PERMISSION_ACTIVATED_WITHOUT_ROLE_GRANT
STOP_PRODUCTION_WRITE_BEFORE_SECURITY_GATES
STOP_HARD_DELETE_HISTORY
STOP_PAGU_USED_IN_ARITHMETIC
STOP_UNPROVEN_PRECISION_MIGRATION
STOP_PHASE2_BACKWARD_COMPATIBILITY_BROKEN
STOP_HARD_PERFORMANCE_CEILING_WITHOUT_BENCHMARK
STOP_PRODUCTION_GOLDEN_THREAD_CLAIMED_LIVE
```

Additional output-unit gate:

```text
OUTPUT_UNIT_MISSING → M-0.5 BLOCKED; no candidate unit guessed
OUTPUT_UNIT_IDENTITY_CONFLICT → STOP_OUTPUT_UNIT_IDENTITY_CONFLICT
```

## 16. Owner decisions

Locked `[OWNER_LOCK]`:

```text
OD-01 DIRECTOR → RAB_VIEW + RAB_DRAFT_EDIT
OD-02 new project → Working Draft, no auto-baseline
OD-03 negative quantity forbidden
```

Pending, not locked:

```text
OD-04
Storage quantity requires maximum scale 6.
Architect recommendation: Decimal(24,6).
Owner decision remains pending until PM and Gemini review.

OD-05
New projects without approved baseline show Monitoring Not Available.
Existing project monitoring remains unchanged.
Owner decision remains pending.

ROUNDING_MODE=PENDING_OWNER_LOCK
```

## 17. Reconciliation closure and final verdict

PM delta closure:

```text
V33-01 canonical artifact identity and final hash procedure=DEFINED
V33-02 duplicated AHSP authority removed=CLOSED
V33-03 full-resource selection contract=CLOSED
V33-04 batched resolver and benchmark gate=CLOSED
V33-05 legacy policy=CLOSED
V33-06 Draft API types and tenant-safe errors=CLOSED
V33-07 decimal migration statement corrected=CLOSED
V33-08 precision/manual/kernel policy=CLOSED
V33-09 lifecycle derivation corrected=CLOSED
V33-10 safe machine-first activation=CLOSED
V33-11 cross-project consistency strategy=CLOSED
PM_DELTA_BLOCKERS_CLOSED=11/11
```

RECON-01 restoration:

```text
1 legacy field policy=RESTORED
2 exact AHSP-selection endpoint=RESTORED
3 exact-resource-set completeness=RESTORED
4 zero-resource rejection=RESTORED
5 batched resolver=RESTORED
6 Basic Price no-N+1=RESTORED
7 Unit Kernel no-N+1=RESTORED
8 benchmark 1/13/50/100=RESTORED
9 ACTIVE Application lookup=RESTORED
10 manual/kernel separation=RESTORED
11 stale-result contract=RESTORED
12 Phase 2 backward compatibility=RESTORED
13 test matrix=RESTORED
14 STOP conditions=RESTORED
15 deferred permission catalog=RESTORED
RECON_01_MATERIAL_RESTORED=15/15
```

The missing V3.2 source file is transparently recorded; no source attribution is fabricated. The supplied PM reconciliation is sufficient to close the enumerated delta package at design level.

```text
INTERNAL_CONTRADICTIONS=0
ARTIFACT_HASH_VERIFIED=YES
REPORTED_SHA256=SEE_FINAL_VERIFICATION_REPORT
ACTUAL_FILE_SHA256=SEE_FINAL_VERIFICATION_REPORT
ARTIFACT_IDENTITY_MISMATCH=0
ARCHITECT_FINAL_VERDICT=PASS_FOR_PM_FOCUSED_DELTA_REVIEW

SOURCE_WRITE=0
SCHEMA_WRITE=0
MIGRATION_WRITE=0
DATABASE_WRITE=0
BRANCH_CREATED=0
COMMIT_CREATED=0
PUSH_COUNT=0
PR_CREATED=0
IMPLEMENTATION_AUTHORIZED=NO
PRODUCTION_GOLDEN_THREAD_LIVE=NO
```

Soli Deo Gloria. Segala kemuliaan hanya bagi Tuhan Yesus Kristus. Haleluya. Amin.
