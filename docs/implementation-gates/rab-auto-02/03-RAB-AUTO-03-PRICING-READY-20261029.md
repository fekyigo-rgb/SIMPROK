# RAB-AUTO-03 — Automatic price completion for proven, already-linked BOQ
Date: 2026-10-29
Base: GitHub main 3383cf7 (including merged PR #223)
Worktree: E:\SIMPROK-RAB-AUTO-02-ORCHESTRATION-WT-20261029
Companion UI: Computer 2 D:\SIMPROK\WORKTREES\SIMPROK-RAB-AUTO-01-20261028

## Scope (reuses authority)
- Reuse CostKernelService.calculateBoqItem and RabKernelPersistenceService.persistBoqItemCalculation. NO duplicate pricing/identity algorithm.
- Existing ProjectModule registers RabAutoPriceReadyService/Controller, new RAB-level permission-guarded POST `/projects/:projectId/rab/auto-price-ready?page=N&limit=N`; body `{ "calculationAsOfDate": "YYYY-MM-DD" }`.
- Auth guards: JwtAuthGuard + ProjectAccessGuard + PermissionsGuard(RAB_DRAFT_EDIT). WorkspaceId from trusted ProjectAccessGuard only.
- Query canonical Working Draft, only WORK_ITEM, up to 25/page, stable sort and hasNext; sequential persistence for bounded, auditable writes.
- Skip unlinked AHSP/occurrence as UNPRICED, preserve MANUAL_CLIENT pricing, preserve already SERVER_COST_KERNEL-calculated lines.
- For linked items, require CALCULATED from existing Cost Kernel, then use EXISTING canonical persistence writer which revalidates price/region/date/resources, lineage and project lifecycle under project-row transaction lock. Never copy candidate numeric outputs to draft directly.
- Per-row exceptions are independent, no false zero, no whole-project blocking, no auto lock, no RAB approve.
- A failing/revalidation-conflicted writer is reported WRITE_REVALIDATION_REQUIRED, not a successful calculated line.
- This is an AUTOMATIC CALCULATION stage for lawful linked BOQ items, NOT proof of first-time automatic AHSP selection.

## Critical frozen-persistence correction
- The existing writer deliberately clears `workingOccurrenceId` and preserves `calculationOccurrenceId` on successful persistence.
- RAB-AUTO-02 readiness now distinguishes PERSISTED_CALCULATION_REPROOF_REQUIRED (with valid frozen lineage) from INCONSISTENT_PERSISTENCE_REQUIRES_REVIEW and MANUAL_PRICE_PRESERVED; never treats persisted price as a dangling AHSP relationship.
- Production browser re-proof still requires the existing persisted-calculation reader; readiness alone does not claim verified historical money.

## Region / association facts
- Read-only permanent PG (prior observation): project test "Uji Klasifikasi dan Konteks" has three project region selections: Kota Administrasi Jakarta Selatan (REGENCY_CITY), Menteng (DISTRICT), Sawah Besar (DISTRICT). These are NOT a unique pricing Region. No silent region selection is authorized.
- B.64 DS10A (140x140 with cover) is available DRAFT with 9 components; BOQ 2.1 unit m is eligible candidate, but the first BOQ→AHSP association is not yet proven canonical. BOQ 5.11 unit m1 is not auto-converted to m.
- No first-time auto-binding in this PR. Owner's no-false-certainty law takes precedence over shortcut matching.

## Verification / limits
- Focused backend core unit tests for price-ready and readiness: 17/17 PASS before frozen-persistence correction; full focused after correction 52/52 PASS.
- Frontend post-reconciliation: 63/63 PASS; production UI build PASS.
- Backend production Nest build PASS. Scoped lint after module formatting to be checked.
- Test suite mocks and builds do NOT equal production authenticated browser/DB E2E.
- No writes made against live DB; no worktree other than RAB-owned ones was modified; no main merge/push/runtime promotion. PR #223 permanent promotion belongs to AHSP chat.

## Verdict
LOCAL AUTO-PRICE-READY / READINESS PHASE: TESTED, NOT YET PRODUCTION RELEASED.
FULL FIRST-TIME AUTOMATIC BOQ→AHSP→BP→COST→RAB: NOT YET PASS; requires canonical specification/association proof and authoritative region. Do not claim that the button solves unlinked AHSP.
