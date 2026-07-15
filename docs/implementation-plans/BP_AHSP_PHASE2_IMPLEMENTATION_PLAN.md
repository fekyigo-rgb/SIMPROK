# SIMPROK — BP-AHSP-PHASE-2

## Project AHSP Occurrence Persistence — Final Implementation Plan

**Status:** `PM FINAL PLAN PASS — READY FOR CODEX IMPLEMENTATION`  
**Owner direction:** Proceed according to the approved SIMPROK workflow  
**PM / Gatekeeper:** ChatGPT  
**Production executor:** `CODEX ONLY`  
**Canonical branch:** `feat/bp-ahsp-phase2-occurrence-persistence`  
**Exact implementation base:** `7b15cf5f8b88c9ad2a58a864493039d4030651df`  
**Date:** 15 Juli 2026

The prior Claude Code planning history is preserved at:

```text
archive/bp-ahsp-phase2-plan-835da
835da4ed5d46deee4dbf94459f36f869acaacf0c
```

That prior plan is planning evidence only. This normalized final plan controls the production implementation wherever it differs.

---

## 1. Mandatory Re-anchor and Precedence

Before editing, Codex must read in this order:

1. `docs/project-memory/SIMPROK_PROJECT_MEMORY.md`
2. `docs/project-memory/SIMPROK_BASIC_PRICE_AHSP_IMPLEMENTATION_BLUEPRINT_OWNER_LOCK.md`
3. `docs/project-memory/SIMPROK_BASIC_PRICE_AHSP_IMPLEMENTATION_BLUEPRINT.md`
4. `docs/project-memory/SIMPROK_PROJECT_RAB_AUTHORITY_UNIT_LAW.md`
5. `docs/implementation-gates/BP_AHSP_PHASE1_DETERMINISTIC_RESOURCE_PROOF.md`
6. `docs/implementation-gates/BP_AHSP_PHASE2_PROJECT_OCCURRENCE_PERSISTENCE.md`
7. `docs/implementation-gates/BP_AHSP_PHASE2_ARCHITECT_CLARIFICATIONS.md`
8. `docs/implementation-gates/BP_AHSP_PHASE2_PM_PLAN_REVIEW_DECISIONS.md`
9. `docs/implementation-gates/BP_AHSP_PHASE2_ARCHITECT_FINAL_REVIEW_DECISIONS.md`
10. `docs/implementation-gates/SECURITY_PROJECT_PERMISSION_WORKSPACE_AUTHORITY_SUPPLEMENT.md`
11. current schema, services, kernel, guards, tests, and migrations.

Precedence when wording conflicts:

```text
Project Memory latest status
→ Owner-locked Foundation / Authority Law
→ Architect Final Review Decisions
→ PM Plan Review Decisions
→ Architect Clarifications
→ Phase 2 Gate
→ this implementation plan
→ repository/runtime evidence for implementation detail
```

No conversational memory may override these sources.

---

## 2. Proven Baseline and Security Prerequisite

Remote repository proof:

```text
main                            = 7b15cf5f8b88c9ad2a58a864493039d4030651df
Phase 2 branch before this plan = 7b15cf5f8b88c9ad2a58a864493039d4030651df
branch relation                 = IDENTICAL
```

Security prerequisite is complete and must not be reimplemented in Phase 2:

```text
PR #23
merge commit 6dc7000456e8f6a58aed9f66fbe1f17eb5d5e4eb
status MERGED_PASS
```

Locked effect:

- `request.projectAccess.workspaceId` is authoritative on project-scoped permission routes.
- explicit workspace context is optional when verified project access exists;
- any explicit mismatch fails closed with `403`;
- non-project permission behavior remains unchanged.

Phase 2 must not modify:

```text
backend/src/auth/guards/permissions.guard.ts
backend/src/auth/guards/permissions.guard.spec.ts
backend/test/acceptance/project-permission-workspace.e2e-spec.ts
```

If implementation appears to require another PermissionsGuard change, stop with:

```text
STOP_SECURITY_SCOPE_REOPENED
```

---

## 3. Product and Domain Boundary

Locked purpose:

> Persist one deterministic AHSP-resource-to-Basic-Price resolution inside one project AHSP occurrence and expose it through guarded backend runtime endpoints.

