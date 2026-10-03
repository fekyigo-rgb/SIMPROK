# SIMPROK Copilot Instructions

Read and obey the repository root `AGENTS.md`.

For all frontend or backend work involving Project Detail, project parties, organizations, stakeholders, personnel, assignments, project roles, authority, decision authority, RBAC, permissions, or user access, also read:

`docs/control/OWNER-DIRECTIVE-PROJECT-GOVERNANCE-UI-LOCK.md`

The existing Project Detail section **F. Pihak Terlibat & Kewenangan** is the canonical UI surface for **siapa boleh buat apa**.

Do not replace, move, duplicate, rename, or redesign this surface without explicit Owner authorization. Do not infer permission from role/title or frontend state. Do not infer decision authority from `roleInProject`, and do not invent a `decisionAuthorityLevel` field/API/persistence contract when repository reality does not contain one.

Use backend effective permissions and real backend contracts only. Preserve fail-closed locked-door states until those contracts exist, including for **Akses saya**.

```text
NO_RIP_AND_REPLACE=YES
NO_PARALLEL_AUTHORITY_PAGE=YES
NO_DECISION_AUTHORITY_FROM_ROLE_INFERENCE=YES
NO_SCHEMA_INVENTION=YES
OWNER_APPROVAL_REQUIRED_FOR_REDESIGN=YES
```
