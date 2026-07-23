# CLAUDE.md — SIMPROK Frontend Scope

Dalam Nama Tuhan Yesus Kristus.

This file supplements the root `CLAUDE.md` and `AGENTS.md` for all work under `frontend/`.

## Owner-Locked Project Governance UI

Before touching Project Detail, parties, organizations, stakeholders, personnel, assignment, `roleInProject`, `decisionAuthorityLevel`, authority, RBAC, permissions, or access UI, read:

`docs/control/OWNER-DIRECTIVE-PROJECT-GOVERNANCE-UI-LOCK.md`

The existing section **F. Pihak Terlibat & Kewenangan** is locked as the canonical frontend surface for **siapa boleh buat apa**.

Do not:

- rip and replace the section;
- create a parallel authority/governance page;
- relocate or rename its primary function;
- infer permission from role or title;
- enable actions from frontend state alone;
- replace honest locked states with fake data;
- redesign without explicit Owner authorization.

Only incremental wiring is allowed: real API data, backend-derived effective permissions, loading/error/empty/forbidden states, tests, and bounded bug fixes.

Required mapping:

- `ProjectAssignment` = person-to-project bridge;
- `roleInProject` = project function;
- `decisionAuthorityLevel` = decision level;
- effective backend permission = technical action authority;
- **Akses saya** = current user's backend-derived identity, assignment, decision authority, and permissions.

Conflict rule:

```text
OWNER_DIRECTIVE_WINS=YES
STOP_AND_REPORT_ON_CONFLICT=YES
```

Soli Deo Gloria. Haleluya. Amin.
