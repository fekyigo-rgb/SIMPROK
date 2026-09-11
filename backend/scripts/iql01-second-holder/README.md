# IQL-01 — Governed Second Holder (Permanent)

Owner-authorized operational activation. Gives the EXISTING Basic Price
verifier role the one narrow authority to JUDGE a pending IQL-01
exact-question learning candidate — approve or reject it — so a candidate the
Owner teaches is approved by a different human (TEACHER ≠ APPROVER).

## Law

- Target: `simprok_app` @ `127.0.0.1:55432` / `simprok_db` only (BP-PROVISIONING-02 guards)
- Permission: `AHSP_RESOURCE_IDENTITY_QUESTION_APPROVE` — approve / reject only;
  never curate rows, TEACH, REVOKE or SUPERSEDE
- Role: the EXISTING `BASIC_PRICE_VERIFIER` of one workspace — never created,
  never ambiguous
- Writes at most ONE `permissions` row and ONE `role_permissions` row; additive,
  idempotent; no Account / Membership / User / Role is created
- Hard stop if: the role is missing or ambiguous; it holds `BASIC_PRICE_PUBLISH`
  or `AHSP_RESOURCE_IDENTITY_DECIDE`; it has no active holder; a holder can also
  TEACH through another role; the code is already granted to any other role
  (`BASIC_PRICE_PUBLISHER`, `DIRECTOR`, ...)

## Modes

```text
npx ts-node scripts/iql01-second-holder/permission-activation.ts --plan
npx ts-node scripts/iql01-second-holder/permission-activation.ts --apply
```

All credentials and confirmation come from environment variables. Never paste
secrets into argv, logs, or PRs.

## Required environment

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Permanent app DSN (host/port/db/role asserted) |
| `IQL01SH_TARGET_WORKSPACE_ID` | Owner workspace UUID |
| `IQL01SH_EXPECTED_ORGANIZATION_ID` | Organization UUID for that workspace |
| `IQL01SH_CONFIRM` | Must equal `IQL01_SECOND_HOLDER_APPLY` for `--apply` |
| `IQL01SH_EXPECTED_PLAN_SHA256` | Plan SHA from `--plan`, reviewed by the Owner |
| `IQL01SH_BACKUP_FILE` | Pre-mutation backup path |
| `IQL01SH_BACKUP_SHA256` | SHA-256 of the backup file |
| `IQL01SH_OWNER_AUTHORIZATION_ID` | Owner authorization record id/string |

## Phases

1. Code merged and promoted (the routes read the code only after promotion)
2. `--plan` (read-only transaction, always rolled back) — Owner reviews the plan,
   its SHA and the named verifier holder(s)
3. Backup PASS (`PG-SECRET-SAFE.sh pg_dump --format=custom`)
4. `--apply` with the confirmation token
5. Proof: the verifier's `/auth/capabilities` lists the code; the verifier sees
   APPROVE / REJECT on a pending candidate; the teacher still gets
   `409 TEACHER_CANNOT_APPROVE`; the publisher still gets 403
