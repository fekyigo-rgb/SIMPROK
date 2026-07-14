# SIMPROK — BP-AHSP-PHASE-2

## Project AHSP Occurrence Persistence — Implementation Plan

**Status:** `PLAN REVISED — NOT IMPLEMENTED — AWAITING PM/ARCHITECT REVIEW`
**Planning draft:** Claude Code
**Production executor:** Codex
**Branch:** `feat/bp-ahsp-phase2-occurrence-persistence`
**Date:** 14 Juli 2026
**Revision basis:** `docs/implementation-gates/BP_AHSP_PHASE2_PM_PLAN_REVIEW_DECISIONS.md` — binding; controls wherever this plan differs. Original planning base: `1281e70fa9a1ba8505d17eae02930d49d3e3b33e` (confirmed `BASELINE_VALID` by that record §1).
**Scope of this document:** planning only. No `schema.prisma` change, no migration, no backend/frontend/test/seed/package change is included in this branch at this stage. Claude Code is not authorized to write the Phase 2 migration or production implementation — production implementation authority is `CODEX ONLY` per the revision basis §2.

This document is the required implementation plan for the gate
`docs/implementation-gates/BP_AHSP_PHASE2_PROJECT_OCCURRENCE_PERSISTENCE.md`,
binding-clarified by
`docs/implementation-gates/BP_AHSP_PHASE2_ARCHITECT_CLARIFICATIONS.md`,
and further binding-controlled by
`docs/implementation-gates/BP_AHSP_PHASE2_PM_PLAN_REVIEW_DECISIONS.md`.
Where this plan appears to conflict with any of the three, those documents win, with the
PM Plan Review Decisions record controlling over the earlier two wherever it speaks; this
plan exists to translate them into an exact, repository-grounded build plan and to surface
every ambiguity found during re-anchor **before** any code is written. This revision
incorporates every PM Plan Review Decision without renegotiation; nothing decided there is
reopened here.

---

## 0. Re-anchor confirmation

Read in full, in order, before revising this plan:

1. `docs/project-memory/SIMPROK_PROJECT_MEMORY.md`
2. `docs/project-memory/SIMPROK_BASIC_PRICE_AHSP_IMPLEMENTATION_BLUEPRINT_OWNER_LOCK.md`
3. `docs/project-memory/SIMPROK_BASIC_PRICE_AHSP_IMPLEMENTATION_BLUEPRINT.md`
4. `docs/implementation-gates/BP_AHSP_PHASE1_DETERMINISTIC_RESOURCE_PROOF.md`
5. `docs/implementation-gates/BP_AHSP_PHASE2_PROJECT_OCCURRENCE_PERSISTENCE.md`
6. `docs/implementation-gates/BP_AHSP_PHASE2_ARCHITECT_CLARIFICATIONS.md`
7. `docs/implementation-gates/BP_AHSP_PHASE2_PM_PLAN_REVIEW_DECISIONS.md` — this revision's
   controlling input; closes the open questions the first draft raised.
8. Current repository reality: `backend/prisma/schema.prisma`, migrations, `BasicPriceService`,
   `ProjectAccessGuard`, `PermissionsGuard`, `ProjectAccessPolicyService`, permission catalog,
   RBAC seed, `ProjectController`, `AhspController`, the Phase 1 kernel and its spec, and
   representative e2e specs. Re-verified unchanged by this revision except where noted.

This revision also merged `origin/main` (merge commit `ee4ffac5619fed3ae7df6469bfa21b96e628d207`,
bringing in `72879663f3bdab17ce023bebe25e887f03e748c4`) into the feature branch to pick up
the PM Plan Review Decisions record itself, per the Repository Synchronization Law. No
conflict occurred.

Locked laws carried into this plan without renegotiation:

- SIMPROK menghitung, manusia memutuskan.
- AHSP adalah otoritas. Basic Price menyesuaikan.
- No nominal-based warning or tie-breaker.
- Resource-level selection lives in the project AHSP occurrence, never in `BoqItem`/`RabDocument`.
- Master `AHSP`/`AHSPVersion`/`AHSPResource` and historical snapshots are never mutated or backfilled.
- The only authorized resolver is the Phase 1 kernel; no fuzzy/AI/alias layer.
- `EXPIRED` Basic Price is never auto-selected in Phase 2.
- No Cost Kernel, no AHSP unit price, no RAB arithmetic, no Execution Factor.
- Production entity names are locked: `ProjectAhspOccurrence`, `ProjectAhspResourceResolution`.
- Freshness architecture is **Option C**, locked by PM Plan Review Decisions §3: the kernel
  gains one optional `freshnessStatus` field on `BasicPriceCandidate`; no unit-predicate
  export from the kernel, no alias duplication in the service.
- Phase 2 is a **name-exact proof, not a code-exact proof** (PM Plan Review Decisions §5) —
  stated verbatim in H and in the eventual implementation report.
- Production implementation authority is `CODEX ONLY` (PM Plan Review Decisions §2).

---

## A. Baseline and repository reality

### A.1 Exact base SHA

```text
branch:            feat/bp-ahsp-phase2-occurrence-persistence
local HEAD:         1281e70fa9a1ba8505d17eae02930d49d3e3b33e
origin/main:        1281e70fa9a1ba8505d17eae02930d49d3e3b33e
origin feature head: 1281e70fa9a1ba8505d17eae02930d49d3e3b33e
git status --short: (empty — clean)
```

Verified via `git fetch origin --prune`, `git checkout main && git pull --ff-only`, then
`git checkout feat/bp-ahsp-phase2-occurrence-persistence && git pull --ff-only`. All four
values matched the expected baseline in the task brief before any file was touched.

**Baseline explanation, confirmed by PM Plan Review Decisions §1:** `1281e70` is the correct
expected base of the authorized planning prompt — local feature `HEAD`, `origin/main`, and
the remote feature branch all matched it before this plan file was first created. An older
SHA, `6be5bf24c13f2e6a8b0b2d8b8d8ca624296a7b6e`, is a valid ancestor of `1281e70` (superseded
by the Repository Synchronization Law and the Architect Clarification Addendum) and is
**not** the expected base — it is mentioned here only to close that ambiguity, not because
this plan was ever built from it. Verdict: `BASELINE_VALID`, `NO_BASELINE_STOP`.

### A.2 Current relevant schema (as of base SHA)

Read in full: `backend/prisma/schema.prisma` (1639 lines). Relevant existing models:

- `Project` (`schema.prisma:299-341`) — `id, workspaceId, organizationId, ...`; relation
  arrays already present for `boqStructures`, `rabDocuments`, `intelligenceEvidence`, etc.
  No AHSP-occurrence relation yet.
- `Workspace` (`schema.prisma:67-92`) — already holds `ahsps`, `ahspVersions`, `ahspSnapshots`,
  `resourceCatalogs`, `basicPrices` relation arrays. No AHSP-occurrence relation yet.
- `AHSPVersion` (`schema.prisma:606-631`) — `id, ahspId, workspaceId? , versionNumber, status
  (AhspVersionStatus), effectiveDate, expiredDate, ...`; `workspaceId` nullable = global version.
- `AHSPResource` (`schema.prisma:633-649`) — `id, ahspVersionId, resourceId (raw String, no FK),
  resourceType (raw String), coefficient (Decimal 18,6), baseUnit (String), conversionFactor
  (Decimal? 18,6)`. `id` is a real UUID PK usable as a genuine FK target (distinct from the raw
  `resourceId` string column, which is *not* a FK).
- `ResourceCatalog` (`schema.prisma:832-853`) — `id, workspaceId? (null = global), code, name,
  type (ResourceType: MATERIAL|LABOR|EQUIPMENT), baseUnit, ...`. No dedicated NestJS service
  exists for this model anywhere in `backend/src` (confirmed by repository search — zero matches
  outside the generated Prisma client).
- `BasicPrice` (`schema.prisma:1245-1275`) — `id, resourceId (FK → ResourceCatalog), workspaceId?,
  organizationId?, regionId?, effectiveDate, value (Decimal 18,2), sourceType, verificationStatus
  (PriceVerificationStatus), sourceOrigin (PriceSourceOrigin), freshnessStatus
  (PriceFreshnessStatus: CURRENT|EXPIRING|EXPIRED), status (String, default "PUBLISHED")`.
  **`BasicPrice` has no `unit` column of its own** — see A.4 finding 3.
- `BoqItem` (`schema.prisma:1304-1334`) — has `ahspVersionId`, `ahspSnapshotId`; draft BOQ save
  is a full delete+recreate per `BP_AHSP_PHASE2_PROJECT_OCCURRENCE_PERSISTENCE.md §4`, confirmed
  by the gate text and not re-verified line-by-line here (no BOQ file was read/changed).

### A.3 Exact existing services/guards/modules to be reused

