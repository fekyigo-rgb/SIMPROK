# SIMPROK — BP-AHSP-PHASE-2

## ARCHITECT FINAL REVIEW DECISIONS

**Status:** `OWNER/PM IMPLEMENTATION GATE — BINDING FINAL ARCHITECT REVIEW`  
**Date:** 14 Juli 2026  
**Applies to:**
- `BP_AHSP_PHASE2_PROJECT_OCCURRENCE_PERSISTENCE.md`
- `BP_AHSP_PHASE2_ARCHITECT_CLARIFICATIONS.md`
- `BP_AHSP_PHASE2_PM_PLAN_REVIEW_DECISIONS.md`
- `BP_AHSP_PHASE2_IMPLEMENTATION_PLAN.md`

This record closes the final conditions raised by the Architect. When an earlier plan or gate conflicts with this record, this record controls.

---

## 1. Architect Verdict

Accepted:

```text
ARCHITECT_PASS_CONDITIONAL
```

The conditions are now resolved and locked below. Production code remains prohibited until the revised implementation plan incorporates this record.

---

## 2. PermissionsGuard Security Fix Is a Separate Slice and Separate PR

The `PermissionsGuard` change is global security infrastructure. It must not be bundled into the Project AHSP occurrence persistence PR.

Required sequence:

```text
SECURITY SLICE / PR A
PermissionsGuard project-workspace authority fix
→ review
→ full gate
→ merge to main

THEN
BP-AHSP-PHASE-2 PR
Kernel Option C
→ schema/migration
→ occurrence runtime module
```

The security slice must use a dedicated branch created from the latest `main`, recommended name:

```text
fix/security-project-permission-workspace-authority
```

Minimum expected scope:

```text
backend/src/auth/guards/permissions.guard.ts
backend/src/auth/guards/permissions.guard.spec.ts
backend/test/acceptance/project-permission-workspace.e2e-spec.ts
```

Controller files may be changed only if the repository-wide guard-order audit proves an affected project route registers `PermissionsGuard` before `ProjectAccessGuard` or has class/method guard composition that does not guarantee the required order. Any such change must be limited to guard ordering; no business logic changes.

The security PR must contain no Project AHSP occurrence schema, migration, kernel, module, controller, service, or DTO changes.

Reason:

- independent failure diagnosis;
- independent review and rollback;
- reverting Phase 2 must never remove a merged security correction;
- global guard behavior requires full regression evidence before new endpoints depend on it.

A separate commit inside the same Phase 2 PR is insufficient for this isolation requirement.

---

## 3. Repository-Wide Guard-Order Audit Is Mandatory

Before editing `PermissionsGuard`, Codex must produce raw repository evidence for all `@UseGuards(...)` declarations in controllers.

The audit must classify:

1. project-scoped routes with `JwtAuthGuard, ProjectAccessGuard, PermissionsGuard` in that order;
2. non-project routes using `PermissionsGuard` without `ProjectAccessGuard`;
3. any route where `PermissionsGuard` precedes `ProjectAccessGuard`;
4. any class-level plus method-level combination whose effective order is ambiguous.

Required law:

```text
For every project-scoped permission route:
ProjectAccessGuard MUST execute before PermissionsGuard.
```

If an unsafe or ambiguous order is found:

```text
STOP_SECURITY_ROUTE_ORDER_FOUND
```

Report the exact files and routes before editing. The security slice may then correct only those guard-order declarations, subject to PM review.

---

## 4. Project-Scoped Workspace Header Contract

When `request.projectAccess.workspaceId` exists:

- it is the authoritative workspace for permission evaluation;
- `x-workspace-id` / query / route workspace context is optional;
- if explicit workspace context is supplied and differs from `request.projectAccess.workspaceId`, reject with `403`;
- membership and role-permission lookup uses `request.projectAccess.workspaceId`;
- missing explicit workspace context must not produce `400` on a project-scoped route.

When `request.projectAccess` does not exist:

- existing non-project behavior remains unchanged;
- explicit workspace context remains required;
- missing workspace context remains `400`;
- existing membership and permission behavior remains unchanged.

This supersedes the revised plan's conservative default that kept `x-workspace-id` mandatory on project-scoped routes.

Required tests:

1. project route without `x-workspace-id` uses DB-verified project workspace and can proceed;
2. matching explicit workspace context proceeds;
3. mismatched explicit workspace context returns `403`;
4. permission held only in Workspace B cannot authorize a Workspace A project operation;
5. project permission lookup uses Workspace A from `projectAccess`;
6. non-project route without workspace context still returns `400`;
7. non-project matching workspace behavior remains unchanged;
8. all existing unit and safe E2E suites remain green.

Any newly failing client/test that previously relied on a mismatched workspace header must be reported as a security hole exposed by the fix, not silently weakened.

---

## 5. Phase 1 Kernel Regression Law

Kernel Option C remains locked.

Implementation must be additive:

- existing Phase 1 test cases remain unchanged;
- five Option C freshness tests are added;
- all original Phase 1 tests pass without modifying their expected outputs or fixtures;
- if an old Phase 1 test must be changed to make the kernel pass, stop:

```text
STOP_PHASE1_REGRESSION
```

The kernel commit must be separate from schema/migration and runtime-module commits.

---

## 6. Resolution Method Becomes a Prisma Enum

Accept the Architect's non-blocking recommendation.

Add:

```prisma
enum ProjectAhspResolutionMethod {
  EXACT_DETERMINISTIC
  DETERMINISTIC_ATTEMPTED
}
```

Use it for:

```prisma
resolutionMethod ProjectAhspResolutionMethod
```

Semantics remain:

```text
RESOLVED                → EXACT_DETERMINISTIC
UNRESOLVED/NEEDS_REVIEW → DETERMINISTIC_ATTEMPTED
```

This remains additive and creates no scalar change on an existing table. No numeric confidence is authorized.

---

## 7. Revised Plan Visibility

The requested plan sections exist on commit:

```text
835da4ed5d46deee4dbf94459f36f869acaacf0c
```

The PM has directly reviewed:

- B.3 — `ProjectAhspResourceResolution` schema;
- E.3 + E.5 — guard contract and status matrix;
- F.3 + F.4 — Option C candidate transport and kernel freshness behavior;
- K — proposed changed-file list.

The plan must now be revised once more to incorporate this final record, especially:

- remove `PermissionsGuard` files from the Phase 2 changed-file list;
- describe the separate security branch/PR prerequisite;
- change project-route header behavior to optional;
- add the repository-wide guard-order audit;
- add `ProjectAhspResolutionMethod` enum;
- preserve the four-step Phase 2 commit sequence after the security PR is merged.

---

## 8. Locked Delivery Sequence

### PR A — Security prerequisite

```text
PermissionsGuard fix
+ guard unit tests
+ focused security E2E
+ all existing unit/E2E regression gates
```

Merge PR A to `main` first.

Then synchronize:

```text
local main = origin/main = merged security head
Phase 2 branch contains merged security main
```

### Phase 2 implementation commits

```text
Commit B — Kernel Option C + additive tests
Commit C — Schema + additive migration only
Commit D — Module + service + controller + DTO + focused unit/E2E tests
```

Each commit must be reviewable independently. If a gate fails at one step, stop before the next step.

No PR for Phase 2 until all three implementation commits and the complete final gate pass.

---

## 9. Current Verdict

```text
ARCHITECT CONDITIONS       : ACCEPTED AND LOCKED
SECURITY PR                : REQUIRED FIRST
REVISED PHASE2 PLAN        : REQUIRED
MIGRATION / PRODUCTION CODE: HOLD
PRODUCTION EXECUTOR        : CODEX ONLY
```

**SIMPROK menghitung. Manusia memutuskan.**  
**AHSP adalah otoritas. Basic Price menyesuaikan.**
