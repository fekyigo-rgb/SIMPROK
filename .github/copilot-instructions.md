# SIMPROK Copilot Instructions

Read and obey the repository root `AGENTS.md`.

For all frontend or backend work involving Project Detail, project parties, organizations, stakeholders, personnel, assignments, project roles, authority, decision authority, RBAC, permissions, or user access, also read:

`docs/control/OWNER-DIRECTIVE-PROJECT-GOVERNANCE-UI-LOCK.md`

The existing Project Detail section **F. Pihak Terlibat & Kewenangan** is the canonical UI surface for **siapa boleh buat apa**.

Do not replace, move, duplicate, rename, or redesign this surface without explicit Owner authorization. Do not infer permission from a role/title or frontend state. Use backend effective permissions and preserve fail-closed locked-door states until real contracts exist.

```text
NO_RIP_AND_REPLACE=YES
NO_PARALLEL_AUTHORITY_PAGE=YES
OWNER_APPROVAL_REQUIRED_FOR_REDESIGN=YES
```
