# RAB-AUTO-01 — Read-only BOQ-triggered AHSP discovery
Date: 2026-10-28
Baseline main: 3c5737b29e85753e27c8ed4586bc66fc3f89759d

## In-scope delivery
- Unlinked, persisted, **clean draft** BOQ row: read-only candidate discovery starts on selection, no manual chooser prerequisite.
- Discovery query: bounded first three BOQ tokens, up to 120 characters, with the **existing** project AHSP search route. The anchor is a partial lexical search term, NOT a declaration of identity or specification equivalence.
- Same authenticated app API, projectId, persisted boqItemId, businessPricingAsOfDate, one page/25 candidates, existing backend eligibility and preference rank.
- Key includes project/row/pricing date/BOQ description. 320ms debounce, cancellation on selected row/project/chooser/date change, stale evidence not displayed.
- Fail closed: no eligible results from the anchored search != no AHSP exists in the full catalog; failed request != empty catalog; recommended candidate != authority to auto-select.
- No POST, PATCH, PUT, schema changes, backend edits, Basic Price resolver or Cost Kernel duplication.
- Prior existing drawer feature identifies missing/expired Basic Price from the linked AHSP occurrence reasonCodes, including actual component names.

## Proof matrix
- Frontend focused source tests (4 suites; discovery, composition, resource trust, route/permission): **57 of 57 PASS**.
- Frontend production build (`npm.cmd run build`): **PASS**.
- New pure helper files ESLint: **PASS**.
- Existing RabWorkspacePage lint comparison to main: **9 errors/2 warnings baseline = 9 errors/2 warnings current**, no additional findings.
- `git diff --check`: PASS.
- Earlier backend main baseline six suites: **122 of 122 PASS**, backend build PASS.
- Root `C:\SIMPROK` and parallel AHSP/BP worktrees unchanged.

## Owner BOQ 2.1 proof limit
- Screenshot: BOQ item 2.1 Saluran U Pracetak Tipe DS 10A (140 cm x 140 cm dengan tutup), quantity displayed 1.00 m, AHSP unlinked, price unpriced.
- Live DESKTOP-4FU9292: localhost ports 5173/3000/55432 listening; HTTP 200 at frontend/backend root.
- Independent read-only Postgres attempt against 127.0.0.1:55432/simprok_db was **rejected, SQLSTATE 28P01** (authentication failed). Did not try password guessing, change credentials, circumvent authorization, or mutate database.
- Therefore no proof of the real BOQ's persisted canonical source ID, eligible full-catalog AHSP candidates, Basic Price availability, or authenticated production browser F5 yet.
- A first-page search or synthetic unit tests **never** certify no AHSP or readiness for an automatic link.

## FINAL VERDICT
READ-ONLY AUTODISCOVERY / HONEST EXCEPTION FRONTEND — LOCAL FOCUSED TEST + BUILD PASS.
REAL BOQ2.1 END-TO-END AUTOMATIC AHSP SELECTION AND CALCULATED RAB — HOLD, not proved.
No push, PR, production runtime, permanent DB, or main merge. Further work requires authenticated real-data evidence and an existing-law authority for automatic AHSP selection; do not auto-bind on ranking alone.
