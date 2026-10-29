# RAB-AUTO-02 — Post-PR #223 compatibility and bounded whole-BOQ readiness

Date: 2026-10-29 (Asia/Jayapura)
Mandate: Owner assigns AHSP Import PR #223 runtime promotion to another chat. This worktree exclusively implements the RAB orchestration seam.

## Source synchronization (isolated branch only)
- GitHub main after PR #223: 3383cf7ca6771573174f6cc0c8c73097dc2bb4c6.
- Computer 1 isolated RAB branch successfully rebased atop that main, without conflicts. C1 prior commit 987aa21 rewritten to 8c412dd.
- Computer 2 RAB-AUTO-01 frontend branch also rebased atop the same main without conflicts; focused frontend 59/59 tests PASS and production build PASS.
- Computer 1 permanent source main, all AHSP/BP worktrees, database and runtime were NOT changed.
- PR #223 only touches backend AHSP import canonicalization and two onetruth regression test files; no overlapping files with this RAB branch.

## Native intelligence vs AI
- SIMPROK owns eligibility, price-region/source governance, Resource Identity/Unit Kernels, AHSP resolution and Cost Kernel. These deterministic services are canonical authority.
- An optional external-AI provider adapter exists under SimprokIntelligenceOrchestrator; permanent backend runtime has SIMPROK_AI_PROVIDER unset, selecting disabled. Its RAB proposal path is draft-only, currently basicPriceCandidates=[].
- AI must NOT authorize AHSP applicability, region, Basic Price, or verified money.

## New project-wide readiness step
- Reuses *exactly* RabAutoReadinessService.assess as the one-row evaluator; no second matcher, BP resolver or Cost Kernel.
- GET /projects/:projectId/ahsp-occurrences/boq-items/working-draft/automation-readiness?businessPricingAsOfDate=YYYY-MM-DD&page=N&limit=N
- Same existing JwtAuthGuard, ProjectAccessGuard, PermissionsGuard/AHSP_VIEW; project and workspace bound in the DB predicate.
- Sorted, paged WORK_ITEM rows from the canonical Working Draft; page <= 10000 and limit <= 25. Only one bounded page loaded, and at most 3 AHSP evaluation calls in parallel. The API reports hasNext; it NEVER calls a mutation endpoint.
- Returns per-row kind plus counts; failing one row returns READINESS_UNAVAILABLE_REQUIRES_REVIEW without erasing other rows or writing Rp0. Candidate universe pagination >50 still fails closed.
- A single ranked candidate, including exact-label B.64, is NOT proof of canonical AHSP-BOQ association. No automatic write while that authority and selected price region are unproved.

## Real project constraints (per earlier READ-ONLY permanent PG audit)
- Project Uji Klasifikasi dan Konteks: 32 work items, 0 linked, five new active AHSP.
- B.64 (DS 10A 140x140 cm with cover): private DRAFT v1, unit m, nine components; one matching BOQ is m, another is m1, therefore do not treat as interchangeable.
- Three project region selections exist; neither their count nor an absent project free-text location authorizes selecting one exact referenceRegionId silently.
- No evidence yet that every resource has an eligible Basic Price for this region/date.

## Post-PR223 test proof
- Computer 1 focused Jest: 6/6 suites **54/54 PASS** (readiness single+batch, AHSP eligibility, AHSP search, PR223 One-Truth reconciliation, PR223 safety).
- Computer 2 frontend focused: 59/59 PASS, production build PASS.
- NestJS backend production build: **PASS** after PR #223 reconciliation.
- Backend scoped ESLint (readiness service/controller, single+batch tests, module): **PASS**.
- Browser production E2E and automatic persisted BOQ–AHSP binding: **NOT YET PASS**.
- DB permanent unchanged. No git push, merge or runtime sync performed.

VERDICT: PR223 source compatibility verified locally; whole-BOQ READ-ONLY readiness implemented and unit tested; actual autonomous AHSP binding and priced RAB remain HOLD until canonical association and region authority can be proved.
