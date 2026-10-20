# RI-01 bounded closeout - 20 October 2026

Status: PUBLISHED AS DRAFT PR #206 (https://github.com/fekyigo-rgb/SIMPROK/pull/206). MERGE HOLD. PERMANENT ACTIVATION HOLD.

## Owner decision and acceptance boundary
Owner explicitly passed the interaction/preparation rooms through Ruang Kerja RAB on 20 October and authorized clean continuous PR preparation. AHSP import and Basic Price improvements are owned by another chat. This decision does not claim completed AHSP linkage, monetary calculation, final RAB, or permanent deployment.
Owner UI evidence in this chat: RAB 1.xlsx imported as 4 sections and 32 items; saved draft loaded again; prices remain unavailable while AHSP is unlinked. Source workbook parity: 36/36 rows, zero parser row errors, SHA256 37AE30D88D791478843F96E90B4283BF334132EAB6DDE72B5F04E2C8603A1BD5. No Owner business data is included in this PR.

## Canonical base and continuity
BASE_MAIN_SHA=6cb88e0fc2bbd825df36a2f4dc311aa1c16cf6fa (PR #204; includes #203).
BRANCH=feat/ri01-rab-preparation-workspace-closeout.
Main advanced by two Basic Price UI files; neither overlaps the RI-01 delta. All 54 pre-closeout changed/untracked files were copied with SHA-256 to E:/SIMPROK-RI01-SAFETY/ri01-pr-closeout-20261020 before branch reconciliation. file-disposition.json accounts for every file: 45 included, one local host-binding change preserved locally, eight local historical evidence/launcher files preserved locally. No file is silently discarded.

## Included product seams
- Preparation UI, canonical classification/region selections and persisted readback.
- RAB workspace, one editable draft identity, existing import preview/approval, flexible BOQ sheet/header recognition and honest unavailable-price display.
- RAB-side eligible AHSP search/preference and optional source-code display; existing eligibility, unit compatibility and resolution remain authorities. This is not AHSP import work.
- Existing region lookup is exported/reused and gains canonical ancestor labels. These three Basic Price namespace paths are RAB reference dependencies, not changes to price parsing, review, publication or calculation.
- Two original migrations: project context selection tables and the unique one-DRAFT-per-project index. Production must preflight duplicate drafts and backup/restore readiness before deployment. No automatic deduplication or production migration in this closeout.

## Test adaptation and local exclusions
Progress E2E includes only four fixture changes required by the one-draft constraint. The temporary local dual-role setup is archived, not shipped: main CI already provisions and verifies its restricted E2E role. Existing role and append-only assertions are unchanged from main. The archived local Progress runner is not a portable runner for this cleaned test and must not be reused without reconciliation.
backend/src/main.ts HOST binding is retained in the local integration worktree, excluded from PR. Historical local launchers, reproduction scripts and browser JSON remain in the safety archive and original directory. They are not installable product files.

## Evidence and gates
- Frontend full unit on #204 base: 1495 PASS, zero failed/skipped.
- Backend focused unit on #204 base: 38 suites / 608 tests PASS, exit 0. Frontend build PASS, exit 0 (bundle-size warning only).
- Backend build and BOQ 9/9: PASS earlier 20 October; backend product bytes unchanged by main #204 reconciliation.
- Historical full backend unit: 4343 PASS, 15 FAIL, 9 skipped. Failures are two external Ambon workbook suites; not repaired or waived here. No overall full-unit PASS claim.
- Historical safe E2E: 826 PASS general run, 55 PASS dedicated Progress run, 17 skipped. Not a single full-run PASS and not fresh evidence for the cleaned test packaging.
- Current exact PR CI and independent raw-source architecture/constitution review: REQUIRED before merge.
- No local database reset, seed, permission grant, business import, migration or permanent activation in closeout.

Soli Deo Gloria. Haleluya. Amin.

Credential-pattern scan: 47 allowlisted files; 3 hits, all unchanged baseline E2E test fixture assignments; 0 real-secret hits under the five declared patterns. PASS_WITH_REVIEWED_HITS; not a comprehensive detector. Raw scan and test logs are preserved in the closeout safety directory.