| Concern | Reuse target | File |
|---|---|---|
| JWT auth | `JwtAuthGuard` | `backend/src/auth/guards/jwt-auth.guard.ts` |
| Project-scoped access | `ProjectAccessGuard` + `ProjectAccessPolicyService.resolveProjectAccess()` | `backend/src/auth/guards/project-access.guard.ts`, `backend/src/auth/project-access-policy.service.ts` |
| Permission enforcement | `PermissionsGuard` + `@Permissions()` decorator | `backend/src/auth/guards/permissions.guard.ts`, `backend/src/common/decorators/permissions.decorator.ts` |
| Permission codes | `PERMISSIONS.AHSP_MANAGE`, `PERMISSIONS.AHSP_VIEW` (already declared **and already seeded** to `DIRECTOR` role in `prisma/seed-rbac-permissions.ts`) | `backend/src/common/constants/permissions.ts` |
| Deterministic resolver | `resolveAhspResourcePrice()` | `backend/src/ahsp/price-resolution/ahsp-resource-price-resolution.kernel.ts` (merged on `main`; this revision authorizes one additive field on `BasicPriceCandidate` plus a freshness branch inside the kernel — Option C, F.4, locked by PM Plan Review Decisions §3) |
| Basic Price eligibility | `BasicPriceService.findByResource()`, `BasicPriceService.findOneForWorkspace()` | `backend/src/basic-price/basic-price.service.ts` |
| Module wiring precedent | `ProjectController` already combines `@UseGuards(ProjectAccessGuard, PermissionsGuard)` with `@Permissions('AHSP_VIEW')` on `GET :projectId/ahsp-snapshot` — the *exact* shape Phase 2's GET endpoint needs | `backend/src/project/project.controller.ts:185-190` |
| Idempotent-create pattern | `ProjectService.create()` (P2002 → `ConflictException`) and `IntakeEnqueueService.findExistingJob()` / `isUniqueConstraintError()` (pre-check + P2002 fallback) | `backend/src/project/project.service.ts:129-146`, `backend/src/reality-intake/intake-enqueue.service.ts:116-144` |
| Restrictive-FK migration style | `intelligence_evidence` table — `ON DELETE RESTRICT ON UPDATE CASCADE` on every tenant/actor FK | `backend/prisma/migrations/20260711031507_p8a_1b_append_only_intelligence_evidence/migration.sql` |

### A.4 Conflicts or missing capabilities found

Findings from the original planning pass, now carried forward with their PM Plan Review
Decisions verdict. Nothing here is silently rewritten — superseded framing is marked, not
deleted.

1. **`PermissionsGuard` resolves `workspaceId` independently of `ProjectAccessGuard`.**
   `PermissionsGuard` reads `x-workspace-id` header / query / route param
   (`permissions.guard.ts:40-47`) and does **not** consult `request.projectAccess` (the
   DB-verified context `ProjectAccessGuard` attaches). This is pre-existing repository
   behavior, already used today by `GET :projectId/ahsp-snapshot` and every other
   `ProjectAccessGuard + PermissionsGuard` route in `ProjectController` — Phase 2 does not
   invent it. It means a caller could send an `x-workspace-id` header pointing at a
   *different* workspace than the project's real workspace and still pass the permission
   check there, while `ProjectAccessGuard` independently and correctly verifies real
   project membership/assignment.
   **STATUS: RESOLVED — SECURITY BLOCKER, LOCKED (PM Plan Review Decisions §9).** The
   original draft's recommendation (service-layer scoping only, treated as a non-blocking
   risk) is superseded: PM ruled that service-layer scoping alone is insufficient and
   authorized a bounded fix inside `PermissionsGuard` itself. Full design in E.3; this is
   now a required in-scope change (D, K), not a residual risk.

2. **The Phase 1 kernel does not export its unit-compatibility predicate**, and the Phase 2
   gate's "expired-only → `NEEDS_REVIEW`" rule (gate §8.8, addendum §3) cannot be
   implemented correctly without it.
   **STATUS: RESOLVED — Option C locked (PM Plan Review Decisions §3).** Neither of the
   original draft's two options (export the predicate; duplicate the alias set) was
   chosen — PM rejected both explicitly. Instead the kernel's own input contract gains one
   optional `freshnessStatus` field, and the kernel evaluates freshness internally. Full
   design in F.3/F.4.

3. **`BasicPrice` has no `unit` column.** The Phase 1 kernel's `BasicPriceCandidate.unit`
   field assumes a price can carry its own unit independent of the resolved
   `ResourceCatalog.baseUnit`. In the real schema, a price's unit is only ever the
   `baseUnit` of its related `ResourceCatalog` row, and `BasicPriceService.findByResource(resourceId)`
   is already scoped to one catalog row — so every real candidate necessarily shares one
   unit.
   **STATUS: ACCEPTED as repository reality (PM Plan Review Decisions §8).** A wrong-unit
   Basic Price for an otherwise-correct catalog cannot be constructed as a truthful E2E
   fixture, and none will be manufactured to satisfy a checklist. Kernel regression tests
   remain the authoritative proof; Phase 2 service tests may prove forwarding/fail-closed
   behavior with mocks. Consequence for the test matrix: see J.3.

4. **No `ResourceCatalog` service exists anywhere in `backend/src`.** Candidate loading for
   Phase 2 must be a new direct Prisma query inside the new service (there is nothing to
   "reuse" here the way `BasicPriceService` is reused). Query shape specified in F.2.
   **STATUS: unchanged by this revision** — no PM Plan Review Decision addressed this
   directly; the plan's original design (F.2) stands.

5. Guard/permission wiring for a brand-new project-scoped module is otherwise fully
   precedented (`ProjectController` pattern in A.3) — no conflict there. **STATUS:
   unchanged**, and now additionally exercised by the new `PermissionsGuard` branch from
   finding 1's resolution.

---

## B. Schema design

### B.1 New enums

```prisma
enum ProjectAhspResolutionStatus {
  RESOLVED
  UNRESOLVED
  NEEDS_REVIEW
}

enum ProjectAhspSelectionMode {
  AUTO_SELECTED
  USER_OVERRIDDEN
}
```

`USER_OVERRIDDEN` is reserved by the locked blueprint and the Phase 2 gate; no Phase 2
endpoint writes it. Reused existing enums (no new enum needed for these): `PriceSourceOrigin`,
`PriceFreshnessStatus`.

### B.2 `ProjectAhspOccurrence`

```prisma
model ProjectAhspOccurrence {
  id                 String   @id @default(uuid()) @db.Uuid
  workspaceId        String   @db.Uuid
  projectId          String   @db.Uuid
  ahspVersionId      String   @db.Uuid
  idempotencyKey     String
  createdByAccountId String?  @db.Uuid
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  workspace   Workspace                       @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  project     Project                         @relation(fields: [projectId], references: [id], onDelete: Cascade)
  ahspVersion AHSPVersion                     @relation(fields: [ahspVersionId], references: [id], onDelete: Restrict)
  resolutions ProjectAhspResourceResolution[]

  @@unique([projectId, idempotencyKey])
  @@index([workspaceId])
  @@index([projectId])
  @@index([ahspVersionId])
  @@map("project_ahsp_occurrences")
}
```

Notes:

- No `ahspResourceId` on the occurrence itself — the gate's §6.2 required-field list does
  not include it. The occurrence is the *container*; the per-resource result lives on
  `ProjectAhspResourceResolution`. Phase 2's single POST endpoint always creates exactly
  one occurrence + one resolution per call; the plural `resolutions` relation anticipates a
  future multi-resource occurrence without requiring one now.
- `createdByAccountId` is a bare UUID column, no FK — matches gate §6.2 exactly
  ("FK is not required in this slice").
- `organizationId` is deliberately **not** duplicated onto this table — addendum §6:
  "the project remains the source of truth for organization ownership."
- Deletion behavior matches gate §6.2: project/workspace deletion cascades; AHSP version
  deletion is restricted while referenced.

### B.3 `ProjectAhspResourceResolution`

```prisma
model ProjectAhspResourceResolution {
  id     String @id @default(uuid()) @db.Uuid
  occurrenceId String @db.Uuid
  ahspResourceId String @db.Uuid

  // Raw AHSP evidence, copied for project-context traceability. Master AHSPResource is unchanged.
  rawResourceRef  String
  rawResourceType String
  coefficient     Decimal @db.Decimal(18, 6)
  ahspUnit        String

  // Resolution outcome
  resourceCatalogId    String?                      @db.Uuid
  selectedBasicPriceId String?                       @db.Uuid
  status               ProjectAhspResolutionStatus
  selectionMode        ProjectAhspSelectionMode?

  // Adaptation trace — populated only when status = RESOLVED
  canonicalUnit           String?
  sourcePriceValue        Decimal?              @db.Decimal(18, 2)
  sourcePriceUnit         String?
  adaptedPriceValue       Decimal?              @db.Decimal(18, 2)
  conversionFactor        Decimal?              @db.Decimal(18, 6)
  selectedSourceOrigin    PriceSourceOrigin?
  selectedFreshnessStatus PriceFreshnessStatus?
  selectedEffectiveDate   DateTime?

  // Audit trace — always populated
  resolutionMethod String
  reasonCodes      String[]
  explanation      String   @db.Text
  policyVersion    String

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  occurrence         ProjectAhspOccurrence @relation(fields: [occurrenceId], references: [id], onDelete: Cascade)
  ahspResource       AHSPResource          @relation(fields: [ahspResourceId], references: [id], onDelete: Restrict)
  resourceCatalog    ResourceCatalog?      @relation(fields: [resourceCatalogId], references: [id], onDelete: Restrict)
  selectedBasicPrice BasicPrice?           @relation(fields: [selectedBasicPriceId], references: [id], onDelete: Restrict)

  @@unique([occurrenceId, ahspResourceId])
  @@index([occurrenceId])
  @@index([ahspResourceId])
  @@index([resourceCatalogId])
  @@index([selectedBasicPriceId])
  @@index([status])
  @@map("project_ahsp_resource_resolutions")
}
```

**Correction (PM Plan Review Decisions §7):** the earlier draft of this schema block spelled
this field `resourceCatalodId` and described the misspelling as a deliberate "typo guard."
PM rejected that framing outright — it was a real typo, and canonical plan examples must
compile exactly as written. The block above is corrected; `resourceCatalogId` is the field
name everywhere in this document and must be typed correctly at implementation time.