Correct placement:

```text
ProjectAhspOccurrence
└── ProjectAhspResourceResolution
    ├── raw AHSP evidence
    ├── resolved ResourceCatalog reference when genuine
    ├── selected Basic Price reference when genuine
    ├── unit adaptation trace
    ├── deterministic status/method/reasons
    └── audit evidence
```

Forbidden placement:

- no resource-level Basic Price selection on `BoqItem`;
- no resource-level selection on a RAB row or `RabDocument`;
- no mutation of master `AHSP`, `AHSPVersion`, or `AHSPResource` evidence;
- no mutation or backfill of `AHSPSnapshot` or `AHSPSnapshotResource`.

Phase 2 is explicitly:

```text
NAME-EXACT PROOF
NOT CODE-EXACT PROOF
```

It permits no fuzzy matching, aliases outside the existing bounded kernel, similarity score, embeddings, AI/LLM matching, or guessing.

---

## 4. Authorized Delivery Sequence

The branch already contains this plan commit. Production work must then use three independently reviewable commits:

```text
Commit B — Kernel Option C + additive kernel tests
Commit C — Prisma schema + one additive migration only
Commit D — Project AHSP runtime module + focused unit/E2E tests
```

Recommended production commit messages:

```text
feat(ahsp): add freshness-aware deterministic resolution
feat(ahsp): add project occurrence persistence schema
feat(ahsp): persist project resource price resolution
```

Rules:

- complete and gate Commit B before Commit C;
- complete and review migration Commit C before Commit D;
- stop on any gate failure before continuing;
- do not create a Phase 2 PR before PM code review and the complete final gate;
- do not merge and do not declare Owner PASS.

---

## 5. Commit B — Kernel Option C

Only authorized resolver:

```text
backend/src/ahsp/price-resolution/ahsp-resource-price-resolution.kernel.ts
```

Add to `BasicPriceCandidate`:

```ts
freshnessStatus?: 'CURRENT' | 'EXPIRING' | 'EXPIRED';
```

Add the stable reason code:

```text
ONLY_EXPIRED_BASIC_PRICE_CANDIDATES
```

Required behavior after existing resource identity, type, AHSP/catalog unit, resourceId, and Basic Price unit checks:

- missing freshness preserves Phase 1 behavior and is selectable;
- `CURRENT` and `EXPIRING` are active/selectable;
- `EXPIRED` is inactive and is never automatically selected;
- only expired compatible candidates → `NEEDS_REVIEW`, no selected Basic Price;
- exactly one active compatible candidate plus any expired candidates → select the active candidate;
- more than one active compatible candidate → `NEEDS_REVIEW` through the existing multi-candidate path;
- expired candidates with unsupported units do not create an expired-only outcome; existing unit failure remains authoritative.

The service must transport freshness to the kernel without:

- pre-resolving unit compatibility;
- duplicating labor-day aliases;
- exporting the kernel unit predicate;
- creating a second resolver.

Required additive kernel tests:

1. missing freshness preserves existing Phase 1 output;
2. only expired compatible candidates → `NEEDS_REVIEW`;
3. one current plus expired candidates → current resolves;
4. two active compatible candidates → `NEEDS_REVIEW`;
5. expired wrong-unit candidates preserve unit-not-supported behavior.

All existing Phase 1 tests must remain unchanged and pass. Otherwise:

```text
STOP_PHASE1_REGRESSION
```

---

## 6. Commit C — Additive Persistence Schema

Add enums:

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

