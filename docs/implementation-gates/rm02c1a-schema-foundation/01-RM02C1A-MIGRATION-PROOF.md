# RM-02C1a — Migration Safety Proof

```
MIGRATION_PATH=backend/prisma/migrations/20260727025308_rm02c1a_resource_identity_schema_foundation/migration.sql
MIGRATION_COUNT=1
PRISMA_VERSION=6.4.1 (unchanged — no upgrade performed)
BUSINESS_DATA_DML_IN_MIGRATION=0 (INSERT=0, UPDATE=0, DELETE=0 — verified by
  a committed static-content test that greps the migration.sql text for
  INSERT INTO / UPDATE "..." / DELETE FROM)
```

## 1. Disposable PostgreSQL method

```
DISPOSABLE_POSTGRES_METHOD=NATIVE_BINARIES (Docker Desktop was not installed
  on this machine — confirmed: `docker` not on PATH, no
  C:\Program Files\Docker directory. Per Owner's explicit choice, substituted
  the already-installed PostgreSQL 17.10 binaries at
  C:\Program Files\PostgreSQL\17\bin — same isolation guarantees as the
  container approach: fresh temp data directory, dynamically-chosen loopback
  port, no mounted persistent volume, torn down completely after proof.)
DISPOSABLE_POSTGRES_DATA_DIR=<session temp scratchpad>\rm02c1a-pg\data (deleted)
DISPOSABLE_POSTGRES_PORT=50230 (dynamically selected via a free-port probe,
  not hard-coded)
DISPOSABLE_POSTGRES_DATABASES=rm02c1a_dev, rm02c1a_shadow (both created after
  parsing and echoing the exact database names from DATABASE_URL /
  SHADOW_DATABASE_URL before running any Prisma command)
DISPOSABLE_POSTGRES_CONTAINER_DESTROYED=YES (pg_ctl stop -m fast, then the
  entire temp data directory was deleted; confirmed removed)
SIMPROK_DB_CONNECTION_COUNT=0
SIMPROK_TEST_CONNECTION_DURING_DISPOSABLE_PROOF=0 (the disposable proof never
  touched simprok_test; simprok_test was used later, separately, only for
  the official safe E2E lifecycle — see §4)
```

## 2. Forward proof (disposable instance)

Sequence: applied all 23 pre-existing migrations to a fresh `rm02c1a_dev`
(`prisma migrate deploy`) — clean. Generated the new migration
(`prisma migrate dev --create-only`). Hand-customized `migration.sql` (partial
index, CHECK constraint, both triggers; removed the unrelated FK-rename
drift — see contract doc §8). Then `prisma migrate reset --force` applied
the complete chain (24 migrations) from zero — clean, no errors.

A temporary (uncommitted, deleted after use) Node script using `pg` ran 24
assertions directly against the reset database:

```
1-3: existing row identical after migration (id/code/name/unit)     PASS
4:   code=NULL becomes legal                                        PASS
5:   multiple NULL-code resources in one workspace legal            PASS
6:   duplicate non-null code, same workspace -> rejected             PASS
7:   same non-null code, different workspace -> accepted             PASS
8:   provenance accepts rawCode NULL, rawUnit NULL, exact raw text   PASS
9:   duplicate provenance locator, same workspace -> rejected        PASS
10:  same source locator, different workspace -> accepted           PASS
11:  deleting a resource with provenance -> rejected (FK RESTRICT)   PASS
12:  zero BasicPrice rows created by this proof                     PASS
H2:  cross-workspace provenance insert -> rejected by trigger        PASS
H3:  global-resource (workspaceId NULL) provenance insert rejected  PASS
H4:  resource workspace mutation rejected once provenance exists    PASS
H4b: setting provenance-bearing resource workspaceId to NULL       PASS
     rejected
H4c: workspace mutation allowed for resource with NO provenance    PASS
H5:  SHA CHECK — canonical uppercase 64-hex passes                  PASS
H5:  SHA CHECK rejects length 63 / length 65 / non-hex / lowercase / PASS (5/5)
     trailing whitespace
H6:  both trigger functions exist by exact name                     PASS
H6:  both triggers exist by exact name                              PASS

24/24 assertions PASS
```

```
DISPOSABLE_FORWARD_PROOF=PASS
```

## 3. Rollback proof (disposable instance) and its temporal boundary

The database was reset again and seeded with **only** the baseline fixture
(one Workspace-A `ResourceCatalog` row, code `L.01` — no NULL-code rows, no
`ResourceSourceIdentity` rows), matching the rollback preconditions this
migration's reverse path requires.

```
precondition: zero NULL-code ResourceCatalog rows        PASS (count=0)
precondition: zero ResourceSourceIdentity rows            PASS (count=0)
```

A temporary reverse SQL script (not committed — this repo has no
down-migration convention; Prisma migrations here are forward-only) was
applied:

```sql
DROP TRIGGER "resource_catalog_workspace_immutable_with_provenance_trigger" ON "resource_catalogs";
DROP TRIGGER "resource_source_identity_workspace_match_trigger" ON "resource_source_identities";
DROP FUNCTION check_resource_catalog_workspace_immutable_with_provenance();
DROP FUNCTION check_resource_source_identity_workspace_match();
DROP TABLE "resource_source_identities";
DROP INDEX "resource_catalogs_workspace_code_nonnull_key";
ALTER TABLE "resource_catalogs" ALTER COLUMN "code" SET NOT NULL;
CREATE UNIQUE INDEX "resource_catalogs_workspaceId_code_key" ON "resource_catalogs"("workspaceId", "code");
```

Result:

```
reverse SQL applied without error                                   PASS
fixture row byte/value-identical after rollback (id/code/name/      PASS
  baseUnit/status all unchanged)
old compound unique index restored                                  PASS
partial unique index dropped                                        PASS
resource_source_identities table dropped                            PASS
both trigger functions dropped                                       PASS
code NOT NULL constraint restored (re-insert with NULL code fails)  PASS

9/9 rollback assertions PASS
```

```
DISPOSABLE_ROLLBACK_PROOF=PASS
ROLLBACK_TEMPORAL_BOUNDARY_DOCUMENTED=YES
```

**Rollback temporal boundary (explicit):** this reverse path is valid only
while zero `ResourceCatalog` rows contain a NULL `code` and zero
`ResourceSourceIdentity` rows exist — i.e., only immediately after this
migration, before RM-02C1b (or any other future work) begins inserting
NULL-code resources or provenance rows. Once RM-02C1b bootstrap runs, this
reverse SQL would destroy real provenance data and cannot be treated as a
safe undo. This is a deliberate, disclosed limitation, not an oversight.

## 4. Application to `simprok_test` (official safe E2E lifecycle)

Per the DB boundaries (`simprok_test` writes and the official safe lifecycle
are explicitly allowed; `simprok_db`/production remain untouched throughout),
the migration was applied for real to the shared local `simprok_test`
database via this repo's existing `npm run test:e2e:safe` lifecycle (`prisma
migrate reset --force` + `seed-acceptance` + the full e2e Jest suite +
residual fingerprint check) — the same mechanism every prior SIMPROK slice
uses, not something invented for this task.

```
SIMPROK_TEST_SCHEMA_WRITE=YES
SIMPROK_TEST_TEMP_TEST_DATA_CLEANED=YES
RESOURCE_CATALOG_PERSISTENT_DATA_DELTA=0
RESOURCE_SOURCE_IDENTITY_PERSISTENT_DATA_DELTA=0
BASIC_PRICE_PERSISTENT_DATA_DELTA=0
PRICE_SUBMISSION_PERSISTENT_DATA_DELTA=0
PUBLICATION_AUDIT_PERSISTENT_DATA_DELTA=0
SIMPROK_DB_CONNECTION_COUNT=0
SIMPROK_DB_WRITE_COUNT=0
```

Three consecutive local runs were made against `simprok_test`:

1. First run (before the new e2e-spec's own assertions were corrected):
   300/305 tests passed; the only 5 failures were in the new
   `resource-identity-schema-foundation.e2e-spec.ts` itself, all caused by
   two test-authoring mistakes (an over-precise index-predicate string
   match, and asserting the wrong Prisma error subclass for CHECK-constraint
   violations vs. length-overflow violations) — not by the schema or
   migration. `RESIDUAL_RESULT: PASS`.
2. Second run (after fixing those two assertions): a genuine, unrelated
   infrastructure flake appeared — 11 failures across exactly two files
   (`project-intake-context.e2e-spec.ts`, `reality-intake-extraction.e2e-spec.ts`),
   neither of which references `ResourceCatalog`, `resourceCatalog`, or the
   one changed application file (confirmed by direct search of both files —
   zero matches). One failure was an explicit Jest timeout
   ("Exceeded timeout of 5000 ms") consistent with this repo's already-named,
   pre-existing debt (`DEBT.md`: "Windows tsx/esbuild service spawn EPERM",
   environment-toolchain class, follow-up required, not a product defect).
   `RESIDUAL_RESULT: FAIL` — leaked rows in unrelated tables (accounts,
   organizations, projects, etc.), consistent with a test being interrupted
   mid-flight by that timeout before its own cleanup ran.
3. Third run (immediate re-run, no code changes): **26/26 suites, 305/305
   tests, RESIDUAL_RESULT: PASS.** The exact same two files that failed in
   run 2 passed cleanly with zero changes, confirming run 2's failure was
   transient environmental flakiness, not a regression from this slice.

```
BACKEND_BUILD=PASS
BACKEND_UNIT_TESTS=478/478 PASS
TARGETED_TESTS=resource-identity-schema-foundation.e2e-spec.ts — PASS (part of the 305/305 in run 3)
SAFE_E2E=PASS (run 3; runs 1-2 preserved above as honest failure history, not erased)
SAFE_E2E_TEST_COUNT=305
RESIDUAL_RESULT=PASS (run 3)
```

Soli Deo Gloria.