Field-to-gate mapping (gate §6.3 required-field list → this schema):

| Gate requirement | Field |
|---|---|
| raw AHSP resource reference | `rawResourceRef` |
| raw AHSP resource type | `rawResourceType` |
| copied AHSP coefficient | `coefficient` |
| copied AHSP unit | `ahspUnit` |
| nullable `resourceCatalogId` | `resourceCatalogId` |
| nullable `selectedBasicPriceId` | `selectedBasicPriceId` |
| resolution status enum | `status` |
| nullable selection mode enum | `selectionMode` |
| nullable canonical unit | `canonicalUnit` |
| nullable source price value/unit | `sourcePriceValue`, `sourcePriceUnit` |
| nullable adapted price value | `adaptedPriceValue` |
| nullable conversion factor | `conversionFactor` |
| nullable selected source origin | `selectedSourceOrigin` (reused `PriceSourceOrigin`) |
| nullable selected freshness status | `selectedFreshnessStatus` (reused `PriceFreshnessStatus`) |
| nullable selected effective date | `selectedEffectiveDate` |
| resolution method string | `resolutionMethod` |
| reason-code string array | `reasonCodes` |
| Indonesian explanation | `explanation` |
| policy version string | `policyVersion` |

**Locked (PM Plan Review Decisions §7):** `canonicalUnit` remains a plain nullable `String`
for Phase 2. No single-member enum is created. The only value the bounded proof ever writes
is `"PERSON_DAY"`.

Decimal precision note: the kernel returns `sourcePriceValue`/`adaptedPriceValue` as exact
decimal **strings** to avoid float loss. Prisma `Decimal` columns accept a string directly
(via `new Prisma.Decimal(stringValue)` or passing the string literal in `data`) without
routing through a JS `number`, so storing them as `Decimal` here does not reintroduce the
float-loss risk the kernel guards against — this must be implemented as string-in,
never `Number(stringValue)`.

### B.4 Relation arrays required on existing models

Purely additive — no scalar column changes:

```prisma
// Workspace
projectAhspOccurrences ProjectAhspOccurrence[]

// Project
ahspOccurrences ProjectAhspOccurrence[]

// AHSPVersion
projectAhspOccurrences ProjectAhspOccurrence[]

// AHSPResource
resourceResolutions ProjectAhspResourceResolution[]

// ResourceCatalog
ahspResourceResolutions ProjectAhspResourceResolution[]

// BasicPrice
ahspResourceResolutions ProjectAhspResourceResolution[]
```

### B.5 Confirmation of migration boundary

The migration this plan authorizes creates **only**: two enums
(`ProjectAhspResolutionStatus`, `ProjectAhspSelectionMode`), two tables
(`project_ahsp_occurrences`, `project_ahsp_resource_resolutions`), their FKs, unique
constraints, and indexes, plus the six relation-array declarations in B.4 (which are
Prisma-schema-only constructs with **zero** SQL/column effect on the referenced tables —
`prisma migrate diff` against this design produces no `ALTER TABLE ... ADD COLUMN` on
`AHSP`, `AHSPVersion`, `AHSPResource`, `AHSPSnapshot`, `AHSPSnapshotResource`,
`ResourceCatalog`, `BasicPrice`, `BoqItem`, or `RabDocument`). No scalar column is added,
altered, or dropped on any existing master AHSP, ResourceCatalog, BasicPrice, BOQ, RAB, or
snapshot table.

---

## C. Migration strategy

- **Proposed migration directory name:** `<timestamp>_bp_ahsp_phase2_project_occurrence_persistence`,
  where `<timestamp>` is whatever `prisma migrate dev --create-only` assigns at actual
  implementation time (existing convention: `YYYYMMDDHHMMSS_snake_case_description`, e.g.
  `20260711031507_p8a_1b_append_only_intelligence_evidence`). No timestamp is fabricated in
  this plan.
- **Proposed SQL structure** (shape, following the `intelligence_evidence` migration
  precedent exactly — restrictive FKs, `ON UPDATE CASCADE`):

```sql
-- CreateEnum
CREATE TYPE "ProjectAhspResolutionStatus" AS ENUM ('RESOLVED', 'UNRESOLVED', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "ProjectAhspSelectionMode" AS ENUM ('AUTO_SELECTED', 'USER_OVERRIDDEN');

-- CreateTable
CREATE TABLE "project_ahsp_occurrences" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "ahspVersionId" UUID NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdByAccountId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "project_ahsp_occurrences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_ahsp_resource_resolutions" (
    "id" UUID NOT NULL,
    "occurrenceId" UUID NOT NULL,
    "ahspResourceId" UUID NOT NULL,
    "rawResourceRef" TEXT NOT NULL,
    "rawResourceType" TEXT NOT NULL,
    "coefficient" DECIMAL(18,6) NOT NULL,
    "ahspUnit" TEXT NOT NULL,
    "resourceCatalogId" UUID,
    "selectedBasicPriceId" UUID,
    "status" "ProjectAhspResolutionStatus" NOT NULL,
    "selectionMode" "ProjectAhspSelectionMode",
    "canonicalUnit" TEXT,
    "sourcePriceValue" DECIMAL(18,2),
    "sourcePriceUnit" TEXT,
    "adaptedPriceValue" DECIMAL(18,2),
    "conversionFactor" DECIMAL(18,6),
    "selectedSourceOrigin" "PriceSourceOrigin",
    "selectedFreshnessStatus" "PriceFreshnessStatus",
    "selectedEffectiveDate" TIMESTAMP(3),
    "resolutionMethod" TEXT NOT NULL,
    "reasonCodes" TEXT[],
    "explanation" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "project_ahsp_resource_resolutions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex + unique constraints
CREATE UNIQUE INDEX "project_ahsp_occurrences_projectId_idempotencyKey_key" ON "project_ahsp_occurrences"("projectId", "idempotencyKey");
CREATE INDEX "project_ahsp_occurrences_workspaceId_idx" ON "project_ahsp_occurrences"("workspaceId");
CREATE INDEX "project_ahsp_occurrences_projectId_idx" ON "project_ahsp_occurrences"("projectId");
CREATE INDEX "project_ahsp_occurrences_ahspVersionId_idx" ON "project_ahsp_occurrences"("ahspVersionId");

CREATE UNIQUE INDEX "project_ahsp_resource_resolutions_occurrenceId_ahspResourceId_key" ON "project_ahsp_resource_resolutions"("occurrenceId", "ahspResourceId");
CREATE INDEX "project_ahsp_resource_resolutions_occurrenceId_idx" ON "project_ahsp_resource_resolutions"("occurrenceId");
CREATE INDEX "project_ahsp_resource_resolutions_ahspResourceId_idx" ON "project_ahsp_resource_resolutions"("ahspResourceId");
CREATE INDEX "project_ahsp_resource_resolutions_resourceCatalogId_idx" ON "project_ahsp_resource_resolutions"("resourceCatalogId");
CREATE INDEX "project_ahsp_resource_resolutions_selectedBasicPriceId_idx" ON "project_ahsp_resource_resolutions"("selectedBasicPriceId");
CREATE INDEX "project_ahsp_resource_resolutions_status_idx" ON "project_ahsp_resource_resolutions"("status");

-- AddForeignKey (occurrence)
ALTER TABLE "project_ahsp_occurrences" ADD CONSTRAINT "project_ahsp_occurrences_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_ahsp_occurrences" ADD CONSTRAINT "project_ahsp_occurrences_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_ahsp_occurrences" ADD CONSTRAINT "project_ahsp_occurrences_ahspVersionId_fkey" FOREIGN KEY ("ahspVersionId") REFERENCES "ahsp_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey (resolution)
ALTER TABLE "project_ahsp_resource_resolutions" ADD CONSTRAINT "..._occurrenceId_fkey" FOREIGN KEY ("occurrenceId") REFERENCES "project_ahsp_occurrences"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_ahsp_resource_resolutions" ADD CONSTRAINT "..._ahspResourceId_fkey" FOREIGN KEY ("ahspResourceId") REFERENCES "ahsp_resources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "project_ahsp_resource_resolutions" ADD CONSTRAINT "..._resourceCatalogId_fkey" FOREIGN KEY ("resourceCatalogId") REFERENCES "resource_catalogs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "project_ahsp_resource_resolutions" ADD CONSTRAINT "..._selectedBasicPriceId_fkey" FOREIGN KEY ("selectedBasicPriceId") REFERENCES "basic_prices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

(Constraint names abbreviated with `...` above for readability; Prisma will generate the
full deterministic names at `migrate dev` time — they must not be hand-shortened in the
real migration file.)

- **Additive-only strategy:** every statement above is `CREATE TYPE`, `CREATE TABLE`,
  `CREATE INDEX`/`CREATE UNIQUE INDEX`, or `ALTER TABLE ... ADD CONSTRAINT` on the two new
  tables. Nothing alters an existing table's columns.
- **No `prisma db push`.** Migration must be generated via `prisma migrate dev --create-only`
  against `.env.test` (`simprok_test`), reviewed, then applied via `prisma migrate deploy`
  or `migrate dev` — never `db push`.
- **No `prisma migrate reset`, no `--force-reset`, no equivalent destructive command.**
- **No backfill.** Both tables start empty; no existing row in any table is touched.
- **Guarded `simprok_test` lifecycle:** all migration application and validation for this
  slice must go through `scripts/test-database-guard.ts` (`npm run verify:db:test` —
  asserts `NODE_ENV=test`, `DATABASE_URL` database name is exactly `simprok_test`, never
  `simprok_db`) and `scripts/run-e2e-safe.ts` (`npm run test:e2e:safe` — resets/seeds only
  under an explicit `SIMPROK_E2E_DESTRUCTIVE_CAPABILITY=RESET_SIMPROK_TEST_DATABASE` flag,
  captures a table fingerprint before the run, and requires `RESIDUAL_RESULT: PASS` — zero
  net row-count/digest drift — after the run). `simprok_db` is never targeted by any command
  in this slice.

---

## D. Runtime architecture

**Scope correction (PM Plan Review Decisions §10):** the original draft scoped this section
to the new `project-ahsp` module only, with the Phase 1 kernel change left "conditional"
(K). Since Option C (F.4) and the `PermissionsGuard` security fix (E.3) are both now locked,
required changes, this revision adds the Phase 1 kernel, its spec, `PermissionsGuard`, and
a new `PermissionsGuard` spec to the proposed implementation scope explicitly — none of
these are optional or conditional in this revision.

Proposed new bounded module, matching the gate's recommended path and the "Allowed
Production Scope" list, plus the two locked cross-cutting changes:

```text
backend/src/project-ahsp/
  project-ahsp.module.ts
  project-ahsp.controller.ts
  project-ahsp.service.ts
  project-ahsp.service.spec.ts
  project-ahsp.controller.spec.ts        (optional — see D.1)
  dto/
    create-project-ahsp-occurrence.dto.ts

