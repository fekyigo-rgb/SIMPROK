# RAB-AUTO-01 — Visible project-wide orchestration / RAB-level calculation
29 Oct 2026 | Rebased onto main 3383cf7 with PR #223, zero conflicts.
Worktree: D:\SIMPROK\WORKTREES\SIMPROK-RAB-AUTO-01-20261028

## Product effect from existing backend authority
- When a SAVED editable Working Draft RAB opens, frontend automatically calls the canonical new RAB-AUTO-02 read-only `GET /projects/:projectId/ahsp-occurrences/boq-items/working-draft/automation-readiness`, paged 25 (max 20 pages/500 work items).
- Reads only server verdicts, no second matcher or browser price engine.
- Shows a compact live per-project summary within the EXISTING RAB toolbar: counts of AHSP-linked, persisted frozen calculation needing re-proof, manual pricing retained, missing eligible AHSP, needing identity proof, and other exceptions. No new module/page.
- A bounded malformed/stale/failed response can never appear as a verified successful full-project audit; draft edits/project changes invalidate and cancel display.
- Existing `Pilih/Ganti AHSP`, source AHSP availability evidence, resource reason-code disclosure and Cost Kernel remain unchanged.
- A single RAB-level `Hitung yang Siap` action appears ONLY when existing canonical readiness declares >=1 lawfully linked working occurrence, on editable SAVED draft without local modifications.
- Action uses new backend POST `/projects/:projectId/rab/auto-price-ready` sequentially by page; backend determines which linked rows are CALCULATED and persists ONLY via existing authoritative cost writer. Other lines remain UNPRICED/exception.
- UI uses draft revision and project switching guards so success or partial failure never overwrites concurrent local edits when refreshing server draft. Never claims complete success on a partial failure.
- This is not automatic *first-time* AHSP binding, and does not resolve an ambiguous price region. Do not claim full RAB Auto E2E.

## Validated local evidence
- Focused frontend tests: 63/63 PASS, incl. 4 new readiness page-parser/status tests; frontend production build PASS; pure utility scoped lint PASS.
- Server API backend contracts need both AHSP_VIEW and RAB_VIEW for read; RAB_DRAFT_EDIT for POST.
- Production authenticated browser click / full DB roundtrip / F5: NOT PROVEN.
- Main/permanent runtime/DB and parallel AHSP/Basic Price worktrees unchanged.
- PR223 promotion assigned to AHSP chat; not attempted here.

VERDICT: UI read-only status + scoped RAB-level price completion wired and locally tested; 0 of 32 BOQ still lack authoritative first-time AHSP binding on the test project. Do not fake matching or money.
