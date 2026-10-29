# RAB-AUTO-07 — hard proof of test target isolation; E2E status

Date: 2026-10-29 Asia/Jayapura
Computer 2: DESKTOP-1HVD1R0
Branch: feat/rab-auto-06-unified-main-20261029
Protected: original RAB worktree, GitHub main, existing runtime/database, both AHSP/BP streams.

## Execution evidence
- Created new isolated PostgreSQL 17.10 cluster at D:\SIMPROK\ISOLATED-TEST\RAB-AUTO-07-20261029\pg17-data, started listening exclusively on 127.0.0.1:56543. Existing 5432 listener unchanged.
- Database test-auth bootstrap / .env.e2e is NOT complete. Credentials unavailable; do not borrow production secrets. No SQL migration, fixture inserts, or real database Golden Thread was executed.
- Safely stopped isolated cluster and deleted ephemeral initialization password file. 56543 stopped; 5432 still listening. Test-only data directory preserved, stopped.
- Added a pure target-policy guard `src/project-ahsp/rab-auto-07-isolated-db-target.ts` that allows ONLY postgresql://simprok_rab_test_admin@127.0.0.1:56543/simprok_e2e (password required, schema optional public). It refuses wrong host/port/db/actor/blank credentials and never prints the secret.
- Added `scripts/rab-auto-07/verify-target.ts`: uses the existing official `database-role-guards.ts` E2E law AND the extra loopback/port/actor policy, performs ONLY a read-only PostgreSQL live identity query. It does not mutate data or create schema.
- With missing .env.e2e, running the preflight returns NONZERO and `RAB_E2E_ENVIRONMENT_OR_CONNECTION_NOT_READY`: FAIL CLOSED AS INTENDED; no DB accessed.
- The new target guard test suite: 11 tests PASS, including rejecting simprok_db, wrong port 5432, wrong host and usernames, bad schema and secret-disclosure checks.
- The cross-service stateful mock-contract suite: 3 tests PASS. Combined focused 2 suites / 14 PASS, new code ESLint PASS. These remain code/contract proofs, not persisted PostgreSQL E2E.
- Backend NestJS production build after the new guard addition: PASS. New code scoped ESLint PASS. No source-level engine or runtime production changes.

## What is still required for genuine product PASS
1. An authorized TEST-ONLY authenticated local credential and a dedicated simprok_e2e database on private cluster 127.0.0.1:56543; .env.e2e for this isolated branch using the existing E2E reset authority, with no sensitive secret ever transmitted through ChatGPT text.
2. Run read-only `tsx scripts/rab-auto-07/verify-target.ts`; it must PASS before any migration or fixture operation.
3. Execute Prisma migrations/required acceptance seed against VERIFIED test-only DB, then positive and negative real HTTP E2E: approved BOQ with explicit AHSP code, original AHSP identity + classification, authorized unique pricing region, 9 resource components with admissible Basic Price, original selectForBoqItem transaction, Cost Kernel, RabKernelPersistenceService, persisted GET independently after restart/F5. Ensure no duplicate AHSP, no fake zero money and no cross-tenant effects.
4. Exact-head GitHub Quality Gate and Owner's explicit merge/runtime/migration approval.

## Verdict
GUARDED ISOLATION / SERVICE CHAIN CONTRACT: TESTED AND PASS.
REAL DB/HTTP/F5 GOLDEN THREAD: HOLD — AUTHENTICATED TEST-ONLY DB NOT PROVISIONED.
DO NOT CLAIM THE RAB IS FULLY AUTOMATICALLY PRICED OR PROMOTE TO PERMANENT.
