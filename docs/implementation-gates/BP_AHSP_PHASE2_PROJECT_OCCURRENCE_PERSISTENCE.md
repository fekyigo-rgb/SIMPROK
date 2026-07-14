# SIMPROK — BP-AHSP-PHASE-2

## PROJECT AHSP OCCURRENCE PERSISTENCE

**Status:** `OWNER/PM IMPLEMENTATION GATE — GO`  
**Owner direction:** Proceed to Phase 2  
**Date:** 14 Juli 2026  
**Repository:** `fekyigo-rgb/SIMPROK`  
**Required base:** latest clean `origin/main` containing merge commit `217b5f8dca983d24b51be18208d2ab00f6a38845`

---

## 1. Purpose

Make the Phase 1 deterministic resolution kernel live in backend runtime by persisting one resource-resolution result and its selected Basic Price inside a distinct **project AHSP occurrence**.

The result belongs to the project AHSP occurrence, **not** to the RAB row and **not** to the master AHSP.

This phase does not calculate resource cost, AHSP unit price, or RAB line total.

---

## 2. Mandatory Re-anchor Order

Before editing:

1. `docs/project-memory/SIMPROK_PROJECT_MEMORY.md`
2. `docs/project-memory/SIMPROK_BASIC_PRICE_AHSP_IMPLEMENTATION_BLUEPRINT_OWNER_LOCK.md`
3. `docs/project-memory/SIMPROK_BASIC_PRICE_AHSP_IMPLEMENTATION_BLUEPRINT.md`
4. `docs/implementation-gates/BP_AHSP_PHASE1_DETERMINISTIC_RESOURCE_PROOF.md`
5. Current schema, services, tests, and runtime evidence

Do not rely on conversational memory alone.

---

## 3. Locked Laws

- SIMPROK menghitung, manusia memutuskan.
- AHSP adalah otoritas. Basic Price menyesuaikan.
- Basic Price is a fact record; no warning merely because a nominal value is high or low.
- SIMPROK automatically selects Basic Price inside the project AHSP occurrence.
- The user may later inspect, compare, and override; those capabilities are not implemented in this phase.
- Resource-level selection must not be stored directly in `BoqItem`, `RabDocument`, or a RAB row.
- Master `AHSP`, `AHSPVersion`, and `AHSPResource` raw evidence must remain unchanged.
- Old `AHSPSnapshot` and `AHSPSnapshotResource` rows must never be backfilled.
- Unsupported or ambiguous resolution must fail closed.
- Existing public Basic Price eligibility remains the source of truth.
- No global-versus-workspace precedence rule may be invented in this phase.

---

## 4. Repository Reality

- Phase 1 kernel is merged on `main`:
  `backend/src/ahsp/price-resolution/ahsp-resource-price-resolution.kernel.ts`
- `BoqItem` currently contains `ahspVersionId` and `ahspSnapshotId`, but it does not persist resource-level resolution or selected Basic Price.
- Draft BOQ save currently performs a full replace: existing `BoqItem` rows are deleted and recreated.
- Therefore, attaching the Phase 2 persistence record directly to a draft `BoqItem` would be unstable and is forbidden in this slice.
- No production Cost Kernel exists.
- Existing `BasicPriceService.findByResource()` already enforces the current public Basic Price eligibility predicate and must be reused rather than redefined.

---

## 5. PM Architecture Decision for This Bounded Slice

Create two production entities:

1. `ProjectAhspOccurrence`
2. `ProjectAhspResourceResolution`

`ProjectAhspOccurrence` is the stable project-context container for one application of an AHSP version. It is independent from the mutable full-replace BOQ draft row lifecycle in this phase.

`ProjectAhspResourceResolution` stores the result for one `AHSPResource` inside that occurrence.

The production names above are locked for Phase 2.

---

## 6. Required Schema Contract

### 6.1 Enums

Add bounded enums equivalent to:

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

`USER_OVERRIDDEN` is reserved by the locked blueprint but must not be written by any Phase 2 endpoint.

### 6.2 ProjectAhspOccurrence

Required fields:

- `id` UUID
- `workspaceId` UUID
- `projectId` UUID
- `ahspVersionId` UUID
- `idempotencyKey` string
- `createdByAccountId` nullable UUID value for audit reference; FK is not required in this slice
- `createdAt`
- `updatedAt`

Required relations:

- workspace
- project
- AHSP version
- resource resolutions

Required constraints:

- unique `(projectId, idempotencyKey)`
- indexes for workspace, project, and AHSP version

Deletion rules:

- project/workspace deletion may cascade to the occurrence
- AHSP version deletion must be restricted while an occurrence references it

### 6.3 ProjectAhspResourceResolution

Required fields:

