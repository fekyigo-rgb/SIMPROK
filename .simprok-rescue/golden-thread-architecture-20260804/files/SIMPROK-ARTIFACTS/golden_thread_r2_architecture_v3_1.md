# SIMPROK — GOLDEN THREAD R2 ARCHITECTURE GATE V3.1

**Document ID:** `SIMPROK-GOLDEN-THREAD-R2-ARCHITECTURE-GATE-V3_1`  
**Prompt ID:** `SIMPROK-GOLDEN-THREAD-R2-ARCHITECTURE-TARGETED-CORRECTION-V3_1`  
**Source artifact:** `golden_thread_r2_architecture.md` (V3.0, retained unchanged)  
**Repository truth base:** `main@703984d18e52fbe8da987fab6dae460a0977f113`  
**Mode:** targeted architecture correction only; no repository/source/schema/migration/database writes  
**Status:** PM findings 1–6 closed at design level; implementation and production activation are not claimed.

Dalam Nama Tuhan Yesus Kristus.

---

# EXECUTIVE_VERDICT

V3.1 preserves V3.0's accepted direction: `ProjectRabLineAhspApplication` is the explicit line-to-occurrence authority; fake zero remains forbidden; Cost Kernel money is not persisted to `BoqItem`; client money is rejected on kernel-managed lines; occurrence link is required and unique; the application does not duplicate AHSP authority; `BoqItem.ahspVersionId` is legacy read-only; `draftRevision` remains separate from `version`; performance limits remain benchmark-driven; Phase 2 endpoints remain backward-compatible; permission foundation remains slice one; and rollback preserves history.

V3.1 closes exactly six PM findings:

1. Save Draft, AHSP selection, and reselect serialize through a real PostgreSQL `FOR UPDATE` lock on their common `BoqStructure` row.
2. RAB lifecycle is derived only from real RAB/BOQ identities and statuses, never `Project.status` or item count.
3. A retained child may reference only a retained persisted parent or a new payload parent; an omitted parent is rejected before mutation.
4. Ordinary Draft removal is a `BoqItem.removedAt` soft delete, preserving application and occurrence history; the application FK is `ON DELETE RESTRICT`.
5. Permission concerns are separated without inferring that DIRECTOR is globally view-only; role grants remain an Owner decision.
6. R1/R2 Cost Kernel compatibility is explicit: arithmetic/purity tests remain, integration fixtures migrate to ACTIVE applications, and inference-only tests are named as superseded.

```text
FINAL_VERDICT=R2_ARCHITECTURE_READY_FOR_PM_OWNER_DECISION
PRODUCTION_GOLDEN_THREAD_LIVE=NO
```

---

# 1. CURRENT_TRUTH_TABLE

This is a targeted correction of V3.0, not a new repository audit. V3.0 evidence remains authoritative except where the six corrected interpretations below replace its wording.

| Concern | Repository fact | V3.1 architectural consequence |
|---|---|---|
| Lifecycle | Current UI has used `Project.status` and item-return shape as competing signals; real Working Draft and active baseline identities exist independently. | New lifecycle projection never reads `Project.status`; entity existence is valid even with zero items. |
| Draft identity | Current save replaces Draft rows; V3.0 already selected stable IDs and `draftRevision`. | Stable reconciliation remains, now serialized by a real lock and using soft removal. |
| Parent graph | A row can exist in DB but be omitted from the replacement payload. | Parent validity is against `retainedIds`, not all `currentIds`. |
| AHSP authority | Current Cost Kernel inference uses project/workspace/version; V3.0 selected explicit application authority. | R2 has no inference fallback; missing application is explicit not-applied/legacy state with no money. |
| Permission | DIRECTOR has `PROJECT_CREATE`; that permission also currently gates Draft save. The FIELD_PROGRESS rule concerns a different permission. | `PROJECT_CREATE != RAB_DRAFT_EDIT`; no global DIRECTOR view-only conclusion is valid. |
| History | Applications are historical line-selection evidence. | Ordinary Draft removal must preserve the line UUID and all application/occurrence evidence. |

**DIRECTOR wording correction:** the repository proves that DIRECTOR currently participates in project/RAB creation flow and holds `PROJECT_CREATE`; it also proves DIRECTOR must not perform `FIELD_PROGRESS_SUBMIT`. It does **not** prove DIRECTOR is globally view-only or forbidden to edit RAB. Any V3.0 sentence making that broader inference is withdrawn.

