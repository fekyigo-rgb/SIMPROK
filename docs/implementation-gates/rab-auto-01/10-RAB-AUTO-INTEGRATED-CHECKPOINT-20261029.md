# RAB-AUTO — UNIFIED ISOLATED INTEGRATION CHECKPOINT
Date: 2026-10-29 (Asia/Jayapura)
Source: upstream GitHub main 3383cf7 (PR #223 merged; not claiming runtime promotion).
Unified worktree: D:\SIMPROK\WORKTREES\SIMPROK-RAB-AUTO-01-20261028
Computer 1 source RAB backend commit e5528a2. Computer 2 source RAB frontend commit d9ec9d2.

## Integration proof
- Both original branches rebased onto the same main 3383cf7 with no conflicts.
- The backend ONLY code/docs diff from Computer 1 was exported as an exact git patch and transferred to Computer 2 isolated RAB worktree; `git apply --check` PASS; `git apply` PASS without conflicts.
- The transfer patch was removed from the target after successful application.
- No permanent runtime source or simprok_db mutation and no AHSP/BP worktree changes.
- On the now unified source: backend 7/7 focused suites **62/62 PASS**, including PR #223 One-Truth reconciliation/safety, AHSP search/eligibility, RAB single and batch readiness, and auto price-ready writer orchestration.
- Computer 2 frontend focused: **63/63 PASS**, frontend production build PASS, new helper ESLint PASS and existing full RabWorkspacePage lint baseline **9 errors / 2 warnings** equals current **9 / 2** (no regression).
- Computer 2 integrated backend production NestJS build: **PASS**.
- Computer 2 unified scoped backend ESLint: **PASS**.
- Computer 1 backend source previously production build and scoped lint PASS.

## Product path and authority
1. Opening a persisted editable RAB automatically GETs RAB readiness in bounded pages. Backend checks WORK_ITEM under trusted project/workspace, reuses existing AHSP eligibility/currentness/Unit Kernel preference and exposes honest exceptions. Candidate recommendation != identity proof.
2. A prepared linked AHSP occurrence may produce a canonical Cost Kernel result. The RAB-level `Hitung yang Siap` control calls POST auto-price-ready, which NEVER chooses AHSP and ONLY persists an existing valid CALCULATED result through RabKernelPersistenceService.
3. Missing AHSP, missing resource, unavailable Basic Price, Unit conflict, stale price, multiple candidates, manual pricing, already frozen calculations and write-time conflicts stay honest exceptions/preserved.
4. Persisted price is recognized by calculation occurrence (NOT working occurrence); no false broken-link status, no re-assignment or re-pricing.
5. A RAB may remain incomplete, while other provably ready linked rows are costed. No RAB lock/approval, no invented Rp0.

## Crucial non-PASS facts / next lawful gate
- **First-time BOQ → AHSP automatic binding remains blocked by canonical association proof and authorized reference pricing region**. Current main preference ranking uses name/classification recall and is not authoritative proof.
- Test project has 32 WORK_ITEM and 0 AHSP links; B.64 DS10A 140x140 with cover appears a candidate but is NOT auto-bind-authorized solely by label. Another BOQ variant has unit m1 instead of m.
- Project stores region selections for Jakarta Selatan, Menteng, Sawah Besar; distinct authority contexts, not one unambiguous referenceRegionId.
- AI orchestrator remains an optional proposal path; production AI provider disabled. All costs are from native Cost Kernel and canonical Basic Price, not LLM.
- No isolated database E2E, authenticated browser new UI proof, or F5 persisted proof; no GitHub PR/CI exact-head, no main merge, no push, no permanent runtime promotion in RAB stream.

VERDICT: UNIFIED READINESS + CANONICAL COSTING FLOW LOCAL TEST PASS; FULL AUTO AHSP BIND + LIVE RAB E2E HOLD.
