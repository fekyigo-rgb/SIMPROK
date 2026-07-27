# RM-02C1b — Reviewed Resource Catalog Bootstrap Contract

**Status:** IMPLEMENTED, NOT MERGED. Draft PR only.

```
BASE_SHA=ca74ebf0cfd67dbdeff68a5dca28b525bd4f1ead
BRANCH=feat/rm02c1b-reviewed-resource-bootstrap
WORKTREE=C:\Users\asus\SIMPROK-WT-RM02C1B
ROADMAP_ITEM=RM-02C1b
```

This document does not reopen or restate the RM-02C0 canonical discovery
(`docs/implementation-gates/rm02c0-discovery/`) or the RM-02C1a schema
foundation (`docs/implementation-gates/rm02c1a-schema-foundation/`), both of
which are locked and unchanged by this slice.

## 1. What this slice does

Bootstraps Workspace-A's `ResourceCatalog` and `ResourceSourceIdentity` rows
from the already-locked RM-02C0 canonical inventory (271 source rows), using
a deterministic, human-reviewable plan and a transactional, idempotent
apply. No endpoint, no frontend, no Prisma schema change — this is pure
application logic on top of the RM-02C1a foundation.

```
SOURCE_ROWS_TOTAL=271 (LABOR=17, MATERIAL=241, EQUIPMENT=13)
BLOCKED_SOURCE_ROWS=2 (rows 39, 104 — missing source unit)
ELIGIBLE_SOURCE_ROWS=269
EXACT_DUPLICATE_GROUPS_COLLAPSED=2 (rows 136/137, rows 157/161)
SOURCE_SCOPED_CANONICAL_IDENTITIES=267
SOURCE_SCOPED_PROVENANCE_ROWS=269
```

Every one of these figures was independently re-verified against the
committed `01-RM02C0-RESOURCE-INVENTORY.json` and
`02-RM02C0-ANOMALY-REGISTER.json` before writing any code (exact row
contents for rows 9, 10-20, 39, 104, 136/137, 157/161, 200/201 were read
directly from the committed JSON, not assumed from the prompt).

## 2. Architecture: no auto-merge algorithm, ever

Every special-case row in `resource-catalog-bootstrap-planner.ts` is an
explicit, hardcoded source row number — never a generic pattern-matching or
fuzzy-merge rule:

- `CANONICAL_CODE_ROW = 9` — the only row permitted to carry a canonical
  code (`L.01`).
- `EXACT_DUPLICATE_GROUPS` — exactly two hardcoded `{representative,
  duplicate}` pairs: `{136, 137}` and `{157, 161}`. No code anywhere scans
  for "rows with identical name+unit" and merges them generically; only
  these two named pairs collapse into one `ResourceCatalog`.
