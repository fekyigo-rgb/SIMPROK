# RM-03C — 02 CANONICAL PRE-MERGE PREFLIGHT

### Dalam Nama Tuhan Yesus Kristus.

```
PREFLIGHT_GATE             = PASS
OWNER_MERGE_DECISION_READY = YES
MERGE                      = NO

PRODUCTION_DATA_WRITE      = 0
PRODUCTION_SCHEMA_WRITE    = 0
PRODUCTION_MIGRATION_APPLY = 0
PRODUCTION_DEPLOYMENT      = 0
PRODUCTION_SERVICE_RESTART = 0
```

Read-only evidence gathered 2026-08-07 against canonical `simprok_db`, before
the Owner decides whether to merge PR #68. This gate audits **production
readiness only**. The RM-03C implementation itself is Architect-audited and was
not reopened, redesigned, or re-litigated here.

No credential, password, connection string, account email or personal name
appears in this document.

---

## 1. Repository and PR reality

| | |
|---|---|
| PR | #68 — `state=OPEN`, `isDraft=true`, `mergedAt=null`, `mergeCommit=null` |
| Mergeability | `mergeable=MERGEABLE`, `mergeStateStatus=CLEAN` |
| Base | `bbba3d0b4e1de694d5f8da4ace40f88a451218ff` — as authorized |
| Head at task start | `9828ee630cdc5fae5708def2aa2feb973213b2f3` — as authorized |
| Changed files | 25 (+3579 / −89) |
| Feature worktree | `C:\Users\asus\SIMPROK-WT-RM03C`, `git status --short` **empty** |

Nothing was merged, marked ready, rebased, amended or force-pushed.

---

## 2. Migration byte inventory (unchanged; read, not edited)

Twelve executable statements, in order:

| # | Statement | Object |
|---|---|---|
| 1 | `CREATE TYPE` | `BasicPriceAssetScope` enum |
| 2 | `ALTER TABLE … ADD COLUMN ×2` | `assetScope` (nullable), `sourceImportRowId` (nullable) |
| 3 | `UPDATE` | legacy null-scope rows → `SIMPROK_CATALOG` |
| 4 | `ALTER TABLE … SET NOT NULL, SET DEFAULT` | `assetScope` |
| 5 | `CREATE UNIQUE INDEX` | `basic_prices_sourceImportRowId_key` |
| 6 | `CREATE INDEX` | `basic_prices_workspaceId_assetScope_idx` |
| 7 | `ALTER TABLE … ADD CONSTRAINT … FOREIGN KEY` | `basic_prices_sourceImportRowId_fkey` |
| 8–12 | `ALTER TABLE … ADD CONSTRAINT … CHECK` ×5 | the five private-asset invariants |

**Index count correction.** The migration creates **TWO** new indexes, not
three. Earlier wording in `00-CONTRACT.md`, the migration header comment and
the PR body said "three indexes" and was wrong; all three surfaces are
corrected in the same commit as this document.

---

## 3. Canonical database identity — PASS

| Property | Value |
|---|---|
| `current_database()` | `simprok_db` |
| `current_user` / `session_user` | `simprok_readonly_audit` |
| Server | `127.0.0.1` port `55432` |
| Version | PostgreSQL 17.10 (x86_64-windows) |
| `pg_is_in_recovery()` | `f` (primary, not a replica) |
| `transaction_read_only` | `on` |
| `default_transaction_read_only` | `on` |
| `statement_timeout` / `lock_timeout` | `30s` / `3s` |
| `search_path` | `"$user", public` |

**Read-only was enforced four ways over,** not asserted:

1. the role itself — `rolsuper=f`, and on `public.basic_prices`
   `has_table_privilege` returns `SELECT=t`, `INSERT=f`, `UPDATE=f`,
   `DELETE=f`; `has_schema_privilege(public, CREATE)=f`;
2. `default_transaction_read_only=on` set at connection startup;
3. an explicit `BEGIN TRANSACTION READ ONLY` opening every script;
4. bounded `statement_timeout`/`lock_timeout` so no query could hold or wait on
   a lock.

