# Production Owner Bootstrap

## Purpose

Create the very first Account/User/Organization/Workspace/DIRECTOR-role
baseline — including that role's canonical RBAC permissions — on a freshly
migrated, empty `simprok_db`. This is not a seed and not a fixture: it
exists to let the real Owner log in for the first time on a database that
has schema but no data, with a role that can actually do something the
moment it's created.

## Preconditions

- `_prisma_migrations` shows all repository migrations applied.
- Every one of `Account`, `User`, `Organization`, `Workspace`,
  `WorkspaceMembership`, `Role`, `MembershipRole`, `Permission`,
  `RolePermission` has row count `0`. Any other combination is refused as
  a partial state — this script does not repair partial state, it only
  refuses to proceed past it. (Identity tables and RBAC tables are checked
  together: a database that already has Permission rows but no Account is
  just as much a partial state as the reverse.)
- `--dry-run` needs **no password at all** — it only runs the
  database-identity guard and the fresh-state check, then prints the plan.
  The password is read only on the `--apply` path, and only there.

## Usage

Dry-run first, with no secret involved:

```
npx tsx scripts/bootstrap-production-owner.ts --dry-run \
  --email=<owner-email> \
  --display-name=<owner-display-name> \
  --organization-name=<organization-name> \
  --workspace-name=<workspace-name>
```

`--apply` requires `SIMPROK_OWNER_BOOTSTRAP_PASSWORD` in the **child
process environment only** (never a CLI argument, never a parent or
persistent shell session, never written to a file). In practice this
means `--apply` is invoked only through an external secure launcher —
built and frozen separately from this PR, not part of it — that:

- prompts the Owner directly via `Read-Host -AsSecureString`,
- converts that to a plaintext value only long enough to hand it to the
  child process's `ProcessStartInfo.EnvironmentVariables`,
- zeroes the BSTR immediately after the child starts,
- never echoes, logs, or persists the value anywhere — not in chat, not
  in a report, not in Git, not in the parent shell's own environment.

Do not run `--apply` by typing the password inline on a command line —
that leaves it sitting in shell history in plaintext. If you don't yet
have that launcher available, `--apply` should not be run at all yet.

npm shortcuts: `npm run bootstrap:owner:dry-run -- <args>` and
`npm run bootstrap:owner:apply -- <args>` (the latter still requires
`SIMPROK_OWNER_BOOTSTRAP_PASSWORD` to already be set in the process
environment by the launcher described above before this runs).

## What it creates

All in a **single transaction** — either everything below is created, or
nothing is:

- One `Organization`, one `Workspace`.
- One workspace-scoped `Role` (`code: 'DIRECTOR'`, `isSystem: true`).
- One `Account` (`status: ACTIVE`, bcrypt-hashed password, salt rounds 10
  — matching `AuthService`).
- One `WorkspaceMembership` (`status: ACTIVE`), one `User`
  (`status: ACTIVE`), one `MembershipRole` linking the membership to the
  DIRECTOR role.
- The canonical RBAC permission catalog (`ensureCanonicalPermissions`,
  imported from `prisma/seed-rbac-permissions.ts` — not redefined here),
  and a `RolePermission` grant to DIRECTOR for exactly the permissions
  `prisma/seed-rbac-permissions.ts` already declares as Director-allowed
  (including `PROJECT_VIEW`, which the standalone seed had been missing —
  DIRECTOR previously could create a project but never see it again).
- A same-transaction proof that none of the Director-forbidden
  MANAGE/ASSIGN permissions ended up granted.

Because RBAC activation happens inside the same transaction as identity
creation, there is no way for this script to leave behind an Owner
Account that exists but has no effective permissions.

## What it deliberately does not do

- Does not invent or redefine any permission. All permission codes and
  the Director allow/forbid lists come from `prisma/seed-rbac-permissions.ts`,
  imported as a module — this script has no permission literals of its
  own beyond the import.
- Does not create any `Project`, `BasicPrice`, `AHSP`, or `RAB` row.
- Does not create `Position`/`PositionAuthority`/`Authority` rows — there
  is no precedent for that chain in this codebase yet (see
  `AuthorityService`, which currently stubs those operations).
- Does not print the password or password hash anywhere.
- Does not depend on, reference, or require any database superuser.

## Testing

`npm run test:bootstrap-owner` runs `scripts/bootstrap-production-owner.spec.ts`
directly (it lives outside `src/`, so the default `npm test` — scoped to
`rootDir: src` — does not pick it up; this is an additive, standalone
Jest invocation and does not change the main test configuration). It is
also now an explicit step in the "Backend Build and Unit" CI workflow.
The suite is pure unit tests against mocked clients — no real database
dependency — covering: fresh plan accepted, existing Account blocked,
partial identity *and* partial RBAC state both blocked, password only
ever read on the apply path (never dry-run), missing/too-short password
blocked, the password env var being removed immediately after capture,
DIRECTOR receiving `PROJECT_VIEW` and never receiving a forbidden
MANAGE/ASSIGN code, the RBAC grant happening inside the same
`$transaction` as identity creation, safe behavior on a repeated
invocation, and static source-safety checks (no fixture identity
literals, no domain data creation, no superuser reference, no password
printing).
