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

P3A — RUANG HIDUP RAB / RAB VIEWER REAL PROJECT ENTRY

Goal:
Ensure /project/:projectId/rab opens as Ruang Hidup RAB / RAB Viewer for real project UUID,
not as an empty fallback, not as fake data, and not as the editable RAB workspace.

Scope:

- frontend/src/pages/ProjectRabDoorPage.tsx only
- If another file is required, STOP and report before editing.

Product Law:
- Ruang Hidup RAB / RAB Viewer = result/viewer/snapshot room.
- Ruang Kerja RAB = editable draft workspace.
- Project name/card from Proyek Saya opens /project/:projectId/rab.
- Detail Proyek button "Buka Ruang RAB" opens /project/:projectId/rab.
- Do not route to Monitoring or War Room.
- Do not claim approval/RBAC/backend engine active without evidence.

Required behavior:
1. Real project UUID should render a proper RAB Viewer/Ruang Hidup RAB page.
2. Use real project fields from API if available.
3. If RAB/BOQ/detail data is not available, show honest placeholder: "Belum tersedia" or "Menunggu data RAB".
4. Do not show fixture/sample RAB as if it belongs to a real API project.
5. Keep existing good visual structure as much as possible.
6. Keep support document/snapshot doors honest: AHSP, Basic Price, TKDN, Metode, Spesifikasi, Schedule, Peralatan.
7. Do not create fake backend/RBAC/approval claims.

Do NOT:
- touch backend
- touch schema
- touch migration
- touch RAB Workspace
- touch Monitoring
- touch War Room
- touch Topbar
- touch index.css
- touch AGENTS.md
- touch CLAUDE.md
- touch data/ or first-real-input-files*
- stage
- commit

Commands:
git status --short
git diff --cached --name-only
npm run build

Report:
A. Status
B. Root cause
C. File changed
D. Fix summary
E. Build result
F. Browser result
G. Git status after
H. READY_FOR_PM_REVIEW or STOP

## Faith Closing

Soli Deo Gloria. Haleluya. Amin.
