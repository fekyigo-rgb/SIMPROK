# RM01B-EVIDENCE-CONTRACT-01

Status: FROZEN. Scope: one current-state closure packet. This contract does
not expand when questions outside Q1-Q5 are asked.

## Admissible questions

Q1. What is the current identity of workspace
10000000-0000-4000-8000-000000000004 and its organization?

Q2. Are multiple acceptance sentinel categories currently present together?

Q3. Has the Owner authorized that workspace as real runtime?

Q4. What are the current definitions and grants for RAB_VIEW and
RAB_DRAFT_EDIT?

Q5. Does the formal audit role satisfy this least-privilege contract?

No inference is admissible about who performed prior setup, when it occurred,
whether it never occurred, or the history of any other database.

## Frozen current-state fingerprint

ANCHOR_WORKSPACE is an exact match only when workspace
10000000-0000-4000-8000-000000000004 is named Workspace-A and belongs to
organization 10000000-0000-4000-8000-000000000002 named Org-A.

ACCOUNT_SENTINELS are these exact id/email pairs:

- 10000000-0000-4000-8000-000000000007 / assigned@test.local
- 10000000-0000-4000-8000-000000000008 / nonassigned@test.local
- 10000000-0000-4000-8000-000000000009 / crosstenant@test.local
- 10000000-0000-4000-8000-000000000021 / foreman@test.local

PROJECT_SENTINELS are:

- 10000000-0000-4000-8000-000000000018 / ACC-X
- 10000000-0000-4000-8000-000000000037 / RAB-DRAFT-PROOF

ROLE_SENTINELS are:

- 10000000-0000-4000-8000-000000000006 / ACCEPTANCE_MEMBER
- 10000000-0000-4000-8000-000000000020 / FOREMAN
- 10000000-0000-4000-8000-000000000040 / ACCEPTANCE_PROJECT_CREATOR
- 10000000-0000-4000-8000-000000000042 / DIRECTOR

RELATION_SENTINELS are workspace membership IDs 010, 011, 012, 022;
membership-role IDs 016, 017, 024, 041, 043; and project-assignment IDs 019,
025, 038, each with prefix 10000000-0000-4000-8000-.

Classification:

- CURRENT_ACCEPTANCE_FINGERPRINT_CONFIRMED: anchor matches and at least two
  independent sentinel categories match completely.
- NO_CURRENT_ACCEPTANCE_FINGERPRINT_DETECTED: anchor does not match and all
  sentinel counts are zero.
- Every other result: PARTIAL_OR_CONFLICTING_MATCH and
  TARGET_IDENTITY_AMBIGUOUS.

NO_CURRENT_ACCEPTANCE_FINGERPRINT_DETECTED does not establish historical
absence. TARGET_WORKSPACE_IS_AUTHORIZED_REAL_RUNTIME is an Owner decision;
database evidence cannot manufacture it.

Confirmed or ambiguous status stops permission activation. Nothing is
deleted, reset, renamed, or cleaned. Current state is reported once and the
Owner decides disposition.

## Q4 canonical permission contract

- RAB_VIEW: name View RAB; description View RAB drafts and bounded import
  previews.
- RAB_DRAFT_EDIT: name Edit RAB Draft; description Edit RAB drafts and
  approve bounded BOQ imports.

The reviewed target is one exact DIRECTOR role in one exact workspace and
organization. Existing conflicting metadata is a stop, never an update.

## Q5 least-privilege contract

The audit role has only the attributes, timeouts, database/schema access, and
column-level SELECT allowlist frozen in audit-role-provision.psql. Any role
membership, DML, schema CREATE, BYPASSRLS, table-wide SELECT, default
privilege, or additional table/column privilege is
STOP_UNEXPECTED_AUDIT_ROLE_PRIVILEGE.

Reported operational statements about an earlier ad-hoc role, its settings,
local DPAPI storage, and its three reported readable tables are
REPORTED_EVIDENCE only. They are not repository proof and do not answer Q5.

Soli Deo Gloria. Haleluya. Amin.
