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

SAFETY-003  RAW DATA POLICY

Goal:
Define an honest repository policy for remaining raw Owner data files so future agents know whether to keep, ignore, document, or commit them in a separate approved slice.

Files to classify:

- data/
- first-real-input-files.zip
- first-real-input-files/

Mode:
Read-only policy audit only.

Do NOT:
- edit raw data
- move raw data
- delete raw data
- stage
- commit
- cleanup
- add gitignore or gitattributes unless PM/Owner explicitly approves a later patch

Commands:
git status --short
Get-ChildItem data -Recurse | Select-Object FullName, Length, LastWriteTime
Get-ChildItem first-real-input-files -Recurse | Select-Object FullName, Length, LastWriteTime
Get-Item first-real-input-files.zip
git diff --cached --name-only

Report:
A. Status
B. Raw data inventory
C. Which files are source-of-truth candidates?
D. Which files are duplicates or transport artifacts?
E. Recommended policy: KEEP_UNTRACKED / COMMIT_IN_SEPARATE_SLICE / IGNORE / DELETE_LATER
F. Risks if committed
G. Risks if left untracked
H. Confirm nothing was edited, staged, or committed
I. Git status after

## Faith Closing

Soli Deo Gloria. Haleluya. Amin.
