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
- **Still open:** isolated browser network-drop-after-commit and retry suppression; separate browser Save Draft dan Keluar acceptance; browser refresh/tab-close native warning; pre-first-save Import BOQ/AHSP capability parity; independent code review and GitHub Quality Gate. The canonical first-save and rollback, security negatives and saved-draft discard HAVE now been independently exercised on real Postgres and an authenticated browser.

## Release gate
Verify no Project/BOQ structure/RAB document or Project card before first explicit Save; cancel pre-save writes nothing; first Save commits exactly one valid Project + BOQ and readback; discard edits to existing project preserves last saved state; browser/menu/back/reload/401/403/network timeout/retry/saving race tests; independent review; Owner-controlled merge and separate runtime promotion.

## Verdict
PHASE A + PHASE B CORE JOURNEY: locally verified by backend/frontend builds, targeted and full frontend tests, real Postgres atomic rollback, and authenticated browser save/discard/readback. **MERGE HOLD / DEPLOY HOLD** until the remaining network-uncertainty, Save-and-Exit, local-mode import/AHSP parity, independent review and CI concerns have been adjudicated. Never equate local acceptance with production activation.

## Independent isolated verification — 24 Oct 2026 (Computer 2)
- Clean isolated PostgreSQL 17 test cluster on 127.0.0.1:55436, own D-drive data directory, separate from installed SIMPROK PostgreSQL :5432. All 81 official migrations applied. No production database mutations.
- Actual Prisma ProjectService create() against real Postgres: malformed duplicate BOQ row rejected, full transaction rolled back (0 new Project, BOQ structure, BOQ rows, or project classification selections); valid first save persisted **one** Project, **one** structure, **two** items with preserved folder parent, **three** classification selections, **one** region; original metadata-only create retained. Evidence: `RAB-FIRST-SAVE-ACCEPTANCE-20261024/real-postgres-proof.json`.
- Authenticated browser against isolated Nest backend :3126 and Vite frontend :5196: 10/10 PASS. New RAB preparation and workspace entry caused no POST /projects/no DB entry; "Tetap Mengerjakan" preserved local rows; "Buang Perubahan Lokal" exited without creating a project; first explicit Save Draft created exactly one Project, saved classification/location/BOQ row, and redirected to the saved workspace. Evidence: `browser-full-flow-proof.json`, `browser-first-save-before.png`, `browser-first-save-after.png`.
- Additional saved-project browser proof: 5/5 PASS. Editing an existing saved item followed by "Buang Perubahan Lokal" left the canonical item's last-saved name and its Project intact. Evidence: `browser-saved-discard-proof.json` and `browser-existing-saved-discard.png` (separate from `browser-full-flow-proof.json`).
- Real HTTP negative cases: no auth => 401; PROJECT_CREATE without RAB_DRAFT_EDIT => 403; duplicate BOQ tempId => 409, existing canonical counts unchanged across failures. Evidence: `negative-http-proof.json`.
- A first successful save initially failed browser readback with 404 **only because the temporary test membership lacked the canonical User profile required by the existing Project Access Policy**. After providing the proper test profile, all three GET endpoints returned 200 and the repeated browser flow passed. This was fixture correction, not a source-code defect.
- Frontend tests **1643/1643 PASS**, production build PASS; backend targeted tests **54/54 PASS**, production build PASS; diff --check PASS on the feature branch. Production main not modified.

### Precise remaining release reservations
- Network-uncertain first-save (POST accepted but response dropped) has not completed a real browser chaos test. Code fails closed and suppresses blind retry, but do NOT claim chaos acceptance.
- The 3-option dialog's **Simpan Draft dan Keluar** path has not completed a separate authenticated browser test. The "Simpan Draft" button and discard/continue paths were exercised.
- Before first save, server project-bound **Import BOQ**, AHSP selection and server-calculation facilities are intentionally disabled; there is no proven equivalent pre-save local adapter. This is a product parity issue for Owner decision/reuse architecture, not a hidden feature.
- No independent final delta review, GitHub CI or Owner merge decision yet; maintain **MERGE HOLD / DEPLOY HOLD**. Evidence is isolated to Computer 2, not production runtime.

Acceptance artifacts reside OUTSIDE the Git worktree in `D:\SIMPROK\WORKTREES\RAB-FIRST-SAVE-ACCEPTANCE-20261024`; their JSON logs and screenshots are retained locally. No user credentials, production tokens or production datasets were used in tests.

## Additional authenticated browser acceptance — 24 Oct 2026, later gate
- **4/4 PASS** `Simpan Draft dan Keluar` from a blocked route: dialog appears, exactly one canonical project with its RAB work item is committed, and only THEN does the browser reach the originally requested home route. Evidence outside repo: `browser-save-and-leave.png` and `browser-save-and-leave.cjs` (browser output).
- **5/5 PASS** adverse network truth: Playwright forwarded an actual `POST /projects` to the real test backend, deliberately discarded the successful response, and verified exactly one server project; UI states the outcome is **unverified**, explicitly disables repeated save, and never sends a second POST. Evidence: `browser-network-uncertain-proof.json` and `browser-network-outcome-uncertain.png`.
- **4/4 PASS** native browser `beforeunload`: unsaved provisional RAB triggers a browser-native confirmation on refresh; dismissing prevents reload, retains the local work item, and performs zero Project writes. Evidence: `browser-native-exit-proof.json`.
- **2/2 PASS** capability re-activation: once the first Save Draft succeeds and the canonical workspace loads, the original Import BOQ and Pilih/Ganti AHSP controls are available. Evidence: `browser-project-capabilities-proof.json`. The capability engines are REUSED, not rebuilt; their end-to-end import/AHSP selection functionality is separately owned by their existing subsystems.
- UX transparency adjustment: before the first save, the UI explicitly describes why project-scoped Import BOQ/AHSP is not yet available; the provisional AHSP button is truly disabled, preventing a silent empty search; the draft sheet truth says "belum disimpan". This is an **intentional first-save boundary**, not parity with a saved project.
- The original ProjectService.create and saveDraftBoq transaction writers, classification hierarchy, RBAC, source-control lock, and permanent DB untouched.
- Full frontend **1643/1643 PASS**, both frontend/backend production build PASS after the above UX amendment. Review of GitHub current `origin/main`: still `a8ad357`, exactly the feature branch base, no upstream drift. Last local proof was performed on the isolated test servers, NOT the permanent runtime.

## Release adjudication
The Owner rule is met for the core create/edit/exit workflow: before the first explicit Save Draft the RAB exists only in local browser state, and first Save creates the one canonical Project+BOQ. **No engineer may describe the original project-bound import and AHSP picker as functioning before the first Save**. The chosen safe integration is explicit Save Draft first, then reuse the existing project-scoped engines. Providing Import/AHSP selection before first save would require a separately reviewed, non-mutating preview adapter, not duplicate engines or secret temporary canonical Projects. It is NOT in this implementation scope. Independent final review, GitHub CI and controlled Owner decision remain before promotion.
