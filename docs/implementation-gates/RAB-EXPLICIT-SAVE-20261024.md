# SIMPROK — RAB Explicit Save / Exit Intent — Owner Product Law (2026-10-24)

## Owner decision
1. Opening/editing a RAB must NOT silently persist it as a saved draft.
2. Explicit **Simpan Draft** owns persistence; uncertain outcomes never count as success.
3. Exiting with unsaved edits offers **Simpan Draft dan Keluar**, **Buang Perubahan Lokal dan Keluar**, **Tetap Mengerjakan**. Browser tab close/reload only supports browser-native confirmation.
4. Discard local edits to an existing saved RAB does NOT delete its Project, Working Draft, classification, location, or audit.
5. REUSE canonical Project/BOQ/AHSP/Basic Price/RAB lifecycle; no duplicate engine or unsafe DB deletion.

## Confirmed facts from current main
- backend/src/project/project.service.ts create() POST /projects already writes a canonical Project and empty Working Draft BOQ structure (plus classification/location) before workspace navigation.
- frontend/src/pages/ProjectSetupPage.tsx currently labels the first action **Simpan Draft & Lanjut ke Ruang Kerja RAB**. This action saves a Project draft, not a RAB document with BOQ rows.
- frontend/src/pages/RabWorkspacePage.tsx has PUT /projects/:id/boq/draft for explicit BOQ/RAB save and draftDirty for local row edits.
- frontend/src/pages/ProjectListPage.tsx reads GET /projects/mine: created projects appear regardless of whether BOQ rows have been saved.
- Original frontend router was BrowserRouter; a data-router is needed for useBlocker.
- Computer 2 C:\SIMPROK contains unrelated dirty changes; this feature worktree on D: was branched from main a8ad357 without modifying C:\SIMPROK.

## Phase A — implemented in isolated branch, NOT promoted
- React Router 7 data router preserves the existing full route tree, enabling its built-in useBlocker.
- Navigation guard for dirty local edits / in-flight save, and browser-native beforeunload warning.
- Three-choice modal; save-and-exit reuses existing Save Draft handler; leave only after successful server confirmation; failed save does not navigate.
- A late save response from another project or revision cannot erase newer local work.
- Pure regression tests for navigation and save-result identity; frontend build and tests.
- No backend change, DB migration, GitHub main change, or permanent runtime change.

## Phase B — source implementation staged, integration acceptance OPEN
- Persiapan RAB now navigates to a local preparation-backed instance of the SAME RAB Workspace; no POST /projects on Lanjut.
- The new provisional workspace can edit local BOQ rows with no projectId, blocks unsaved exits, and makes its first explicit Save Draft via the existing POST /projects route carrying nested initialDraft.
- CreateProjectDto includes validated initialDraft; ProjectService.create transaction calls the extracted SAME saveDraftBoqInTransaction writer before commit. Existing PUT /projects/:id/boq/draft reuses the same writer and projection, not a parallel BOQ engine.
- PROJECT_CREATE permission remains guarded; initialDraft additionally requires RAB_DRAFT_EDIT resolved through the existing workspace permission authority. No migration, new table, second transaction, or temporary DB project.
- First-save UI re-reads canonical classification/location and saved BOQ identity before claiming success; uncertain 5xx/network/readback blocks blind retries; 4xx rejection remains correctable.
- Project-bound AHSP/Basic Price picker and server BOQ-import approval are not available in local provisional mode; this is an explicit product acceptance gap, NOT proven equivalent to the saved-project journey.
- **Not yet proven:** authenticated end-to-end browser interaction, isolated disposable DB commit/rollback under real Postgres, service permission negative cases, import BOQ before first save, end-to-end navigation/back/reload and uncertain network outcome. Phase B code cannot be merged until verified.

## Release gate
Verify no Project/BOQ structure/RAB document or Project card before first explicit Save; cancel pre-save writes nothing; first Save commits exactly one valid Project + BOQ and readback; discard edits to existing project preserves last saved state; browser/menu/back/reload/401/403/network timeout/retry/saving race tests; independent review; Owner-controlled merge and separate runtime promotion.

## Verdict
PHASE A: locally verified. PHASE B: source implementation and targeted unit tests staged; backend/frontend build verification in progress. **MERGE HOLD / DEPLOY HOLD** until disposable-DB integration, authorized-browser and pending import parity are proven. Never claim production activation from local tests.
