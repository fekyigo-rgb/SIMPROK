# RM-03B — 02 VERIFICATION

### Dalam Nama Tuhan Yesus Kristus.

Everything below was executed unless explicitly marked `NOT RUN`.

| Field | Value |
|---|---|
| BASE_SHA | `99eff0019f84fe737234bd5fe8586475fd9794ce` |
| PR65_MERGE_SHA | `99eff0019f84fe737234bd5fe8586475fd9794ce` |
| Branch | `feat/rm03b-private-assets-one-live-row` |
| Worktree | `E:\SIMPROK DATA PINDAHAN\WORKTREES\USERS-ASUS\SIMPROK-WT-RM03B-PRIVATE-ASSETS-ONE-LIVE-ROW` |

---

## 1. Phase A — PR #65 merge

All seven pre-merge gates passed before merging:

| Gate | Result |
|---|---|
| Fetched PR #65 | ✓ |
| Head == `0e42a2027a709aca6fe8c1ef4dbb41ef822161a8` | ✓ exact match |
| Base == `main` | ✓ |
| Backend Build and Unit | **pass** |
| Frontend Test and Build | **pass** |
| Official Safe E2E | **pass** |
| Checks ran on the expected head SHA | ✓ verified via check-runs API (`head=0e42a2027a70`) |
| No schema / migration / dependency / env file in the diff | ✓ 12 files, all `src`/`test`/`docs` |
| Secret scan on full PR diff | ✓ clean |
| Unresolved blocking review threads | 0 |
| `mergeable` / `mergeStateStatus` | `MERGEABLE` / `CLEAN` |

Merged with `--match-head-commit`. GitHub cannot merge a draft, so the PR was
marked ready immediately before merging; this is recorded because it is a state
change, not a silent step.

```
PR65_MERGED            = YES
PR65_EXPECTED_HEAD_MATCH = YES
PR65_CI                = PASS
PR65_MERGE_SHA         = 99eff0019f84fe737234bd5fe8586475fd9794ce
NEW_ORIGIN_MAIN_SHA    = 99eff0019f84fe737234bd5fe8586475fd9794ce
```

---

## 2. Files changed (RM-03B)

| File | Kind |
|---|---|
| `backend/src/project-ahsp/ahsp-eligibility.policy.ts` | new |
| `backend/src/project-ahsp/ahsp-eligibility.policy.spec.ts` | new (test) |
| `backend/src/project-ahsp/project-ahsp.service.ts` | modified — both predicates now share one builder; list returns `origin` |
| `backend/src/project-ahsp/project-ahsp.service.spec.ts` | modified — Q-01 restated, Q-01b/Q-01c added |
| `backend/src/ahsp/ahsp.controller.ts` | modified — workspace trust (create + version) **and server-derived actor on all 8 mutations** |
| `backend/src/ahsp/ahsp.controller.spec.ts` | modified — actor-spoof proofs; one defect-locking test restated |
| `backend/src/ahsp/ahsp.module.ts` | modified — registers the actor resolver |
| `backend/src/ahsp/services/trusted-ahsp-actor.service.ts` | new — server-derived actor |
| `backend/src/ahsp/services/trusted-ahsp-actor.service.spec.ts` | new (test) |
| `backend/src/ahsp/services/ahsp-version.service.ts` | modified — parent-AHSP tenant check |
| `backend/test/acceptance/project-ahsp-occurrence.e2e-spec.ts` | modified — private fixtures + 11 cases + 2 actor-provenance cases |
| `frontend/src/utils/ahspOriginDisplay.ts` | new |
| `frontend/src/utils/ahspOriginDisplay.test.ts` | new (test) |
| `frontend/src/pages/RabWorkspacePage.tsx` | modified — origin label + honest private note |
| `docs/implementation-gates/rm03b-private-assets/*` | new (4 docs) |

