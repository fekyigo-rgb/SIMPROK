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