backend/src/ahsp/price-resolution/
  ahsp-resource-price-resolution.kernel.ts       (modified — Option C, F.4)
  ahsp-resource-price-resolution.kernel.spec.ts  (modified — additive regression tests, F.4)

backend/src/auth/guards/
  permissions.guard.ts       (modified — bounded security fix, E.3)
  permissions.guard.spec.ts  (new — no such file exists today; confirmed absent from
                               `backend/src/auth/guards/` by repository search)
```

Plus:

```text
backend/test/acceptance/project-ahsp-occurrence.e2e-spec.ts   (new)
backend/src/app.module.ts                                     (modified — register ProjectAhspModule)
backend/prisma/schema.prisma                                  (modified — see B)
backend/prisma/migrations/<timestamp>_bp_ahsp_phase2_project_occurrence_persistence/migration.sql (new)
```

### D.1 File-by-file

- **`project-ahsp.module.ts`** — imports `PrismaModule`, `BasicPriceModule` (to inject the
  existing `BasicPriceService` rather than re-instantiate query logic); declares
  `ProjectAhspController`; provides `ProjectAhspService`. No exports needed outside this
  module in Phase 2.
- **`project-ahsp.controller.ts`** — `@Controller('projects/:projectId/ahsp-occurrences')`.
  Two routes, matching D.2/E exactly.
- **`project-ahsp.service.ts`** — the orchestration described fully in F and G. Depends on
  `PrismaService` and `BasicPriceService`.
- **`dto/create-project-ahsp-occurrence.dto.ts`** — `class-validator`-decorated DTO:
  `ahspVersionId: string` (`@IsUUID()`), `ahspResourceId: string` (`@IsUUID()`),
  `idempotencyKey: string` (`@IsString()`, `@IsNotEmpty()`, bounded `@MaxLength()` —
  exact bound to be set consistent with existing DTO conventions, e.g. 200 chars).
- **Serialization/response shape:** no dedicated serializer class exists elsewhere in this
  codebase for read endpoints (`BasicPriceController`, `AhspController` both return raw
  Prisma query results). Recommend the same convention: the service returns the persisted
  `ProjectAhspOccurrence` row with its `resolutions` included
  (`prisma.projectAhspOccurrence.findUnique({ ..., include: { resolutions: true } })`),
  and the controller returns that object directly. No manual field remapping — avoids a
  redundant intermediate model for a bounded slice.
- **Unit tests:** `project-ahsp.service.spec.ts`, mocking `PrismaService` and
  `BasicPriceService` (same style as `basic-price.service.spec.ts` and
  `ahsp-version.service.spec.ts`), covering the full matrix in J.1.
- **Controller spec:** optional; `AhspController` has one (`ahsp.controller.spec.ts`),
  `BasicPriceController` does not. Recommend adding a thin one only if guard/DTO wiring
  needs isolated proof beyond what the e2e spec already covers — default to relying on the
  e2e spec for controller-level proof, consistent with `BasicPriceController`'s precedent,
  to avoid duplicate low-value tests.
- **E2E tests:** `project-ahsp-occurrence.e2e-spec.ts`, self-provisioning its own
  organizations/workspaces/accounts/roles/AHSP fixtures inline (the `basic-price.e2e-spec.ts`
  convention — a tagged, fully self-cleaning fixture set), because Phase 2 needs a specific,
  controlled `AHSPVersion` → `AHSPResource` → `ResourceCatalog` → `BasicPrice` chain that the
  shared acceptance seed does not guarantee. Full matrix in J.2.
- **`ahsp-resource-price-resolution.kernel.ts` / `.kernel.spec.ts`** — additive-only change:
  one optional field on the exported `BasicPriceCandidate` interface and one freshness
  branch inside `resolveAhspResourcePrice()`'s existing Step 3 logic. Every existing Phase 1
  test must still pass unmodified. Full design and required regression tests in F.4.
- **`permissions.guard.ts` / `permissions.guard.spec.ts`** — one bounded conditional branch
  inside `PermissionsGuard.canActivate()`; no new guard class, no new decorator, no change
  to `ProjectAccessPolicyService`. `permissions.guard.spec.ts` is a new file — no spec
  currently exists for this guard. Full design and required tests in E.3/J.2a.

### D.2 Endpoints (unchanged from gate)

```http
POST /projects/:projectId/ahsp-occurrences
GET  /projects/:projectId/ahsp-occurrences/:occurrenceId
```

---

## E. Security and tenant flow

### E.1 Guard stack (identical shape to existing `ProjectController` project-scoped routes)

```ts
@UseGuards(JwtAuthGuard, ProjectAccessGuard, PermissionsGuard)

@Post()
@Permissions(PERMISSIONS.AHSP_MANAGE)
create(...) { ... }