```
SCHEMA_CHANGE = NO · MIGRATION_CHANGE = NO · DEPENDENCY_CHANGE = NO
```
No file under `backend/prisma/` touched. No lockfile touched. **No file
delivered by PR #65 modified.**

---

## 3. Test results — executed

### Backend unit — **PASS**

```
npm test -- --runInBand
  Test Suites: 69 passed, 69 total
  Tests:       845 passed, 845 total
```

Baseline measured on this same worktree before any RM-03B edit:
**808 (67 suites)**.

- RM-03B private-asset slice: **808 → 825 (+17)**
- Actor-provenance remediation: **825 → 845 (+20)**

**Net 808 → 845 (+37). Zero regressions.** The tenant-trust fixes broke no
existing test; the actor fix required restating exactly one test that had been
asserting the defective behaviour.

### Frontend — **PASS**

```
npm test    (tsc --noEmit + node --test)
  tests 150 · pass 150 · fail 0
```
Baseline **145** → **150 (+5)**.

### Builds — **PASS**

```
backend:  nest build            → clean
frontend: tsc -b --noEmit       → clean
          vite build            → built, 0 errors
```

### Typecheck integrity

```
npx tsc -p tsconfig.json --noEmit  → 26 errors
```
Exactly the **pre-existing** baseline; **zero** in any file this gate touched.
Verified pre-existing by locating the same offending literals at `HEAD`
(`project-ahsp.service.spec.ts` `ReasonCode` strings at HEAD lines 272/335/380,
merely shifted by the new tests). `nest build` uses `tsconfig.build.json` and
ts-jest transpiles without type-checking (`isolatedModules: true`), so these
never gated and still do not.

---

## 4. Official Safe E2E — CI

**NOT RUN LOCALLY, deliberately** — unchanged from the RM-03 finding: the only
local `simprok_e2e` sits on the port-5432 cluster this task forbids touching,
and Docker is unavailable. CI provisions its own ephemeral
`postgres:16.4-alpine` with `POSTGRES_DB=simprok_e2e`, touching neither the
production cluster nor the local 5432 cluster.

```
SIMPROK_DB_WRITE_COUNT  = 0   (never connected to live production)
OLD_CLUSTER_WRITE_COUNT = 0   (no write, no DDL, no reset)
E2E_DATABASE_IDENTITY_GATE / E2E_RESULT / E2E_RESIDUAL_COUNT → see §9 (CI)
```

11 new E2E cases were added (**407 → 418**); their runtime behaviour is proven
by CI, not by claim.

### CI run 3 — FINAL, actor-provenance remediation (commit `3fdac88`) — **GREEN**

```
Backend Build and Unit    PASS
Frontend Test and Build   PASS
Official Safe E2E         PASS

  E2E database guard PASS: simprok_e2e     (asserted 3x)
  Test Suites: 33 passed, 33 total
  Tests:       420 passed, 420 total       (418 + 2 actor-provenance cases)
  RESIDUAL_RESULT: PASS - final database matches baseline
  JEST_RESULT: PASS
```

Verified against the check-runs API on the exact tip (`head=3fdac8822340` on
all three jobs), and read from the raw job log rather than from a green badge.

```
E2E_DATABASE_IDENTITY_GATE = PASS
E2E_RESULT                 = PASS (420/420)
E2E_RESIDUAL_COUNT         = 0
```

### CI run 2 (commit `71a84a4`) — **GREEN**

```
Backend Build and Unit    PASS   56s
Frontend Test and Build   PASS   23s
Official Safe E2E         PASS   1m25s

  E2E database guard PASS: simprok_e2e     (asserted 3x)
  Test Suites: 33 passed, 33 total
  Tests:       418 passed, 418 total       (baseline 407, +11)
  RESIDUAL_RESULT: PASS - final database matches baseline
  JEST_RESULT: PASS
```