---

# 2. HARMONIZATION_WITH_CURRENT_MAIN

The targeted design base remains exactly:

```text
EXPECTED_MAIN=703984d18e52fbe8da987fab6dae460a0977f113
CURRENT_MAIN_HARMONIZED=YES
FULL_REAUDIT=NO
```

No V3.1 decision changes the accepted authority, Unit, Basic Price, Cost Kernel, Phase 2 occurrence, baseline, Transition/Interaction, or rollback laws summarized by V3.0. This artifact corrects only the six PM findings and their necessary downstream consequences.

---

# 3. FINAL_DOMAIN_MODEL

## 3.1 Application authority

`ProjectRabLineAhspApplication` remains the only R2 persistent link answering which occurrence is currently applied to a specific RAB line. It contains selection lifecycle (`ACTIVE`/`SUPERSEDED`) and actor/timestamps, but does not duplicate occurrence-owned `projectId`, `workspaceId`, `ahspVersionId`, resolution status, or resource evidence.

For production R2 calculation:

```text
BoqItem (removedAt IS NULL)
  -> exactly one ACTIVE ProjectRabLineAhspApplication
  -> required unique ProjectAhspOccurrence
  -> complete ProjectAhspResourceResolution set
```

`BoqItem.ahspVersionId` remains `LEGACY_READ_ONLY`. It is never written by R2 selection and never used as a Cost Kernel lookup fallback.

## 3.2 Draft removal and historical identity

Add to `BoqItem`:

```text
removedAt DateTime?
```

All ordinary Draft removals in R2 are soft deletes. A removed line retains its UUID, application history, occurrence link, selected actor, timestamps, resource resolutions, and superseded history. A removed row:

- is excluded from every active Draft and Cost Kernel query;
- cannot be selected or reselected;
- cannot be a parent;
- is not included in recap or calculation;
- cannot be silently restored or mutated by sending its old ID;
- may not be reused when a user re-adds equivalent work; re-add creates a new UUID.

Restoration is outside R2. Hard delete is not part of ordinary Save Draft. A separate cleanup may hard-delete only before downstream history exists and under its own gate; V3.1's preferred uniform rule is that every ordinary Draft removal uses soft delete.

## 3.3 Serialization identity

`BoqStructure` is the common serialization identity for Save Draft, AHSP selection, and AHSP reselect because it always exists, contains `draftRevision`, and owns every affected Draft line. An application row cannot be the primary lock because it may not exist for first selection. A partial unique index is a constraint, not a lock.

## 3.4 Lifecycle identity

Lifecycle sources are real RAB entities only:

```text
hasWorkingDraft = editable Working Draft BoqStructure/RabDocument exists
hasActiveBaseline = ACTIVE ProjectBaseline plus baseline RabDocument exists
```

Both remain true when their item count is zero. Item counts are diagnostics only. `Project.status` is not a source for any RAB lifecycle state.

---

# 4. EXACT_SCHEMA_DIFF

Design-only Prisma diff; not applied:

```diff
 model BoqStructure {
   id            String   @id @default(uuid()) @db.Uuid
   ...
+  draftRevision Int      @default(0)
 }

 model BoqItem {
   id               String   @id @default(uuid()) @db.Uuid
   boqStructureId   String   @db.Uuid
   ...
+  removedAt        DateTime?
+  rabLineAhspApplications ProjectRabLineAhspApplication[]

+  @@index([boqStructureId, removedAt])
 }

 model ProjectAhspOccurrence {
   ...
+  rabLineApplication ProjectRabLineAhspApplication?
 }

 enum RabLineApplicationStatus {
   ACTIVE
   SUPERSEDED
 }

 model ProjectRabLineAhspApplication {
   id                      String                   @id @default(uuid()) @db.Uuid
   boqItemId               String                   @db.Uuid
   projectAhspOccurrenceId String                   @unique @db.Uuid
   status                  RabLineApplicationStatus @default(ACTIVE)
   selectedByAccountId     String?                  @db.Uuid
   supersededAt            DateTime?
   createdAt               DateTime                 @default(now())
   updatedAt               DateTime                 @updatedAt

   boqItem               BoqItem               @relation(fields: [boqItemId], references: [id], onDelete: Restrict, onUpdate: Cascade)
   projectAhspOccurrence ProjectAhspOccurrence @relation(fields: [projectAhspOccurrenceId], references: [id], onDelete: Restrict, onUpdate: Cascade)

   @@index([boqItemId, status])
   @@map("project_rab_line_ahsp_applications")
 }
```