@Get(':occurrenceId')
@Permissions(PERMISSIONS.AHSP_VIEW)
findOne(...) { ... }
```

`AHSP_MANAGE` and `AHSP_VIEW` already exist in the permission catalog
(`common/constants/permissions.ts`) and are already seeded to the `DIRECTOR` role
(`prisma/seed-rbac-permissions.ts`) — no new permission code, no seed change required for
Phase 2 itself (test fixtures create their own scoped roles, as `basic-price.e2e-spec.ts`
does).

### E.2 `ProjectAccessPolicyService` remains the single predicate

No new access-resolution logic is introduced. `ProjectAccessGuard` continues to call
`ProjectAccessPolicyService.resolveProjectAccess(accountId, projectId)` unmodified and
attaches `request.projectAccess` (`{ projectId, workspaceId, ... }`, DB-verified).

### E.3 `PermissionsGuard` security fix — LOCKED (PM Plan Review Decisions §9)

The seam identified in A.4 finding 1 is not merely a service-layer scoping convention to
work around. PM Plan Review Decisions §9 rules that **service query scoping alone is
insufficient**: "a caller could otherwise present permission from a different workspace
while targeting a project they are assigned to." PM authorizes and requires one bounded
change to `PermissionsGuard` itself:

- When `request.projectAccess.workspaceId` is present — true for every route in this
  module, since the guard order is `JwtAuthGuard, ProjectAccessGuard, PermissionsGuard` and
  `ProjectAccessGuard` always runs first and attaches it — that value becomes the
  **authoritative** workspace for the permission/membership/role lookup inside
  `PermissionsGuard.canActivate()`. The lookup that currently reads
  `membership.membershipRoles → role.rolePermissions → permission.code`
  (`permissions.guard.ts:51-101`) is evaluated against `request.projectAccess.workspaceId`,
  not against whatever the client supplied.
- If the request **also** explicitly supplies a workspace context (header/query/param) and
  it differs from `request.projectAccess.workspaceId`, `PermissionsGuard` must reject with
  `403` — a mismatch is an authorization fact ("you are presenting credentials for a
  workspace you are not operating in"), not a malformed request, so it is not `400`.
- If the request is on a project-scoped route and supplies **no** explicit workspace
  context at all, this plan's default is to still require it exactly as today (see the
  "plan-level default" note below) — the bounded fix adds an authoritative-source-and-
  mismatch-rejection check; it does not relax the existing header-required behavior, to
  keep the change to the single narrow branch PM authorized and to avoid any regression to
  routes/tests that already always supply the header.
- Non-project-scoped routes (no `request.projectAccess` attached — `ProjectAccessGuard` is
  not in that route's guard chain) retain their existing behavior exactly: workspace
  context still comes from `x-workspace-id` header/query/param, unchanged. This is a
  narrow, additive conditional branch inside `PermissionsGuard`, not a rewrite.
- No second project-access predicate and no new guard class are introduced —
  `ProjectAccessPolicyService` remains the single project-access predicate (E.2, unchanged),
  and `PermissionsGuard` gains one conditional branch, not a new class.

**Plan-level default flagged for confirmation:** PM Plan Review Decisions §9 does not spell
out whether the `x-workspace-id` header becomes optional on project-scoped routes once
`request.projectAccess.workspaceId` is authoritative. This plan chooses the more
conservative reading — keep the header required everywhere, unchanged — because it
satisfies all five required tests in §9 without touching the "missing header → 400"
behavior any existing route or e2e spec (all of which always supply the header today) relies
on. If PM/Architect intended the header to become optional on project routes, that is a
one-line change to this section before implementation.

This closes the seam completely: a caller can no longer present a valid permission from a
workspace they are not targeting to authorize an operation against a project in a different
workspace. `ProjectAhspService` continues to read `workspaceId` from
`request.projectAccess.workspaceId` for query/persistence scoping (unchanged design intent
from the first draft) — after this guard fix, that value and any *matching* `x-workspace-id`
header are guaranteed consistent by construction; a mismatched header never reaches the
service at all, because the guard rejects it first. The account ID for `createdByAccountId`
comes from `request.user.id` (populated by `JwtAuthGuard`/JWT strategy), also never from the
request body.

### E.4 Query scoping

- POST: creates are scoped by `projectId` (route param, already validated to exist and be
  accessible by `ProjectAccessGuard`) + `workspaceId` (`request.projectAccess.workspaceId`).
- GET: `prisma.projectAhspOccurrence.findFirst({ where: { id: occurrenceId, projectId,
  workspaceId }, include: { resolutions: true } })` — if no row matches all three, throw
  `NotFoundException` (mirrors `BasicPriceService.findOneForWorkspace()`'s pattern exactly:
  a wrong-tenant or wrong-project occurrence ID returns 404, never leaking existence).

### E.5 Expected status matrix

| Condition | Status | Mechanism |
|---|---|---|
| No/invalid JWT | 401 | `JwtAuthGuard` (passport-jwt default) |
| Project not found / membership not found | 404 | `ProjectAccessGuard` → `ProjectAccessPolicyService` |
| Membership exists, no active assignment to project | 403 | `ProjectAccessGuard` ("Project assignment required") |
| Missing `x-workspace-id` header | 400 | `PermissionsGuard` (existing behavior — not part of the gate's 401/403/404 list but a real, pre-existing status this route inherits; unchanged by E.3's fix per this plan's conservative default) |
| `x-workspace-id` header supplied and differs from `request.projectAccess.workspaceId` | 403 | `PermissionsGuard` — **new**, E.3 security fix (PM Plan Review Decisions §9) |
| `x-workspace-id` workspace has no active membership | 403 | `PermissionsGuard` |
| Missing `AHSP_MANAGE` (POST) / `AHSP_VIEW` (GET) | 403 | `PermissionsGuard`, evaluated against `request.projectAccess.workspaceId` (E.3) |
| Permission held only in a different workspace than the project's real workspace | 403 | `PermissionsGuard` — **new**, E.3 security fix closes this (previously would have incorrectly passed) |
| Occurrence belongs to another project/workspace | 404 | service-level scoped query (E.4) — no existence leak |
| Idempotency key reused with identical payload | 200/201, same IDs | service (G) |
| Idempotency key reused with different payload | 409 | service (G) |

---

## F. Resolution flow

### F.1 Overview (service method, e.g. `ProjectAhspService.createOccurrence()`)

1. Validate `ahspVersionId` exists and is visible: workspace-owned version must have
   `ahspVersion.workspaceId === request.projectAccess.workspaceId`; a global version
   (`workspaceId === null`) is always visible. No workspace/global preference is invented —
   both remain independently eligible inputs to the kernel's multi-candidate rule (F.4).
2. Validate `ahspResourceId` exists and belongs to that `ahspVersionId`
   (`ahspResource.ahspVersionId === ahspVersionId`); otherwise reject before any resolution
   attempt (test matrix J.1.14).
3. Idempotency pre-check (G).
4. Load `ResourceCatalog` candidates (F.2).
5. Load `BasicPrice` candidates via `BasicPriceService.findByResource()` and map them 1:1
   into the kernel's (Option C) candidate shape, including a `freshnessStatus` passthrough
   (F.3). The service applies **no** freshness or unit pre-filtering itself.
6. Call `resolveAhspResourcePrice()` (Phase 1 kernel) with the assembled input — the kernel
   now evaluates the Phase 2 freshness boundary internally (F.4, Option C).
7. If the kernel result is `RESOLVED`, revalidate `selectedBasicPriceId` via
   `BasicPriceService.findOneForWorkspace()` (F.5).
8. Persist occurrence + resolution atomically (G).
9. Return the persisted, re-read row (not the in-memory kernel result) — so the API
   response is always exactly what is in the database.

### F.2 ResourceCatalog candidate-loading strategy (new query — no existing service to reuse)

```ts
this.prisma.resourceCatalog.findMany({
  where: {
    name: { equals: rawResourceRef.trim(), mode: 'insensitive' },
    OR: [{ workspaceId }, { workspaceId: null }],
  },
});
```

Deliberately **not** filtered by `type` here — the kernel itself distinguishes
"no name match" (`NO_CATALOG_CANDIDATE`) from "name matches, type doesn't"
(`RESOURCE_TYPE_MISMATCH`), and pre-filtering by type at the query layer would silently
collapse that distinction and violate "the only authorized resolver is the kernel." No
fuzzy/similarity matching, no alias table, no AI — a single case-insensitive, trimmed
equality check, tenant-or-global scoped.

Known bounded limitation (flagged, not silently absorbed): SQL `ILIKE`-style equality does
not collapse *internal* repeated whitespace the way the kernel's own
`normalizeResourceName()` does. Phase 1's only proof name (`"Pekerja"`) has no internal
whitespace, so this does not affect the bounded proof, but a resource named with doubled
internal spaces would fail the DB-level candidate query even though the kernel would
consider it equivalent. Accepted as out of bounded scope; not fixed here (fixing it would
require either an in-memory superset scan or a generated/normalized column on
`ResourceCatalog`, and the latter is a forbidden scalar change to that table in this phase).

### F.3 Basic Price candidate assembly

```ts
const rows = await this.basicPriceService.findByResource(resolvedCatalogId, workspaceId);
// rows already satisfy the public eligibility predicate (status=PUBLISHED AND
// verificationStatus=PUBLISHED, tenant-or-global) — this predicate is reused, not duplicated.
```

Each row is mapped to the kernel's (Option C) `BasicPriceCandidate` shape, now including the
optional `freshnessStatus` passthrough field authorized by PM Plan Review Decisions §3:

```ts
{
  id: row.id,
  resourceId: row.resourceId,
  value: row.value.toString(),          // Prisma Decimal → exact string, never Number(row.value)
  sourceOrigin: row.sourceOrigin,
  unit: row.resource.baseUnit,          // see A.4 finding 3 — BasicPrice has no independent unit
  freshnessStatus: row.freshnessStatus, // 'CURRENT' | 'EXPIRING' | 'EXPIRED' — raw passthrough, no interpretation here
}
```

The service performs **no** unit-compatibility pre-check and **no** freshness-based
filtering before this call — every `findByResource()` row is mapped 1:1 into a candidate and
handed to the kernel exactly as returned. All freshness *and* unit decisions are made inside
the kernel, which remains the single resolver.

### F.4 Phase 2 freshness boundary — Option C, LOCKED (PM Plan Review Decisions §3)

This replaces the first draft's F.4 in full. That draft proposed two options — exporting the
kernel's internal unit predicate for service-side filtering (option a), or duplicating the
bounded alias set inside the service (option b) — and left the choice open (L.1). PM
rejected both explicitly ("Option (a)... is rejected. Option (b)... is forbidden.") and
locked a third design instead: extend the kernel's own input contract with one optional
field, so all freshness *and* unit logic stays inside the single resolver.

Gate §8.8 / addendum §3 requirement, unchanged: `CURRENT` and `EXPIRING` may auto-resolve;
`EXPIRED` must not; if only expired-but-otherwise-compatible candidates exist, persist
`NEEDS_REVIEW` with a distinct reason. "Compatible" means matching `resourceId` **and**
unit — a wrong-unit `EXPIRED` candidate must not create an expired-only review outcome;
unit failure stays authoritative over freshness (PM Plan Review Decisions §3, final bullet).

**Locked design:**

1. Add one optional field to the kernel's exported `BasicPriceCandidate` interface:

   ```ts
   export interface BasicPriceCandidate {
     readonly id: string;
     readonly resourceId: string;
     readonly value: string;
     readonly sourceOrigin: string;
     readonly unit: string;
     readonly freshnessStatus?: 'CURRENT' | 'EXPIRING' | 'EXPIRED';
   }
   ```

2. Kernel behavior, inside `resolveAhspResourcePrice()`'s existing Step 3 (unchanged
   entry point, unchanged purity — still no I/O, still deterministic):
   - A candidate with `freshnessStatus` **omitted** is treated as selectable — this
     preserves every existing Phase 1 test and caller unchanged (backward compatible by
     construction).
   - Among unit-compatible candidates (existing Step 3b logic, unchanged), split by
     freshness: `CURRENT`/`EXPIRING`/omitted → **active**; `EXPIRED` → **inactive**.
   - Zero active, one-or-more inactive → `NEEDS_REVIEW`, `selectedBasicPriceId` unset, new
     reason code `ONLY_EXPIRED_BASIC_PRICE_CANDIDATES` (appended to the existing reason-code
     union — does not replace `NO_BASIC_PRICE_CANDIDATE`, `MULTIPLE_BASIC_PRICE_CANDIDATES`,
     etc., which continue to mean what they already mean).
   - Exactly one active candidate → that candidate resolves, exactly as today, regardless of
     how many `EXPIRED` candidates also exist alongside it — expired candidates present next
     to one active one never block or alter selection.
   - More than one active candidate → `NEEDS_REVIEW` via the existing
     `MULTIPLE_BASIC_PRICE_CANDIDATES` path, unchanged.
   - Zero unit-compatible candidates at all (active or expired) → existing
     `UNRESOLVED`/`BASIC_PRICE_UNIT_NOT_SUPPORTED`/`NO_BASIC_PRICE_CANDIDATE` path,
     unchanged.

3. The service's only responsibility (F.3) is to transport `freshnessStatus` unmodified from
   each `findByResource()` row into the candidate handed to the kernel. The service performs
   **no** pre-filtering, **no** unit-alias duplication, and imports **no** predicate from the
   kernel — the kernel file's only change is the widened `BasicPriceCandidate` type and the
   freshness branch inside its existing Step 3 logic.

**Required kernel regression tests** (`ahsp-resource-price-resolution.kernel.spec.ts`,
additive to the existing Phase 1 suite — every existing Phase 1 test must still pass
unmodified, proving backward compatibility), matching PM Plan Review Decisions §3 exactly:

1. Candidates without `freshnessStatus` preserve Phase 1 behavior (re-run an existing Phase
   1 fixture unchanged; assert identical output).
2. Only `EXPIRED` compatible candidates → `NEEDS_REVIEW`, `reasonCodes` includes
   `ONLY_EXPIRED_BASIC_PRICE_CANDIDATES`, no `selectedBasicPriceId`.
3. One current (`CURRENT`/`EXPIRING`) plus one or more `EXPIRED` candidates for the same
   resource → the active candidate resolves normally (`RESOLVED`); the expired candidate(s)
   are excluded from the count that would otherwise trigger `MULTIPLE_BASIC_PRICE_CANDIDATES`.
4. Two active (`CURRENT`/`EXPIRING`) compatible candidates → `NEEDS_REVIEW` via the existing
   `MULTIPLE_BASIC_PRICE_CANDIDATES` path (proves Option C did not loosen the existing
   multi-candidate rule).
5. `EXPIRED` wrong-unit candidates retain existing unit-not-supported behavior — they do not
   create an expired-only review outcome.

Kernel scope discipline preserved: no fuzzy/semantic/alias/embedding/AI matching is added;
the only new logic is a freshness split on an already-unit-filtered candidate set, using
data the service transports verbatim from the database.

### F.5 Revalidation before persistence — LOCKED failure behavior (PM Plan Review Decisions §6)

`BasicPriceService.findOneForWorkspace(selectedBasicPriceId, workspaceId)` is called
immediately before the row is written (F.1 step 7), using the same eligibility predicate as
candidate loading (reused, not re-implemented — "not a second eligibility predicate; it
reuses the existing BasicPrice service," decision §6, verbatim).

The first draft proposed this outcome as a plan-level default needing confirmation. PM
accepted and locked it exactly. If `findOneForWorkspace()` throws `NotFoundException` (the
price became ineligible between candidate-load and persistence — e.g. withdrawn), the
service must fail closed and persist, verbatim:

- `status = UNRESOLVED`
- `selectedBasicPriceId = null`
- **no source/adapted price trace persisted as selected truth** — `sourcePriceValue`,
  `sourcePriceUnit`, `adaptedPriceValue`, `conversionFactor`, `canonicalUnit`,
  `selectionMode`, `selectedSourceOrigin`, `selectedFreshnessStatus`,
  `selectedEffectiveDate` all remain `null`, even though the kernel had momentarily computed
  a `RESOLVED` result before revalidation ran — a failed revalidation must not leave a
  half-`RESOLVED`-looking row
- `reasonCodes` includes `SELECTED_BASIC_PRICE_NO_LONGER_ELIGIBLE`
- `resolutionMethod = DETERMINISTIC_ATTEMPTED` (H, PM Plan Review Decisions §4 — this
  outcome did not survive revalidation, so it is not `EXACT_DETERMINISTIC`)
- **no unhandled 500** — the `NotFoundException` from `findOneForWorkspace()` is caught
  inside the service and converted into this persisted outcome, never propagated raw to the
  controller

### F.6 No tie-breaker, no second predicate

No ordering by nominal value, date, freshness, DB order, or UUID is added anywhere in F —
multi-candidate outcomes are always `NEEDS_REVIEW`, decided entirely inside the kernel (F.4,
Option C) once it receives the full unit-compatible candidate list the service transports
without pre-filtering.

---

## G. Transaction and idempotency

### G.1 DB constraint

`@@unique([projectId, idempotencyKey])` on `ProjectAhspOccurrence` (B.2) is the sole source
of truth for idempotency. No `boqItemId` anywhere in this schema or flow — idempotency key
is a **temporary client-supplied surrogate for retry-safety only**, not a canonical Work
Occurrence identity (P7C's eventual structural occurrence reference is a separate, later
concern per Project Memory §P7C — this plan does not anticipate or design toward it).

### G.2 Runtime algorithm (atomic, race-safe)

```ts
try {
  return await this.prisma.$transaction(async (tx) => {
    const occurrence = await tx.projectAhspOccurrence.create({
      data: { workspaceId, projectId, ahspVersionId, idempotencyKey, createdByAccountId },
    });
    const resolution = await tx.projectAhspResourceResolution.create({
      data: { occurrenceId: occurrence.id, ahspResourceId, ...resolutionFields },
    });
    return { occurrence, resolution };
  });
} catch (error) {
  if (isP2002(error, ['projectId', 'idempotencyKey'])) {
    const existing = await this.prisma.projectAhspOccurrence.findUniqueOrThrow({
      where: { projectId_idempotencyKey: { projectId, idempotencyKey } },
      include: { resolutions: true },
    });
    const existingResolution = existing.resolutions[0];
    const samePayload =
      existing.ahspVersionId === ahspVersionId &&
      existingResolution?.ahspResourceId === ahspResourceId;
    if (samePayload) return { occurrence: existing, resolution: existingResolution };
    throw new ConflictException('idempotencyKey already used with a different payload for this project');
  }
  throw error;
}
```

This is the same check-then-fallback shape as `ProjectService.create()`
(`project.service.ts:129-146`) and `IntakeEnqueueService`
(`intake-enqueue.service.ts:116-144`), adapted to the composite key. It is race-safe
because the Postgres unique constraint — not an application-level pre-check — is what
actually serializes concurrent identical-key inserts: the loser's `create()` throws P2002,
and its catch block re-reads and returns the winner's row. Net effect under concurrency:
exactly one occurrence + one resolution row are ever created for a given
`(projectId, idempotencyKey)`, and every concurrent caller with the same key+payload
receives the same IDs.

### G.3 Atomicity

Occurrence and resolution are created inside one `prisma.$transaction`, so a failure
partway through (e.g. resolution insert fails after occurrence insert succeeds) rolls back
both — there is never a persisted occurrence without its resolution, or vice versa.

### G.4 Same key, different payload

Detected by comparing the *existing* row's `ahspVersionId` + its resolution's
`ahspResourceId` against the incoming request. Any mismatch → `409 ConflictException`
(J.1.4, J.2 security matrix).

---

## H. Audit trace

Every persisted `ProjectAhspResourceResolution` row carries (see B.3 for exact fields):

- `status` (`ProjectAhspResolutionStatus`)
- `selectionMode` (nullable `ProjectAhspSelectionMode`, only `AUTO_SELECTED` ever written
  in Phase 2)
- `resolutionMethod` — **truthful per outcome, LOCKED (PM Plan Review Decisions §4)**:
  `"EXACT_DETERMINISTIC"` only when `status = RESOLVED`; `"DETERMINISTIC_ATTEMPTED"` when
  `status = UNRESOLVED` or `NEEDS_REVIEW`, including the F.5 revalidation-failure path. Never
  write `EXACT_DETERMINISTIC` for an unresolved or ambiguous result. No numeric confidence
  value is authorized anywhere in this schema (unchanged from the first draft).
- `reasonCodes` (`String[]`) — the kernel's own `ReasonCode` values (now including
  `ONLY_EXPIRED_BASIC_PRICE_CANDIDATES` from Option C, F.4), plus the one Phase-2-service
  reason code from F.5's locked revalidation-failure path
  (`SELECTED_BASIC_PRICE_NO_LONGER_ELIGIBLE`)
- `explanation` — the kernel's Indonesian explanation string when the kernel produced the
  result; a plain-language Indonesian explanation authored by the service for the
  Phase-2-only override paths (expired-only, revalidation-failure)
- `policyVersion` — a Phase-2-specific constant, proposed literal
  `"BP_AHSP_PHASE2_RESOLUTION_POLICY_V1"`, deliberately distinct from
  `P7C_PRODUCT_INTELLIGENCE_LAW_V1`/`P8A_CONSTITUTIONAL_AI_BOUNDARY_V1` (those govern the
  unrelated AI/EF boundary, not this deterministic resolution path) — exact literal
  pending PM/Architect confirmation, not load-bearing to the schema design
- `createdByAccountId` on the occurrence — from `request.user.id`, never the body
- `createdAt`/`updatedAt` on both tables
- `rawResourceRef`, `rawResourceType`, `coefficient`, `ahspUnit` — raw AHSP evidence, copied
  at persistence time; master `AHSPResource` is never written to
- `resourceCatalogId`, `selectedBasicPriceId` — only populated "when they genuinely exist
  and are authorized" (addendum §8) — both remain `null` for `UNRESOLVED`, and
  `selectedBasicPriceId` remains `null` for `NEEDS_REVIEW` even when `resourceCatalogId`
  is known
- source/adapted price trace: `sourcePriceValue`, `sourcePriceUnit`, `adaptedPriceValue`,
  `conversionFactor` (`"1.000000"` for the labor-day equivalence), `canonicalUnit`
  (`"PERSON_DAY"`), `selectedSourceOrigin`, `selectedFreshnessStatus`,
  `selectedEffectiveDate` — all populated only for `RESOLVED`

No numeric confidence field exists anywhere in this schema (confirmed absent from B.3) —
matches addendum §8 exactly.

### H.1 Resource identity honesty — explicit statement (PM Plan Review Decisions §5)

Phase 2 uses the existing Phase 1 exact normalized-name resolver unchanged: trim, lowercase,
collapse repeated whitespace inside the kernel, exact name equality, matching resource type,
bounded labor-day unit equivalence. It performs no fuzzy, semantic, alias, embedding, AI, or
LLM matching. Phase 2 is therefore, stated exactly as PM requires it to appear in this plan
and in the eventual implementation report:

```text
NAME-EXACT PROOF
NOT CODE-EXACT PROOF
```

---

## I. No-money boundary

Explicit proof this phase introduces none of the following, anywhere in the proposed
schema (B) or service flow (F/G):

| Forbidden | Where checked | Present? |
|---|---|---|
| coefficient × price | `coefficient` and `sourcePriceValue`/`adaptedPriceValue` are stored side by side but never multiplied in F/G — no service method computes a product | No |
| resource cost | No field named or semantically equal to a resource cost anywhere in B.3 | No |
| Harga Satuan AHSP (AHSP unit price) | No aggregation across resolutions is computed or stored | No |
| subtotal / grand total | Not present in either table | No |
| RAB update | `BoqItem.unitPrice`/`lineTotal`/`RabDocument` are never referenced by `project-ahsp.service.ts` (no import, no query) | No |
| Cost Kernel | Not built; no Cost-Kernel-shaped function exists in this plan | No |
| Execution Factor | Absent from the runtime path entirely (addendum §7) — no EF field, no EF service call | No |
| Snapshot consumption | `AHSPSnapshot`/`AHSPSnapshotResource` are never read or written by this module | No |

`adaptedPriceValue` equals `sourcePriceValue` exactly (factor 1, no arithmetic) for the
bounded labor-day proof — this is evidence storage, not calculation, matching the kernel's
own framing ("Factor 1 → adapted price equals source price exactly (same string, no
arithmetic)").

**Confirmed unchanged by this revision:** none of Option C (F.4), the `PermissionsGuard`
fix (E.3), the resolution-method correction (H), or the revalidation-failure lock (F.5)
touch money, RAB, Cost Kernel, Execution Factor, snapshots, ranking, fuzzy/AI matching, or a
second eligibility predicate — every prohibition in this table and in §0's locked laws holds
exactly as in the first draft. PM Plan Review Decisions §9's `PermissionsGuard` change is a
tenant-isolation fix at the auth layer, not a change to what this module persists or
calculates.

---

## J. Test matrix

### J.1 Focused unit/service tests (`project-ahsp.service.spec.ts`, mocked Prisma + BasicPriceService)

1. `Pekerja/LABOR/OH` + one exact catalog + one current `Org/Hari` public-eligible price →
   persists `RESOLVED/AUTO_SELECTED` with `resolutionMethod = EXACT_DETERMINISTIC`.
2. Exact decimal source value persisted without JS float conversion (assert the value
   passed to `tx.projectAhspResourceResolution.create()` is the original string, not a
   `Number`-round-tripped value).
3. Same idempotency key + same payload → same occurrence/resolution IDs returned on a
   second call (mock the first `create()` to throw P2002, assert the fallback re-read path
   is taken and returns the pre-seeded existing row).
4. Same idempotency key + different `ahspVersionId`/`ahspResourceId` → `ConflictException`
   (409).
5. Zero catalog candidates → `UNRESOLVED`.
6. Multiple exact catalog candidates → `NEEDS_REVIEW`.
7. Zero `findByResource()` rows returned → `UNRESOLVED` (the service performs no
   pre-filtering per Option C — F.3/F.4 — so this proves the empty-array-to-kernel path
   directly).
8. Wrong Basic Price unit → `UNRESOLVED/BASIC_PRICE_UNIT_NOT_SUPPORTED`. Proven two ways
   per PM Plan Review Decisions §8: (i) **authoritatively** at the kernel regression-test
   layer (F.4, already covering this since Phase 1 and unchanged by Option C); (ii) at this
   service layer by mocking `findByResource()` to return a row whose `resource.baseUnit` is
   a non-labor-day unit and asserting the service forwards it to the real kernel unmodified
   and persists the kernel's verdict unchanged — a fail-closed forwarding proof, not a
   fresh eligibility decision. See J.3 for why a real end-to-end DB fixture for this case is
   not attempted.
9. Multiple unit-compatible, non-expired (active) Basic Prices → `NEEDS_REVIEW` via the
   kernel's `MULTIPLE_BASIC_PRICE_CANDIDATES` path (F.4 point 2); assert no
   cheapest/highest/first selection logic exists anywhere in the service.
10. A very high nominal value resolves identically to a normal one; no warning field, no
    behavioral branch on magnitude.
11. Only `EXPIRED` unit-compatible candidates exist → `NEEDS_REVIEW`,
    `reasonCodes` includes `ONLY_EXPIRED_BASIC_PRICE_CANDIDATES` (emitted directly by the
    kernel's Option C freshness branch, F.4 — not a service-side override, unlike the first
    draft's rejected design), `selectedBasicPriceId = null`.
12. Workspace `AHSPVersion` from another workspace → rejected before kernel invocation
    (F.1 step 1).
13. Global `AHSPVersion` (`workspaceId = null`) → allowed.
14. Requested `ahspResourceId` not belonging to requested `ahspVersionId` → rejected
    (F.1 step 2).
15. Master `AHSP`/`AHSPVersion`/`AHSPResource` rows are never passed to any Prisma `update`/
    `delete` call in the service (assert on the mock — no `update`/`delete` invocation
    against those models).
16. Revalidation failure path (F.5, locked by PM Plan Review Decisions §6):
    `findOneForWorkspace()` mock throws `NotFoundException` → persisted row has
    `status = UNRESOLVED`, `selectedBasicPriceId = null`, every selected-price-trace field
    (`sourcePriceValue`, `sourcePriceUnit`, `adaptedPriceValue`, `conversionFactor`,
    `canonicalUnit`, `selectionMode`, `selectedSourceOrigin`, `selectedFreshnessStatus`,
    `selectedEffectiveDate`) is `null`, `reasonCodes` includes
    `SELECTED_BASIC_PRICE_NO_LONGER_ELIGIBLE`, `resolutionMethod = DETERMINISTIC_ATTEMPTED`,
    and no exception escapes the service method.
17. `resolutionMethod` truthfulness (PM Plan Review Decisions §4): a `RESOLVED` result
    persists `EXACT_DETERMINISTIC`; both an `UNRESOLVED` result (item 5 or 7) and a
    `NEEDS_REVIEW` result (item 6, 9, or 11) persist `DETERMINISTIC_ATTEMPTED` — asserted
    explicitly, not merely implied by the other test cases.

### J.2 E2E/security tests (`project-ahsp-occurrence.e2e-spec.ts`, real `simprok_test` DB)

1. No token → 401.
2. Project outsider (authenticated, no assignment to the project) → 403.
3. Missing `AHSP_MANAGE` on POST → 403.
4. Missing `AHSP_VIEW` on GET → 403.
5. Workspace A account cannot create/read an occurrence scoped to a Workspace B project
   (mirrors `project-access.e2e-spec.ts`'s cross-tenant concealment pattern — 404, not 403,
   to avoid existence leak, consistent with E.5).
6. Successful POST persists exactly one occurrence row and one resolution row (assert via
   direct Prisma count, not just the HTTP response body).
7. Successful GET returns the same persisted selection and trace as the POST response.
8. A `VERIFIED`-only (internal-curation) or otherwise public-ineligible Basic Price is never
   selected — seed one alongside an eligible one for the same catalog, assert the eligible
   one wins and the ineligible one never appears as `selectedBasicPriceId`.
9. No `BoqItem`, `RabDocument`, `AHSPSnapshot`, or `AHSPSnapshotResource` row is created,
   updated, or deleted by the Phase 2 call (assert via before/after row snapshots scoped to
   the test's fixtures — in addition to the global residual-fingerprint guard in
   `test:e2e:safe`, which already proves zero net DB drift across the whole suite).
10. Idempotency: two concurrent POSTs with the same key+payload (`Promise.all`) resolve to
    the same occurrence ID and leave exactly one row in the database (real concurrency
    proof, complementing the mocked unit test in J.1.3).
11. Safe E2E guard: confirm the suite runs only under `simprok_test`
    (`scripts/test-database-guard.ts`) and `RESIDUAL_RESULT: PASS` is reported by
    `run-e2e-safe.ts` after this spec is included in the suite.
12. End-to-end proof of the E.3 security fix on this module's own routes: an account with
    `AHSP_MANAGE` in Workspace B, holding a valid assignment to a Workspace A project,
    calling `POST /projects/:projectId/ahsp-occurrences` with `x-workspace-id: <Workspace B
    id>` → `403` (permission from Workspace B must not authorize the Workspace A project
    operation). The same account calling with `x-workspace-id: <Workspace A id>` (matching)
    → normal success/failure per its actual Workspace A permissions, unaffected.

### J.2a `PermissionsGuard` security regression tests — new (PM Plan Review Decisions §9)

`backend/src/auth/guards/permissions.guard.spec.ts` (new file — see D). Unit-level, mocking
`Reflector` and `PrismaService`, isolated from HTTP/DB, covering all five tests §9 requires:

1. Project-scoped route (`request.projectAccess` present): permission is checked in the
   actual project workspace (`request.projectAccess.workspaceId`), not a differing supplied
   header — construct a request with both present and differing, assert the lookup query
   uses `request.projectAccess.workspaceId`.
2. A membership/role granting the required permission only in Workspace B, with
   `request.projectAccess.workspaceId = Workspace A`, does not authorize — `403`
   (`ForbiddenException`).
3. Explicitly mismatched `x-workspace-id` (header differs from
   `request.projectAccess.workspaceId`) is rejected with `403`.
4. Matching `x-workspace-id` (equal to `request.projectAccess.workspaceId`) continues to
   pass exactly as before.
5. Non-project-scoped route (no `request.projectAccess` on the request — the route's guard
   chain never included `ProjectAccessGuard`) retains today's exact behavior: workspace
   context from header/query/param, `400` if absent, `403` if the resolved workspace grants
   no membership or insufficient permission — unchanged by this fix.

The end-to-end complement to tests 2/3/4 above, exercised through this module's real HTTP
routes, is J.2 item 12.

### J.3 Known test-matrix limitation (flagged, not silently dropped)

Gate §10 test #8 ("Wrong Basic Price unit persists `UNRESOLVED`/`BASIC_PRICE_UNIT_NOT_SUPPORTED`")
cannot be constructed as a real Phase 2 E2E fixture with today's schema: because
`BasicPrice` has no independent `unit` column (A.4 finding 3), every `BasicPrice` row
returned by `findByResource(catalogId)` necessarily carries the same unit as its one
`ResourceCatalog.baseUnit`. A "wrong-unit Basic Price for an otherwise-correct catalog"
cannot exist as real data. This case remains fully proven at the Phase 1 kernel unit-test
layer (already merged, already passing) using synthetic `BasicPriceCandidate.unit` values,
and is additionally proven indirectly at the Phase 2 unit-test layer (J.1.8) by directly
constructing a service-level `BasicPriceCandidate` array with a mismatched unit and
asserting the kernel-forwarding path preserves the kernel's verdict unchanged. **Accepted
and locked as sufficient coverage (PM Plan Review Decisions §8):** "kernel regression tests
remain the authoritative proof for malformed/synthetic wrong-unit candidates; Phase 2
service tests may prove forwarding/fail-closed behavior with mocks; do not manufacture
impossible database data merely to satisfy an E2E checklist." No E2E fixture for this case
will be attempted.

---

## K. Proposed changed-file list (for the implementation slice — none of these exist yet on this branch)

```text
backend/prisma/schema.prisma                                                          (modified)
backend/prisma/migrations/<timestamp>_bp_ahsp_phase2_project_occurrence_persistence/migration.sql (new)
backend/src/app.module.ts                                                              (modified)
backend/src/project-ahsp/project-ahsp.module.ts                                        (new)
backend/src/project-ahsp/project-ahsp.controller.ts                                    (new)
backend/src/project-ahsp/project-ahsp.service.ts                                       (new)
backend/src/project-ahsp/project-ahsp.service.spec.ts                                  (new)
backend/src/project-ahsp/dto/create-project-ahsp-occurrence.dto.ts                     (new)
backend/test/acceptance/project-ahsp-occurrence.e2e-spec.ts                            (new)
backend/src/ahsp/price-resolution/ahsp-resource-price-resolution.kernel.ts             (modified — Option C, F.4; locked, unconditional per PM Plan Review Decisions §3)
backend/src/ahsp/price-resolution/ahsp-resource-price-resolution.kernel.spec.ts        (modified — additive regression tests, F.4)
backend/src/auth/guards/permissions.guard.ts                                           (modified — bounded security fix, E.3; locked per PM Plan Review Decisions §9)
backend/src/auth/guards/permissions.guard.spec.ts                                      (new — no such file exists today)
```

**Scope correction (PM Plan Review Decisions §10):** the first draft listed the kernel
change as conditional on an unresolved (a)-vs-(b) choice, and did not list
`PermissionsGuard` at all. Both are now firm, locked, in-scope items — see D.

This plan itself is the only file changed on this branch at the current (planning) stage:

```text
docs/implementation-plans/BP_AHSP_PHASE2_IMPLEMENTATION_PLAN.md                        (this file — revised)
```

---

## L. Risks and STOP conditions

### L.1 Kernel export question (F.4) — RESOLVED (Option C locked, PM Plan Review Decisions §3)

The first draft's highest-priority open item — export the unit predicate, or duplicate it —
is closed. PM rejected both and locked a third design: one optional `freshnessStatus` field
on `BasicPriceCandidate`, evaluated entirely inside the kernel. No further PM/Architect
input is needed on this point before implementation; see F.4 for the full locked design and
required regression tests.

### L.2 `BasicPriceService` sufficiency

Per addendum §9: "If the current BasicPrice service cannot satisfy the gate without
redefining eligibility, stop with `STOP_ARCHITECTURE_CONFLICT`; do not create a second
predicate." Finding: `findByResource()` + `findOneForWorkspace()` **are** sufficient for the
eligibility predicate itself (status + verificationStatus + tenant-or-global) — no second
eligibility predicate is proposed anywhere in this plan. The freshness split in F.4 is not
a second *eligibility* predicate; it is Phase-2-specific *bounding logic* the gate itself
mandates (§8.8), now implemented entirely inside the kernel via Option C (F.4) rather than
as a service-side filter. **Confirmed settled by PM Plan Review Decisions §8/§9**, which
reuse `findByResource()`/`findOneForWorkspace()` as the sole eligibility source throughout —
no STOP condition here.

### L.3 Workspace ambiguity (tenant vs. global `AHSPVersion`/`ResourceCatalog`)

No global-vs-workspace precedence is invented (F.1 step 1, F.2). When both a global and a
workspace-scoped `ResourceCatalog` row match by name, the kernel's own existing
multi-candidate rule (`NEEDS_REVIEW`) applies unchanged — this plan adds no new tie-break.

### L.4 Prisma relation/deletion conflict

Checked directly against the live schema (B.4): none of the six new relation-array
declarations collide with an existing field name on `Workspace`, `Project`, `AHSPVersion`,
`AHSPResource`, `ResourceCatalog`, or `BasicPrice` (verified by reading each model in full
in A.2). No conflict found.

### L.5 Unstable occurrence identity

Explicitly avoided per gate §4/addendum §5: `ProjectAhspOccurrence` has no relation to
`BoqItem` in this phase, and no `boqItemId` field exists anywhere in B.2/B.3. Idempotency
key is documented (G.1, H) as a temporary retry surrogate, not a structural identity.

### L.6 Idempotency race

Addressed by G.2's atomic-create-then-P2002-fallback design, which relies on the Postgres
unique constraint (not an application-level lock) as the actual serialization point. Risk
residual: if the fallback re-read itself races with a not-yet-committed transaction from
another process (extremely narrow window between the failed insert and the committed
winner's visibility), `findUniqueOrThrow` could theoretically miss a just-committed row
under certain isolation/visibility edge cases. Standard Postgres read-committed behavior
(the Prisma default) makes this practically unreachable once the winning transaction has
committed (which it must have, to produce the P2002 in the first place) — noted as a
theoretical residual, not treated as a blocking risk.

### L.7 Migration incompatibility

None identified: both new tables are wholly new, all FKs point at existing PK columns of
matching type (`Uuid`), and the additive relation-array declarations have no SQL effect
(B.5). No existing migration in `backend/prisma/migrations/` needs to be reordered or
amended.

### L.8 WorkspaceId source-of-truth seam (A.4 finding 1 / E.3) — RESOLVED, now a required change

The first draft treated this as a non-blocking risk with a service-layer-only workaround.
**PM Plan Review Decisions §9 ruled that insufficient** and locked a bounded
`PermissionsGuard` fix instead (E.3) — this is no longer a residual risk to monitor; it is a
required, in-scope code change (D, K) with its own test obligations (J.2 item 12, J.2a).
The one still-open sub-decision is the conservative default noted in E.3 (whether the
`x-workspace-id` header becomes optional on project routes) — flagged there, not here, since
it does not change whether the fix ships, only one edge-case detail of its shape.

### L.9 `PermissionsGuard` regression risk — new (E.3, PM Plan Review Decisions §9)

The bounded fix in E.3 changes behavior on every existing route that combines
`ProjectAccessGuard` with `PermissionsGuard` (today: several routes in `ProjectController`,
per A.3), not only the two new Phase 2 endpoints — because the fix lives inside the shared
`PermissionsGuard` class. Mitigation already designed into E.3/J.2a:

- the fix only activates when `request.projectAccess` is present, so non-project-scoped
  routes are provably unaffected by construction (J.2a test 5);
- for the project-scoped routes that already exist today (`ProjectController`), every
  request in current usage and in the existing e2e suite (`project-access.e2e-spec.ts`,
  `project-intake-context.e2e-spec.ts`, etc.) already supplies an `x-workspace-id` header
  that matches the actual project's workspace (callers are not presenting cross-workspace
  credentials today), so the new mismatch-rejection branch should not change any passing
  existing test's outcome — but this is a prediction, not yet a proof;
- **required before this change ships:** the full existing backend unit and safe-E2E suites
  (gate §14, C) must still pass unmodified after the `PermissionsGuard` change, in addition
  to the new tests in J.2/J.2a. Any existing test that starts failing because of this change
  must be treated as a signal to re-examine the fix's shape with PM/Architect, not silently
  adjusted to pass.

---

**SIMPROK menghitung. Manusia memutuskan.**
**AHSP adalah otoritas. Basic Price menyesuaikan.**
**Selection lives inside the project AHSP occurrence; RAB only consumes the later AHSP result.**
