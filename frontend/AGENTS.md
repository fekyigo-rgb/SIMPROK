# SIMPROK Frontend Agent Instructions

Dalam Nama Tuhan Yesus Kristus.

## Mandatory Owner Directive

Before any work involving Project Detail, project parties, organizations, stakeholders, personnel, assignments, project roles, authority, decision authority, RBAC, permissions, or access control, read in full:

`docs/control/OWNER-DIRECTIVE-PROJECT-GOVERNANCE-UI-LOCK.md`

The existing Project Detail section:

> **F. Pihak Terlibat & Kewenangan**

is the canonical frontend surface for **siapa boleh buat apa**.

Hard rules:

```text
SECTION_F_UI=LOCKED_AS_CANONICAL
NO_RIP_AND_REPLACE=YES
NO_NEW_PARALLEL_AUTHORITY_PAGE=YES
NO_FRONTEND_GUESSED_PERMISSION=YES
NO_ROLE_NAME_AS_PERMISSION_SHORTCUT=YES
OWNER_APPROVAL_REQUIRED_FOR_REDESIGN=YES
```

Backend work must incrementally activate the existing UI. Do not replace, relocate, rename, or redesign it without explicit Owner instruction.

Use:

- `ProjectAssignment` as the person-to-project bridge;
- `roleInProject` for project function;
- `decisionAuthorityLevel` for `VIEWER`, `RECOMMENDER`, `DECIDER`, `APPROVER`;
- backend effective permissions for technical actions;
- backend-derived identity, assignment, authority, and permission for **Akses saya**.

If the backend contract is absent, preserve an honest locked-door state such as **Menunggu RBAC/backend**. Never invent real-looking data or enable actions from frontend assumptions.

If any task conflicts with the canonical directive, stop and report the conflict. The Owner directive wins.

Soli Deo Gloria. Haleluya. Amin.