enum ProjectAhspResolutionMethod {
  EXACT_DETERMINISTIC
  DETERMINISTIC_ATTEMPTED
}
```

`USER_OVERRIDDEN` is reserved for the locked future blueprint but no Phase 2 endpoint may write it.

### 6.1 `ProjectAhspOccurrence`

Required data:

- UUID `id`;
- `workspaceId` UUID;
- `projectId` UUID;
- `ahspVersionId` UUID;
- `idempotencyKey` string;
- nullable `createdByAccountId` UUID audit value; no FK required in this slice;
- timestamps;
- relation to resource resolutions.

Constraints:

```text
unique(projectId, idempotencyKey)
index workspaceId
index projectId
index ahspVersionId
```

Deletion:

- workspace/project may cascade to occurrence;
- AHSP version reference must restrict deletion.

### 6.2 `ProjectAhspResourceResolution`

Required data:

- UUID `id`;
- `occurrenceId` UUID;
- `ahspResourceId` UUID;
- copied raw AHSP resource reference;
- copied raw AHSP resource type;
- copied AHSP coefficient as Decimal, never JavaScript float;
- copied AHSP unit;
- nullable `resourceCatalogId` UUID;
- nullable `selectedBasicPriceId` UUID;
- `ProjectAhspResolutionStatus`;
- nullable `ProjectAhspSelectionMode`;
- nullable canonical unit string;
- nullable source price Decimal and source unit;
- nullable adapted price Decimal;
- nullable conversion factor Decimal;
- nullable selected source origin using the existing enum;
- nullable selected freshness using the existing enum;
- nullable selected effective date;
- `ProjectAhspResolutionMethod`;
- stable reason-code string array;
- Indonesian explanation;
- policy version;
- timestamps.

Constraints:

```text
unique(occurrenceId, ahspResourceId)
indexes occurrenceId, ahspResourceId, resourceCatalogId,
        selectedBasicPriceId, status
```

References to AHSPResource, ResourceCatalog, and selected BasicPrice must restrict deletion.

`canonicalUnit` remains a nullable `String`. The bounded resolved proof may write only:

```text
PERSON_DAY
```

### 6.3 Migration law

The migration may contain only:

- the three bounded enums;
- `project_ahsp_occurrences`;
- `project_ahsp_resource_resolutions`;
- required FKs, unique constraints, and indexes;
- required relation arrays on existing Prisma models.

Forbidden:

- no new scalar on master AHSP, snapshots, ResourceCatalog, BasicPrice, BoqItem, or RabDocument;
- no ResourceCatalog FK on master `AHSPResource`;
- no backfill;
- no `prisma db push`;
- no reset or destructive migration command.

Migration must be additive and safe for existing rows.

---

## 7. Commit D — Guarded Runtime Module

Create bounded module:

```text
backend/src/project-ahsp/
  project-ahsp.module.ts
  project-ahsp.controller.ts
  project-ahsp.service.ts
  project-ahsp.service.spec.ts
  dto/create-project-ahsp-occurrence.dto.ts
