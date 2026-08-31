# TESTCRED-LEAST-PRIVILEGE-01 — Mitigating UTANG-TESTCRED-01 Without Rotation

**Status:** PLAN — not adopted. No credential has been rotated. No SQL in
this runbook has been executed against any database. `CONNECT_ISOLATION`
for the prepared runner role is **NOT_YET_PROVEN**.

## 1. What happened (UTANG-TESTCRED-01) — stated honestly

During RM-02D1 work on 2026-07-28, an agent session read
`backend/.env.test` directly with a file-read tool to inspect its
`DATABASE_URL`. That put the full connection string into the session
transcript — including the password for the local Postgres instance's
**`postgres` role, which is that instance's cluster superuser**.

This must be stated plainly, not softened: a Postgres superuser role is
**cluster-wide**, not database-scoped. It can connect to and do anything to
**every** database hosted on that same Postgres server/instance —
`simprok_test`, `simprok_e2e`, and `simprok_db` alike, if `simprok_db` is
reachable on that instance. There is no Postgres-level boundary that
confines a superuser credential to only the databases this project
normally uses it for.

**What actually protects `simprok_db` today is not the credential — it is
this codebase's own application-level guards.**
`backend/scripts/database-role-guards.ts` (and every script built on it,
e.g. `e2e-database-lifecycle.ts`) asserts `current_database()` before
proceeding, and refuses to continue if it is not exactly `simprok_test` or
`simprok_e2e`. That is a real, working guard — **but it only guards
SIMPROK's own official scripts.** It does nothing to stop the same exposed
password from being used directly with `psql`, pgAdmin, DBeaver, a raw
`pg` connection in an ad-hoc script, or any other Postgres client entirely
outside this codebase. Framing the previous version of this runbook used —
"the credential has no reach to `simprok_db`" — conflated "our official
workflow won't misuse it" with "the credential cannot reach it," which are
not the same claim. The second one is not true for a superuser credential,
and this runbook must not imply that it is.

**Owner decision (2026-07-28):** rotation of this credential is **deferred**.
Owner has been informed of the cluster-wide/superuser nature of the
exposure described above and **accepts the risk** of deferral.
UTANG-TESTCRED-01 **stays OPEN**. This runbook is the mitigation Owner
asked for that does not require rotating anything today.

## 2. Immediate mitigation (in effect now, no rotation needed)

1. **Never read `.env.test` / `.env.e2e` directly into a visible
   transcript again.** The codebase already has a safe pattern for this —
   `loadAcceptanceEnvironment()` / `loadE2EEnvironment()` in
   `backend/scripts/database-role-guards.ts` load the file into
   `process.env` programmatically without printing it. Any future script
   that needs `DATABASE_URL` should call one of those, or follow the same
   shape, rather than opening the file with a generic file-read tool.
2. Any future secret audit in this repo reports **count + path + masked
   status only** — never a full matched line, never the credential value
   itself.
3. This codebase's own official workflows (`database-role-guards.ts`,
   `e2e-database-lifecycle.ts`, and everything built on them, including
   `backend/scripts/verify-equivalence-271.ts`) continue to assert the live
   database name before doing anything, so a misuse of this credential
   **through those specific code paths** cannot reach `simprok_db`. This is
   real and already true — it is just not the same thing as the credential
   itself being incapable of reaching `simprok_db`, which remains possible
   through any client this codebase's guards don't wrap.

None of the above requires touching the credential itself. They are process
mitigations, in effect immediately. None of them make `CONNECT_ISOLATION`
true — that is a separate, unproven, Postgres-level claim (§3).

## 3. Prepared (not adopted) structural mitigation: a reduced-privilege test role

`test-role-least-privilege.sql` (same directory as this file) defines a
`simprok_test_runner` Postgres role scoped to exactly `simprok_test` and
`simprok_e2e` — owner of those two sandbox databases (required because this
project's test/e2e workflow runs `prisma migrate reset`, which drops and
recreates the whole schema), `NOSUPERUSER NOCREATEDB NOCREATEROLE`, and
**no `GRANT` of any privilege on any other database, `simprok_db`
included.**

**`CONNECT_ISOLATION=NOT_YET_PROVEN.`** Not granting a privilege is not the
same as proving the role cannot connect. In PostgreSQL, `CONNECT` on a
database is granted to `PUBLIC` by default unless explicitly revoked, and
this file cannot revoke anything on `simprok_db` without connecting to
`simprok_db` — which it must never do (§ script header). This runbook does
**not** claim `simprok_test_runner` is isolated from `simprok_db` today,
because nothing has been run yet to establish that either way, and even
once it is run, this file alone cannot prove it.

**The adoption phase (§4) must prove isolation explicitly**, by running
this exact query against the live cluster once `simprok_test_runner`
exists:

```sql
SELECT has_database_privilege('simprok_test_runner', 'simprok_db', 'CONNECT');
-- Required result: false
```

If this returns `true`, adoption of `simprok_test_runner` **does not
pass**, and no future revision of this runbook may claim isolation until a
Postgres-level `REVOKE CONNECT ON DATABASE simprok_db FROM simprok_test_runner`
(or an equivalent explicit revoke) is applied by whoever administers
`simprok_db`, and the same query is re-run and confirmed `false`.

This is **not** rotation. Today's `postgres` credential keeps working
unchanged.

## 4. Adoption phase (whenever Owner authorizes it — not requested here)

1. A human with existing superuser access runs `test-role-least-privilege.sql`
   against `simprok_test`, then again against `simprok_e2e` (never
   `simprok_db` — the script fails closed if pointed anywhere else).
