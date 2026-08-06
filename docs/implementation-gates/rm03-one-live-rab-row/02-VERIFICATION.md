# RM-03 / ONE_LIVE_RAB_ROW — 02 VERIFICATION

### Dalam Nama Tuhan Yesus Kristus.

Everything below was actually executed unless explicitly marked
`NOT RUN`. Nothing is claimed on the strength of expectation.

| Field | Value |
|---|---|
| BASE_SHA | `3eaa6e4a53d45461192970628b9cf2a3c269d681` |
| Branch | `feat/rm03-one-live-rab-row` |
| Worktree | `E:\SIMPROK DATA PINDAHAN\WORKTREES\USERS-ASUS\SIMPROK-WT-RM03-ONE-LIVE-RAB-ROW` |
| Parent clone | `E:\SIMPROK DATA PINDAHAN\CLONES\SIMPROK-RM03` (fresh clone) |

---

## 1. Repository provenance

`C:\SIMPROK` was checked and **rejected** as the working repository: its tree
was dirty (`M backend/src/workspace/workspace.controller.ts` plus untracked
evidence artefacts) and it held other active work on
`feat/project-notes-honesty`. Per the task's §3 this mandated a fresh clone.

```
git clone https://github.com/fekyigo-rgb/SIMPROK.git   → E:\...\CLONES\SIMPROK-RM03
  origin           https://github.com/fekyigo-rgb/SIMPROK.git   ✓
  origin/main      3eaa6e4a53d45461192970628b9cf2a3c269d681     ✓ == EXPECTED_ORIGIN_MAIN_SHA
  working tree     clean                                        ✓
git worktree add -b feat/rm03-one-live-rab-row ... 3eaa6e4...    ✓ clean at base
```

`STOP_MAIN_MOVED` **does not apply.** The local `origin/main` initially read
`4a3eb51`; a fetch showed this was a stale ref and resolved to the expected
`3eaa6e4`. Main has not moved.

---

## 2. Files changed

| File | Kind |
|---|---|
| `backend/src/project/persisted-calculation.contracts.ts` | new |
| `backend/src/project/persisted-calculation.service.ts` | new |
| `backend/src/project/persisted-calculation.service.spec.ts` | new (test) |
| `backend/src/project/project.controller.ts` | modified — one `GET` route + injection |
| `backend/src/project/project.module.ts` | modified — one provider |
| `backend/test/acceptance/gate2a-rab-kernel-persistence.e2e-spec.ts` | modified — viewer actor + 5 RM-03 cases |
| `frontend/src/utils/rabPersistedCalculationDisplay.ts` | new |
| `frontend/src/utils/rabPersistedCalculationDisplay.test.ts` | new (test) |
| `frontend/src/pages/RabWorkspacePage.tsx` | modified |
| `docs/implementation-gates/rm03-one-live-rab-row/*` | new (3 docs) |

`SCHEMA_CHANGE=NO` · `MIGRATION_CHANGE=NO` · `DEPENDENCY_CHANGE=NO`
No file under `backend/prisma/` was touched. No `package.json` / lockfile changed.

---

## 3. Test results — executed

### Backend unit — **PASS**

```
npm test -- --runInBand
  Test Suites: 67 passed, 67 total
  Tests:       808 passed, 808 total
```

Baseline measured on the same tree with the new spec excluded:

```
npx jest --runInBand --testPathIgnorePatterns "persisted-calculation.service.spec.ts"
  Test Suites: 66 passed, 66 total
  Tests:       797 passed, 797 total
```

**797 → 808 (+11). Zero regressions.** The delta is exactly the new spec.

### Frontend — **PASS**

```
npm test    (tsc --noEmit + node --test)
  tests 145 · pass 145 · fail 0
```

Baseline at `BASE_SHA` was 133 (10 test files). **133 → 145 (+12).**

### Builds — **PASS**

```
backend:  npm run build   (nest build)   → clean
frontend: npx tsc -b --noEmit            → clean
          npm run build   (vite)         → built, 0 errors
```

### Targeted specs

```
npx jest src/project/persisted-calculation.service.spec.ts   → 11 passed
node --test src/utils/rabPersistedCalculationDisplay.test.ts → 12 passed
```

---

## 4. Official Safe E2E — **NOT RUN LOCALLY (deliberate)**

### E2E database identity — reality as measured

A read-only audit established, without writing anything:

