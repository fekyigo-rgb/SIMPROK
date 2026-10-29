# RAB-AUTO-01 / AHSP upstream — Browser Empty-List Evidence (28 Oct 2026)

## Grounded browser evidence (Owner screenshot)
- URL: `localhost:5173/ahsp`.
- Browser DevTools: **Disable cache enabled**.
- Authenticated in-app `GET http://localhost:3000/ahsp`: **200 OK**.
- DevTools **Response** body: exact JSON `[]`.
- AHSP screen shows "Belum ada AHSP yang tersedia dalam workspace ini." with source "Semua", blank search, filters on "Semua".
- This establishes: **the authenticated /ahsp list returned ZERO AHSP entries** for the server-resolved workspace and shared catalog visibility at that observation time.
- It does **NOT** establish that the whole database lacks AHSP, that import journals were deleted, or that archived/deleted/other-workspace rows do not exist.

## Canonical code reading (main-derived RAB isolated worktree)
- `AhspRoomPage` `GET /ahsp`, successful array => READY; `[]` is honestly rendered as empty. Earlier hypothetical malformed nonarray concern is now ruled out for this observed request.
- `AhspController.list`: permission `AHSP_VIEW`, workspace taken from trusted `request.workspaceContext.workspaceId`, not a URL query parameter.
- `AhspService.list(workspaceId)`: nondeleted AHSP parent rows in **workspaceId == active OR workspaceId IS NULL (shared)**. Does not require an eligible RAB formula (output unit/resources/dates); its empty result is therefore stronger than a RAB chooser empty result, but only for that workspace and global/shared scope.
- `ProjectAhspService.searchEligibleVersions` applies additional eligibility and paged lexical search; it cannot manufacture a candidate if /ahsp has no visible source parents under that same workspace.

## Local environment observation, NOT DB count
- Connected Computer 1 DESKTOP-4FU9292: listeners frontend :5173, backend :3000, PostgreSQL :55432 active.
- Independent PostgreSQL read-only access previously rejected `28P01` (authentication). No credential guessing, PG write, database migration, or alternate authorization attempted.
- Computer 1 has active dirty AHSP / BP worktrees and branch state. Preserve them.

## Narrow gate verdict
**UPSTREAM AHSP LIST EMPTY — CONFIRMED FROM REAL AUTHENTICATED BROWSER HTTP 200 / []**.
**ROOT CAUSE (workspace vs DB environment vs absent actual parent rows) — NOT YET CONFIRMED**.
**REAL RAB-BOQ 2.1 AHSP AUTO-BIND / COST — BLOCKED BY UPSTREAM DATA PROOF; NO PRICE FABRICATION**.
- DO NOT import or recreate AHSP simply because the library is empty.
- DO NOT modify AHSP/BP parallel build from this RAB branch.
- Next authority: read-only verification of trusted current workspace against the actual permanent PostgreSQL data **through established authorized connection**; count AHSP parents by scope, deleted/archived state, and compare expected project workspace and user workspace (no row mutations).
- Reuse existing RAB notifications; retain RAB-AUTO-01 candidate/discovery branch, not merge to main or permanent until E2E proof.