2. That same human runs the `has_database_privilege(...)` query from §3
   against the live cluster and records the result. If `true`, STOP —
   adoption does not proceed until isolation is separately established.
3. Only if `false`: update `backend/.env.test` / `backend/.env.e2e` to
   authenticate as `simprok_test_runner` instead of `postgres`.
4. Re-run `npm run verify:db:acceptance` and `npm run verify:db:e2e` to
   confirm the guarded scripts still pass under the new role.
5. **Only then**, as a separate and explicit Owner-authorized step, would
   the original shared `postgres` role's password actually be rotated —
   closing UTANG-TESTCRED-01. That step is not part of this runbook and is
   not requested here; Owner has deferred it.

## 5. Why this order

Rotating first and fixing scope later would mean re-exposing a new
superuser-equivalent secret through the same risk (any future accidental
`cat`/read of the env file). Narrowing the credential's privilege first —
**and proving, not assuming, that the narrower role truly cannot reach
`simprok_db`** — means that if the same class of transcript exposure ever
happens again before a rotation is scheduled, the blast radius is provably
a role confined to two disposable local test databases, not a claim that
turns out to still be cluster-wide.

## 6. Ticket state

- UTANG-TESTCRED-01: **OPEN** (rotation deferred by Owner, 2026-07-28;
  Owner accepts the cluster-wide/superuser risk described in §1 for the
  deferral period).
- `CONNECT_ISOLATION`: **NOT_YET_PROVEN**.
- This runbook + SQL: prepared, not adopted, not executed.

## 7. E2E IS NOW SERVED BY A DIFFERENT, REPOSITORY-GOVERNED ROLE (2026-08-27)

**Read this before acting on §4.** Nothing above is retracted — it is
historical record and stays. What follows narrows its remaining scope, because
half of the problem §4 was written to solve has since been solved by a
different, already-governed role.

**The E2E half is closed.** `backend/.env.e2e` now authenticates as
**`simprok_e2e_app`**, not `postgres`. That role is not invented here: it is
defined by this repository's own CI, `.github/workflows/pr-quality-gate.yml`,
which creates it `NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION
NOBYPASSRLS`, makes it owner of `simprok_e2e`, writes this exact DSN into
`backend/.env.e2e`, and then runs `verify:db:e2e` and `test:e2e`. Its password
is a committed CI-only literal, not a secret.

Measured locally on 2026-08-27, cluster `127.0.0.1:5432`:

```
current_user   = simprok_e2e_app
rolsuper       = false      rolcreaterole = false
rolcreatedb    = false      rolbypassrls  = false
```

Under that identity the MON-03 PostgreSQL boundary acceptance
(`progress-security.e2e-spec.ts` test 12) executes its INSERT/UPDATE/DELETE
assertions for the first time as a genuine non-superuser, and the official
`npm run test:e2e:safe` passes end to end.

One local, Owner-authorized DDL was needed to get there:

```sql
ALTER SCHEMA public OWNER TO pg_database_owner;   -- on simprok_e2e only
```

`prisma migrate reset` drops and recreates `public`, so the runtime role must
own it. On a freshly created database — which is what CI has — PostgreSQL 15+
already owns `public` by `pg_database_owner`, so CI's `ALTER DATABASE ... OWNER
TO simprok_e2e_app` carries the schema along. This local `simprok_e2e`
predates the role, so its `public` was still owned explicitly by `postgres`.
The statement aligns local with CI and grants the role no cluster-level
privilege; the four attributes above are unchanged by it.

**The acceptance half is still open, and §4 still governs it.**
`backend/.env.test` — the `simprok_test` acceptance database — continues to
authenticate as the shared `postgres` superuser. `simprok_test_runner` has
**not** been created; `test-role-least-privilege.sql` remains PLAN ONLY and
must still never be executed by an agent.

**So the two roles are not rivals, and a future executor should not treat them
as one decision:**

| | `simprok_e2e_app` | `simprok_test_runner` |
|---|---|---|
| Status | EXISTS, in use | PLANNED, never created |
| Governed by | `.github/workflows/pr-quality-gate.yml` | this runbook + its `.sql` |
| Databases | `simprok_e2e` only | `simprok_test` **and** `simprok_e2e` |
| Credential | committed CI-only literal | human-set, interactive `\password` |
| Agent may use it | yes | no — human superuser only |

When §4 is eventually actioned, its remaining work is **`.env.test` /
`simprok_test` only**. Repointing `.env.e2e` at `simprok_test_runner` would
replace a working, CI-matching configuration with a divergent one — do not do
it without a deliberate Owner decision to consolidate.

**Ticket state, updated:**

- `UTANG-TESTCRED-01`: **OPEN**, now scoped to the acceptance credential
  (`.env.test` / `simprok_test`). The E2E credential no longer contributes to
  it.
- `CONNECT_ISOLATION` for `simprok_test_runner`: still **NOT_YET_PROVEN** (the
  role does not exist).
- Canonical isolation for `simprok_e2e_app`: **PROVEN 2026-08-27**. Read-only
  census of the canonical cluster `127.0.0.1:55432` (as
  `simprok_readonly_audit`) lists exactly `simprok_app`,
  `simprok_cluster_admin`, `simprok_migrator`, `simprok_readonly_audit` —
  `simprok_e2e_app` **does not exist there**, so it cannot authenticate to
  canonical at all. Beware the earlier false alarm: a
  `has_database_privilege(..., 'simprok_db', 'CONNECT') = true` measured on
  port **5432** refers to a LEGACY database that merely shares the name
  `simprok_db` inside the test cluster. It is not the canonical database, and
  it is not grounds for a canonical `REVOKE`.