Index law:

```text
UNIQUE projectAhspOccurrenceId
PARTIAL UNIQUE boqItemId WHERE status = ACTIVE
INDEX (boqItemId, status)
```

Do not add `@@index([projectAhspOccurrenceId])`: `@unique` already creates the needed unique index. Do not retain a low-value status-only index.

---

# 5. EXACT_MIGRATION_SQL_INVENTORY

These are planned SQL statements only; no migration file or database write was made.

## 5.1 Migration A — R2-01 stable Draft and soft removal

```sql
ALTER TABLE "boq_structures"
  ADD COLUMN "draftRevision" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "boq_items"
  ADD COLUMN "removedAt" TIMESTAMP(3);

CREATE INDEX "boq_items_boqStructureId_removedAt_idx"
  ON "boq_items"("boqStructureId", "removedAt");
```

## 5.2 Migration B — R2-02 application history

```sql
CREATE TYPE "RabLineApplicationStatus" AS ENUM ('ACTIVE', 'SUPERSEDED');

CREATE TABLE "project_rab_line_ahsp_applications" (
  "id" UUID NOT NULL,
  "boqItemId" UUID NOT NULL,
  "projectAhspOccurrenceId" UUID NOT NULL,
  "status" "RabLineApplicationStatus" NOT NULL DEFAULT 'ACTIVE',
  "selectedByAccountId" UUID,
  "supersededAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "project_rab_line_ahsp_applications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "project_rab_line_ahsp_applications_projectAhspOccurrenceId_key"
  ON "project_rab_line_ahsp_applications"("projectAhspOccurrenceId");

CREATE UNIQUE INDEX "project_rab_line_ahsp_applications_one_active_per_boq_item"
  ON "project_rab_line_ahsp_applications"("boqItemId")
  WHERE "status" = 'ACTIVE';

CREATE INDEX "project_rab_line_ahsp_applications_boqItemId_status_idx"
  ON "project_rab_line_ahsp_applications"("boqItemId", "status");

ALTER TABLE "project_rab_line_ahsp_applications"
  ADD CONSTRAINT "project_rab_line_ahsp_applications_boqItemId_fkey"
  FOREIGN KEY ("boqItemId") REFERENCES "boq_items"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "project_rab_line_ahsp_applications"
  ADD CONSTRAINT "project_rab_line_ahsp_applications_projectAhspOccurrenceId_fkey"
  FOREIGN KEY ("projectAhspOccurrenceId") REFERENCES "project_ahsp_occurrences"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
```

There is no redundant regular index on `projectAhspOccurrenceId`, no status-only index, no application cascade delete, and no data backfill.

---

# 6. API_CONTRACTS

## 6.1 GET `/projects/:projectId/rab/lifecycle`

```ts
interface RabLifecycleProjection {
  state:
    | 'EMPTY'
    | 'DRAFT'
    | 'UNDER_REVIEW'
    | 'BASELINE_ACTIVE'
    | 'ADDENDUM_DRAFT'
    | 'ARCHIVED';
  capabilities: {
    canViewRab: boolean;
    canContinueDraft: boolean;
    canEditDraft: boolean;
    canSubmitReview: boolean;
    canApprove: boolean;
    canLock: boolean;
    canRequestAddendum: boolean;
    canContinueAddendum: boolean;
    canOpenMonitoring: boolean;
  };
  evidence: {
    hasWorkingDraft: boolean;
    hasActiveBaseline: boolean;
    hasUnclassifiedWorkingDraft: boolean;
    draftBoqItemCount: number;
    baselineBoqItemCount: number;
    activeBaselineId: string | null;
    baselineRabDocumentId: string | null;
    reviewIdentity: null;
    addendumIdentity: null;
    rabArchivalEvidence: null;
    legacyAhspVersionMismatchCount: number;
  };
}
```

