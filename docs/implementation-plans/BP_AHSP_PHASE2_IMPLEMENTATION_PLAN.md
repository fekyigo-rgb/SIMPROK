# SIMPROK — BP-AHSP-PHASE-2

## Project AHSP Occurrence Persistence — Implementation Plan

**Status:** `PLAN ONLY — NOT IMPLEMENTED — AWAITING PM/ARCHITECT REVIEW`
**Author:** Claude Code (repository executor)
**Branch:** `feat/bp-ahsp-phase2-occurrence-persistence`
**Date:** 14 Juli 2026
**Scope of this document:** planning only. No `schema.prisma` change, no migration, no backend/frontend/test/seed/package change is included in this branch at this stage.

This document is the required implementation plan for the gate
`docs/implementation-gates/BP_AHSP_PHASE2_PROJECT_OCCURRENCE_PERSISTENCE.md`,
binding-clarified by
`docs/implementation-gates/BP_AHSP_PHASE2_ARCHITECT_CLARIFICATIONS.md`.
Where this plan appears to conflict with either document, those two documents win;
this plan exists to translate them into an exact, repository-grounded build plan and
to surface every ambiguity found during re-anchor **before** any code is written.

---

## 0. Re-anchor confirmation

Read in full, in order, before drafting this plan:

1. `docs/project-memory/SIMPROK_PROJECT_MEMORY.md`
2. `docs/project-memory/SIMPROK_BASIC_PRICE_AHSP_IMPLEMENTATION_BLUEPRINT_OWNER_LOCK.md`
3. `docs/project-memory/SIMPROK_BASIC_PRICE_AHSP_IMPLEMENTATION_BLUEPRINT.md`
4. `docs/implementation-gates/BP_AHSP_PHASE1_DETERMINISTIC_RESOURCE_PROOF.md`
5. `docs/implementation-gates/BP_AHSP_PHASE2_PROJECT_OCCURRENCE_PERSISTENCE.md`
6. `docs/implementation-gates/BP_AHSP_PHASE2_ARCHITECT_CLARIFICATIONS.md`
7. Current repository reality: `backend/prisma/schema.prisma`, migrations, `BasicPriceService`,
   `ProjectAccessGuard`, `PermissionsGuard`, `ProjectAccessPolicyService`, permission catalog,
   RBAC seed, `ProjectController`, `AhspController`, the Phase 1 kernel and its spec, and
   representative e2e specs.

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
| Deterministic resolver | `resolveAhspResourcePrice()` | `backend/src/ahsp/price-resolution/ahsp-resource-price-resolution.kernel.ts` (merged on `main`, untouched by this plan except the open question in A.4 finding 2) |
| Basic Price eligibility | `BasicPriceService.findByResource()`, `BasicPriceService.findOneForWorkspace()` | `backend/src/basic-price/basic-price.service.ts` |
| Module wiring precedent | `ProjectController` already combines `@UseGuards(ProjectAccessGuard, PermissionsGuard)` with `@Permissions('AHSP_VIEW')` on `GET :projectId/ahsp-snapshot` — the *exact* shape Phase 2's GET endpoint needs | `backend/src/project/project.controller.ts:185-190` |
| Idempotent-create pattern | `ProjectService.create()` (P2002 → `ConflictException`) and `IntakeEnqueueService.findExistingJob()` / `isUniqueConstraintError()` (pre-check + P2002 fallback) | `backend/src/project/project.service.ts:129-146`, `backend/src/reality-intake/intake-enqueue.service.ts:116-144` |
| Restrictive-FK migration style | `intelligence_evidence` table — `ON DELETE RESTRICT ON UPDATE CASCADE` on every tenant/actor FK | `backend/prisma/migrations/20260711031507_p8a_1b_append_only_intelligence_evidence/migration.sql` |

### A.4 Conflicts or missing capabilities found

These are surfaced for PM/Architect judgment, not silently resolved:

1. **`PermissionsGuard` resolves `workspaceId` independently of `ProjectAccessGuard`.**
   `PermissionsGuard` reads `x-workspace-id` header / query / route param
   (`permissions.guard.ts:40-47`) and does **not** consult `request.projectAccess` (the
   DB-verified context `ProjectAccessGuard` attaches). This is pre-existing repository
   behavior, already used today by `GET :projectId/ahsp-snapshot` and every other
   `ProjectAccessGuard + PermissionsGuard` route in `ProjectController` — Phase 2 does not
   invent it. But it means a caller could send an `x-workspace-id` header pointing at a
   *different* workspace than the project's real workspace and still pass the permission
   check there, while `ProjectAccessGuard` independently and correctly verifies real
   project membership/assignment. **Recommendation (see E.3): the service must scope all
   reads/writes using `request.projectAccess.workspaceId`** (DB-verified by
   `ProjectAccessPolicyService` against the project's actual `workspaceId`), never the
   header-derived `request.workspaceContext.workspaceId`, for persistence/query scoping.
   This is a repository-wide seam, not a Phase-2-only defect; flagged as a risk in L, not a
   blocker.

2. **The Phase 1 kernel does not export its unit-compatibility predicate**, and the Phase 2
   gate's "expired-only → `NEEDS_REVIEW`" rule (gate §8.8, addendum §3) cannot be
   implemented correctly without it. Detail and recommendation in F.4/L.1 — this is the
   single most important open question in this plan.

3. **`BasicPrice` has no `unit` column.** The Phase 1 kernel's `BasicPriceCandidate.unit`
   field assumes a price can carry its own unit independent of the resolved
   `ResourceCatalog.baseUnit`. In the real schema, a price's unit is only ever the
   `baseUnit` of its related `ResourceCatalog` row, and `BasicPriceService.findByResource(resourceId)`
   is already scoped to one catalog row — so every real candidate necessarily shares one
   unit. Consequence for the test matrix: see J.3.

4. **No `ResourceCatalog` service exists anywhere in `backend/src`.** Candidate loading for
   Phase 2 must be a new direct Prisma query inside the new service (there is nothing to
   "reuse" here the way `BasicPriceService` is reused). Query shape specified in F.2.

5. Guard/permission wiring for a brand-new project-scoped module is otherwise fully
   precedented (`ProjectController` pattern in A.3) — no conflict there.

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
  resourceCatalodId    String?                      @db.Uuid // see naming note below
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

(`resourceCatalodId` above is a typo guard for the reviewer — the actual field name is
**`resourceCatalogId`**; written out correctly in every other reference in this document
and must be typed correctly at implementation time.)

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

Design decision flagged for confirmation: `canonicalUnit` is a plain nullable `String`
(only ever `"PERSON_DAY"` in this phase) rather than a new single-member enum, to avoid
introducing an enum with exactly one value for a bounded proof. If PM/Architect prefers a
`ProjectAhspCanonicalUnit { PERSON_DAY }` enum for stronger DB typing ahead of Phase 3's
unit dictionary, that is a one-line change to this plan before implementation.

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

Proposed new bounded module, matching the gate's recommended path and the "Allowed
Production Scope" list exactly:

```text
backend/src/project-ahsp/
  project-ahsp.module.ts
  project-ahsp.controller.ts
  project-ahsp.service.ts
  project-ahsp.service.spec.ts
  project-ahsp.controller.spec.ts        (optional — see D.1)
  dto/
    create-project-ahsp-occurrence.dto.ts
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

### E.3 WorkspaceId source of truth for this module (recommendation, needs confirmation)

Because of the seam in A.4 finding 1, this plan recommends: **`ProjectAhspService` reads
`workspaceId` exclusively from `request.projectAccess.workspaceId`** (set by
`ProjectAccessGuard`, verified against the project's real `workspaceId` in the database),
not from `request.workspaceContext.workspaceId` (set by `PermissionsGuard` from the
client-supplied `x-workspace-id` header). `PermissionsGuard` still runs and still requires
a valid, permission-holding `x-workspace-id` header (existing behavior, unchanged) — but
the header's value is used only to satisfy that guard, never passed into the service layer
for query/persistence scoping. The account ID for `createdByAccountId` comes from
`request.user.id` (populated by `JwtAuthGuard`/JWT strategy), also never from the request
body.

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
| Missing `x-workspace-id` header | 400 | `PermissionsGuard` (existing behavior — not part of the gate's 401/403/404 list but a real, pre-existing status this route inherits; noted, not changed) |
| `x-workspace-id` workspace has no active membership | 403 | `PermissionsGuard` |
| Missing `AHSP_MANAGE` (POST) / `AHSP_VIEW` (GET) | 403 | `PermissionsGuard` |
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
5. Load `BasicPrice` candidates via `BasicPriceService.findByResource()`, apply the Phase 2
   freshness boundary (F.4).
6. Call `resolveAhspResourcePrice()` (Phase 1 kernel) with the assembled input.
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

Each row is mapped to the kernel's `BasicPriceCandidate` shape:

```ts
{
  id: row.id,
  resourceId: row.resourceId,
  value: row.value.toString(),       // Prisma Decimal → exact string, never Number(row.value)
  sourceOrigin: row.sourceOrigin,
  unit: row.resource.baseUnit,       // see A.4 finding 3 — BasicPrice has no independent unit
}
```

### F.4 Phase 2 freshness boundary — the central open design question

Gate §8.8 / addendum §3 require: `CURRENT` and `EXPIRING` may auto-resolve; `EXPIRED` must
not; **if only expired-but-otherwise-compatible candidates exist, persist `NEEDS_REVIEW`**
(not the kernel's own `UNRESOLVED`), with a distinct Phase-2 reason. "Compatible" here means
matching `resourceId` **and** unit (test matrix item 8, wrong-unit, must still be
`UNRESOLVED`/`BASIC_PRICE_UNIT_NOT_SUPPORTED` regardless of freshness — so "compatible" is
not merely "same resourceId").

The kernel's `BasicPriceCandidate` type carries no freshness field at all — freshness
splitting **must** happen in the service, before the kernel is called, and the kernel
cannot itself distinguish "zero candidates because none exist" from "zero candidates
because we filtered out the only ones that existed." Concretely, this requires the service
to independently know whether a given candidate is unit-compatible **before** invoking the
kernel — the exact same bounded labor-day-unit check the kernel already performs
internally, but the kernel does not currently export it.

**Recommended design (needs explicit PM/Architect confirmation before implementation):**

1. Export the kernel's existing internal `isLaborDayUnit()` predicate (or the
   `LABOR_DAY_UNIT_ALIASES` set it reads) as a **named export** from
   `ahsp-resource-price-resolution.kernel.ts`. This is a pure, additive, zero-behavior-change
   export of logic that already exists and is already tested in Phase 1 — it does not alter
   `resolveAhspResourcePrice()`'s behavior or Phase 1's own test results.
2. In the service, before calling the kernel: split `findByResource()` rows by
   `isLaborDayUnit(row.resource.baseUnit)` into `unitCompatible` and the rest (ignored —
   they are the "wrong unit" case, always `UNRESOLVED` regardless of freshness, per test
   matrix item 8).
3. Within `unitCompatible`, split by `freshnessStatus !== 'EXPIRED'` into
   `eligibleForKernel` and `expiredOnly`.
4. Call the kernel with `eligibleBasicPriceCandidates: eligibleForKernel` (mapped per F.3).
5. If the kernel returns `UNRESOLVED` with a Basic-Price-related reason
   (`NO_BASIC_PRICE_CANDIDATE`) **and** `expiredOnly.length > 0`, override the persisted
   status to `NEEDS_REVIEW` with a Phase-2-defined reason code (e.g.
   `ONLY_EXPIRED_BASIC_PRICE_CANDIDATES`, appended to the kernel's own reason codes, not
   replacing them) and `selectedBasicPriceId = null`. Otherwise persist the kernel's result
   as-is.

**Open question for PM/Architect:** modifying
`backend/src/ahsp/price-resolution/ahsp-resource-price-resolution.kernel.ts` (even a pure
additive export) is **not** explicitly listed in the Phase 2 gate's "Allowed Production
Scope" (§11), which only lists `schema.prisma`, one migration, `app.module.ts`, new
`backend/src/project-ahsp/**`, tests, and the `BasicPriceModule` import. Two paths forward,
both preserved in this plan pending PM/Architect direction:

- **(a) Preferred:** authorize a tiny additive export from the kernel file as in-scope,
  since it changes zero Phase 1 behavior and avoids duplicating the bounded alias set.
- **(b) Fallback:** duplicate the bounded `LABOR_DAY_UNIT_ALIASES` set as a private
  constant inside `project-ahsp.service.ts`, with a code comment cross-referencing the
  kernel file and an explicit note that the two lists must be changed together. This keeps
  the kernel file untouched but introduces the exact kind of duplication the "single
  authorized resolver" principle exists to prevent.

This plan does not choose between (a) and (b) unilaterally — it is flagged here as a
required PM/Architect decision before implementation begins (see L.1).

### F.5 Revalidation before persistence

`BasicPriceService.findOneForWorkspace(selectedBasicPriceId, workspaceId)` is called
immediately before the row is written (F.1 step 7), using the same eligibility predicate as
candidate loading (reused, not re-implemented). If it throws `NotFoundException` (the price
became ineligible between candidate-load and persistence — e.g. withdrawn), the service
persists `UNRESOLVED` instead of `RESOLVED` with a Phase-2 reason (e.g.
`SELECTED_BASIC_PRICE_NO_LONGER_ELIGIBLE`), not a hard 500 — fail-closed, not fail-crash.
This exact outcome-on-revalidation-failure is not specified verbatim by the gate; it is a
plan-level default proposed for confirmation, consistent with the blueprint's
"fail-closed... say what is missing" law.

### F.6 No tie-breaker, no second predicate

No ordering by nominal value, date, freshness, DB order, or UUID is added anywhere in F —
multi-candidate outcomes are always `NEEDS_REVIEW`, exactly as the kernel already decides
once it receives the (freshness-and-unit-pre-filtered) candidate list.

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
- `resolutionMethod` — always the literal string `"EXACT_DETERMINISTIC"` in this phase,
  since the Phase 1 kernel is the only resolver used regardless of outcome status
- `reasonCodes` (`String[]`) — the kernel's own `ReasonCode` values, plus the Phase-2-only
  codes introduced in F.4/F.5 when applicable
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
7. Zero eligible Basic Price (after freshness/unit split) → `UNRESOLVED`.
8. Wrong Basic Price unit → `UNRESOLVED/BASIC_PRICE_UNIT_NOT_SUPPORTED` — **at the kernel
   unit-test layer only** (already proven in Phase 1's own spec); see J.3 for why this
   cannot be independently re-proven with real `BasicPriceService`-backed data at the
   Phase 2 service layer, and the proposed resolution.
9. Multiple unit-compatible, non-expired Basic Prices → `NEEDS_REVIEW`; assert no
   cheapest/highest/first selection logic exists.
10. A very high nominal value resolves identically to a normal one; no warning field, no
    behavioral branch on magnitude.
11. Only expired unit-compatible candidates exist → `NEEDS_REVIEW` with the Phase-2 reason
    from F.4, `selectedBasicPriceId = null` (this is the primary proof of the F.4 design).
12. Workspace `AHSPVersion` from another workspace → rejected before kernel invocation
    (F.1 step 1).
13. Global `AHSPVersion` (`workspaceId = null`) → allowed.
14. Requested `ahspResourceId` not belonging to requested `ahspVersionId` → rejected
    (F.1 step 2).
15. Master `AHSP`/`AHSPVersion`/`AHSPResource` rows are never passed to any Prisma `update`/
    `delete` call in the service (assert on the mock — no `update`/`delete` invocation
    against those models).
16. Revalidation failure path (F.5): `findOneForWorkspace()` mock throws `NotFoundException`
    → persisted status becomes `UNRESOLVED`, not a thrown 500.

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
asserting the kernel-forwarding path preserves the kernel's verdict unchanged. Recommend
PM/Architect accept this as sufficient coverage for Phase 2 rather than requiring an
unconstructable E2E fixture.

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
```

Conditionally (pending F.4 decision (a) vs (b)):

```text
backend/src/ahsp/price-resolution/ahsp-resource-price-resolution.kernel.ts             (modified — additive export only, if (a) is authorized)
```

This plan itself is the only file changed on this branch at the current (planning) stage:

```text
docs/implementation-plans/BP_AHSP_PHASE2_IMPLEMENTATION_PLAN.md                        (new — this file)
```

---

## L. Risks and STOP conditions

### L.1 Kernel export question (F.4) — highest-priority open item

Whether the Phase 2 service may add a tiny additive export to the Phase 1 kernel file, or
must instead duplicate its bounded unit-alias set locally, is not decided by this plan.
**Recommendation: resolve this explicitly before implementation starts** — it changes the
shape of one file and one design decision, not the schema or the endpoints, so it should
not block schema/migration review, but must be confirmed before the resolution-flow code is
written.

### L.2 `BasicPriceService` sufficiency

Per addendum §9: "If the current BasicPrice service cannot satisfy the gate without
redefining eligibility, stop with `STOP_ARCHITECTURE_CONFLICT`; do not create a second
predicate." Finding: `findByResource()` + `findOneForWorkspace()` **are** sufficient for the
eligibility predicate itself (status + verificationStatus + tenant-or-global) — no second
eligibility predicate is proposed anywhere in this plan. The freshness split in F.4 is not
a second *eligibility* predicate; it is Phase-2-specific *bounding logic* the gate itself
mandates (§8.8), applied after `findByResource()`'s eligibility filter already ran. This
plan treats that distinction as settled, not a STOP condition — flagged here so
PM/Architect can object if they read it differently.

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

### L.8 WorkspaceId source-of-truth seam (A.4 finding 1 / E.3)

Not new to Phase 2, but Phase 2 is the first time this module explicitly persists
tenant-scoped data behind this exact guard combination outside `ProjectController` itself.
Recommend the E.3 default (scope by `request.projectAccess.workspaceId`) be explicitly
confirmed by PM/Architect, since it is a plan-level judgment call rather than a literal
instruction in either gate document.

---

**SIMPROK menghitung. Manusia memutuskan.**
**AHSP adalah otoritas. Basic Price menyesuaikan.**
**Selection lives inside the project AHSP occurrence; RAB only consumes the later AHSP result.**
