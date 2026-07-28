-- RM-02D1 remediation (UTANG-TESTCRED-01 mitigation) — reduced-privilege
-- Postgres role for the LOCAL dev/test toolchain (simprok_test, simprok_e2e)
-- ONLY. Never simprok_db.
--
-- STATUS: PLAN ONLY. This file has never been executed against any
-- database by an agent, and must never be executed by an agent. Owner
-- decision 2026-07-28: rotation of the current shared `postgres` credential
-- is DEFERRED (Owner accepts the cluster-wide/superuser risk described in
-- docs/runbook/TESTCRED-LEAST-PRIVILEGE-01.md while deferred);
-- UTANG-TESTCRED-01 stays OPEN. This asset exists so that whenever Owner
-- authorizes adoption, there is already a reviewed, least-privilege target
-- to rotate the test credential INTO — not another superuser-equivalent
-- role. A human with existing superuser access on the target Postgres
-- instance runs this manually, psql session by psql session, exactly once
-- per database (`-d simprok_test`, then `-d simprok_e2e`). It follows the
-- same safe-password pattern already proven in
-- backend/scripts/rm01b/audit-role-provision.psql: the role is created
-- locked (NOLOGIN, PASSWORD NULL) first if it does not already exist, a
-- password is entered interactively via psql's own `\password` (never
-- typed into this file, never echoed, never logged), and — critically —
-- SCRAM-SHA-256 verification runs unconditionally for whichever role now
-- exists, whether freshly created here or already present from a prior
-- run. An existing role whose stored password is NULL, MD5, or otherwise
-- not a confirmed `SCRAM-SHA-256$...` verifier STOPS this script; it is
-- never silently "fixed" or rotated by this file.
--
-- IMPORTANT — read before running: this file establishes the role's
-- attributes and per-database ownership. It does NOT prove the role is
-- isolated from simprok_db (CONNECT_ISOLATION). PostgreSQL grants CONNECT
-- to PUBLIC on every database by default unless explicitly revoked, and
-- this file cannot revoke anything on simprok_db without connecting to
-- simprok_db, which it must never do. After running this file, the
-- adoption phase (docs/runbook/TESTCRED-LEAST-PRIVILEGE-01.md §4) requires
-- separately running:
--   SELECT has_database_privilege('simprok_test_runner', 'simprok_db', 'CONNECT');
-- and confirming it returns false. If it returns true, adoption does not
-- pass and no document may claim isolation until that is fixed and
-- reverified.
--
-- Scope reasoning: this project's normal test/e2e workflow (see
-- backend/scripts/e2e-database-lifecycle.ts, `prisma migrate reset` /
-- `migrate dev` / `migrate deploy`) drops and recreates the entire public
-- schema of simprok_test/simprok_e2e on every run. That requires full DDL
-- control inside those two databases specifically — there is no meaningful
-- narrower privilege set that would still let Prisma's own tooling work.
-- Ownership of exactly those two sandbox databases (not CREATEDB, not
-- CREATEROLE, not SUPERUSER, and no privilege on any other database) is the
-- least-privilege shape that satisfies that real requirement.

\set ON_ERROR_STOP on

SELECT current_database() IN ('simprok_test', 'simprok_e2e') AS database_ok \gset
\if :database_ok
\else
  \echo 'STOP_DATABASE_IDENTITY_MISMATCH: run this only against simprok_test or simprok_e2e, never simprok_db.'
  SELECT 1 / 0 AS fail_closed;
\endif

SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'simprok_test_runner') AS role_exists \gset
BEGIN;
\if :role_exists
\else
  CREATE ROLE simprok_test_runner NOLOGIN PASSWORD NULL NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 5;
  SET LOCAL password_encryption = 'scram-sha-256';
  \password simprok_test_runner
\endif

-- SCRAM verification runs unconditionally here, for BOTH the
-- just-created-above branch AND the already-existing-role branch. This is
-- deliberate: an existing role this script did not just password itself
-- must still prove it has a real SCRAM-SHA-256 verifier before being
-- promoted to LOGIN below. Never printed: only a boolean LIKE match, never
-- the stored hash itself.
SELECT COALESCE(rolpassword LIKE 'SCRAM-SHA-256$%', false) AS password_is_scram FROM pg_authid WHERE rolname = 'simprok_test_runner' \gset
\if :password_is_scram
\else
  \echo 'STOP_PASSWORD_NOT_SCRAM: simprok_test_runner has no confirmed SCRAM-SHA-256 password (missing, MD5, or otherwise). This script never sets or rotates a password for a pre-existing role -- provision it out-of-band with \password and rerun.'
  SELECT 1 / 0 AS fail_closed;
\endif

ALTER ROLE simprok_test_runner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 5;

-- Ownership of THIS database only (run once with -d simprok_test, once with
-- -d simprok_e2e — never with -d simprok_db, guarded above).
SELECT format('ALTER DATABASE %I OWNER TO simprok_test_runner', current_database()) \gexec
GRANT ALL ON SCHEMA public TO simprok_test_runner;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO simprok_test_runner;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO simprok_test_runner;

SELECT (
  rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls
) AS attributes_ok FROM pg_roles WHERE rolname = 'simprok_test_runner' \gset
\if :attributes_ok
\else
  \echo 'STOP_UNEXPECTED_TEST_ROLE_PRIVILEGE'
  SELECT 1 / 0 AS fail_closed;
\endif

COMMIT;

-- This file does NOT prove CONNECT_ISOLATION. Immediately after running it
-- against both databases, run (still as the superuser, from any database):
--   SELECT has_database_privilege('simprok_test_runner', 'simprok_db', 'CONNECT');
-- Required result: false. If true, STOP -- do not proceed to adoption
-- (docs/runbook/TESTCRED-LEAST-PRIVILEGE-01.md §4) until an explicit
-- REVOKE CONNECT ON DATABASE simprok_db FROM simprok_test_runner (applied
-- by whoever administers simprok_db) makes this query return false.
--
-- Adoption (manual, after the above is confirmed false):
--   1. Update backend/.env.test and backend/.env.e2e DATABASE_URL to use
--      simprok_test_runner instead of postgres.
--   2. Re-run `npm run verify:db:acceptance` / `verify:db:e2e` to confirm
--      the guarded scripts still pass with the new role.
--   3. Only after that is confirmed working should the original shared
--      `postgres` role's password actually be rotated (separate, explicit
--      Owner-authorized step — not part of this file).
