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

P7C Canonical Intake Contract implemented on branch:

feat/p7c-canonical-intake-contract

Status:
- Backend implementation done.
- Frontend create/read-back integration done.
- API/runtime Mode C and Mode F evidence done.
- Browser visual desktop/mobile audit not completed because no browser automation/tooling is available in the session.
- PR review by Owner/PM still required.

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