```
E2E_DATABASE_IDENTITY_GATE = PASS
E2E_RESULT                 = PASS (418/418)
E2E_RESIDUAL_COUNT         = 0
```

### CI run 1 (commit `e41391b`) — 417/418, one failure, **caused by the test fixture**

```
Backend Build and Unit    PASS
Frontend Test and Build   PASS
Official Safe E2E         FAIL — Tests: 1 failed, 417 passed, 418 total
                                 RESIDUAL_RESULT: PASS
```

**All ten tenant-isolation cases passed**, including every cross-workspace
negative, the null-workspace leak guard, the archived/superseded exclusions, and
the foreign-version-append refusal.

The single failure was `ignores a forged workspaceId in the AHSP create body`,
which returned **500** instead of 201 — and the fault was the fixture's, not the
code's. The `/ahsp` routes carry no `ProjectAccessGuard`, so
`request.projectAccess` is undefined and the controller falls back to
`body.userId`. The test passed an **Account** id, but `AHSP.createdByUserId` is a
foreign key to **User** — a constraint violation, not an authorization outcome.

Fixed in a follow-up commit (never an amend) by having the actor factory return
the User row id and passing that. Note this also means the assertion it makes —
that the trusted workspace wins over a forged body field — had not yet actually
been exercised; run 2 is the first run that proves it.

`RESIDUAL_RESULT: PASS` on the failing run too: the widened tag-scoped cleanup
removed every private, null-workspace, archived, superseded and foreign fixture.

Cleanup was widened from a single `ahspId` to `workType: { startsWith: tag }` so
the new private, null-workspace, archived, superseded and foreign fixtures are
all removed. The harness's whole-database fingerprint diff is the backstop.

---

## 4b. ACTOR PROVENANCE REMEDIATION (found in final review)

### The defect

Every AHSP mutation persists provenance — `createdByUserId`,
`approvedByUserId`, `archivedByUserId`, `deletedByUserId`,
`ownershipTransferredByUserId`, plus an `AHSPAuditLog.who` row. **All of them
took their actor from `body.userId`**, a value the browser sends.

```
Authenticated User A
  → POST /ahsp with body.userId = <User B>
  → AHSP created in the correct workspace (tenant scope was already trusted)
  → createdByUserId and audit.who both say User B
```

```
ACTOR_PROVENANCE_SPOOF   = YES   (before this remediation)
CROSS_WORKSPACE_LEAK     = NO    (workspace was already server-derived)
```

This was never a data leak. It was worse in a different way: the audit trail
recorded something untrue, and an untrue provenance record is indistinguishable
from a true one afterwards.

**Root cause.** `ahsp.controller.ts` read `request.projectAccess?.userId ?? body.userId`
on create, and `body.userId` directly on update / delete / archive / approve /
transfer / version-create / snapshot. The `/ahsp` routes carry no
`ProjectAccessGuard`, so `request.projectAccess` is always undefined there and
the fallback was in fact the only path. There is no global `ValidationPipe` and
the DTOs are plain interfaces, so nothing stripped the field either.

Honest note: the RM-03B tenant-trust fix had already closed the *workspace*
inversion on two of these routes, but left the *actor* on all of them. The
earlier fixture repair even passed a `userId` in the body, which is exactly the
shape this remediation now proves inert.

### The fix

`backend/src/ahsp/services/trusted-ahsp-actor.service.ts` derives the actor
server-side, walking the canonical identity chain and nothing else:

```
JWT Account
  → ACTIVE WorkspaceMembership for the selected workspace   (guard-verified)
    → ACTIVE User profile belonging to that membership
      → trusted User.id
```

Predicates asserted: `User.status = ACTIVE`, `membership.status = ACTIVE`,
`membership.account.status = ACTIVE`, and the membership's own `workspaceId`
re-checked against the context, so a context whose two halves disagree cannot
resolve. `User.workspaceMembershipId` is `@unique`, so the actor is
deterministic — never a choice among candidates.