The credential was read from the runtime secrets file into shell variables and
passed to `psql` **through the environment only** — never in any process
command line, honouring the same rule
`ops-runners/SHARED-HELPERS/ASSERT-NO-DB-SECRET-IN-PROCESS-ARGV.ps1` enforces.

**Why this is the canonical target and not a look-alike:**

- The runtime's own `secrets/backend.runtime.env` points `simprok_app` at the
  identical `127.0.0.1:55432/simprok_db`.
- Cluster topology confirms two separate PostgreSQL instances on this host:
  the **old** cluster (`postgresql-x64-17` service, data dir
  `C:\Program Files\PostgreSQL\17\data`, `port = 5432`, listening `0.0.0.0`) —
  the prohibited one — and the **canonical** cluster
  (`SIMPROK-RUNTIME\postgres17-main\data`, `port = 55432`,
  `listen_addresses = '127.0.0.1'`), which is the process actually serving
  55432. The queried target is the canonical cluster.
- This cluster hosts only `postgres`, `simprok_db`, `template1` — there is no
  `simprok_e2e`, no `simprok_test`, no developer database on it.
- Canonical is genuinely live and in Owner-bootstrap state: accounts 1,
  workspaces 1, organizations 1, memberships 1, users 1, permissions 18,
  roles 1, projects 1, regions 0. Database size 12 MB.

---

## 4. Production schema drift — NONE

```
RM03C_MIGRATION_RECORDED       = NO   (_prisma_migrations count = 0)
RM03C_ENUM                     = ABSENT
RM03C_ASSET_SCOPE_COLUMN       = ABSENT
RM03C_SOURCE_IMPORT_ROW_COLUMN = ABSENT
RM03C_INDEXES                  = ABSENT (both)
RM03C_FK                       = ABSENT
RM03C_CHECKS                   = ABSENT (all five)
FAILED_OR_UNFINISHED_MIGRATIONS = 0
```

Canonical `public.basic_prices` currently has 18 columns, 4 foreign keys, 1
primary key, **zero CHECK constraints**, and 8 indexes — exactly the
pre-RM-03C shape. `_prisma_migrations` holds 29 applied migrations, the newest
being `20260804090000_e1a_contextual_occurrence_ahsp_selection`, i.e. the head
of `main` at `6ac58b5`. Canonical schema is exactly one migration behind this
PR, as expected.

---

## 5. Historical BasicPrice truth — PASS_EMPTY_TABLE

```
HISTORICAL_BACKFILL_TRUTH = PASS_EMPTY_TABLE

LEGACY_ROW_COUNT                            = 0
CATALOG_SUBMISSION_LINEAGE_COUNT            = 0
CATALOG_PUBLICATION_LINEAGE_COUNT           = 0
CATALOG_CONTROLLED_LEGACY_LINEAGE_COUNT     = 0
AMBIGUOUS_COUNT                             = 0
                                              ---
SUM                                         = 0 = LEGACY_ROW_COUNT   ✓

BACKFILL_UPDATE_AFFECTED_ROWS_EXPECTED      = 0
```

`public.basic_prices` contains **zero rows**. Stronger than that:
`pg_stat_user_tables` reports `n_tup_ins = 0`, `n_tup_upd = 0`, `n_tup_del = 0`
— **no row has ever been inserted into this table on the canonical cluster.**
This is not "rows were cleaned up"; it is "no row ever existed". No old script,
earlier runtime, manual SQL operation or untracked procedure can have written a
row that later needs classifying, because the table's lifetime insert counter
is zero.

The whole price domain is empty and internally consistent:

| Table | Rows |
|---|---|
| `basic_prices` | 0 |
| `price_submissions` | 0 |
| `price_submission_reviews` | 0 |
| `price_submission_review_decisions` | 0 |
| `price_submission_audits` | 0 |
| `basic_price_publication_audits` | 0 |
| `basic_price_import_batches` | 0 |
| `basic_price_import_rows` | 0 |
| `resource_catalogs` | 0 |
| `project_ahsp_resource_resolutions` | 0 |

Anomaly probes, all zero: orphan `sourceSubmissionId` = 0; submission lineage
contradictions (resource/workspace/organization) = 0; publication audits with
no matching BasicPrice = 0.

