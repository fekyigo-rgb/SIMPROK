# RM-02C1c — Proof Report

## 1. Disposable-instance proof (real committed inventory, isolated PostgreSQL 17)

```
DISPOSABLE_POSTGRES_METHOD=NATIVE_BINARIES (Docker not installed on this
  machine, consistent with RM-02C1a/RM-02C1b's finding; substituted the
  local PostgreSQL 17.10 binaries — fresh temp data directory, dynamic
  loopback port, no persistent volume, destroyed completely after proof)
DISPOSABLE_POSTGRES_CONTAINER_DESTROYED=YES
```

Full RM-02C1a migration chain (24 migrations — unchanged by RM-02C1b or
this slice, since neither touches the schema) applied cleanly to a fresh
disposable database. A single Workspace-A fixture (matching the real
well-known ID `10000000-0000-4000-8000-000000000004`) was seeded with zero
pre-existing `ResourceCatalog` rows.

The real, unmodified `loadCanonicalInventory()` + `buildMissingUnitPlan()`
/ `applyMissingUnitPlan()` — the same code the CLI wrapper calls — was run
directly against this disposable instance, using the real committed
inventory (not a synthetic fixture):

```
inventory hash verified                                              PASS
PLAN_HASH_RUN_1 == PLAN_HASH_RUN_2                                    PASS
plan has exactly 2 entries                                            PASS
row 39 disposition = CREATE_REVIEWED_RESOURCE (fresh workspace)       PASS
row 104 disposition = CREATE_REVIEWED_RESOURCE (fresh workspace)      PASS
row 39 acceptedBaseUnit = Buah                                        PASS
row 104 acceptedBaseUnit = M3                                         PASS
row 39 sourceRawUnit = null                                           PASS
row 104 sourceRawUnit = null                                          PASS
first apply: resourceCatalogCreatedDelta = 2                          PASS
first apply: provenanceCreatedDelta = 2                               PASS
Kawat BRC persisted with baseUnit=Buah, code=null, type=MATERIAL      PASS
Kerikil persisted with baseUnit=M3, code=null, type=MATERIAL          PASS
Kawat BRC provenance rawUnit remains NULL                             PASS
Kerikil provenance rawUnit remains NULL                               PASS
persisted ResourceCatalog count = 2 (fresh workspace, source-scoped)  PASS
second dry-run: both rows IDEMPOTENT_ALREADY_APPLIED                 PASS
second apply: resourceCatalogCreatedDelta = 0                        PASS
second apply: provenanceCreatedDelta = 0                              PASS
persisted count unchanged after second apply                         PASS

20/20 assertions PASS
```

Concurrent-apply serialization and injected-failure rollback are not
re-proven on the disposable instance — both require a specific timing
setup that is already proven, twice, against real `simprok_test` in the
e2e suite (§2, tests 25/26). This disposable run's unique contribution is
proving the exact Buah/M3 dispositions end-to-end against the real
committed inventory before ever touching `simprok_test`.

## 2. Official safe E2E (real `simprok_test`)

`test/acceptance/resource-catalog-missing-unit-disposition.e2e-spec.ts` —
10 tests, using a dedicated fixture workspace and a fixture-scoped
`sourceSha256` (never the real committed inventory's hash), so this suite
never depends on or disturbs the real Workspace-A precondition state:

```
fresh apply creates exactly two reviewed resources, zero side effects   PASS
second identical apply is fully idempotent — zero persistent delta     PASS
a stale plan hash fails before any write                                PASS
a missing/wrong confirmation token fails before any write               PASS
existing provenance mismatch fails closed as CONFLICT_STOP              PASS
an existing unproven exact candidate fails closed                       PASS
an existing same-name/different-unit candidate is never modified/       PASS
  never blocks
concurrent apply attempts serialize via the advisory lock                PASS
injected failure between the two rows rolls back both                    PASS
no ResourceCatalog/provenance row in an unrelated workspace              PASS
```

Run twice consecutively to confirm the concurrency assertion isn't flaky —
both runs: 10/10 PASS.

Real Workspace-A precondition re-verified unaffected after both direct
e2e runs: `catalog=267, provenance=269` (source-scoped, unchanged).

See §XV of the final report for the full-suite backend/frontend gate
results (build, unit tests, official safe E2E suite-wide count, residual
result).

## 3. What is reused vs. independently proven

The RM-02C1a tenancy triggers (cross-workspace provenance rejection,
global-resource provenance rejection, workspace immutability once
provenance exists) are not re-proven here — this module's own write paths
always source both `ResourceCatalog.workspaceId` and
`ResourceSourceIdentity.workspaceId` from the same `params.workspaceId`,
so there is no code path in this slice that could construct a
cross-workspace or global-resource write. Re-testing RM-02C1a's own,
already-proven trigger behavior again would be redundant, not additional
evidence.

Soli Deo Gloria.