Pattern B (resolve inside the mutation path) was chosen over Pattern A
(populate `userId` in `PermissionsGuard`) because `request.workspaceContext`
already carries `membershipId`, and changing the guard would alter the context
shape for every route in the application. Pattern B is bounded to the AHSP
module.

**Fail-closed.** `NO_TRUSTED_USER_PROFILE → 403`, no mutation. There is no
fallback to `body.userId`, no attribution to the Account id, no "any User in
the workspace", and no actorless record.

Both authority fields are also destructured OUT of the body before it is
spread, so a forged value cannot survive even if spread order were later
changed by accident.

```
CLIENT_SUPPLIED_USER_ID_AUTHORITATIVE = NO
PERSISTED_CREATOR_EQUALS_AUTHENTICATED_USER = YES
AUDIT_ACTOR_EQUALS_AUTHENTICATED_USER = YES
```

### Tests

- `trusted-ahsp-actor.service.spec.ts` — the ACTIVE chain, the workspace
  cross-check, no `id:` lookup a body could steer, fail-closed on a missing
  profile, rejection of unusable contexts, and a guarded Prisma proxy proving
  only the `user` model is read.
- `ahsp.controller.spec.ts` — a spoofed actor is ignored on **all eight**
  mutations; the resolver is called with the workspace context; and when no
  trusted actor resolves, the writer is never reached.
- E2E — authenticated manager posts `body.userId = <another real User>`;
  persisted `createdByUserId` **and** `AHSPAuditLog.who` both equal the
  authenticated user. Plus a canonical create with no `userId` field at all.

One existing controller test asserted the snapshot was attributed to
`body.userId`; it was locking the defect in place and is restated. Its
workspace assertion is preserved unchanged.

---

## 5. Security / tenant verification

| Check | Result | How |
|---|---|---|
| Private branch never admits `workspaceId: null` | PASS | unit assertion incl. a literal `"workspaceId":null` string check |
| Private branch requires strict equality on BOTH version and AHSP | PASS | unit |
| Private branch requires `USER_ASSET` | PASS | unit |
| Private branch excludes deleted/archived AHSP | PASS | unit |
| Private branch excludes SUPERSEDED/ARCHIVED versions | PASS | unit |
| Private branch never requires PUBLISHED | PASS | unit |
| Predicate binds to the caller's workspace, not a captured one | PASS | unit (second workspace) |
| `CATALOG_ELIGIBILITY_SEMANTICS_PRESERVED` | YES | unit |
| List and revalidation share one builder | PASS | by construction + E2E |
| Null-workspace `USER_ASSET` not listed | PASS | E2E (CI) |
| Null-workspace `USER_ASSET` not bindable | PASS | E2E (CI) |
| Foreign workspace private AHSP not listed | PASS | E2E (CI) |
| Foreign workspace private AHSP not bindable | PASS | E2E (CI) |
| Archived private AHSP not bindable | PASS | E2E (CI) |
| Forged `workspaceId` in create body ignored | PASS | E2E (CI) |
| Version cannot be appended to a foreign AHSP | PASS | E2E (CI) |
| Workspace authority from trusted context only | PASS | controllers |
| No secret in argv/log/git | PASS | staged-diff scan |

---

## 6. Public-path regression

| Claim | Result |
|---|---|
| `PUBLIC_ELIGIBILITY_PREDICATE_REGRESSION` | **NO** — `publicEligibilityWhere()` untouched |
| `PUBLIC_CATALOG_VISIBILITY_REGRESSION` | **NO** — `CATALOG_ELIGIBILITY_SEMANTICS_PRESERVED=YES`, asserted by unit test |
| `PUBLIC_REVIEW_PUBLICATION_REGRESSION` | **NO** — no review/publication file modified |
| Basic Price writer inventory | **UNCHANGED** — `UNREGISTERED_BASIC_PRICE_WRITER_COUNT = 0`; no writer added |
| PR #65 persisted re-proof | **UNCHANGED** — no PR #65 file modified |