**What this means for the migration's `UPDATE`.** It is *operationally
vacuous* on current canonical data — it will touch 0 rows. It is retained
because it must remain correct for any environment that does hold pre-RM-03C
rows, and because the classification belongs in the reviewable diff rather than
hidden in a column default.

**Governance consequence.** The earlier claim that the catalog backfill was
"proved" is corrected: repository writer lineage *supported* the hypothesis;
this canonical read proves the stronger and simpler fact that there is nothing
to classify at all.

---

## 6. Migration operational risk

```
MIGRATION_OPERATIONAL_CLASS = EMPTY_OR_NEAR_EMPTY_SIMPLE_WINDOW
```

| Evidence | Value |
|---|---|
| Exact row count | 0 |
| Heap size | 0 bytes |
| Indexes size | 64 kB (8 indexes × 1 page) |
| Total relation size | 72 kB |
| `n_live_tup` / `n_dead_tup` | 0 / 0 |
| Lifetime ins/upd/del | 0 / 0 / 0 |
| Vacuum / analyze history | never (nothing to vacuum) |
| Locks on `basic_prices` | only this audit session's own `AccessShareLock` |
| Other sessions on `simprok_db` | 1 (`simprok_app`, the running backend pool) |
| `basic_price_import_rows` (FK target) | 64 kB, 0 rows |
| Database size | 12 MB |
| Server | PostgreSQL 17.10 |

Statement-by-statement, against 0 rows:

| Statement | Rows scanned | Lock | Blocks app writes? | Assessment |
|---|---|---|---|---|
| `CREATE TYPE` | — | none on the table | no | instant |
| `ADD COLUMN` ×2 (nullable, no default) | 0 | `ACCESS EXCLUSIVE`, catalog-only | momentarily | metadata-only in PG 11+; instant |
| `UPDATE … WHERE assetScope IS NULL` | 0 | row locks on 0 rows | no | vacuous; no WAL rows, no bloat |
| `SET NOT NULL` | 0 (validation scan) | `ACCESS EXCLUSIVE` | momentarily | instant on an empty heap |
| `SET DEFAULT` | — | `ACCESS EXCLUSIVE`, catalog-only | momentarily | instant |
| `CREATE UNIQUE INDEX` | 0 | `SHARE` (blocks writes, allows reads) | momentarily | instant; ~8 kB |
| `CREATE INDEX` (composite) | 0 | `SHARE` | momentarily | instant; ~8 kB |
| `ADD FOREIGN KEY` | 0 | `ACCESS EXCLUSIVE` on `basic_prices` + `SHARE ROW EXCLUSIVE` on `basic_price_import_rows` (also 0 rows) | momentarily | instant |
| `ADD CHECK` ×5 | 0 each | `ACCESS EXCLUSIVE` | momentarily | instant |

Expected growth: ~16 kB (two new empty indexes). Expected total lock hold:
milliseconds, inside Prisma's single migration transaction. The only session
that could be blocked is the one `simprok_app` pool, for that duration.

`CONCURRENTLY` variants and a phased plan are **not** required at this size and
are deliberately not proposed — they would add risk and complexity for no gain.
No `VACUUM`, `ANALYZE`, `REINDEX` or `CLUSTER` was run, and none is needed
before or after.

**This does not authorize applying anything.** `PRODUCTION_MIGRATION_APPLY = 0`.

---

## 7. Deployment coupling — MANUAL_AND_DECOUPLED

```
DEPLOYMENT_COUPLING                        = MANUAL_AND_DECOUPLED
AUTOMATIC_PRODUCTION_MIGRATION_ON_MERGE    = NO
AUTOMATIC_INCOMPATIBLE_RUNTIME_ACTIVATION  = NO
```