- `id` UUID
- `occurrenceId` UUID
- `ahspResourceId` UUID
- raw AHSP resource reference
- raw AHSP resource type
- copied AHSP coefficient
- copied AHSP unit
- nullable `resourceCatalogId` UUID
- nullable `selectedBasicPriceId` UUID
- resolution status enum
- nullable selection mode enum
- nullable canonical unit
- nullable source price value
- nullable source price unit
- nullable adapted price value
- nullable conversion factor
- nullable selected source origin
- nullable selected freshness status
- nullable selected effective date
- resolution method string
- reason-code string array
- Indonesian explanation text
- policy version string
- `createdAt`
- `updatedAt`

Required relations:

- occurrence
- original `AHSPResource`
- nullable `ResourceCatalog`
- nullable selected `BasicPrice`

Required constraints:

- unique `(occurrenceId, ahspResourceId)`
- indexes for occurrence, AHSP resource, catalog, selected price, and status
- referenced AHSP resource, ResourceCatalog, and selected Basic Price must use restrictive deletion behavior

The raw AHSP fields are copied for project-context traceability. The master AHSP row is not modified.

---

## 7. Runtime API Contract

Create a dedicated bounded module, recommended path:

```text
backend/src/project-ahsp/
```

### 7.1 Create and resolve

```http
POST /projects/:projectId/ahsp-occurrences
```

Guards:

- `JwtAuthGuard`
- `ProjectAccessGuard`
- `PermissionsGuard`
- permission: existing `AHSP_MANAGE`

Body:

```json
{
  "ahspVersionId": "uuid",
  "ahspResourceId": "uuid",
  "idempotencyKey": "stable-client-retry-key"
}
```

The authenticated account ID and workspace ID must come from request context, never from the body.

### 7.2 Read occurrence

```http
GET /projects/:projectId/ahsp-occurrences/:occurrenceId
```

Guards:

- `JwtAuthGuard`
- `ProjectAccessGuard`
- `PermissionsGuard`
- permission: existing `AHSP_VIEW`

Return the occurrence and persisted resource resolutions.

No update, override, delete, comparison, snapshot, or RAB endpoint is authorized in Phase 2.

---

## 8. Runtime Service Flow

For `POST /projects/:projectId/ahsp-occurrences`:

1. Validate the project belongs to the active workspace.
2. Resolve idempotency:
   - same key + same payload returns the existing occurrence;
   - same key + different payload returns `409 Conflict`.
3. Load the requested AHSP version and requested AHSP resource.
4. Prove the resource belongs to that AHSP version.
5. AHSP version visibility:
   - workspace-owned version must match the active workspace;
   - global version (`workspaceId = null`) is allowed;
   - do not invent a workspace/global preference rule.
6. Load tenant-visible/global ResourceCatalog candidates for the Phase 1 resource class.
7. Reuse `BasicPriceService.findByResource()` to obtain already-public-eligible prices. Do not duplicate the publication predicate.
8. Phase 2 freshness boundary:
   - `CURRENT` and `EXPIRING` may enter the bounded proof;
   - `EXPIRED` must not be automatically selected in Phase 2;
   - if only expired compatible prices exist, persist `NEEDS_REVIEW` with a stable Phase 2 reason indicating that expired automatic-use policy is not authorized yet.
9. Call `resolveAhspResourcePrice()` from Phase 1.
10. Persist the occurrence and one resource-resolution result atomically.
11. If resolved, revalidate the selected Basic Price through `BasicPriceService.findOneForWorkspace()` immediately before persistence.
12. Return the persisted record from the database.

No fallback to manual `BoqItem.unitPrice` is allowed.

---

## 9. Persisted Outcome Contract

### RESOLVED

Persist:

- `resourceCatalogId`
- `selectedBasicPriceId`
- `status = RESOLVED`
- `selectionMode = AUTO_SELECTED`
- copied source value/unit/origin/freshness/effective date
- copied AHSP coefficient/unit
- canonical unit
- factor `1`
- adapted price equal to source price for the Phase 1 labor-day equivalence
- reason codes
- Indonesian explanation
- resolution method
- policy version

### UNRESOLVED

Persist:

- `status = UNRESOLVED`
- no selected Basic Price
- no invented price
- reason codes and explanation
- raw AHSP evidence and coefficient/unit

### NEEDS_REVIEW

Persist:

- `status = NEEDS_REVIEW`
- no automatic selected Basic Price
- no ranking by nominal price
- reason codes and explanation
- raw AHSP evidence and coefficient/unit

---

## 10. Required Tests

### Focused unit/service tests

At minimum prove:

