# CLAUDE.md — SIMPROK Frontend Scope

Dalam Nama Tuhan Yesus Kristus.

This file supplements the root `CLAUDE.md` and `AGENTS.md` for all work under `frontend/`.

## Owner-Locked Project Governance UI

Before touching Project Detail, parties, organizations, stakeholders, personnel, assignment, `roleInProject`, decision authority, authority, RBAC, permissions, or access UI, read:

`docs/control/OWNER-DIRECTIVE-PROJECT-GOVERNANCE-UI-LOCK.md`

The existing section **F. Pihak Terlibat & Kewenangan** is locked as the canonical frontend surface for **siapa boleh buat apa**.

Do not:

- rip and replace the section;
- create a parallel authority/governance page;
- relocate or rename its primary function;
- infer permission from role or title;
- infer decision authority from `roleInProject`;
- invent a `decisionAuthorityLevel` field, enum, API, or persistence contract;
- enable actions from frontend state alone;
- replace honest locked states with fake data;
- redesign without explicit Owner authorization.

Only incremental wiring is allowed: real API data, backend-derived effective permissions, loading/error/empty/forbidden states, tests, and bounded bug fixes.

Required separation:

- `ProjectAssignment` = person-to-project bridge;
- `roleInProject` = project function;
- decision authority = separate decision-level axis whose current backend home must be verified;
- effective backend permission = technical action authority;
- **Akses saya** = current user's backend-derived identity, assignment, authority, and permissions that actually exist.

If the backend contract for decision authority or effective RBAC is absent, preserve an honest locked-door state such as **Menunggu RBAC/backend**. Do not fill the gap with local frontend state or role-name inference.

Conflict rule:

```text
OWNER_DIRECTIVE_WINS=YES
REPOSITORY_REALITY_MUST_BE_VERIFIED=YES
STOP_AND_REPORT_ON_CONFLICT_OR_GAP=YES
```

Soli Deo Gloria. Haleluya. Amin.