| Question | Answer | Evidence |
|---|---|---|
| **A.** Does merging deploy to canonical runtime? | **NO** | `.github/workflows/` on `main` contains exactly one file, `pr-quality-gate.yml`, triggered `on: pull_request` only. No `push`, no `schedule`, no `workflow_dispatch`, no deploy job. GitHub API: environments `0`, deployments `0`, webhooks `0`. Two legacy PR19 diagnostic workflows remain *registered* but their files no longer exist on `main`, so they cannot trigger — and neither is a deploy workflow. |
| **B.** Does runtime sync auto-run Prisma migration? | **NO** | There is no automatic runtime sync at all. `source-main-canonical` sits on branch `main` at `6ac58b5` while `origin/main` is `bbba3d0` — one commit behind. A runtime that auto-pulled could not be behind. |
| **C.** Does backend startup run migrations? | **NO** | `backend/src/main.ts` only creates the Nest app and listens. `PrismaService.onModuleInit` only calls `$connect()`. No `migrate`, no `db push`, no DDL anywhere in the startup path. |
| **D.** Does a scheduler/service poll `main` and redeploy? | **NO** | Zero Windows Scheduled Tasks match `simprok|prisma|node|npm|docker|git`. Zero Windows services match `simprok|prisma|node|npm|docker|nssm|winsw|pm2`. The only PostgreSQL service is `postgresql-x64-17`, which serves the **old** 5432 cluster. No Dockerfile or compose file exists in the repository. |
| **E.** Can new code go live before migration? | **NO** (not without deliberate human action) | The backend is a plain foreground `node dist/src/main` process (PID observed on :3000), started by `bash` running `ops-runners/SHARED-HELPERS/START-BACKEND-RUNTIME.sh`, which sources `secrets/backend.runtime.env` and execs a **pre-built** `dist`. Activating new code requires a human to pull into `source-main-canonical`, `npm ci`, `npm run build`, and restart that process — three explicit steps, none automated. |
| **F.** Can migration be applied before compatible code exists? | **YES**, and that is the safe order | The migration is purely additive; old code never selects the new columns. |
| **G.** Is there an explicit, separately-authorized migration launcher? | **CREDENTIAL YES, RUNNER NOT YET** | A dedicated least-privilege `simprok_migrator` role exists with its own credential file, separate from both `simprok_app` and `simprok_readonly_audit`, and there is an established `ops-runners/` pattern (SHA256-manifested, `COMPLETED-DO-NOT-RUN` markers, argv-secret gate). But **no RM-03C migration runner script exists yet** — the RED runbook must author one under explicit Owner authorization. This is a gap to fill in the next task, not a blocker for the merge decision. |

Bounded-scope caveat, stated rather than glossed: this check covered GitHub
workflows/environments/deployments/webhooks, repository scripts and package
manifests, Windows Scheduled Tasks and Services filtered by name/path, listening
ports, and the runtime source's git state. It cannot exclude an out-of-band
process on another host that is invisible from this machine's configuration.
Within everything observable here, no automatic path from merge to production
exists.

---

## 8. Future RED deployment order

```
FUTURE_RED_DEPLOYMENT_ORDER =
  1. PLAN            Owner authorizes a separate RED runbook; author the
                     migration runner under ops-runners/ with a SHA256 manifest,
                     using the simprok_migrator credential (never simprok_app,
                     never argv).
  2. SNAPSHOT        Take a canonical backup / verify a restore path first.
  3. PRE-CHECK       Re-run this preflight's drift + row-count reads. Abort if
                     canonical is no longer pre-RM-03C, or if basic_prices is
                     no longer empty and any row is unclassifiable.
  4. MIGRATE         prisma migrate deploy (this one migration), inside the
                     controlled window. Milliseconds at current size.
  5. VERIFY SCHEMA   Re-read: enum present, both columns present, both indexes
                     present, FK present, all five CHECKs present and validated,
                     _prisma_migrations records exactly one new row, zero
                     failed/unfinished.
  6. SYNC CODE       Pull main into source-main-canonical, npm ci,
                     prisma generate, npm run build.
  7. RESTART         Restart the backend via START-BACKEND-RUNTIME.sh.
  8. SMOKE READ      GET /basic-prices returns 200 and the catalog behaves
                     exactly as before (empty set today).
  9. SMOKE PRIVATE   Only after reality input exists: prove one workspace-private
                     price end to end.
```

**Why schema first, then code.** The migration is additive: it adds two
nullable-then-defaulted columns and constraints that only bind rows the old
code cannot create. Old code neither selects nor writes `assetScope` or
`sourceImportRowId`, so it keeps working unchanged after step 4 — the window
between steps 4 and 7 is safe. The reverse order is **not** safe: new code's
generated Prisma client selects `assetScope` and `sourceImportRowId` in the
Explorer, AHSP resolution and Cost Kernel reads, so starting it before step 4
would fail with missing-column errors on ordinary endpoints.

