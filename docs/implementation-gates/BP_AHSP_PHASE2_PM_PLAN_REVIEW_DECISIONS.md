# SIMPROK — BP-AHSP-PHASE-2

## PM PLAN REVIEW DECISIONS

**Status:** `OWNER/PM IMPLEMENTATION GATE — BINDING PLAN REVIEW`  
**Date:** 14 Juli 2026  
**Applies to:**
- `BP_AHSP_PHASE2_PROJECT_OCCURRENCE_PERSISTENCE.md`
- `BP_AHSP_PHASE2_ARCHITECT_CLARIFICATIONS.md`
- `BP_AHSP_PHASE2_IMPLEMENTATION_PLAN.md`

This record closes the open questions found during implementation-plan review. When the plan conflicts with this record, this record controls.

---

## 1. Baseline Decision

The authorized planning prompt expected:

```text
1281e70fa9a1ba8505d17eae02930d49d3e3b33e
```

The planning run proved local feature `HEAD`, `origin/main`, and the remote feature branch all matched that SHA before the plan file was created.

The older SHA:

```text
6be5bf24c13f2e6a8b0b2d8b8d8ca624296a7b6e
```

is a valid ancestor of `1281e70` and was superseded by the Repository Synchronization Law and Architect Clarification Addendum. It is not the expected base of the final authorized planning prompt.

Verdict:

```text
BASELINE_VALID
NO_BASELINE_STOP
```

---

## 2. Executor Decision

The current branch contains one planning-document commit authored by Claude Code. That document may remain as reviewed planning input because it changed no production code, schema, migration, test, seed, or package file.

Production implementation authority remains:

```text
CODEX ONLY
```

Claude Code and Antigravity are not authorized to write the Phase 2 migration or production implementation unless the Owner explicitly amends the executor law.

The plan header must be corrected to state that Claude Code authored the planning draft only and that Codex is the production executor.

---

## 3. Freshness Architecture — OPTION C LOCKED

The Phase 1 kernel remains the single resolver.

Authorize an additive change to:

```text
backend/src/ahsp/price-resolution/ahsp-resource-price-resolution.kernel.ts
```

Add an optional field to `BasicPriceCandidate`:

```text
freshnessStatus?: CURRENT | EXPIRING | EXPIRED
```

Kernel behavior:

- missing `freshnessStatus` preserves Phase 1 behavior and is treated as selectable for backward compatibility;
- CURRENT and EXPIRING compatible candidates may participate in automatic resolution;
- EXPIRED candidates must never be auto-selected;
- only EXPIRED unit-compatible candidates → `NEEDS_REVIEW`, `selectedBasicPriceId = null`, reason `ONLY_EXPIRED_BASIC_PRICE_CANDIDATES`;
- one CURRENT/EXPIRING compatible candidate plus any EXPIRED candidates → select the one active candidate;
- multiple CURRENT/EXPIRING compatible candidates → `NEEDS_REVIEW`;
- wrong-unit EXPIRED candidates do not create an expired-only review outcome; existing unit-failure behavior remains authoritative.

The service transports public-eligible rows and freshness data to the kernel. It must not duplicate labor-day aliases or pre-resolve unit compatibility.

Required kernel regression tests:

1. candidates without freshness preserve Phase 1 behavior;
2. only expired compatible candidates → NEEDS_REVIEW;
3. one current plus one expired → current resolves;
4. two active compatible candidates → NEEDS_REVIEW;
5. expired wrong-unit candidates retain unit-not-supported behavior.

Option (a), exporting the unit predicate for service-side filtering, is rejected. Option (b), duplicating aliases, is forbidden.

---

## 4. Resolution Method Semantics

`resolutionMethod` must describe the achieved outcome truthfully.

```text
RESOLVED                → EXACT_DETERMINISTIC
UNRESOLVED/NEEDS_REVIEW → DETERMINISTIC_ATTEMPTED
```

Do not write `EXACT_DETERMINISTIC` for an unresolved or ambiguous result.

No numeric confidence is authorized.

---

## 5. Resource Identity Honesty