---

## 7. Cost Kernel

Untouched. Formula, exact-Decimal discipline, and provenance requirements are
unchanged; a private AHSP flows through the **same** kernel as a catalog one.
The E2E binding case asserts `coefficient 2 × adapted 100 = 200` per resource
from a **PUBLISHED** Basic Price — private analysis, canonical price.

---

## 8. Schema gate outcome

```
AHSP:        AHSP_SCHEMA_CHANGE = NO   (delivered without schema change)
BasicPrice:  STOP_SCHEMA_DECISION_REQUIRED
```
See `03-SCHEMA-DECISION-PACKET.md`. No migration written; no writer added; no
status overloaded; no private semantics inferred.

---

## 9. Status declaration

```
PR65_MERGED                   = YES
PR65_MERGE_SHA                = 99eff0019f84fe737234bd5fe8586475fd9794ce
NEW_MAIN_SHA                  = 99eff0019f84fe737234bd5fe8586475fd9794ce

RM03B_STATE                   = RM-03B2 DELIVERED · RM-03B1 STOP_SCHEMA_DECISION_REQUIRED
SCHEMA_CHANGE                 = NO
MIGRATION_CHANGE              = NO
DEPENDENCY_CHANGE             = NO
BASIC_PRICE_PRIVATE_SEMANTIC  = NOT EXPRESSIBLE — decision packet supplied
BASIC_PRICE_WRITER_STATUS     = UNCHANGED (2 writers, inventory intact)
PRIVATE_AHSP_USE_E2E          = added (CI-proven)
PRIVATE_BASIC_PRICE_USE_E2E   = NOT APPLICABLE (blocked at schema gate)
CROSS_WORKSPACE_NEGATIVE_E2E  = added (CI-proven)
PUBLIC_PATH_REGRESSION        = NO
COST_KERNEL_E2E               = unchanged + private-AHSP resolution asserted
PERSISTED_RECOMPUTATION_E2E   = unchanged from PR #65
ACTOR_PROVENANCE_FIX          = PASS
CLIENT_SUPPLIED_USER_ID_AUTHORITATIVE = NO
PERSISTED_CREATOR_TRUSTED     = YES
AUDIT_ACTOR_TRUSTED           = YES
ACTOR_SPOOF_NEGATIVE_E2E      = PASS
CATALOG_ELIGIBILITY_SEMANTICS_PRESERVED = YES
BACKEND_TEST_COUNT            = 808 → 845
FRONTEND_TEST_COUNT           = 145 → 150
SAFE_E2E_COUNT                = 407 → 420 (CI, PASS)
E2E_RESIDUAL                  = 0
CI_STATUS                     = ALL GREEN on 3fdac88
E2E_DATABASE_IDENTITY_GATE    = PASS
E2E_RESIDUAL_COUNT            = 0
CI_STATUS                     = ALL GREEN (backend, frontend, Official Safe E2E)
PRODUCTION_DATA_WRITE         = NO
MERGE                         = NO_FOR_RM03B
```

---

## 10. What was NOT verified — stated plainly

- **No browser was opened.** No visual verification is claimed.
- **Safe E2E was not run locally** (§4). It was run in CI and passed there
  (418/418); the run-1 fixture defect it exposed was fixed by a follow-up
  commit, never an amend.
- **Nothing was verified against production data**, by design.
- **Private Basic Price was not implemented or tested** — it is stopped at the
  schema gate, not deferred silently.
- The pre-existing findings in `01-CURRENT-REALITY-MATRIX.md` §E items 6–8
  (no global ValidationPipe, null-workspace AHSP mutability, `resourceId` as a
  plain String) are **reported, not fixed** — each is outside this gate and none
  is leaned on by the private branch.

Soli Deo Gloria. Haleluya. Amin.