There is one further reason this order is comfortable today: canonical
`basic_prices` is empty, so between steps 4 and 7 there is no data whose
behaviour could differ.

---

## 9. CI checkout truth (the terminology correction)

```
PR_MERGE_REF_CI = GREEN
RAW_HEAD_CI     = NOT_SEPARATELY_PROVED
```

`pr-quality-gate.yml` triggers on the `pull_request` event, so
`actions/checkout` checks out the **merge ref**, not the raw feature head. The
job log states it verbatim:

```
run 31162221889  (PR head 9828ee6)
  git fetch … origin +6d46d3ae…:refs/remotes/pull/68/merge
  git checkout --progress --force refs/remotes/pull/68/merge
  HEAD is now at 6d46d3a Merge 9828ee630c… into bbba3d0b4e…

run 31166178589  (PR head 64e6c6a, this preflight commit)
  git fetch … origin +9f066c95…:refs/remotes/pull/68/merge
  git checkout --progress --force refs/remotes/pull/68/merge
```

So every green result in `01-VERIFICATION.md` was produced by building and
testing the **merge result of this branch into current `main`** — not the raw
head SHA. That is *stronger* than a raw-head run for merge safety, and it
independently covers the base-movement deviation, but it is a different claim
and is no longer described as "exact head CI". No job has checked out `9828ee6`
or `64e6c6a` in isolation.

Post-correction run `31166178589` (head `64e6c6a`, all required jobs green):

| Job | Result | Evidence |
|---|---|---|
| Backend Build and Unit | pass 45s | `Test Suites: 71 passed` · `Tests: 911 passed, 911 total` |
| Backend Owner-bootstrap focused | pass | `Tests: 30 passed, 30 total` |
| Frontend Test and Build | pass 25s | 150/150 + build |
| Official Safe E2E | pass 1m34s | `Test Suites: 34 passed` · `Tests: 450 passed, 450 total` · `RESIDUAL_RESULT: PASS` · `JEST_RESULT: PASS` |

Identical to the pre-correction numbers, as a comment/docs-only change must be.

---

## 10. Preflight matrix

```
PR_REALITY                                = PASS
CANONICAL_DB_IDENTITY                     = PASS
READ_ONLY_TRANSACTION                     = VERIFIED
PRODUCTION_SCHEMA_DRIFT                   = NO

HISTORICAL_BACKFILL_TRUTH                 = PASS_EMPTY_TABLE
AMBIGUOUS_BASIC_PRICE_COUNT               = 0

MIGRATION_OPERATIONAL_CLASS               = EMPTY_OR_NEAR_EMPTY_SIMPLE_WINDOW
DEPLOYMENT_COUPLING                       = MANUAL_AND_DECOUPLED
AUTOMATIC_PRODUCTION_MIGRATION_ON_MERGE   = NO
AUTOMATIC_INCOMPATIBLE_RUNTIME_ACTIVATION = NO

EXECUTABLE_MIGRATION_SQL_CHANGED          = NO
REPOSITORY_CODE_CHANGED                   = NO
GOVERNANCE_WORDING                        = CORRECTED
INDEX_COUNT_WORDING                       = TWO
CI_SHA_WORDING                            = TRUTHFUL

PRODUCTION_DATA_WRITE                     = 0
PRODUCTION_SCHEMA_WRITE                   = 0
PRODUCTION_MIGRATION_APPLY                = 0
PRODUCTION_DEPLOYMENT                     = 0
PRODUCTION_SERVICE_RESTART                = 0

PREFLIGHT_GATE                            = PASS
OWNER_MERGE_DECISION_READY                = YES
MERGE                                     = NO
```

`NEXT = OWNER REVIEWS PREFLIGHT → OWNER MAY AUTHORIZE PR #68 MERGE → SEPARATE
RED MIGRATION RUNBOOK → CANONICAL MIGRATION APPLY → RUNTIME SYNCHRONIZATION →
REALITY INPUT → ONE_LIVE_RAB_ROW`

No step of that sequence was performed in this task.

Soli Deo Gloria. Haleluya. Amin.
