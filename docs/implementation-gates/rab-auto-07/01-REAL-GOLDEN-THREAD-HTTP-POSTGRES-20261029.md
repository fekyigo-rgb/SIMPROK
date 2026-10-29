# RAB-AUTO-07: Actual HTTP + PostgreSQL Golden Thread — Verified
Date: 2026-10-29, Asia/Jayapura
Machine: Computer 2 / DESKTOP-1HVD1R0
Source branch: feat/rab-auto-06-unified-main-20261029, parent commit 43d4026.
Scope: isolated, authenticated synthetic fixture. NO writes to permanent runtime, PostgreSQL 5432, or simprok_db.

## Isolated PostgreSQL identity and migration
- Separate PostgreSQL 17 instance created on 127.0.0.1:56543; DB simprok_e2e; dedicated principal simprok_rab_test_admin.
- App E2E config is LOCAL, .gitignored backend/.env.e2e. Password and test-only JWT secret are not in git, reports or console output. Bootstrap secret file removed.
- Read-only database identity gate PASS (database, principal, port and exact 127.0.0.1 IPv4 /32 loopback). Existing project E2E role/capability guards PASS.
- Official reset+migrate+seed via existing e2e-database-lifecycle.ts PASS; schema includes RAB-AUTO-05 sourceAhspCode.
- Built a narrow verified test runner reusing canonical E2E guard, PostgreSQL advisory lock, 98-table baseline/final fingerprints, and standard Jest E2E suites.

## Combined real HTTP + DB proof
ONE combined process on Computer 2 ran:
- test/acceptance/boq-import.e2e-spec.ts: 18/18 PASS
- test/acceptance/project-ahsp-occurrence.e2e-spec.ts: 34/34 PASS
- test/acceptance/gate2a-rab-kernel-persistence.e2e-spec.ts: 20/20 PASS
- test/acceptance/rab-auto07-first-binding.e2e-spec.ts: 1/1 PASS
TOTAL: 4/4 suites, **73/73 tests PASS**.
Canonical E2E runner says RAB_E2E_JEST_STATUS=PASS, RAB_E2E_RESIDUAL_STATUS=PASS. Exactly 98 baseline tables fingerprinted; post-test all stable. DB advisory lock released.
The intentionally injected TEST_BOQ_BUSINESS_USE_WRITE_FAILURE appears in the BOQ suite log as a negative transaction rollback check; that suite passed. It is NOT a new production defect.

## One real Golden Thread (not mocked)
- E2E creates a synthetic workspace, project, authenticated actors with distinct permissions and real sessions; a single selected pricing region; a proper construction classification tree.
- A resource and price submission go through real HTTP ACCEPT by verifier and PUBLISH by a different actor: resulting Basic Price evidence is admissible.
- Imports a real XLSX with fields No / Uraian / Volume / Satuan / Kode AHSP through the existing preview + approval HTTP endpoints. Source code B.64 persisted into actual BoqItem.sourceAhspCode; source approval BoqBusinessUseEvent exists.
- One owned private AHSP B.64 and DRAFT version with canonical classification and 1 material resource, coefficient 2 Kg, matches full BOQ text and unit Kg.
- The actual POST working-draft/auto-bind-explicit-references returns FIRST_ASSOCIATION_PROVEN_AND_LINKED. The parent AHSP and project occurrence are not duplicated.
- The actual POST /rab/auto-price-ready uses Cost Kernel + existing authoritative persistence. Basic Price 100000.00 x coefficient 2 = unitPrice 200000.00; quantity 5 = lineTotal 1000000.00.
- The NestJS application is closed and recreated; authenticated GET persisted-calculation returns VERIFIED; stored and independently recomputed 200000.00 / 1000000.00 match, allResourceCostsReproduced true.
- A second pricing request returns ALREADY_CALCULATED, without duplicate occurrence or money write.
- On the same BOQ before success, an additional selected region forces PRICE_REGION_NOT_UNIQUE, NO occurrence and NO unit price. The second region is then removed and the proven path succeeds.
- Cleanup and baseline comparison leave zero test residuals.

## Regression and build evidence
- Backend RAB, AHSP One-Truth and source/identity focused regression: 17/17 suites, 118/118 PASS.
- Frontend RAB workspace+component product tests: 66/66 PASS.
- NestJS backend build PASS; Vite/TS frontend production build PASS.
- New E2E scripts and tests scoped ESLint PASS (test-only Supertest untyped JSON exception, no production kernel lint bypass).
- The true product UI authenticated browser/F5 interaction has NOT been run; HTTP app reconstruction+GET is not a claim of browser proof.

## Boundaries of the verdict
1. This proves ONE complete RAB line using an explicitly approved AHSP source code, exact full description, unambiguous region, original classification, price resource and unit identity. It does not prove BOQ without AHSP reference, all resources/prices, varied dates, large BOQs, or all real projects.
2. Grade A proven for this fixture and its canonical stored computation, NOT broad nationwide or production Grade A.
3. PR #227 reached upstream main (6ced853) during this work; branch integration must selectively sync upstream with clean rebase and rerun affected gates before any release.
4. NO push, merge, permanent DB migration, or runtime sync is authorized or performed by this checkpoint.
5. No network-based AI model was involved in generating or authorizing monetary calculation: RAB is computed natively by SIMPROK services/Cost Kernel.

VERDICT: ONE REAL FIRST-AHSP-ASSOCIATION GOLDEN THREAD E2E **PASS**, 73/73 HTTP + PostgreSQL COMBINED, RESIDUAL PASS. BROAD RAB AUTO / AUTHENTICATED BROWSER / EXACT-HEAD CI / PROD PROMOTION: STILL SEPARATE GATES.