```

Add:

```text
backend/test/acceptance/project-ahsp-occurrence.e2e-spec.ts
```

Register the module in:

```text
backend/src/app.module.ts
```

Import and reuse the existing `BasicPriceModule` / `BasicPriceService`. Do not duplicate public eligibility.

### 7.1 API

```http
POST /projects/:projectId/ahsp-occurrences
GET  /projects/:projectId/ahsp-occurrences/:occurrenceId
```

POST body:

```json
{
  "ahspVersionId": "uuid",
  "ahspResourceId": "uuid",
  "idempotencyKey": "stable-client-retry-key"
}
```

Account and workspace IDs must come from authenticated request context, never the body.

Guard order for both routes:

```text
JwtAuthGuard
→ ProjectAccessGuard
→ PermissionsGuard
```

Permissions:

```text
POST → AHSP_MANAGE
GET  → AHSP_VIEW
```

No update, delete, override, comparison, snapshot, Cost Kernel, or RAB endpoint is authorized.

### 7.2 Tenant and visibility flow

Use:

```text
request.projectAccess.workspaceId
```

as the authoritative workspace.

- workspace-owned AHSP version must match the project workspace;
- global AHSP version (`workspaceId = null`) is allowed;
- requested AHSP resource must belong to the requested version;
- GET must constrain by `occurrenceId + projectId + workspaceId` and return not found without cross-tenant existence leakage;
- no global/workspace preference rule may be invented.

### 7.3 Candidate flow

1. Validate version visibility and resource/version ownership.
2. Resolve idempotency.
3. Load tenant-visible/global ResourceCatalog candidates for the raw resource proof without fuzzy matching.
4. Reuse `BasicPriceService.findByResource(resourceCatalogId, workspaceId)`.
5. Map exact Prisma Decimal strings and `resource.baseUnit`; never convert price through JavaScript `number`.
6. Transport `freshnessStatus` to the Option C kernel.
7. Call the Phase 1 resolver exactly once.
8. If resolved, revalidate through `BasicPriceService.findOneForWorkspace()` immediately before persistence.
9. Persist occurrence and one resolution atomically.
10. Return the database re-read record.

Repository reality at the authorized base:

- `findByResource()` and `findOneForWorkspace()` enforce lifecycle `status=PUBLISHED`, verification `PUBLISHED`, and tenant/global visibility;
- they do not filter freshness, so `EXPIRED` rows can truthfully reach Option C;
- returned ordering is not a selection rule and must never be used as a tie-breaker.

If the existing Basic Price service cannot satisfy this flow without redefining eligibility:

```text
STOP_ARCHITECTURE_CONFLICT
```

### 7.4 Revalidation failure

If final selected-price revalidation fails:

- persist `UNRESOLVED`;
- `selectedBasicPriceId = null`;
- no selected source/adapted trace;
- reason `SELECTED_BASIC_PRICE_NO_LONGER_ELIGIBLE`;
- method `DETERMINISTIC_ATTEMPTED`;
- no unhandled `500`.

This is not a second eligibility predicate.

---

## 8. Persisted Outcome Matrix

### RESOLVED

```text
status               = RESOLVED
selectionMode        = AUTO_SELECTED
resolutionMethod     = EXACT_DETERMINISTIC
resourceCatalogId    = genuine resolved catalog
selectedBasicPriceId = genuine revalidated price
canonicalUnit        = PERSON_DAY
conversionFactor     = 1
adaptedPriceValue    = exact source price value
```

Persist copied AHSP evidence, source origin, freshness, effective date, reason codes, Indonesian explanation, and policy version.

### UNRESOLVED

```text
status               = UNRESOLVED
selectionMode        = null
selectedBasicPriceId = null
resolutionMethod     = DETERMINISTIC_ATTEMPTED
```

Never invent a price or fallback to `BoqItem.unitPrice`.

### NEEDS_REVIEW

```text
status               = NEEDS_REVIEW
selectionMode        = null
selectedBasicPriceId = null
resolutionMethod     = DETERMINISTIC_ATTEMPTED
```

No ranking by nominal price, effective date, database order, UUID, or global/workspace origin.

---

## 9. Idempotency and Atomicity

Database source of truth:

```text
unique(projectId, idempotencyKey)
```

Required behavior:

- same key + same project/version/resource → return existing occurrence and resolution IDs;
- same key + different version/resource → `409 Conflict`;
- concurrent identical retries → exactly one occurrence and one resolution;
- occurrence and resolution are created in one transaction;
- no `boqItemId` in the key or occurrence schema.

Handle the unique-constraint race by re-reading the winner and comparing payload. Do not rely only on a pre-check.

---

## 10. Authorized Production File Scope

Expected production/test scope:

```text
backend/src/ahsp/price-resolution/ahsp-resource-price-resolution.kernel.ts
backend/src/ahsp/price-resolution/ahsp-resource-price-resolution.kernel.spec.ts
backend/prisma/schema.prisma
backend/prisma/migrations/<timestamp>_bp_ahsp_phase2_project_occurrence_persistence/migration.sql
backend/src/app.module.ts
backend/src/project-ahsp/**
backend/test/acceptance/project-ahsp-occurrence.e2e-spec.ts
```

Small relation-array additions in existing Prisma models are allowed only as required by the new FKs.

Any file outside this list requires STOP and PM review before modification.

---

## 11. Forbidden Scope

- no frontend;
- no Basic Price UI;
- no user override endpoint;
- no price-comparison UI or persistence;
- no candidate ranking or cheapest/highest selection;
- no publication-semantics change;
- no Basic Price write-flow change;
- no permission-catalog or seed change;
- no global/workspace precedence;
- no universal unit engine;
- no material, equipment, package, density, logistics, or hour/day conversion;
- no coefficient × price;
- no resource cost;
- no AHSP unit price;
- no subtotal, grand total, or RAB arithmetic;
- no `BoqItem.unitPrice` or `lineTotal` update;
- no Execution Factor;
- no snapshot creation/schema change/backfill;
- no mutation of master AHSP evidence;
- no edits to the merged security slice.

---

## 12. Required Tests

### 12.1 Kernel regression

The five Option C tests in section 5 plus every original Phase 1 test unchanged.

### 12.2 Focused service/unit proof

At minimum:

1. Pekerja/LABOR/OH + one exact catalog + one current Org/Hari eligible price → `RESOLVED/AUTO_SELECTED`;
2. exact Decimal string persists without float conversion;
3. same idempotency key/same payload returns same IDs;
4. same key/different payload → `409`;
5. no catalog → `UNRESOLVED`;
6. multiple exact catalogs → `NEEDS_REVIEW`;
7. no eligible price → `UNRESOLVED`;
8. unsupported Basic Price unit → fail closed through kernel proof/mocks;
9. multiple active compatible prices → `NEEDS_REVIEW`;
10. high nominal price resolves identically with no warning;
11. expired-only compatible prices → `NEEDS_REVIEW`;
12. active plus expired → active resolves;
13. foreign-workspace AHSP version rejected;
14. global AHSP version allowed;
15. resource/version mismatch rejected;
16. final revalidation failure persists truthful `UNRESOLVED`;
17. master AHSP evidence remains unchanged.

Do not manufacture impossible BasicPrice-unit database fixtures. Kernel tests are authoritative for synthetic wrong-unit candidates.

### 12.3 E2E/security proof

At minimum:

1. no token → `401`;
2. project outsider → `403`/repository-locked project-access behavior;
3. missing `AHSP_MANAGE` on POST → `403`;
4. missing `AHSP_VIEW` on GET → `403`;
5. Workspace A cannot create/read Workspace B occurrence;
6. successful POST persists exactly one occurrence and one resolution;
7. successful GET returns the same persisted trace;
8. public-ineligible Basic Price is not selected;
9. expired-only outcome persists `NEEDS_REVIEW` with no selection;
10. no mutation of `BoqItem`, `RabDocument`, master AHSP, or historical snapshots;
11. safe E2E runs only against `simprok_test` and residual result passes.

---

## 13. Required Gates

1. baseline proof: branch, exact base, remote head, clean worktree;
2. `git diff --check`;
3. Prisma format;
4. Prisma validate using `.env.test`;
5. raw migration review;
6. focused kernel and service tests;
7. backend build;
8. full backend unit tests serially;
9. `npm run verify:db:test`;
10. official `npm run test:e2e:safe`;
11. E2E guard explicitly proves `simprok_test`;
12. `RESIDUAL_RESULT: PASS` and advisory lock released;
13. frontend build regression;
14. no secret leakage;
15. exact changed-file review;
16. local feature `HEAD` equals remote branch head after push;
17. final clean worktree.

Never run acceptance, migration, or destructive commands against `simprok_db`.

---

## 14. Stop Conditions

Return immediately without widening scope when any applies:

```text
STOP_BASELINE_DIVERGED
STOP_PHASE1_REGRESSION
STOP_SECURITY_SCOPE_REOPENED
STOP_ARCHITECTURE_CONFLICT
STOP_MIGRATION_SCOPE_VIOLATION
STOP_TEST_DATABASE_GUARD
STOP_UNAUTHORIZED_FILE_SCOPE
FAIL
```

---

## 15. Required Final Codex Report

Return:

A. baseline proof;  
B. architecture/schema summary;  
C. exact changed files grouped by Commit B/C/D;  
D. migration filename and complete raw SQL;  
E. endpoint/guard proof;  
F. Option C and Phase 1 regression proof;  
G. idempotency/concurrency proof;  
H. tenant/security proof;  
I. persistence and Decimal proof;  
J. proof that master AHSP, BOQ, RAB, and snapshots were not mutated;  
K. every gate command, count, exit code, residual/advisory-lock evidence;  
L. exact final commit SHA, remote equality, and clean status.

Final verdict must be exactly one:

```text
IMPLEMENTATION_PASS_AWAITING_PM_GATE
STOP_ARCHITECTURE_CONFLICT
FAIL
```

No PR. No merge. No Owner PASS declaration.

---

**SIMPROK menghitung. Manusia memutuskan.**  
**AHSP adalah otoritas. Basic Price menyesuaikan.**  
**Selection lives inside the project AHSP occurrence; RAB only consumes the later AHSP result.**