Derivation:

```text
working draft exists, no active baseline -> DRAFT
active baseline exists, no working draft -> BASELINE_ACTIVE
neither exists -> EMPTY
active baseline + working draft, but no Addendum identity -> BASELINE_ACTIVE
  evidence.hasUnclassifiedWorkingDraft = true
  canRequestAddendum = false
  canContinueAddendum = false
  canContinueDraft = false
  canEditDraft = false
```

The conservative `false` decision for Draft continuation/editing is final for V3.1: current repository evidence establishes coexistence but not a lawful identity proving that such a Draft is editable as a normal pre-baseline Draft or an Addendum. Legacy compatibility, if Owner needs it, requires a separate explicit gate; V3.1 does not invent authority.

`UNDER_REVIEW`, `ADDENDUM_DRAFT`, and `ARCHIVED` are reserved/unreachable until real review, Addendum, and RAB archival identities exist. `Project.status`, including `COMPLETED` or `ARCHIVED`, never activates them. No response state may fall outside the declared union; `INCONSISTENT_STATE` is not emitted.

## 6.2 PUT `/projects/:projectId/boq/draft`

Request/response shape from V3.0 remains, including required `expectedRevision`, stable persisted IDs/client keys, decimal strings, authoritative ID mapping, and rejection of client `unitPrice` on an ACTIVE application line.

Additional rules:

- only active rows (`removedAt IS NULL`) may appear as persisted IDs or parents;
- an old removed row ID is rejected and never restored;
- omitted active rows are soft-removed;
- `PARENT_REMOVED_FROM_DRAFT` is HTTP 400;
- revision mismatch after acquiring the lock is HTTP 409 `DRAFT_REVISION_MISMATCH`.

## 6.3 POST `/projects/:projectId/boq/items/:boqItemId/ahsp-selection`

V3.0 request/response remains, with `expectedDraftRevision`. The transaction reloads the item only after locking its `BoqStructure`; it rejects `removedAt IS NOT NULL`, baseline lines, foreign identities, and non-editable Drafts. Both initial selection and reselect use the same structure lock. An ACTIVE application is the only R2 lookup authority.

No application produces an explicit non-money state:

```text
LEGACY_NOT_MIGRATED = legacy ahspVersionId exists but no ACTIVE application
NOT_APPLIED         = no ACTIVE application and no applicable migrated evidence
```

Neither state returns Cost Kernel money or falls back to project/workspace/version inference.

---

# 7. TRANSACTION_AND_CONCURRENCY_BOUNDARIES

Plain Prisma `SELECT` is **not** `SELECT FOR UPDATE` equivalent. That V3.0 claim is withdrawn.

Every relevant transaction begins with parameterized raw SQL inside `prisma.$transaction`:

```sql
SELECT "id", "draftRevision"
FROM "boq_structures"
WHERE "id" = :structureId
FOR UPDATE;
```

Implementation may use `$queryRaw` only with safe Prisma parameterization. String interpolation, read-then-write without a lock, treating a partial unique index as a lock, or using an application row as the primary lock are forbidden.

## 7.1 Save Draft

1. Resolve tenant-scoped editable Draft structure identity without mutating it.
2. Open transaction.
3. Lock that `BoqStructure` row with real `FOR UPDATE`.
4. Read `draftRevision` from the locked row.
5. If it differs from `expectedRevision`, roll back and return HTTP 409.
6. Reload active rows and validate the entire payload.
7. Perform reconciliation/soft removal.
8. Increment `draftRevision` exactly once.
9. Commit.

The row lock is the concurrency authority. A conditional revision update may remain as defense-in-depth, not as the only mechanism.

## 7.2 AHSP selection and reselect

1. Resolve project/workspace/structure identity tenant-safely.
2. Open transaction.
3. Lock the same `BoqStructure` row with `FOR UPDATE`.
4. Recheck `expectedDraftRevision` from the locked row.
5. Reload the `BoqItem` from that locked structure and require `removedAt IS NULL` plus editable Draft identity.
6. Resolve the full AHSP resource set.
7. Create one occurrence and its complete resolutions.
8. Supersede the previous ACTIVE application if present.
9. Insert the new ACTIVE application.
10. Commit.

