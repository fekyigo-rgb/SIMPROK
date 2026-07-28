-- RM-02D1 remediation (UTANG-TESTCRED-01 mitigation) — reduced-privilege
-- Postgres role for the LOCAL dev/test toolchain (simprok_test, simprok_e2e)
-- ONLY. Never simprok_db.
--
-- STATUS: PLAN ONLY. This file has never been executed against any
-- database by an agent, and must never be executed by an agent. Owner
-- decision 2026-07-28: rotation of the current shared `postgres` credential
-- is DEFERRED; UTANG-TESTCRED-01 stays OPEN. This asset exists so that
-- whenever Owner authorizes adoption, there is already a reviewed,
-- least-privilege target to rotate the test credential INTO — not another
-- superuser-equivalent role. A human with existing superuser access on the
-- target Postgres instance runs this manually, psql session by psql
-- session, exactly once per database (`-d simprok_test`, then
-- `-d simprok_e2e`). It follows the same safe-password pattern already
-- proven in backend/scripts/rm01b/audit-role-provision.psql: the role is
-- created locked (NOLOGIN, PASSWORD NULL) first, the password is entered
-- interactively via psql's own `\password` (never typed into this file,
-- never echoed, never logged), and only a confirmed SCRAM-SHA-256 verifier
-- promotes the role to LOGIN.
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
--
-- Isolation from simprok_db is NOT enforced by a Postgres-level REVOKE in
-- this file (that would require connecting to simprok_db, which this asset
-- must never do). The actual, already-implemented isolation boundary is
-- application-level: backend/scripts/database-role-guards.ts asserts
-- `current_database()` equals exactly simprok_test/simprok_e2e before any
-- test/e2e script proceeds, and FORBIDDEN_PRODUCTION_DATABASE = simprok_db
-- is a recognized, guarded name in that same module. A cluster-level
-- REVOKE CONNECT ON DATABASE simprok_db FROM PUBLIC is a separate,
-- larger, production-owning-DBA decision, out of scope here.

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
  SELECT COALESCE(rolpassword LIKE 'SCRAM-SHA-256$%', false) AS password_is_scram FROM pg_authid WHERE rolname = 'simprok_test_runner' \gset
  \if :password_is_scram
  \else
    \echo 'STOP_PASSWORD_NOT_SCRAM'
    SELECT 1 / 0 AS fail_closed;
  \endif
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

-- Adoption (manual, after this is run against both databases by a human):
--   1. Update backend/.env.test and backend/.env.e2e DATABASE_URL to use
--      simprok_test_runner instead of postgres.
--   2. Re-run `npm run verify:db:acceptance` / `verify:db:e2e` to confirm
--      the guarded scripts still pass with the new role.
--   3. Only after that is confirmed working should the original shared
--      `postgres` role's password actually be rotated (separate, explicit
--      Owner-authorized step — not part of this file).
