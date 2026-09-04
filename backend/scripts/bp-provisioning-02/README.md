# BP-PROVISIONING-02 — Governed Permanent Verifier / Publisher

Owner-authorized operational activation. Closes the Permanent provisioning gap
without product self-grant UI and without making DIRECTOR both verifier and
publisher.

## Law

- Target: `simprok_app` @ `127.0.0.1:55432` / `simprok_db` only
- Roles: `BASIC_PRICE_VERIFIER` (REVIEW_VIEW + VERIFY), `BASIC_PRICE_PUBLISHER` (PUBLISH)
- Hard stop if verifier Account == publisher Account
- DIRECTOR must not receive these grants from this activation
- Passwords written only under `SIMPROK-RUNTIME/secrets/` (outside git)

## Modes

```text
npx ts-node scripts/bp-provisioning-02/permission-activation.ts --plan
npx ts-node scripts/bp-provisioning-02/permission-activation.ts --apply
```

All credentials and confirmation come from environment variables. Never paste
secrets into argv, logs, or PRs.

## Required environment

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Permanent app DSN (host/port/db/role asserted) |
| `BP02_TARGET_WORKSPACE_ID` | Owner workspace UUID |
| `BP02_EXPECTED_ORGANIZATION_ID` | Organization UUID for that workspace |
| `BP02_VERIFIER_EMAIL` | Distinct human email |
| `BP02_PUBLISHER_EMAIL` | Distinct human email |
| `BP02_OWNER_EMAIL` | Owner email that must not receive curation roles |
| `BP02_CONFIRM` | Must equal `BP_PROVISIONING_02_APPLY` for `--apply` |
| `BP02_EXPECTED_PLAN_SHA256` | Plan SHA from `--plan` |
| `BP02_BACKUP_FILE` | Pre-mutation backup path |
| `BP02_BACKUP_SHA256` | SHA-256 of backup file |
| `BP02_OWNER_AUTHORIZATION_ID` | Owner authorization record id/string |
| `BP02_SECRETS_OUT_DIR` | Directory for password env (outside repo) |

## Backup

Before `--apply`, dump at least RBAC identity tables with a write-capable
operator credential (not logged). Record path + SHA-256. Restore is Owner-only.

## Phases

1. `--plan` (read-only transaction, always rolled back)
2. Owner reviews plan SHA + SoD expectations
3. Backup PASS
4. `--apply` with confirmation token
5. Targeted login/capabilities proof (separate acceptance mission for full BP journey)