- `SAME_NAME_DIFFERENT_UNIT_ROWS` — `{200, 201}`, a label-only distinction
  (both still become independent resources; the label exists purely so a
  human reading the plan sees "these look similar but are deliberately
  distinct," not "these are default rows that happen to share a name").
- `BLOCKED_MISSING_UNIT_ROWS` — `{39, 104}`, zero writes.

This is a deliberate reading of `AUTO_FUZZY_MERGE=FORBIDDEN`: a general
"collapse anything that looks like a duplicate" algorithm would be exactly
the forbidden behavior, even if it happened to produce the same result for
these two pairs today. Hardcoding the two authorized pairs by row number
makes the exception auditable and incapable of silently reappearing for a
row the committed evidence never approved.

## 3. Disposition model

```
CREATE_NEW_RESOURCE                        — the default: one row, one resource, code NULL
REUSE_EXACT_L01                            — row 9, an exact pre-existing L.01 found
CREATE_L01_IF_ABSENT                       — row 9, no pre-existing L.01
ATTACH_EXACT_DUPLICATE_PROVENANCE          — rows 137/161: attach to the representative's resource
CREATE_DISTINCT_SAME_NAME_DIFFERENT_UNIT   — rows 200/201: same as CREATE_NEW_RESOURCE, labeled for clarity
BLOCKED_MISSING_SOURCE_UNIT                — rows 39/104: zero writes
IDEMPOTENT_ALREADY_APPLIED                 — this exact row's provenance already exists and matches exactly
CONFLICT_STOP                              — fails closed; apply refuses if ANY row has this disposition
```

Disposition is computed fresh from live database state every time the plan
is built — both for a read-only dry-run and, again, inside the apply
transaction immediately before writing (see §5). It is never cached or
carried forward from an earlier read.

## 4. Deterministic plan and hash

The plan is canonicalized (recursively sorted object keys, entries ordered
by `sourceRowNumber` ascending) and hashed with SHA-256. Two independent
`buildPlan()` calls against unchanged database state produce byte-identical
JSON and identical hashes — proven both by a unit test (mocked client) and
by the disposable-instance proof (real database, real 271-row inventory,
`PLAN_HASH_RUN_1 == PLAN_HASH_RUN_2`).

The committed plan JSON (`01-RM02C1B-CANONICAL-PLAN.json`) contains no
database-generated UUID, no price, and no non-reproducible timestamp — only
source-row-derived facts and dispositions. UUIDs are resolved fresh at apply
time by re-querying, never carried from an earlier plan read (a stale UUID
baked into a plan would be exactly the kind of TOCTOU bug this design
avoids).

## 5. Apply: transaction, advisory lock, idempotency, fail-closed gates

`applyBootstrapPlan()`:

1. Requires `confirmationToken === "APPLY_RM02C1B_TO_SIMPROK_TEST"` (checked
   before opening any transaction).
2. Opens one Prisma interactive transaction for the entire apply.
3. Acquires `pg_advisory_xact_lock()` scoped to a hash of
   `(workspaceId, sourceSha256, parserContractVersion)` — transaction-scoped,
   so it releases automatically on commit or rollback; no separate
   unlock call needed, no lock ever leaks past a crash.
4. Rebuilds the plan **fresh, inside the transaction**, and compares its
   hash to the caller-supplied `expectedPlanSha256`. A mismatch — the live
   database or inventory changed since the plan was reviewed — fails
   closed (`STOP_STALE_PLAN_HASH`) before any write.
5. Refuses if any entry is `CONFLICT_STOP` (`STOP_CONFLICTS_PRESENT`).
6. Processes entries in `sourceRowNumber` order (so a representative row —
   136 or 157 — is always resolved before its attach-row — 137 or 161 —
   needs it).
7. Returns exact deltas: `resourceCatalogCreatedDelta`,
   `resourceCatalogReusedDelta`, `resourceCatalogUpdatedDelta`,
   `provenanceCreatedDelta`.

A test-only seam (`injectFailureAfterSourceRowNumber`) throws immediately
after processing a named row, before commit — this is how transactional
rollback is proven (test 25) without needing a real infrastructure fault.
It is never referenced by the CLI wrapper.

## 6. The CLI wrapper is the only sanctioned entry point against a real environment

`scripts/rm02c1b/resource-catalog-bootstrap.ts` (`npm run
resource-catalog:bootstrap:dry-run` / `:apply`) loads `.env.test`, then runs
this repository's existing, already-proven official database guard
(`scripts/test-database-guard.ts`'s `verifyTestDatabase()`) — refusing
anything except a live `simprok_test`. Only after the guard passes does it
call the guard-agnostic core planner/apply functions.

This is a deliberate separation, not an oversight: the core
`resource-catalog-bootstrap-planner.ts` module has **no** database-name
assertion of its own. That is what let the same code be proven end-to-end
on a disposable, isolated PostgreSQL 17 instance (§7) and in
`test/acceptance/resource-catalog-bootstrap.e2e-spec.ts` against real
`simprok_test` — both call the core functions directly, never through the
CLI wrapper, and neither could otherwise pass the wrapper's
simprok_test-only guard.

## 7. L.01 disposition — three cases, all proven

```
CASE 1 (REUSE_EXACT_L01)      — pre-existing exact L.01: UUID preserved,
                                 rm02bTestOnly stripped from specifications,
                                 every other key preserved, resource never
                                 recreated.
CASE 2 (CREATE_L01_IF_ABSENT) — no L.01 exists: created fresh.
CASE 3 (CONFLICT_STOP)        — a code=L.01 resource exists but doesn't
                                 exactly match name=Pekerja/type=LABOR/
                                 baseUnit=Org-Hari (or more than one exists):
                                 fails closed, applies nothing.
```

All three are covered by dedicated e2e tests, each running in its own
disposable workspace (these three states are mutually exclusive and cannot
coexist in one workspace).

## 8. Null-readiness / scope

No application source file outside `src/resource-catalog/` and
`scripts/rm02c1b/` was touched. No endpoint, no DTO, no frontend file.

```
RESOURCE_CATALOG_ALIAS_CREATED=NO
CATALOG_SEARCH_ENDPOINT_CREATED=NO
UNIT_KERNEL_TOUCHED=NO
BASIC_PRICE_TOUCHED=NO
```

## 9. Known limitation — deferred, not solved here

```
RM02C1C_MISSING_UNIT_HUMAN_DISPOSITION=DEFERRED
```

Rows 39 (Kawat BRC) and 104 (Kerikil) have a genuinely empty source unit
cell. No unit is inferred for either — see
`03-RM02C1B-BLOCKED-ROW-REGISTER.json`. Resolving what unit these two
resources should actually carry requires a human decision informed by
domain knowledge this task does not have and is not authorized to guess at;
it is named as a follow-up roadmap item, not solved by fabricating a
plausible-looking unit.

Soli Deo Gloria.