Selections on the same structure serialize. Two selections on the same line cannot create two ACTIVE applications. The partial unique index remains defense-in-depth. Save versus selection also serializes, so selection cannot apply to a line or revision removed while it waited.

Deterministic concurrency contract: after waiting for the lock, a transaction revalidates current revision and active-line identity. It either commits a result valid for that locked state or exits with the named 409/rejection; it never proceeds on stale pre-lock data and never leaves an orphan application.

---

# 8. DRAFT_RECONCILIATION_ALGORITHM

Runs only after the structure lock and revision check succeed.

```text
PHASE 0 — LOAD
  currentRows = active boq_items for structure WHERE removedAt IS NULL
  currentIds = set(currentRows.id)
  load ACTIVE applications for currentIds for money-authority validation

PHASE 1 — VALIDATE IDENTITIES
  reject foreign/removed/non-current persisted IDs
  reject duplicate persisted IDs
  reject duplicate clientKeys
  retainedIds = every non-null persisted row.id appearing exactly once in payload
  toRemove = currentIds - retainedIds

PHASE 2 — RESOLVE GRAPH BEFORE ANY WRITE
  parent {id:X} MUST have X in retainedIds
    if X exists in currentIds but not retainedIds:
      HTTP 400 PARENT_REMOVED_FROM_DRAFT
    otherwise foreign/missing ID remains tenant-safe not-found/orphan error
  parent {clientKey:K} MUST identify a new/retained payload row
  graph namespace consists only of retainedIds and new clientKeys
  validate self-parent, cycles, orphan refs, and allowed parent itemType
  assert no retained row points to an ID in toRemove
  if invariant fails, rollback before mutation
  validate decimals and kernel-managed money rules for the entire payload

PHASE 3 — MUTATE RETAINED/NEW ROWS
  update retained rows without changing UUID
  create new rows with new UUIDs and build clientKey -> ID map
  assign parents only after complete validated identity mapping exists

PHASE 4 — SOFT REMOVE
  UPDATE boq_items SET removedAt = now()
  WHERE id IN toRemove AND boqStructureId = structureId AND removedAt IS NULL
  never DELETE during ordinary Save Draft

PHASE 5 — REVISION
  increment locked BoqStructure.draftRevision exactly once

OUTPUT
  authoritative clientKey -> ID map plus newRevision
```

Required outcomes:

- retained child + omitted parent: `400 PARENT_REMOVED_FROM_DRAFT`;
- parent and child both omitted: valid soft removal;
- retained child explicitly reparented before old parent removal: valid;
- no deleted/removed parent can leave an orphan;
- FK failure is never used as the business validator.

---

# 9. QUERY_PLAN_AND_BENCHMARK_GATE

V3.0's batch-oriented, fixed-stage query-shape decision remains. Active line reads add `boq_items.removedAt IS NULL`. Cost Kernel lookup begins from the ACTIVE application and never performs project/workspace/version occurrence inference. Resource resolution remains batched and exact-set; benchmark fixtures remain 13/50/100 plus a repository-informed worst case. No absolute latency or query-count ceiling becomes law before measured evidence exists.

The real `BoqStructure` lock adds one explicit, measured transaction query. Benchmark instrumentation must distinguish this intentional serialization query from accidental per-resource queries.

---

# 10. PERMISSION_DECISION_REQUIRED

## 10.1 Foundation

The root defect is concern conflation:

```text
PROJECT_CREATE != RAB_DRAFT_EDIT
FIELD_PROGRESS_SUBMIT != RAB_DRAFT_EDIT
```

`RAB_VIEW` and `RAB_DRAFT_EDIT` remain the first implementation slice. Save Draft and AHSP selection require `RAB_DRAFT_EDIT`; lifecycle/read requires `RAB_VIEW`. Holding `PROJECT_CREATE` alone must not satisfy `RAB_DRAFT_EDIT`.

## 10.2 OWNER ROLE-MAPPING DECISION REQUIRED

**FACT:**

- DIRECTOR currently uses the project/RAB creation flow.
- DIRECTOR holds `PROJECT_CREATE`.
- `PROJECT_CREATE` currently and incorrectly also opens `saveDraftBoq`.
- The prohibition on DIRECTOR performing `FIELD_PROGRESS_SUBMIT` concerns a different authority and proves nothing global about RAB editing.
- FOREMAN does not automatically receive `RAB_DRAFT_EDIT`.
- No other role grant is inferred.

