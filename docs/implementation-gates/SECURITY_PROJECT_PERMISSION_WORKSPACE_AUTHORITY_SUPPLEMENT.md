# SIMPROK — SECURITY PREREQUISITE

## PROJECT PERMISSION WORKSPACE AUTHORITY — REGRESSION HONESTY SUPPLEMENT

**Status:** `OWNER/PM IMPLEMENTATION GATE — BINDING`  
**Date:** 14 Juli 2026  
**Applies to:** `fix/security-project-permission-workspace-authority`

This supplement controls wherever an earlier prompt or plan differs.

---

## 1. Audit Result

The repository-wide controller audit proved:

```text
SECURITY_GUARD_ORDER_AUDIT_PASS
```

All current project-scoped permission routes execute `ProjectAccessGuard` before `PermissionsGuard`. No controller guard-order edit is authorized or required in this slice.

The shared guard change intentionally affects every project-scoped permission route, including:

```text
POST /projects/:projectId/progress/field
```

This is accepted because `PermissionsGuard` is shared security infrastructure. It does not reopen the Monitoring feature scope and does not authorize Progress-domain business changes.

---

## 2. Regression Honesty Law

Existing test files are historical evidence and must not be edited to make this security fix pass.

Required:

- every existing backend unit suite must pass without editing any existing test file;
- every existing safe E2E suite must pass without editing any existing E2E file;
- in particular, existing Progress tests must remain unchanged;
- if any existing test becomes red, stop and report the exact test, request headers/context, old behavior, and new behavior;
- do not weaken the guard;
- do not rewrite an existing expected status merely to restore green;
- a newly exposed mismatched-workspace dependency is evidence of the old security hole, not noise.

Stop status:

```text
STOP_EXISTING_TEST_EXPOSED_SECURITY_HOLE
```

No subsequent implementation step may run until PM review resolves the exposed behavior.

---

## 3. Focused E2E Clarification

Regression honesty does **not** prohibit adding one new focused E2E spec.

The security slice remains allowed to create:

```text
backend/test/acceptance/project-permission-workspace.e2e-spec.ts
```

Reason:

- unit tests prove the isolated guard branch;
- existing suites prove no regression;
- the new focused E2E proves the new HTTP contract at runtime: project route without header, matching header, mismatched header, and permission sourced from the wrong workspace.

Therefore the exact authorized production/test scope remains:

```text
backend/src/auth/guards/permissions.guard.ts
backend/src/auth/guards/permissions.guard.spec.ts
backend/test/acceptance/project-permission-workspace.e2e-spec.ts
```

No existing test file may be modified.

---

## 4. Shared Guard Contract

When `request.projectAccess.workspaceId` exists:

- project workspace from DB is authoritative;
- explicit workspace context is optional;
- missing explicit workspace context is not `400`;
- matching explicit workspace context proceeds;
- mismatched explicit workspace context is `403`;
- permission membership lookup uses the DB-verified project workspace.

When `request.projectAccess` does not exist:

- existing non-project behavior remains unchanged;
- explicit workspace context remains required;
- missing context remains `400`.

---

## 5. Recorded Debt — Not In Scope

### `DEBT-GUARD-02`

Reality Intake upload performs workspace membership authorization directly inside `UploadController` using Prisma instead of the normalized access-policy/guard path.

This is a second authorization truth and must be normalized in a dedicated future security slice. Do not touch it now.

### `DEBT-PERMISSION-01` — Expanded

The permission catalog does not yet contain the final write permissions for:

- RAB draft editing (`RAB_DRAFT_EDIT`);
- project AHSP occurrence writing.

Current repository examples borrow broader permissions, including `PROJECT_CREATE` for saving a BOQ draft. Phase 2 must not invent new permission codes. Owner must decide the write-permission catalog before these surfaces are opened to real users.

---

## 6. Delivery Law

The security PR must be independently reviewable and mergeable before BP-AHSP-PHASE-2 continues.

No schema, migration, kernel, AHSP, Basic Price, Progress business logic, controller, seed, or frontend change is authorized.

**SIMPROK menghitung. Manusia memutuskan.**