| Fact | Value |
|---|---|
| `.env.e2e` present in this worktree | **NO** (gitignored; exists only in an unrelated local worktree) |
| That file's target | `localhost:**5432**/simprok_e2e` |
| Cluster 5432 `system_identifier` | `7645538841198314512` |
| Live production `system_identifier` (per task §2) | `7670529528327835808` |
| Databases on cluster 5432 | `postgres`, `simprok_db` (stale copy, 14 MB), `simprok_e2e`, `simprok_test` |
| Cluster 5432 `current_user` | `postgres` (superuser) |

**Cluster 5432 is a different physical cluster from live production** — the
system identifiers differ, so nothing running there can reach
`127.0.0.1:55432/simprok_db`.

### Why the local run was not performed

The only provisioned `simprok_e2e` lives on cluster **5432**, which the task
§2 forbids touching. Running Safe E2E locally would have violated that
instruction. Docker is not available on this machine, so a throwaway
container could not be substituted.

**Resolution:** the authoritative Safe E2E is CI's own job, which provisions
an ephemeral `postgres:16.4-alpine` service container with
`POSTGRES_DB: simprok_e2e` (`.github/workflows/pr-quality-gate.yml:75-127`)
and writes its own `backend/.env.e2e`. That run touches **neither** the live
production cluster **nor** the local 5432 cluster. It is therefore the
cleanest possible environment for this proof, and it is where
`E2E_DATABASE_IDENTITY_GATE` and `E2E_RESULT` will be established.

### Honest touch accounting

| Counter | Value |
|---|---|
| `SIMPROK_DB_WRITE_COUNT` (live production, 55432) | **0** — never connected |
| Live production cluster connections | **0** |
| `OLD_CLUSTER_TOUCH_COUNT` (5432) | **2 read-only SELECTs**, during the audit: one identity query, one database listing. **0 writes, 0 DDL, 0 resets.** |
| E2E fixtures written anywhere | **0** locally |

This is reported rather than rounded to zero. Two read-only identity queries
were the minimum needed to establish the cluster facts above, which the task
itself requires be recorded.

### The identity gate itself was reviewed and is sound

`backend/scripts/database-role-guards.ts` requires, before any write:

- `NODE_ENV === 'test'` exactly (`:103-105`);
- URL database name `=== 'simprok_e2e'` exactly (`:131-135`) — so any
  `/simprok_db` URL is rejected;
- `SIMPROK_E2E_DESTRUCTIVE_CAPABILITY === 'RESET_SIMPROK_E2E_DATABASE'` (`:136-140`);
- a live `select current_database()` equal to `simprok_e2e` (`:171-174`),
  checked twice — once on a throwaway client and once on the actual locked
  client;
- a symbol-branded `VerifiedE2EDestructiveAuthority` that
  `resetAndSeedE2EDatabase` asserts before spawning `prisma migrate reset`.

Residual safety: `run-e2e-safe.ts:27,39-58` fingerprints every table (row
count **and** `md5` content digest) before and after, and fails the run on any
difference.

Two honest weaknesses observed, neither introduced here and neither fixed
here: `FORBIDDEN_PRODUCTION_DATABASE` is exported but never referenced (safety
rests on the positive allowlist, which is sufficient), and no cluster-level
marker such as `system_identifier` is checked (identity is proven by name
only). `backend/scripts/e2e-database-lifecycle.spec.ts`, which tests the
guards' own negative cases, is run by no npm script and no CI job.

---

## 5. Security / tenant verification

| Check | Result | Evidence |
|---|---|---|
| Workspace-scoped read | PASS | `BoqItem` query scoped `boqStructure.projectId` **and** `project.workspaceId`; asserted in spec |
| Occurrence tenant scope | PASS | `{ id, projectId, workspaceId }`; asserted in spec |
| Actor from JWT only | PASS | `workspaceId` read from `request.projectAccess`, never from the body |
| Permission required | PASS | `RAB_VIEW`; E2E asserts `403` for an actor holding only `BASIC_PRICE_VERIFY` |
| Cross-tenant row | PASS | foreign row returns `BOQ_ITEM_NOT_FOUND`, not a leak |
| Manual price cannot masquerade as kernel | PASS | `MANUAL_CLIENT` → `MANUAL_PRICE_NOT_REPROVABLE`, never a proof |
| No write on the read path | PASS | Prisma double exposes no write method; E2E compares rows byte-for-byte before/after |
| No secret in argv/log/git | PASS | no credential printed; no `.env*` staged; `.gitignore:5-7` unchanged |

