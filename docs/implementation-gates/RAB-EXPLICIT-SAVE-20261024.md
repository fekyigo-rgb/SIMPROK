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

## Phase B — BLOCKING: initial project creation
Owner explicitly requires a new RAB NOT to enter canonical persistence or Proyek Saya until the workspace **Simpan Draft** click. Phase A does NOT fulfill that because POST /projects still occurs in Persiapan RAB.

Required next architecture: truly LOCAL/nonpersistent composition for new RAB before first save, then a single atomic first-save operation that reuses the existing Project and BOQ canonical writers, with classification/location/authorization/idempotency/readback. No fake fix that merely hides already-saved projects, and no deletion of provisional canonical records. Inventory project-bound AHSP/Basic Price/Unit/region consumers before making this change; ensure existing intelligence is reusable without extra engine.

## Release gate
Verify no Project/BOQ structure/RAB document or Project card before first explicit Save; cancel pre-save writes nothing; first Save commits exactly one valid Project + BOQ and readback; discard edits to existing project preserves last saved state; browser/menu/back/reload/401/403/network timeout/retry/saving race tests; independent review; Owner-controlled merge and separate runtime promotion.

## Verdict
PHASE A: staged in isolated worktree. PHASE B: NOT IMPLEMENTED. **MERGE HOLD** until both meet Owner law and authenticated browser proof. Do not claim product-law fulfillment from Phase A tests.
