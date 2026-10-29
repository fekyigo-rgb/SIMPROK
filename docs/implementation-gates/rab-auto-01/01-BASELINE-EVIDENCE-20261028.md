# RAB-AUTO-01 — Independent Baseline Gate (2026-10-28)

## Source of truth and non-overlap
- Repo: fekyigo-rgb/SIMPROK.
- Exact baseline: origin/main `3c5737b29e85753e27c8ed4586bc66fc3f89759d` (merged PR #217).
- Isolated worktree: `D:\SIMPROK\WORKTREES\SIMPROK-RAB-AUTO-01-20261028`.
- Isolated branch: `feat/rab-auto-01-one-real-line-20261028`.
- Existing dirty worktrees on both connected computers protected; no modifications to them.
- No `simprok_db` writes; no production readback, migrations, merge or runtime sync.
- Owner product law: https://github.com/fekyigo-rgb/SIMPROK/issues/71
- Historic PR #197: selectively HOLD, do not merge its stale full diff.

## Exact on-main wiring (verified from source)
1. `backend/src/project-ahsp/project-ahsp.service.ts`: `searchEligibleVersions` pages eligible AHSP by name/code/method, default page size 25; `attachProjectPreference` annotates/ranks against selected project classification and BOQ description; `selectForBoqItem` takes explicit AHSP version, date, region, and idempotency key, enforces lifecycle, eligibility, output-unit compatibility, and invokes the existing resource-resolution orchestrator in one transaction.
2. `backend/src/project-ahsp/ahsp-preference.ts`: classification and name token evidence produce `preference.recommended`, **not an authoritative identity/equivalence proof**. Multiple rows may be recommended simultaneously; `CROSS_CATEGORY_FALLBACK` is only a ranking distinction.
3. `backend/src/project-ahsp/ahsp-resource-resolution.orchestrator.ts`: existing one-source resource + Basic Price resolution; do not rebuild.
4. `backend/src/project/cost-kernel.service.ts`: existing single/batch calculation; do not rebuild.
5. `frontend/src/pages/RabWorkspacePage.tsx`: selection is still explicit with chosen `ahspVersionId` and `referenceRegionId`; NO verified all-BOQ automatic selection claim.
6. `backend/src/project/rab-intelligence-proposal.service.ts`: bounded read-only proposal; `basicPriceCandidates: []` explicitly. It cannot be promoted into authoritative RAB costing without a proven relationship.

## Protected safety finding — why a 'recommended #1' cannot auto-write
- Recommendation can be nonunique even within a page, and a paginated search does not prove catalogue-wide uniqueness.
- Lexical/classification match is candidate evidence, not enough to prove AHSP identity, output requirements, material/equipment specification or scope.
- A missing relationship must remain an honest `NEEDS_REVIEW` / `UNPRICED` exception, never a fabricated `VERIFIED` price.
- Existing verified mapping must be reused through existing authorities; no second matcher, resource resolver, unit converter or Cost Kernel.

## Actual local proofs (isolated)
- 2026-10-28: fresh `npm ci` backend dependencies in this worktree (835 packages), generated Prisma client matches the new main enums. Earlier failed test caused by stale **external** reused Prisma client, not by the code; external junction unlinked, original dependencies remained intact.
- Focused unit: 6/6 suites, **122/122 tests PASS**:
  `ahsp-preference.spec.ts`,
  `project-ahsp-search.spec.ts`,
  `ahsp-eligibility.policy.spec.ts`,
  `project-ahsp.service.spec.ts`,
  `ahsp-resource-resolution.orchestrator.spec.ts`,
  `cost-kernel.service.spec.ts`.
- Backend `npm.cmd run build`: **PASS**.
- Worktree product code remained unchanged at this gate. No full E2E/database/browser/actual BOQ proof claimed.

## Next narrow implementation gate — NOT YET PASSED
- Identify **one real, authorized, persisted BOQ WORK_ITEM** with actual AHSP and Basic Price candidates. Read-only source proof first; never invent fixture results as production.
- Determine whether existing canonical evidence can safely prove a unique AHSP without using mere score/rank/page position. Check complete candidate universe, specification precedence, workspace/region/date, eligibility, and exact unit.
- If proof exists: reuse existing `selectForBoqItem` and current Cost Kernel/persistence contracts; test deterministic repeated request, F5/readback, and traceable money.
- If proof does not exist: produce isolated honest exception; do not auto-bind, do not write price zero, do not stop other rows.
- Any missing minimal RAB-only orchestration must be introduced on this isolated branch AFTER a verified gap is shown and must pass unit, safe isolated E2E, authenticated browser, exact-head CI and independent review. OWNER explicitly authorizes merge/promotion separately.

## Verdict
PRE-FLIGHT (main baseline + six focused unit suites + backend build): PASS.
REAL-BOQ AUTOMATED SELECTION / PRICE PERSISTENCE: NOT PROVED / HOLD.
NO PR OR PERMANENT PROMOTION AUTHORIZED.
