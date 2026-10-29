# RAB-AUTO-07 — Golden Thread E2E preflight and cross-service contract
Date: 2026-10-29 | Computer 2 DESKTOP-1HVD1R0
Branch: feat/rab-auto-06-unified-main-20261029; predecessor unified commit 5db68d8.

## Scope and non-negotiable source truth
Objective: one saved BOQ row -> explicitly verified AHSP code/spec -> canonical AHSP occurrence -> canonical Resource Identity/Basic Price -> Cost Kernel -> authoritative RAB persistence -> subsequent independent DB read, without writes to permanent simprok_db.

## Local E2E environment verification
- PostgreSQL 17.10 binaries are installed at C:\Program Files\PostgreSQL\17\bin.
- Existing local port 5432 is already occupied by a different PostgreSQL instance; NO connection/write to that instance.
- Created a brand-new PostgreSQL **cluster**, restricted to 127.0.0.1:56543, under D:\SIMPROK\ISOLATED-TEST\RAB-AUTO-07-20261029\pg17-data. It started successfully and pg_isready responded ACCEPTING CONNECTIONS.
- The cluster was initialized with scram-sha-256 authentication (do not downgrade to trust or bypass account credentials). The test connection/bootstrap setup was NOT completed; no confirmed isolated simprok_e2e DB/migrated schema or authenticated test actor exists. The repository's own guarded E2E harness requires an explicit .env.e2e file targeting database exactly simprok_e2e; it does NOT exist in this isolated worktree.
- An attempt to configure an authenticated isolated test connection was prevented by tool safety checks. Do NOT bypass the check or borrow Computer 1/Computer 2 permanent DB credentials, do not mutate production DB.
- After preflight the test cluster was stopped safely with pg_ctl -m fast: port 56543 no longer listening, pre-existing port 5432 still listening. The ephemeral plaintext bootstrap password file was deleted. The test-only cluster directory remains isolated and inactive; no permanent PostgreSQL instance was modified.
- Consequently the real PostgreSQL and browser E2E test has NOT RUN. Treat it as BLOCKED, not PASS. Cleanup/stop of the isolated cluster should be recorded after verification.

## Useful additional cross-service proof
- Added src/project-ahsp/rab-auto-07-golden-chain.contract.spec.ts.
- A controlled in-memory test composes the existing RabAutoFirstBindService, RabAutoPriceReadyService, existing Cost Kernel and authoritative RAB persistence writer, using stateful mocks. The test asserts a proven source B.64 link leads to kernel CALCULATED then saved/frozen RAB projection and a repeat does not double-write.
- Two countercases: no explicit source AHSP reference; and multiple selected project regions. Neither may invoke canonical linking or invent monetary totals.
- This is **service integration contract proof, NOT real database persistence**. It makes no claim that the physically stored Resource/Basic Price available for the specific AHSP.
- New 3 contract tests PASS; focused run 3 suites / 17 tests PASS; scoped test ESLint PASS. Integrated earlier RAB-AUTO-06 had 15 suites/104 backend tests and 66 frontend tests PASS, both builds PASS and Prisma validate PASS.
- Backend NestJS production build after new contract tests: PASS. Scoped new-test ESLint PASS, 3 suites / 17 focused tests PASS.

## Missing release proof
- Test-only authenticated Postgres connection, isolated Prisma migrate deploy and fixture provisioning.
- Fixture: approved BOQ source with exact explicit AHSP code and full wording; workspace/project permissions; unique selected region; current applicable AHSP version & classification; 9 known component identities with eligible Basic Prices.
- Run real REST or guarded test-server E2E: ingest -> source approval -> POST auto-bind-explicit-references -> POST auto-price-ready -> GET persisted BOQ/occurrence; restart server and independent GET; prove amounts/source facts and no duplicates, no Rp0, no touch to other workspace.
- Final exact-head Quality Gate, Owner authorized merge and only then Owner authorized permanent runtime cutover (including migration).
- Full RAB Automatic beyond explicit-source evidence remains separately gated.

VERDICT: GOLDEN CHAIN SERVICE CONTRACT PASS LOCAL; ISOLATED DATABASE/BROWSER PERSISTENCE E2E NOT RUN (ENVIRONMENT/AUTH BLOCKER). DO NOT PROMOTE.
