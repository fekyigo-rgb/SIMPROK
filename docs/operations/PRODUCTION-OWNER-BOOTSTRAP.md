# Production Owner Bootstrap

## Purpose

Create the very first Account/User/Organization/Workspace baseline on a
freshly migrated, empty `simprok_db`. This is not a seed and not a fixture:
it exists to let the real Owner log in for the first time on a database
that has schema but no data.

## Preconditions

- `_prisma_migrations` shows all repository migrations applied.
- Every one of `Account`, `User`, `Organization`, `Workspace`,
  `WorkspaceMembership` has row count `0`. Any other combination is refused
  as a partial state — this script does not repair partial state, it only
  refuses to proceed past it.
- `SIMPROK_OWNER_BOOTSTRAP_PASSWORD` is set in the **child process**
  environment only, at least 12 characters. Never pass the password as a
  CLI argument or set it in a parent/persistent shell session.

## Usage

```
npx tsx scripts/bootstrap-production-owner.ts --dry-run \
  --email=<owner-email> \
  --display-name=<owner-display-name> \
  --organization-name=<organization-name> \
  --workspace-name=<workspace-name>
```

Dry-run performs the database-identity guard and the fresh-state check,
prints the plan, and makes no writes. Once the plan looks correct, run the
same command with `--apply` instead of `--dry-run`, with
`SIMPROK_OWNER_BOOTSTRAP_PASSWORD` set for that invocation only:

```
SIMPROK_OWNER_BOOTSTRAP_PASSWORD=<password> npx tsx scripts/bootstrap-production-owner.ts --apply \
  --email=<owner-email> \
  --display-name=<owner-display-name> \
  --organization-name=<organization-name> \
  --workspace-name=<workspace-name>
```

npm shortcuts: `npm run bootstrap:owner:dry-run -- <args>` and
`npm run bootstrap:owner:apply -- <args>`.

## What it creates

One `Organization`, one `Workspace`, one workspace-scoped `Role`
(`code: 'DIRECTOR'`, `isSystem: true`), one `Account` (`status: ACTIVE`,
bcrypt-hashed password, salt rounds 10 — matching `AuthService`), one
`WorkspaceMembership` (`status: ACTIVE`), one `User` (`status: ACTIVE`),
and one `MembershipRole` linking the membership to the DIRECTOR role. All
in a single transaction — either everything is created or nothing is.

## What it deliberately does not do

- Does not create or grant any `Permission`/`RolePermission` row. Run
  `prisma/seed-rbac-permissions.ts` afterward against the same database —
  that is the existing, already-tested source of truth for what DIRECTOR
  is allowed to do. This script only creates the role that seed expects to
  find; it never invents permissions.
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
Jest invocation and does not change the main test configuration). The
suite is pure unit tests against mocked clients — no real database
dependency — covering: fresh plan accepted, existing Account blocked,
partial state blocked, missing/absent password blocked, safe behavior on
a second invocation after a prior successful apply, and static
source-safety checks (no fixture identity literals, no fabricated
permission grants, no domain data creation, no superuser reference).