Phase 2 uses the existing Phase 1 exact normalized-name resolver:

- trim;
- lowercase;
- collapse repeated whitespace inside the kernel;
- exact name equality;
- matching resource type;
- bounded labor-day unit equivalence.

Phase 2 is therefore:

```text
NAME-EXACT PROOF
NOT CODE-EXACT PROOF
```

This limitation must appear in the implementation report. No fuzzy, semantic, alias, embedding, AI, or LLM matching is permitted.

---

## 6. Revalidation Failure Law

The plan proposal is accepted and locked.

If `BasicPriceService.findOneForWorkspace()` fails immediately before persistence because the selected price is no longer public-eligible:

- fail closed;
- persist `UNRESOLVED`;
- `selectedBasicPriceId = null`;
- no source/adapted price trace is persisted as selected truth;
- reason code: `SELECTED_BASIC_PRICE_NO_LONGER_ELIGIBLE`;
- resolution method: `DETERMINISTIC_ATTEMPTED`;
- do not throw an unhandled 500.

This is not a second eligibility predicate; it reuses the existing BasicPrice service.

---

## 7. Schema Plan Correction

The plan contains a real typo:

```text
resourceCatalodId
```

It must be corrected everywhere to:

```text
resourceCatalogId
```

Calling it a “typo guard” is rejected. Canonical plan examples must compile as written.

`canonicalUnit` remains a nullable `String` for Phase 2. Do not create a one-member enum. The only value written by the bounded proof is `PERSON_DAY`.

---

## 8. Basic Price Unit Reality

Repository reality is accepted:

- `BasicPrice` has no independent unit column;
- the runtime unit is derived from its related `ResourceCatalog.baseUnit`;
- a wrong-unit Basic Price for the same real catalog cannot be constructed as a truthful E2E fixture.

Coverage decision:

- kernel regression tests remain the authoritative proof for malformed/synthetic wrong-unit candidates;
- Phase 2 service tests may prove forwarding/fail-closed behavior with mocks;
- do not manufacture impossible database data merely to satisfy an E2E checklist.

---

## 9. Project Permission Workspace — SECURITY BLOCKER

The existing `PermissionsGuard` reads workspace context from a client-controlled header/query/route field, while `ProjectAccessGuard` resolves the real project workspace from the database.

Service query scoping alone is insufficient: a caller could otherwise present permission from a different workspace while targeting a project they are assigned to.

Authorize one bounded security change to `PermissionsGuard`:

- when `request.projectAccess.workspaceId` exists, it is the authoritative workspace for permission evaluation;
- an explicitly supplied workspace context that differs from `request.projectAccess.workspaceId` must be rejected with `403`;
- permission membership/role lookup must use the project-access workspace;
- non-project-scoped routes retain their existing workspace-context behavior;
- do not create a second project-access predicate or a new permission guard.

Required tests:

1. project-scoped route checks permission in the actual project workspace;
2. permission in Workspace B cannot authorize a project operation in Workspace A;
3. mismatched `x-workspace-id` is rejected;
4. matching workspace continues to pass;
5. non-project permission routes retain existing behavior.

This change is required before the Phase 2 POST/GET endpoints may be considered secure.

---

## 10. Plan Revision Required

Before migration or production implementation, Codex must revise the implementation plan to include all decisions in this record.

The revised plan must:

- correct the baseline explanation;
- correct executor attribution;
- correct `resourceCatalogId` spelling;
- replace F.4 with Option C;
- add the kernel file and kernel tests to proposed scope;
- use truthful resolution-method values;
- label the proof name-exact, not code-exact;
- lock the revalidation-failure behavior;
- add the bounded `PermissionsGuard` security fix and tests;
- retain all no-money, no-RAB, no-snapshot, no-EF, no-ranking, and tenant-isolation boundaries.

No migration and no production code before:

```text
REVISED_PLAN_READY_AWAITING_PM_ARCHITECT_REVIEW
```

**SIMPROK menghitung. Manusia memutuskan.**  
**AHSP adalah otoritas. Basic Price menyesuaikan.**
