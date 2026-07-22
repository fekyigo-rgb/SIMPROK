# RM01B dormant operational assets

These assets prepare PHASE-1A, PHASE-1B, and PHASE-2. PHASE-0 does not run
them and makes zero simprok_db connections or writes.

## Phase matrix

- PHASE-0: source preparation and truth sync. Exit is a Draft PR exact SHA.
- PHASE-1A: dormant audit-role DCL. A fresh full RED gate and Owner production
  authorization are mandatory. A human provisioner uses a write-capable
  credential; no agent may use that credential.
- PHASE-1B: dormant read-only fingerprint, using only the formal audit
  credential, one Frozen Evidence Contract, one read-only transaction, and
  unconditional rollback.
- PHASE-2: dormant activation. It requires Owner-authorized target identity,
  NO_CURRENT_ACCEPTANCE_FINGERPRINT_DETECTED, backup PASS, reviewed PLAN PASS,
  and Owner production authorization PASS.
- PHASE-3: dormant single Owner browser session.
- PHASE-4: dormant final truth sync; close only independently proven debts.

There is no automatic advance between phases.

Provisioning expects psql variable audit_role and prompts invisibly for a
password only when the role is absent. Fingerprinting uses the resulting
formal audit credential. The permission runner accepts exactly --plan or
--apply and reads every credential and confirmation from external environment
variables. Never paste secrets into arguments, files, logs, or PRs.

If a fingerprint is confirmed or ambiguous, stop before activation. Do not
clean, reset, rename, or remove anything. Report current state once and wait
for Owner disposition.

## One Owner browser session (PHASE-3 only)

Positive Director journey: real Director login; verify PROJECT_CREATE,
RAB_VIEW, and RAB_DRAFT_EDIT; enter Buat RAB normally; create project and RAB
Draft; enter Ruang Kerja RAB normally; Import BOQ; Preview; Approve; reload;
verify structure, items, volume, and unit persist; and verify unknown prices
remain null/Belum dihitung rather than Rp0.

Record separate negative results for FOREMAN without permission, nonassigned
user, cross-tenant user, ACTIVE ACC-X, direct URL bypass, and RAB Viewer
read-only lifecycle behavior. Automated tests cannot replace Owner proof.
