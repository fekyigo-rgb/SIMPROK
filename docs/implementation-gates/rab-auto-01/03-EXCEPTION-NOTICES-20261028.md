# RAB-AUTO-01 — Honest Availability & Basic Price Exception Notices
Date: 2026-10-28
Baseline: origin/main 3c5737b29e85753e27c8ed4586bc66fc3f89759d
Branch: feat/rab-auto-01-one-real-line-20261028
Working tree: D:\SIMPROK\WORKTREES\SIMPROK-RAB-AUTO-01-20261028

## Owner-accepted behavior
1. If no AHSP suitable for a BOQ, SIMPROK must tell the user honestly.
2. If AHSP is linked but an AHSP resource/item lacks eligible Basic Price, SIMPROK must identify the missing resource, not invent Rp0.
3. Exceptions are visible in the ordinary RAB drawer; no separate module and no duplicate resolver.

## Implemented narrow delta
- Added `frontend/src/utils/rabAvailabilityNotice.ts` as a PURE presenter, not a matcher.
- Added matching 6 targeted tests.
- Connected presenter to the EXISTING `RabWorkspacePage` AHSP analysis drawer (no new API, no backend changes, no schema).
- For an AHSP-linked BOQ, use the EXISTING occurrence GET with per-resource `reasonCodes`. `NO_BASIC_PRICE_CANDIDATE` shows resource name and missing eligible Basic Price. `ONLY_EXPIRED_BASIC_PRICE_CANDIDATES` shows source prices expired; treated separately.
- Unproven identity, unproven unit, specifications conflicting, loading/failed responses are NEVER misrepresented as Basic Price being absent.
- For an unlinked BOQ, distinguish AHSP not yet assessed, request failing, a bounded search returning zero, a nonrecommending candidate set, and recommended candidates without authorized equivalence. No overclaim that the entire AHSP catalog is empty.
- Keep existing per-resource trust explanations and the cost kernel unchanged.
- Preserve existing manual-price copy in the AHSP drawer even when no AHSP is linked; do not present an explicitly manual amount as a Cost Kernel failure.
- Preserve candidate-count text while a user changes an already-linked AHSP; search notice additions do not blank that established workflow.

## Local proof
- Frontend `npm.cmd run build` = PASS (tsc + vite).
- Focused `node --test` with the new suite plus source trust, composition, and workspace-door law = **54/54 PASS**.
- New files scoped ESLint = PASS.
- Existing `RabWorkspacePage.tsx` ESLint comparison vs exact baseline: baseline 9 errors/2 warnings; modified 9 errors/2 warnings, SAME rule family counts (7 set-state-in-effect, 1 immutability, 2 exhaustive-deps, 1 refs).
- `git diff --check` = PASS.
- Prior baseline backend 6 suite 122 tests PASS and backend build PASS (no backend changes in this delta).

## Remaining hard gate
- NO complete-catalog authority of 'no matching AHSP' exists here: search is lexical and paginated; the UI truthfully only says no candidate surfaced from **the current search**. A positive 'none exists' verdict requires complete governed selection/eligibility evidence, not frontend inference.
- NO automatic BOQ-to-AHSP bind or real price persistence is proven here.
- NO authenticated browser proof or isolated DB E2E for this new UI delta yet.
- NO production DB mutation, main merge, push, runtime sync, or CI claim.

## Verdict
RAB-AUTO-01 HONEST EXCEPTION NOTIFICATION PRESENTATION — LOCAL BUILD & FOCUSED TESTS PASS.
PRODUCTION RUNTIME / AUTO-SELECTION / REAL-BOQ E2E — PENDING.
