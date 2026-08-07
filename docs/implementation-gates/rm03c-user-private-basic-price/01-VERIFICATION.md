# RM-03C — 01 VERIFICATION

### Dalam Nama Tuhan Yesus Kristus.

```
RM03C_ENGINEERING_GATE = PASS
OWNER_MERGE_REQUIRED   = YES
MERGE                  = NO
```

Every number below is copied from a CI run, not from intent.

**Terminology, corrected by the pre-merge preflight.** This gate's CI runs on
the `pull_request` event, and `actions/checkout` therefore checks out
`refs/pull/68/merge` — the *merge result*, not the raw feature head. Wording
that called this "exact head CI" was inaccurate and is corrected throughout to
`PR_MERGE_REF_CI`. `RAW_HEAD_CI = NOT_SEPARATELY_PROVED`: no job checked out
`9828ee6` by itself. See `02-CANONICAL-PREFLIGHT.md` §9 for the checkout log
proof.

---

## 1. Reality

| | |
|---|---|
| Worktree | `C:\Users\asus\SIMPROK-WT-RM03C` (new, isolated) |
| Branch | `feat/rm03c-user-private-basic-price` |
| Authorized baseline | `6ac58b5c002abfb8627011ac6cec51d4b04cdb3b` — checked at Stage 0, **matched** |
| Commits | `605698d` schema + migration · `ac072e2` implementation + tests + contract |
| Draft PR | [#68](https://github.com/fekyigo-rgb/SIMPROK/pull/68) |
| CI run | `31162221889` (event `pull_request`, PR head `9828ee6`) |
| Actually checked out | `refs/pull/68/merge` = `6d46d3a` — "Merge `9828ee6` into `bbba3d0`" |

`C:\SIMPROK` (dirty) and `C:\Users\asus\SIMPROK-RUNTIME\source-main-canonical`
(runtime source) were never touched. Nothing was staged with `git add .`.

### Base movement — recorded, not absorbed

`origin/main` moved **after** the Stage-0 check passed:

```
authorized baseline  6ac58b5   (matched at Stage 0)
origin/main now      bbba3d0
delta                bbba3d0 docs(monitoring): lock Grade A roadmap v1.0
                     1 file: docs/roadmap/SIMPROK-MONITORING-GRADE-A-ROADMAP.md, +765
```

Docs-only, **zero file overlap** with this branch. The branch was deliberately
**not rebased** — authorization is not silently moved onto a base the Owner did
not name. Owner decides whether a rebase is wanted before merge.

---

## 2. CI — PR merge-ref, all green

`PR_MERGE_REF_CI = GREEN` · `RAW_HEAD_CI = NOT_SEPARATELY_PROVED`

The jobs below ran on `6d46d3a` (`9828ee6` merged into `bbba3d0`), which is
what the `pull_request` event checks out. That is *stronger* than a raw-head
run for merge safety — it is the merge result, tested against current `main` —
but it is not the same claim, so it is not called one.

| Job | Result | Evidence |
|---|---|---|
| Backend Build and Unit | **pass** 3m01s | `Test Suites: 71 passed` · `Tests: 911 passed, 911 total` |
| Backend Owner-bootstrap focused | **pass** | `Tests: 30 passed, 30 total` |
| Frontend Test and Build | **pass** 32s | 150/150, build ok (frontend untouched by this gate) |
| Official Safe E2E | **pass** 1m35s | `Test Suites: 34 passed` · `Tests: 450 passed, 450 total` · `RESIDUAL_RESULT: PASS` · `JEST_RESULT: PASS` |

```
UNIT       420/420 baseline -> 911/911   (+60 focused tests, 69 -> 71 suites)
SAFE_E2E   420/420 baseline -> 450/450   (+30, exactly this gate's new suite)
REGRESSION 0
RESIDUAL   PASS - final database matches baseline
```

The Safe E2E baseline `420/420` is RM-03B's recorded figure at `6ac58b5`
(`rm03b-private-assets/02-VERIFICATION.md`). The delta is exactly the 30 cases
in `rm03c-user-private-basic-price.e2e-spec.ts` — `PASS
test/acceptance/rm03c-user-private-basic-price.e2e-spec.ts` appears in the job
log — so no pre-existing case changed state.

> **Local Safe E2E was NOT run, and this is stated rather than implied.** The
> local `.env.e2e` points `simprok_e2e` at the old `localhost:5432` cluster,
> which §25 of this task forbids touching. CI is therefore the first and only
> place the migration was applied and the CHECK constraints met a real database.
> `prisma validate` and `generate` were run locally against a deliberately
> unreachable dummy URL (`127.0.0.1:1`), which parses the schema without opening
> a connection.

---

## 3. Migration — applied only in CI's ephemeral database

```
PRODUCTION_MIGRATION_APPLY = 0
PRODUCTION_DATA_WRITE      = 0
```

- `prisma migrate deploy` was **never** run against `simprok_db`.
- No manual SQL against any production database.
- No production write credential was used for anything.
- CI's `Official Safe E2E` applies it via `prisma migrate reset --force
  --skip-seed` against a throwaway `postgres:16.4` service container, then
  seeds and fingerprints it.
- The later pre-merge preflight touched canonical `simprok_db` **read-only**,
  through the dedicated `simprok_readonly_audit` role (no INSERT/UPDATE/DELETE/
  CREATE privilege) inside `BEGIN TRANSACTION READ ONLY` with
  `default_transaction_read_only=on`. It confirmed canonical is still
  pre-RM-03C: enum, both columns, both indexes, the FK and all five CHECKs are
  ABSENT, and `_prisma_migrations` has no RM-03C record and zero
  failed/unfinished migrations. See `02-CANONICAL-PREFLIGHT.md`.

Name parity with the datamodel was proved offline with
`prisma migrate diff --from-empty --to-schema-datamodel --script`: every object
this migration creates matches the name Prisma expects
(`basic_prices_sourceImportRowId_key`, `basic_prices_workspaceId_assetScope_idx`,
`basic_prices_sourceImportRowId_fkey`), so the migration cannot drift from the
schema.

### The four invariants, observed rejecting real rows

The Postgres server log for the Safe E2E run shows each new constraint firing
against the E2E's deliberate probes — this is the constraint working, not a
failure:

```
ERROR: ... violates check constraint "basic_prices_private_requires_workspace_check"
ERROR: ... violates check constraint "basic_prices_private_requires_import_row_provenance_check"
ERROR: ... violates check constraint "basic_prices_private_never_published_check"          (x2, status + verificationStatus)
ERROR: ... violates check constraint "basic_prices_private_not_submission_born_check"
ERROR: ... violates check constraint "basic_prices_import_row_link_private_only_check"
ERROR: ... duplicate key value violates unique constraint "basic_prices_sourceImportRowId_key"
```

The suite also creates one **valid** private row first and deletes it, so those
six rejections are proved to be the constraints doing their job rather than a
broken fixture failing for an unrelated reason.

`ADD CONSTRAINT` validated every pre-existing row in that CI database without
error. That is a statement about the CI database, not about canonical
production — the canonical claim is proved separately and directly in
`02-CANONICAL-PREFLIGHT.md` (`basic_prices` = 0 rows, `n_tup_ins = 0`).

---

## 4. Test map

### Focused unit — new

| Spec | Cases | Proves |
|---|---|---|
| `trusted-basic-price-actor.service.spec.ts` | 6 | full ACTIVE Account/membership/User chain, membership bound to the JWT account, no fallback, fail-closed on every malformed context |
| `basic-price-private-asset.service.spec.ts` | 19 | `assetScope` explicit; `status`/`verificationStatus` never written; no submission/review/publication audit; trusted actor as reporter; all five `sourceOrigin` values survive verbatim; exact `Prisma.Decimal`; refuses missing region/date/origin/resource/price; foreign workspace and foreign account both 404; idempotency; batch and row lifecycle untouched; explicit projection |

### Focused unit — extended

| Spec | Added | Proves |
|---|---|---|
| `basic-price-eligibility.policy.spec.ts` | +10 | `publicEligibilityWhere()` unchanged (exact keys, no `assetScope`/`workspaceId`/`OR`); catalog branch preserved condition by condition; private branch strict equality, never null, never an `OR`; no precedence (no `orderBy`/`priority`/`rank` anywhere); determinism |
| `basic-price.service.spec.ts` | restated | every prior intent re-asserted branch by branch on list/detail/by-resource; `findByResource` order pinned and forbidden from carrying `assetScope` |
| `basic-price-writer-inventory.spec.ts` | +2 | exact 3-writer array; the private writer's `data` literal carries no publication axis and no submission/review/audit reference |
| `project-ahsp.service.spec.ts` | +2 | candidate query is catalog-OR-own-private with applicability asserted **outside** the branch OR; no `orderBy` on the candidate read. Also switched from a hand-written eligibility stub to the **real** policy — a stub can only ever assert what the spec already believed |
| `rab-kernel-persistence.service.spec.ts` | +16 | private price yields the identical kernel result; catalog chain never consulted for it; import-row chain bound by exact id; fails closed on missing evidence, wrong resource, unresolved row, tenant/region mismatch, missing hash/origin/date, a submission it must not have, and foreign/null workspace |
| `basic-price-workflow.projection.spec.ts` | +3 | `assetScope` read from the column and independent of `workspaceScope`; unknown/absent value fails safe to `SIMPROK_CATALOG`; private source name resolved through the same import batch |

### Acceptance E2E — new (30 cases, all in CI)

Writer · idempotency · ownership-vs-source · own-workspace list/detail/by-resource ·
Workspace-B cannot list, read, resolve or infer (incl. forged `x-workspace-id`
header **403** and forged `workspaceId` query param **403**, foreign batch
**404**) · catalog still visible to both tenants · private never in the
publication queue · publish refused **409** with the row unchanged · the Cost
Kernel proof · all five CHECK constraints probed directly with a control case.

---

## 5. Cost Kernel proof

Chosen deliberately where precedence cannot arise, and the cardinality is
**asserted in the test**, not assumed:

```
ELIGIBLE_PRIVATE_COUNT            = 1
ELIGIBLE_CATALOG_COMPETITOR_COUNT = 0
```

```
BasicPriceImportRow (RESOLVED by a human, cell F9, sha256 c*64, Toko Bangunan Jaya)
  -> BasicPrice  assetScope=WORKSPACE_PRIVATE  value=137500.00  sourceOrigin=STORE
                 status=UNPUBLISHED  verificationStatus=UNVERIFIED
  -> AHSP resource resolution  RESOLVED  AUTO_SELECTED
     canonicalUnit=PERSON_DAY  quantityFactor=1  priceOperation=IDENTITY
     sourcePriceValue=137500.00  adaptedPriceValue=137500.00
  -> Cost Kernel   coefficient 2.000000 x 137500.00 = 275000.00  unit price
                   x volume 5                       = 1375000.00 line total
  -> BoqItem       priceOrigin=SERVER_COST_KERNEL
  -> read-only re-proof  status=VERIFIED, recomputed == stored
```

Same kernel, same arithmetic, no fork, no unit-engine expansion, no manual
unit-price authority.

---

## 6. Result flags

```
PRIVATE_BASIC_PRICE_SCHEMA_DECISION       = PASS
PRIVATE_BASIC_PRICE_SCHEMA                = IMPLEMENTED
PRIVATE_BASIC_PRICE_WRITER                = IMPLEMENTED
PRIVATE_BASIC_PRICE_ELIGIBILITY           = IMPLEMENTED
PRIVATE_BASIC_PRICE_PROVENANCE            = PASS
PRIVATE_BASIC_PRICE_TENANT_ISOLATION      = PASS
PRIVATE_BASIC_PRICE_COST_KERNEL_PATH      = PASS

ASSET_SCOPE_SEPARATE_FROM_SOURCE_ORIGIN   = YES
PRIVATE_VS_CATALOG_PRECEDENCE_INTRODUCED  = NO

PUBLIC_ELIGIBILITY_PREDICATE_REGRESSION   = NO
PUBLIC_CATALOG_VISIBILITY_REGRESSION      = NO
PUBLIC_REVIEW_PUBLICATION_REGRESSION      = NO

UNREGISTERED_BASIC_PRICE_WRITER_COUNT     = 0
NEW_PERMISSION_CODE                       = 0
NEW_BASELINE_CODE                         = 0

SCHEMA_MIGRATION                          = PASS
PRODUCTION_MIGRATION_APPLY                = 0
PRODUCTION_DATA_WRITE                     = 0

FOCUSED_TESTS                             = PASS
REGRESSION                                = PASS
SAFE_E2E                                  = PASS (450/450, residual PASS)

DRAFT_PR                                  = OPEN (#68)
PR_MERGE_REF_CI                           = GREEN
RAW_HEAD_CI                               = NOT_SEPARATELY_PROVED

ONE_LIVE_RAB_ROW                          = NOT_YET_CLAIMED
GOLDEN_THREAD_CLOSED                      = NO
MERGE                                     = NO
```

No STOP condition was reached. One deviation is recorded in §1 (base movement,
docs-only, not rebased).

`NEXT_AFTER_OWNER_MERGE = REALITY INPUT -> ONE_LIVE_RAB_ROW`

No production reality write was performed in this task.

Soli Deo Gloria. Haleluya. Amin.
