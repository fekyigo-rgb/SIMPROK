# TESTCRED-LEAST-PRIVILEGE-01 — Mitigating UTANG-TESTCRED-01 Without Rotation

**Status:** PLAN — not adopted. No credential has been rotated. No SQL in
this runbook has been executed against any database.

## 1. What happened (UTANG-TESTCRED-01)

During RM-02D1 work on 2026-07-28, an agent session read
`backend/.env.test` directly with a file-read tool to inspect its
`DATABASE_URL`. That put the full connection string — including the local
dev/test Postgres `postgres` role's password — into the session transcript.
The credential is a **local, non-production** Postgres instance credential
(it has no reach to `simprok_db`; `backend/scripts/database-role-guards.ts`
already fails closed if a script connected with it ever finds itself on any
database other than `simprok_test`/`simprok_e2e`), but a credential
appearing anywhere in a transcript is still an exposure and is tracked as
open debt.

**Owner decision (2026-07-28):** rotation of this credential is **deferred**.
UTANG-TESTCRED-01 **stays OPEN**. This runbook is the mitigation Owner asked
for that does not require rotating anything today.

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
   itself. (This is exactly how the RM-02D1-REMEDIATION-V3.1 secret audit
   was performed; see `docs/implementation-gates/rm02d1-fix/` for that
   audit's result.)
3. The credential's blast radius is already bounded structurally: it only
   ever authenticates to a local Postgres instance, and every script that
   uses it (`database-role-guards.ts`, `e2e-database-lifecycle.ts`) asserts
   the live database name before doing anything, so even a misuse of this
   exact credential cannot reach `simprok_db` through this codebase's own
   tooling.

None of the above requires touching the credential itself. They are process
mitigations, in effect immediately.

## 3. Prepared (not adopted) structural mitigation: a reduced-privilege test role

`test-role-least-privilege.sql` (same directory as this file) defines a
`simprok_test_runner` Postgres role scoped to exactly `simprok_test` and
`simprok_e2e` — owner of those two sandbox databases (required because this
project's test/e2e workflow runs `prisma migrate reset`, which drops and
recreates the whole schema), `NOSUPERUSER NOCREATEDB NOCREATEROLE`, and no
privilege whatsoever on any other database, `simprok_db` included.

This is **not** rotation. Today's `postgres` credential keeps working
unchanged. This file is a reviewed, ready-to-run target for **whenever**
Owner authorizes the next step:

1. A human with existing superuser access runs `test-role-least-privilege.sql`
   against `simprok_test`, then again against `simprok_e2e` (never
   `simprok_db` — the script fails closed if pointed anywhere else).
2. `backend/.env.test` / `backend/.env.e2e` are updated to authenticate as
   `simprok_test_runner` instead of `postgres`.
3. `npm run verify:db:acceptance` and `npm run verify:db:e2e` are re-run to
   confirm the guarded scripts still pass under the new role.
4. **Only then**, as a separate and explicit Owner-authorized step, would
   the original shared `postgres` role's password actually be rotated —
   closing UTANG-TESTCRED-01. That step is not part of this runbook and is
   not requested here; Owner has deferred it.

## 4. Why this order

Rotating first and fixing scope later would mean re-exposing a new
superuser-equivalent secret through the same risk (any future accidental
`cat`/read of the env file). Narrowing the credential's privilege first
means that if the same class of transcript exposure ever happens again
before a rotation is scheduled, the blast radius is a role that owns two
disposable local test databases — not a Postgres superuser.

## 5. Ticket state

- UTANG-TESTCRED-01: **OPEN** (rotation deferred by Owner, 2026-07-28).
- This runbook + SQL: prepared, not adopted, not executed.