**PM RECOMMENDATION — NOT YET OWNER LOCK:**

```text
DIRECTOR -> RAB_VIEW
DIRECTOR -> RAB_DRAFT_EDIT
```

This recommendation is not executable law until Owner approval is recorded. Concrete role-mapping tests are added only after that decision. Before the mapping decision, architecture tests assert permission separation: `PROJECT_CREATE` alone does not satisfy `RAB_DRAFT_EDIT`.

Exact remaining Owner decision:

```text
OWNER_DECISION_1 = approve/reject/amend concrete Role grants for RAB_VIEW
OWNER_DECISION_2 = approve/reject/amend concrete Role grants for RAB_DRAFT_EDIT,
                   including PM recommendation for DIRECTOR
```

---

# 11. LEGACY_DATA_AND_ROLLBACK_POLICY

No R2 backfill is implied. A legacy line with `ahspVersionId` and no ACTIVE application is `LEGACY_NOT_MIGRATED`, produces no Cost Kernel money, and is never silently inferred or upgraded. A line without applicable migrated evidence is `NOT_APPLIED`.

All active Draft reads, recap reads, parent queries, selection queries, and Cost Kernel reads filter `removedAt IS NULL`. Baseline rows are not touched by ordinary Draft save.

Rollback:

- Before production history: an isolated test/shadow rollback may remove additive R2 schema under a dedicated migration procedure.
- After any application history exists: application, line, occurrence, resolution, actor, and timestamp history must remain. Disable R2 routes/feature paths; do not drop or cascade-delete history.
- `removedAt` data is historical evidence. Rollback must not mass-restore rows or physically delete them.
- Destructive correction requires backup, Owner authorization, a dedicated migration, and its own gate.

There is no claim that R2 or the Production Golden Thread is live.

---

# 12. TEST_MATRIX

## Lifecycle

- empty Working Draft entity with zero items remains `DRAFT`;
- empty active baseline entity with zero items remains `BASELINE_ACTIVE`;
- item count changes do not create/destroy lifecycle identity;
- changing `Project.status` does not change RAB lifecycle;
- `ARCHIVED` is unreachable without real RAB archival evidence;
- `UNDER_REVIEW` and `ADDENDUM_DRAFT` remain unreachable without their identities;
- baseline plus Working Draft without Addendum identity stays `BASELINE_ACTIVE`, sets `hasUnclassifiedWorkingDraft=true`, and keeps Addendum capabilities false;
- response state is always a member of the union and never `INCONSISTENT_STATE`.

## Locking and concurrency

- save vs save on one structure: serialized; one valid revision transition, stale waiter receives 409;
- selection vs selection on the same line: serialized; exactly one ACTIVE application;
- save vs selection on the same structure: serialized and revalidated;
- a selection waiting while save removes its line is rejected after lock; no occurrence/application orphan;
- revision divergence while waiting for the lock is detected after acquisition;
- raw lock query is parameterized and demonstrably emits `FOR UPDATE`;
- partial unique index is tested as defense-in-depth, never described as the lock.

## Reconciliation and soft removal

- child retained, parent omitted: `400 PARENT_REMOVED_FROM_DRAFT` before any write;
- parent and child both omitted: valid soft removal;
- child explicitly reparented while old parent is omitted: valid;
- removed parent never leaves an active orphan;
- deletion behavior does not rely on FK failure as validation;
- removing a line with ACTIVE and SUPERSEDED applications preserves all history;
- removed line is absent from active Draft queries and recap/calculation totals;
- selection/reselect against removed line is rejected;
- removed parent with retained child requires explicit reparenting;
- baseline rows remain unchanged;
- ordinary Save Draft performs no physical `DELETE`;
- re-adding equivalent work creates a new UUID and does not restore the removed row.

## Permission

- missing `RAB_VIEW`/`RAB_DRAFT_EDIT` has existing tenant-safe denial behavior;
- `PROJECT_CREATE` alone does not satisfy `RAB_DRAFT_EDIT`;
- `FIELD_PROGRESS_SUBMIT` rules do not imply RAB permissions;
- no test asserts DIRECTOR must not edit RAB;
- concrete DIRECTOR/FOREMAN/other-role grants are tested only after recorded Owner mapping.