1. `Pekerja / LABOR / OH` plus one exact catalog and one current `Org/Hari` public-eligible Basic Price persists `RESOLVED / AUTO_SELECTED`.
2. Exact decimal source value is persisted without JavaScript float conversion.
3. Same idempotency key and same payload returns the same occurrence and resolution IDs.
4. Same idempotency key with different resource/version returns `409`.
5. No catalog persists `UNRESOLVED`.
6. Multiple exact catalogs persist `NEEDS_REVIEW`.
7. No eligible Basic Price persists `UNRESOLVED`.
8. Wrong Basic Price unit persists `UNRESOLVED / BASIC_PRICE_UNIT_NOT_SUPPORTED`.
9. Multiple compatible Basic Prices persist `NEEDS_REVIEW`; no cheapest/highest selection.
10. A high nominal value resolves identically; no nominal warning.
11. Only expired compatible prices persist `NEEDS_REVIEW`; no automatic selection.
12. Workspace AHSP version from another workspace is rejected.
13. Global AHSP version is allowed.
14. Requested resource not belonging to the requested version is rejected.
15. Master AHSP, AHSPVersion, and AHSPResource remain unchanged.

### E2E/security tests

At minimum prove:

1. no token → `401`;
2. project outsider → `403`;
3. missing `AHSP_MANAGE` on POST → `403`;
4. missing `AHSP_VIEW` on GET → `403`;
5. Workspace A cannot create/read an occurrence in Workspace B;
6. successful POST persists exactly one occurrence and one resolution;
7. successful GET returns the same persisted selection and trace;
8. `VERIFIED`-only or otherwise public-ineligible Basic Price is not selected;
9. no `BoqItem`, `RabDocument`, `AHSPSnapshot`, or `AHSPSnapshotResource` row is mutated by the Phase 2 call;
10. safe E2E guard targets `simprok_test` and residual result passes.

---

## 11. Allowed Production Scope

- `backend/prisma/schema.prisma`
- one new Prisma migration
- `backend/src/app.module.ts`
- new bounded `backend/src/project-ahsp/**`
- direct focused unit tests
- direct acceptance/E2E tests
- module import of existing `BasicPriceModule`

Small changes to model relation arrays in existing Prisma models are allowed only as required by the new relations.

---

## 12. Forbidden Scope

- No change to `BoqItem.unitPrice`, `BoqItem.lineTotal`, or RAB arithmetic.
- No relation from the new occurrence directly to a draft `BoqItem` in Phase 2.
- No frontend or browser UI.
- No user override endpoint.
- No price comparison UI or comparison persistence.
- No multi-price ranking.
- No cheapest/highest selection.
- No publication semantics change.
- No Basic Price write flow change.
- No global/workspace precedence rule.
- No material, equipment, package, density, logistics, or hour-to-day conversion.
- No Cost Kernel arithmetic.
- No AHSP unit-price calculation.
- No snapshot creation or snapshot schema change.
- No backfill of existing snapshots or historical data.
- No mutation of master AHSP resource identity, coefficient, or unit.
- Do not touch PR #19 or Phase 1 history.

---

## 13. Database Safety

- Never run destructive or acceptance tests against `simprok_db`.
- Migration and E2E execution are permitted only through the official guarded `simprok_test` lifecycle.
- Prisma validation must use `.env.test`.
- No production database backfill is authorized.
- Migration must be additive and safe for existing rows.

---

## 14. Required Gates

1. baseline proof: branch, exact base SHA, clean worktree
2. `git diff --check`
3. Prisma format and validate using `.env.test`
4. migration review
5. focused tests
6. backend build
7. full backend unit tests serially
8. `npm run verify:db:test`
9. official `npm run test:e2e:safe`
10. E2E guard proves `simprok_test`
11. `RESIDUAL_RESULT: PASS`
12. frontend build regression
13. no secret leakage
14. final clean worktree after commit

---

## 15. Branch and Commit Law

Branch:

```text
feat/bp-ahsp-phase2-occurrence-persistence
```

Recommended commit message:

```text
feat(ahsp): persist project resource price resolution
```

Do not merge.
Do not create a PR before PM code review.
Do not declare Owner PASS.

---

## 16. Required Final Report

Return:

A. baseline proof  
B. architecture and schema summary  
C. exact changed files  
D. migration details  
E. runtime endpoint proof  
F. idempotency proof  
G. tenant/security proof  
H. persistence proof  
I. proof that AHSP master, BOQ, RAB, and snapshots were not mutated  
J. all gate commands, counts, and exit codes  
K. final commit SHA and clean status

Final verdict exactly one:

```text
IMPLEMENTATION_PASS_AWAITING_PM_GATE
STOP_ARCHITECTURE_CONFLICT
FAIL
```

---

**SIMPROK menghitung. Manusia memutuskan.**  
**AHSP adalah otoritas. Basic Price menyesuaikan.**  
**Selection lives inside the project AHSP occurrence; RAB only consumes the later AHSP result.**
