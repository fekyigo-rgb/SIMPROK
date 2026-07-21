# SIMPROK NEXT TASK

Status: IMPLEMENTED_ON_BRANCH / AWAITING_OWNER_REVIEW

## Faith Opening

Dalam Nama Tuhan Yesus Kristus.

## Agent Instruction

Read AGENTS.md first.
Read CLAUDE.md if working with Claude Code.
Do not ask Owner to re-explain SIMPROK.
Do not perform broad audit.
Do not edit source code until Owner gives a new focused task.
Do not touch Monitoring / War Room.
Do not stage.
Do not commit.

## Current Locked Checkpoint

P3B:
- Commit: d91924a
- Message: fix(rab): polish living rab viewer layout
- Status: OWNER PASS / COMMITTED / LOCKED

P3C:
- Commit: 45c5e7a
- Message: fix(rab): support viewer zoom scroll area
- Status: OWNER PASS / COMMITTED / LOCKED

P4B:
- Commit: dac5dde
- Message: fix(rab): polish RAB and AHSP snapshot viewer hierarchy
- Status: OWNER PASS / BUILD PASS / COMMITTED / LOCKED

## Locked Result Summary

RAB Viewer / Ruang Hidup RAB:
- Visual hierarchy accepted by Owner as-is.
- RAB/BOQ empty state remains honest.
- Data Pendukung panel remains.
- Status & Mekanisme remains.
- No Monitoring / War Room work.

AHSP Snapshot:
- AHSP categories must come from actual RAB/BOQ FOLDER/subjudul.
- No hardcoded fake categories.
- "Semua Kategori" is filter control only.
- AHSP empty state remains honest.
- Topbar route context fixed for AHSP Snapshot.

## Current Task

PR #35 — canonical RAB draft-lifecycle closure (UTANG-LIFECYCLE-06),
implemented on branch:

feat/import-first-01-boq-working-draft

Status:
- Corrected per the Owner's "Final Planned-State and Pre-Multer Authority
  Addendum": Project.status is now an eligibility DOOR
  (RAB_EDITABLE_PROJECT_STATUSES = [PLANNED] only), not ignored — new
  reasonCode PROJECT_NOT_DRAFT added, priority: ACTIVE_BASELINE_EXISTS >
  APPROVED_RAB_EXISTS > MULTIPLE_WORKING_DRAFTS > PROJECT_NOT_DRAFT >
  allowed. ACC-X (status ACTIVE) is now correctly PROJECT_NOT_DRAFT — the
  gap recorded in the previous version of this file is resolved, see
  docs/project-memory/SIMPROK_PROJECT_MEMORY.md §12.3.
- New pre-Multer guard RabEditableLifecycleGuard added to import
  preview/approve, ahead of FileInterceptor: a blocked project now rejects
  before file buffering/parsing/fingerprint check, proven by E2E.
- Backend RabLifecyclePolicyService + lifecycle enforcement on GET/PUT
  boq/draft and import preview/approve: done, gates green (build, 375/375
  unit tests; verify:db:test and test:e2e:safe re-run pending as of this
  status line — see task transcript for final counts).
- ProjectService.create now births exactly one empty Working Draft
  atomically, status PLANNED: done.
- /projects/mine batched rabLifecycle projection: done.
- Frontend RabWorkspacePage fail-closed capability gating,
  ProjectListPage lifecycle-driven card action, and ProjectRabDoorPage no
  longer falling back to GET /boq/draft for a non-PLANNED project: done,
  frontend tests (19/19) + build green.
- RAB-DRAFT-PROOF acceptance fixture (status PLANNED) seeded in
  simprok_test: done.
- Read-only simprok_db permission inventory found FIVE SEEDED_CURRENT
  permission codes absent from production (RAB_VIEW, RAB_DRAFT_EDIT,
  AHSP_APPROVE, BASIC_PRICE_VIEW, BASIC_PRICE_MANAGE) — recorded as
  UTANG-PERMISSION-08, see
  docs/project-memory/SIMPROK_PROJECT_MEMORY.md §13. Not fixed here; this
  is an Owner/PM production-activation decision.
- Manual browser walkthrough (Section 11 of the original task) not
  performed — no browser automation/tooling is available in this session,
  same limitation already recorded for P7C above.
- Nothing has been staged or committed. PR review and Owner PASS required
  before any commit, per this file's "Do not stage / Do not commit" and
  CLAUDE.md's "No commit without Owner PASS; no PASS without Owner browser
  review."

Prior task (P7C Canonical Intake Contract, branch
feat/p7c-canonical-intake-contract) status is unchanged from before this
entry and is not re-verified here.

If Owner gives a new task:
1. Verify repo status first.
2. Identify exact allowed files.
3. Execute only that task.
4. Do not broaden scope.
5. Do not stage or commit without Owner PASS.

## Commands for next agent start

git status --short
git log --oneline -5

## Faith Closing

Soli Deo Gloria. Haleluya. Amin.
