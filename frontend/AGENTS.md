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
NO_DECISION_AUTHORITY_FROM_ROLE_INFERENCE=YES
OWNER_APPROVAL_REQUIRED_FOR_REDESIGN=YES
```

Backend work must incrementally activate the existing UI. Do not replace, relocate, rename, or redesign it without explicit Owner instruction.

Keep these axes separate:

- `ProjectAssignment` = person-to-project bridge;
- `roleInProject` = project function;
- decision authority = separate decision-level axis;
- backend effective permission = technical action authority.

Repository reality rule: do not assume a `decisionAuthorityLevel` field, enum, API, or persistence contract exists merely because the conceptual axis is Owner-locked. Verify the current backend first. Until the real contract exists, keep that axis in an honest locked-door/negative state and never infer it from `roleInProject`.

**Akses saya** must be derived from backend identity, assignment, authority, and effective permissions that actually exist. If backend/RBAC dependencies are incomplete, preserve **Menunggu RBAC/backend** or another honest fail-closed state.

If any task conflicts with the canonical directive or the repository lacks a required contract, stop and report the conflict/gap. The Owner directive wins; repository facts must not be invented.

Soli Deo Gloria. Haleluya. Amin.
