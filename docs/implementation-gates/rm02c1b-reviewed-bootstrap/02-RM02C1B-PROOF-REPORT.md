# RM-02C1b — Proof Report

## 1. Disposable-instance proof (real 271-row inventory, isolated PostgreSQL 17)

```
DISPOSABLE_POSTGRES_METHOD=NATIVE_BINARIES (Docker not installed on this
  machine, consistent with the RM-02C1a slice's finding; substituted the
  local PostgreSQL 17.10 binaries — fresh temp data directory, dynamic
  loopback port, no persistent volume, destroyed completely after proof)
DISPOSABLE_POSTGRES_CONTAINER_DESTROYED=YES
```

Full RM-02C1a migration chain (24 migrations) applied cleanly to a fresh
disposable database. A single Workspace-A fixture (matching the real
well-known ID `10000000-0000-4000-8000-000000000004`) was seeded, with zero
pre-existing `ResourceCatalog` rows — matching the real `simprok_test`'s
actual state (confirmed separately: `seed-acceptance.ts` never creates a
`ResourceCatalog` row for Workspace-A).

The **real, unmodified** `loadCanonicalInventory()` +
`buildPlan()`/`applyBootstrapPlan()` — the same code the CLI wrapper calls —
was run directly against this disposable instance, using the real committed
271-row inventory (not a synthetic fixture):

```
inventory hash verified                                              PASS
271 total rows                                                       PASS
PLAN_HASH_RUN_1 == PLAN_HASH_RUN_2                                    PASS
blocked rows = 2                                                      PASS
zero conflicts on fresh Workspace-A                                   PASS
eligible rows = 269                                                   PASS
canonical identities = 267                                            PASS
provenance rows = 269                                                 PASS
row 9 disposition = CREATE_L01_IF_ABSENT (fresh workspace)             PASS
11 L.02 rows, all canonicalCode null                                  PASS
row 137 disposition = ATTACH_EXACT_DUPLICATE_PROVENANCE                PASS
row 161 disposition = ATTACH_EXACT_DUPLICATE_PROVENANCE                PASS
rows 200/201 = CREATE_DISTINCT_SAME_NAME_DIFFERENT_UNIT                PASS
rows 39/104 = BLOCKED_MISSING_SOURCE_UNIT                              PASS
first apply: resourceCatalogCreatedDelta = 267                        PASS
first apply: provenanceCreatedDelta = 269                             PASS
persisted ResourceCatalog count = 267                                  PASS
persisted ResourceSourceIdentity count = 269                           PASS
row 39 write count = 0                                                 PASS
row 104 write count = 0                                                PASS
non-L.01 canonical code non-null count = 0                             PASS
canonical code "0" count = 0                                           PASS
zero BasicPrice/PriceSubmission/PublicationAudit/UnitDefinition/        PASS
  UnitAlias/AHSP/Region DELTA caused by this bootstrap
second dry-run: all 269 eligible rows are IDEMPOTENT_ALREADY_APPLIED   PASS
second apply: resourceCatalogCreatedDelta = 0                          PASS
second apply: provenanceCreatedDelta = 0                               PASS
persisted count unchanged after second apply                          PASS

27/27 assertions PASS
```

One methodological correction made during this proof, recorded for
transparency: the first draft of the zero-side-effect check asserted
**absolute** zero for `UnitDefinition`/`UnitAlias`, which failed (8 and 11
respectively) — not because of a bootstrap defect, but because an earlier,
already-merged migration (`20260717010000_kamus_unit_kernel_01a`) seeds
fixed unit reference rows directly in its own DDL, unconditionally, in every
environment. The check was corrected to assert **delta == 0** (before vs.
after this bootstrap's apply), which is what the contract actually requires
and what this bootstrap's code is actually capable of affecting — confirmed
now genuinely zero.

Transaction-rollback-on-injected-failure and concurrent-apply serialization
are not re-proven against the full 271-row dataset here — both require live
rows to inject a failure against or race on, and both are already proven
against a real Postgres transaction in the e2e suite (§2, tests 25 and 26).
This disposable run's unique contribution is proving the exact
267/269/2 counts end-to-end against the real committed inventory before
ever touching `simprok_test`.

## 2. Official safe E2E (real `simprok_test`)

`test/acceptance/resource-catalog-bootstrap.e2e-spec.ts` — 11 tests, run via
`npm run test:e2e:safe` (full migration chain applied fresh, seed-acceptance,
full suite, residual fingerprint check):

```
37-43: full apply across every disposition type — zero side-effect deltas  PASS
27: second identical apply is fully idempotent — zero persistent delta     PASS
25: injected mid-apply failure rolls back everything                      PASS
28: a stale plan hash fails                                                PASS
29: a missing/wrong confirmation token fails before any write              PASS
31: an existing provenance mismatch fails closed as CONFLICT_STOP          PASS
26: concurrent apply attempts serialize via the advisory lock              PASS
36: no ResourceCatalog/provenance row in an unrelated workspace            PASS
22 (CASE 2): absent L.01 created exactly once                              PASS
18/19/20/21 (CASE 1): pre-existing exact L.01 reused, UUID/keys preserved  PASS
23/24 (CASE 3): conflicting L.01 fails closed                              PASS
```

See §XV of the final report for the full-suite backend/frontend gate
results (build, unit tests, safe E2E suite-wide count, residual result).

## 3. What is asserted vs. what is reused from RM-02C1a

Items 33-35 of the test contract (cross-workspace provenance rejected;
global-resource provenance rejected; Workspace-A resource immutable once
provenance exists) are enforced by the RM-02C1a database triggers, already
proven in that slice's own test suite
(`test/acceptance/resource-identity-schema-foundation.e2e-spec.ts`). This
bootstrap's own code never constructs a cross-workspace or global-resource
write (every provenance row it creates always uses the same `workspaceId` as
the resource it just resolved), so there is no new code path here that could
violate those invariants — re-proving RM-02C1a's own trigger behavior again
in this slice would be redundant, not additional evidence.

Soli Deo Gloria.
