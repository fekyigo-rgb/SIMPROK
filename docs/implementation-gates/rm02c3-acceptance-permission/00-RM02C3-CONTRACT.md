# RM-02C3 Acceptance Permission Activation Contract

## Boundary

This slice activates browser-acceptance authority only in `simprok_test`.
It does not alter canonical permission seeds, production roles, schema,
migrations, frontend source, or Basic Price business behavior. A literal
`simprok_db` identity is rejected; no production connection is authorized.

The locked target is Workspace-A
`10000000-0000-4000-8000-000000000004`, active account
`assigned@test.local`, and dedicated role `RM02C3_BROWSER_ACCEPTANCE`.

## Least privilege

The exact allowlist is:

- `BASIC_PRICE_IMPORT`
- `BASIC_PRICE_REVIEW_VIEW`

The role may not contain or acquire resolve, submit, verify, publish, manage,
AHSP, RAB, Project, Authority, wildcard, or administrator authority. It may
not be assigned to any other membership.

## PLAN/APPLY

PLAN runs in a repeatable-read, read-only transaction, resolves every locked
identity, reports deterministic dispositions, and produces a canonical
SHA-256 plan hash. It performs zero writes.

APPLY requires the non-secret explicit capability confirmation
`APPLY_RM02C3_BROWSER_ACCEPTANCE_TO_SIMPROK_TEST`. Inside one serializable
transaction it acquires a transaction advisory lock, rebuilds the plan,
compares the approved hash, and inserts only missing rows in `permissions`,
`roles`, `role_permissions`, and `membership_roles`. It never updates,
revokes, or deletes authority. A fresh second PLAN/APPLY must have zero delta.

The acceptance environment is loaded only through the established acceptance
loader and guard. Environment values, connection strings, credentials, and
tokens are never printed.

## Browser boundary

`/basic-price/import` remains gated by `BASIC_PRICE_IMPORT`.
`/basic-price/import/:batchId/review` remains gated by
`BASIC_PRICE_REVIEW_VIEW`. Browser proof is observational selection-state
proof performed by the Owner only after exact-HEAD CI and persistent APPLY.
No resolve, reject, submit, verify, or publish action is authorized.