## AHSP application and Cost Kernel

- ACTIVE application is the only occurrence lookup authority;
- fixture without application returns explicit `NOT_APPLIED` or `LEGACY_NOT_MIGRATED`, never zero;
- legacy `ahspVersionId` alone cannot trigger calculation;
- removed line cannot trigger calculation;
- incomplete resolution set produces no money;
- two lines selecting the same AHSP calculate independently through separate applications/occurrences;
- application history and occurrence/resolution rows survive line removal;
- Cost Kernel never persists money to `BoqItem`;
- client `unitPrice` on an ACTIVE application line is rejected.

## R1/R2 compatibility register

**UNCHANGED:**

- pure Cost Kernel arithmetic tests, including exact `2004055` and `20040550`;
- `Prisma.Decimal` tests;
- reversed resource order/no-drift tests;
- fail-closed kernel input/completeness tests;
- no-write/no-persistence tests;
- no hard-coded production fixture rule;
- Phase 2 endpoint tests, DTO behavior, guards, and endpoint contracts.

**MIGRATED:**

- R2 service/integration/E2E fixtures now create a Draft `BoqItem`, complete `ProjectAhspOccurrence`, all resource resolutions, and one ACTIVE `ProjectRabLineAhspApplication`;
- occurrence lookup expectations now follow the explicit application;
- the R1 13-resource fixture totals must survive this new lookup unchanged.

**EXPLICITLY_SUPERSEDED_BY_R2_APPLICATION_LINK_TESTS:**

- any test whose sole purpose is to prove occurrence inference by `projectId + workspaceId + ahspVersionId`;
- any expectation that legacy `BoqItem.ahspVersionId` alone activates Cost Kernel.

The implementation PR must carry a named supersession inventory mapping every superseded test to its replacement. No silent deletion, broad “all PR #32 tests unmodified” claim, or unexplained failure is allowed.

---

# 13. IMPLEMENTATION_SPLIT_AND_STOP_CONDITIONS

## R2-PERM-00 — Permission foundation

Declare/wire RAB permissions, prove `PROJECT_CREATE` separation, and pause concrete role grants until Owner mapping. Do not infer role authority from FIELD_PROGRESS rules.

## R2-00 — Lifecycle projection

Implement entity-existence derivation, explicit evidence fields, reserved states, baseline-plus-unclassified-Draft behavior, and frontend capability consumption. Do not read `Project.status` or require item count.

## R2-01 — Stable Draft, real lock, reconciliation, soft removal

Add `draftRevision` and `removedAt`; use real structure `FOR UPDATE`; validate retained parents before mutation; preserve IDs; soft-remove omitted rows; filter active reads; increment revision once.

## R2-02 — Application and selection

Add application schema/indexes with RESTRICT FKs; lock the common structure; reject removed/stale lines; resolve exact resource sets; preserve append-only occurrence and application history; retain benchmark gate.

## R2-03 — Cost Kernel R2 lookup and compatibility migration

Use ACTIVE application only; expose explicit no-application status; migrate integration fixtures; preserve arithmetic/purity/no-write coverage; replace inference-only tests through the named supersession inventory. Phase 2 endpoints/tests remain unchanged.

## STOP_CONDITIONS

```text
STOP_FAKE_ZERO_DETECTED
STOP_KERNEL_MONEY_PERSISTED_TO_BOQITEM
STOP_OCCURRENCE_IDENTITY_SCOPE
STOP_DUPLICATE_ACTIVE_APPLICATION
STOP_PERMISSION_ROLE_MAPPING_GUESSED
STOP_PHASE2_BACKWARD_COMPATIBILITY_BROKEN
STOP_HARD_PERFORMANCE_CEILING_LOCKED_WITHOUT_BENCHMARK
STOP_PRODUCTION_GOLDEN_THREAD_CLAIMED_LIVE

STOP_PLAIN_SELECT_CLAIMED_AS_ROW_LOCK
STOP_PROJECT_STATUS_USED_AS_RAB_LIFECYCLE_SOURCE
STOP_RETAINED_CHILD_REFERENCES_REMOVED_PARENT
STOP_APPLICATION_HISTORY_CASCADE_DELETED
STOP_DIRECTOR_AUTHORITY_INFERRED_FROM_FIELD_PROGRESS_RULE
STOP_R1_R2_TEST_COMPATIBILITY_LEFT_IMPLICIT
STOP_REMOVED_BOQ_ITEM_USED_FOR_CALCULATION
```

