# SIMPROK NEXT TASK

Status: ACTIVE

## Faith Opening

Dalam Nama Tuhan Yesus Kristus.

## Agent Instruction

Read AGENTS.md first.
Execute only this task.
Do not ask Owner to re-explain SIMPROK.
Do not perform broad audit.
Do not edit outside allowed files.
Do not stage.
Do not commit.

## Current Task

SAFETY-002 STEP 1  DIAGNOSE ONLY

Goal:
Find why these files show modified even though normal git diff appears empty:

- frontend/src/components/layout/Topbar.tsx
- frontend/src/index.css

Mode:
Read-only only.

Do NOT:
- edit
- checkout
- restore
- stage
- commit
- delete
- cleanup

Commands:
git status --short
git diff --stat -- frontend/src/components/layout/Topbar.tsx frontend/src/index.css
git diff --ignore-all-space -- frontend/src/components/layout/Topbar.tsx frontend/src/index.css
git ls-files --eol frontend/src/components/layout/Topbar.tsx frontend/src/index.css
git check-attr -a frontend/src/components/layout/Topbar.tsx frontend/src/index.css
Test-Path .gitattributes
if (Test-Path .gitattributes) { Get-Content .gitattributes }
git diff --cached --name-only

Report:
A. Status
B. Is the change purely line-ending CRLF/LF? Give evidence.
C. Does .gitattributes exist? yes/no.
D. Any real content diff?
E. Recommendation: restore / gitattributes / leave  with reason.
F. Confirm nothing was edited, staged, or committed.
G. Git status after.

## Faith Closing

Soli Deo Gloria. Haleluya. Amin.