---

## 6. Money-law verification

| Rule | Result |
|---|---|
| Exact `Prisma.Decimal` on the canonical path | PASS — no `Number()`, `parseFloat`, or unary `+` in either new backend file |
| Rounding policy reused, not invented | PASS — `toMoneyDecimal2` (OD-04, scale 2, `ROUND_HALF_UP`) |
| Comparison uses the same rounding as the write | PASS — recomputed value rounded identically before `.equals()` |
| `resourceCost` precision preserved in UI | PASS — full fraction shown, never truncated to 2 places |
| No client-side money arithmetic added | PASS — new frontend code formats server strings only |
| `RECOMPUTED_UNIT_PRICE_EQUALS_STORED` | PASS in unit + E2E fixtures |
| `RECOMPUTED_AMOUNT_EQUALS_STORED` | PASS in unit + E2E fixtures |
| `RECOMPUTED_RESOURCE_COSTS_MATCH` | PASS — `2.000000 × 100000.00 = 200000`, summing to the stored unit price |

---

## 7. Schema status

`STOP_SCHEMA_DECISION_REQUIRED` **NOT TRIGGERED.** Per-resource
reproducibility is achievable with the existing schema; see
`01-TRACE-MATRIX.md` Part 1.D. No migration was written.

---

## 8. Known blockers (Level-B)

1. **No production path publishes an AHSP version** — `updateStatus` is
   route-less and caller-less; only `PUBLISHED` versions are bindable.
   Owner/PM authority decision required.
2. **Basic Price permission codes are not seeded** (UTANG-PERMISSION-08).
3. **Resource resolution supports only `PERSON_DAY`, factor 1** — the first
   real row must be chosen accordingly.
4. **Only one real human actor exists** — publication requires two.

None was worked around. No fake actor, price, coefficient, or source was created.

---

## 9. Status declaration

```
LEVEL-A
  RM03_ENGINEERING_READY            = YES
  BACKEND_UNIT                      = PASS (797 → 808, +11)
  FRONTEND_UNIT                     = PASS (133 → 145, +12)
  BACKEND_BUILD                     = PASS
  FRONTEND_BUILD                    = PASS
  SCHEMA_CHANGE                     = NO
  MIGRATION_CHANGE                  = NO
  DEPENDENCY_CHANGE                 = NO
  E2E_DATABASE_IDENTITY_GATE        = DELEGATED_TO_CI (not run locally, by design)
  E2E_RESULT                        = PENDING_CI
  E2E_RESIDUAL_COUNT                = PENDING_CI
  SIMPROK_DB_WRITE_COUNT            = 0
  OLD_CLUSTER_TOUCH_COUNT           = 2 read-only SELECTs, 0 writes
  PRODUCTION_REALITY_DATA_WRITTEN   = NO
  GOLDEN_THREAD_LIVE_CLOSED         = NO

LEVEL-B
  ONE_LIVE_RAB_ROW                       = NOT PASSED
  BASIC_PRICE_TO_RAB_GOLDEN_THREAD_PROOF = NOT PASSED
  GOLDEN_THREAD_CLOSED                   = NO
  GATE2B_READY                           = NO
  STATE = WAITING_OWNER_ONE_ROW_REALITY_INPUT
  STATE = WAITING_OWNER_REAL_BASIC_PRICE_ACTOR

MERGE                = NO — Owner only
PRODUCTION_ACTIVATION = NO — Owner only
```

---

## 10. What was NOT verified — stated plainly

- **No browser was opened.** No visual verification of any kind is claimed.
  Owner's eyes remain the final verdict (Doktrin Cermin).
- **Safe E2E was not executed locally**, for the cluster reason in §4. The
  five new E2E cases are type-clean and syntactically valid but their runtime
  behaviour is unproven until CI runs them. If CI fails, it will be fixed with
  a new commit — never an amend.
- **Nothing was verified against live production data**, by design.
- The pre-existing 26 `tsc -p tsconfig.json` strictness errors in untouched
  files remain; they are outside the CI gate (`nest build` uses
  `tsconfig.build.json`; ts-jest transpiles without type-checking because
  `isolatedModules: true`). None is in a file this gate touched.

Soli Deo Gloria. Haleluya. Amin.