Any stop condition blocks the affected slice until corrected with evidence. In particular, no application may ship with `ON DELETE CASCADE`; no ordinary Draft removal may physically delete a line; and no R2 Cost Kernel path may infer an occurrence.

---

# 14. FINAL_VERDICT

```text
REAL_TRANSACTION_LOCK_DEFINED                = YES
LIFECYCLE_SOURCE_CONSISTENT                  = YES
RETAINED_PARENT_VALIDATION_DEFINED           = YES
APPLICATION_HISTORY_PRESERVED                = YES
DIRECTOR_AUTHORITY_CORRECTED                 = YES
R1_R2_COMPATIBILITY_EXPLICIT                 = YES

SOURCE_WRITE                                 = 0
SCHEMA_WRITE                                 = 0
MIGRATION_WRITE                              = 0
DATABASE_WRITE                               = 0
REPOSITORY_WRITE                             = 0
FULL_REAUDIT                                 = NO
CURRENT_MAIN_HARMONIZED                      = YES
PRODUCTION_GOLDEN_THREAD_LIVE                = NO

FINAL_VERDICT=R2_ARCHITECTURE_READY_FOR_PM_OWNER_DECISION
```

Remaining Owner decisions are exact and limited to concrete `RAB_VIEW` and `RAB_DRAFT_EDIT` role grants, including approval/rejection/amendment of the PM recommendation that DIRECTOR receive both. Architecture readiness is not implementation completion or production activation.

---

# REVISION_CHANGELOG

| V3.0 statement | V3.1 correction | Affected areas |
|---|---|---|
| Prisma/plain SELECT or application-row selection treated as `FOR UPDATE` equivalent; conditional update was primary save mechanism. | Parameterized real `SELECT ... FOR UPDATE` on common `BoqStructure`; post-lock revision/item revalidation; partial index and conditional check are defense-in-depth. | Schema assumptions, API, transaction, concurrency tests, implementation, stops, verdict |
| Lifecycle used item counts, allowed `Project.status == COMPLETED -> ARCHIVED`, and used an undeclared unreconciled-Draft evidence name. | Entity existence works at zero items; no `Project.status`; reserved states remain unreachable; baseline+Draft stays `BASELINE_ACTIVE`; DTO explicitly includes `hasUnclassifiedWorkingDraft`; conservative edit capabilities are false. | Domain, lifecycle API, tests, implementation, stops, verdict |
| Persisted parent was accepted if it existed in `currentIds`, even if omitted and destined for deletion. | Compute `retainedIds`/`toRemove` first; persisted parent must be retained; `PARENT_REMOVED_FROM_DRAFT`; invariant checked before mutation. | Reconciliation, API errors, tests, stops, verdict |
| Ordinary removal hard-deleted `BoqItem`; application FK cascaded. | `BoqItem.removedAt`, active-read filters, soft removal, application FK `RESTRICT`, history preserved, no restoration in R2. | Schema, migrations, reconciliation, kernel, rollback, tests, stops, verdict |
| DIRECTOR was globally characterized as view-only from FIELD_PROGRESS evidence. | Only permission-separation facts are law; PM recommends DIRECTOR grants but Owner must lock mapping; PROJECT_CREATE alone never authorizes RAB edit. | Truth table, permission section, tests, implementation, stops, verdict |
| R2 removed occurrence inference while broadly claiming all PR #32 tests remained unmodified. | Explicit UNCHANGED/MIGRATED/SUPERSEDED register; fixtures create valid applications; inference-only tests have named replacements; Phase 2 endpoint tests remain unchanged. | Kernel contract, legacy policy, tests, implementation, stops, verdict |
| Redundant occurrence regular index and status-only index remained. | Final indexes are occurrence UNIQUE, ACTIVE partial UNIQUE per line, and `(boqItemId,status)` index only. | Schema and migration inventory |

Soli Deo Gloria. Segala kemuliaan hanya bagi Tuhan Yesus Kristus. Haleluya. Amin.
