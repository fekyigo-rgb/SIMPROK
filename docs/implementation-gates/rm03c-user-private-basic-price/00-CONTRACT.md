# RM-03C — 00 CONTRACT (USER_PRIVATE_BASIC_PRICE)

### Dalam Nama Tuhan Yesus Kristus.

```
ROADMAP_ITEM                        = RM-03C
BASE                                = origin/main 6ac58b5c002abfb8627011ac6cec51d4b04cdb3b
BRANCH                              = feat/rm03c-user-private-basic-price
CLOSES                              = USER_PRIVATE_BASIC_PRICE = STOP_SCHEMA_DECISION_REQUIRED
                                      (rm03b-private-assets/03-SCHEMA-DECISION-PACKET.md §11)
PRODUCTION_DATA_WRITE               = 0
PRODUCTION_MIGRATION_APPLY          = 0
MERGE                               = NO
```

This gate closes the one blocker RM-03B stopped on, and nothing else. It does
not reopen PR #65, PR #66, private AHSP, the Cost Kernel design, the clean
cluster work, or the runtime baseline.

---

## 1. The schema decision

RM-03B's packet offered three options and recommended **Option A**. Owner law
ratified it. This gate implements exactly that:

```prisma
enum BasicPriceAssetScope {
  WORKSPACE_PRIVATE
  SIMPROK_CATALOG
}

model BasicPrice {
  assetScope        BasicPriceAssetScope @default(SIMPROK_CATALOG)
  sourceImportRowId String?              @unique @db.Uuid
}
```

`assetScope` is an **OWNERSHIP / ASSET SCOPE** axis. It answers *who owns this
price and where may it be used*. It is deliberately none of the following, each
of which keeps its own column and its own unchanged meaning:

| Question | Column | Untouched by RM-03C |
|---|---|---|
| Who owns it / where may it be used? | `assetScope` | **new** |
| How far through publication is it? | `status` | yes |
| How far through verification is it? | `verificationStatus` | yes |
| Where did the number come from? | `sourceOrigin` / `sourceType` | yes |
| Is it still valid in time? | `effectiveDate` / `validUntil` / `freshnessStatus` | yes |

`PRIVATE_USABLE != PUBLISHED`. The four axes are never collapsed.

---

## 2. Ownership is not source

`assetScope` and `sourceOrigin` are orthogonal, and the writer keeps them so.

```
assetScope   = WORKSPACE_PRIVATE      (the workspace owns this asset)
sourceOrigin = STORE                  (the price came from a store)
reporter     = the workspace member   (who recorded it)
```

**SOURCE != REPORTER. OWNERSHIP != SOURCE.** There is no `PRIVATE` source
family and none was created. A workspace-private price may truthfully carry
`GOVERNMENT`, `SUPPLIER`, `STORE`, `DISTRIBUTOR` or `FIELD_REPORT` — the writer
copies the batch's declared origin verbatim, and a unit test proves each of the
five values survives unchanged onto a private row.

---

## 3. No private-vs-catalog precedence

`PRIVATE_VS_CATALOG_PRECEDENCE_INTRODUCED = NO`.

The eligibility builder returns `{ OR: [catalogBranch, privateBranch] }` — a
statement about *which rows are legally eligible*, containing no ordering, no
ranking key, no priority field and no tie-breaker.

Selection remains where it already was and remains **scope-blind**:
`resolveAhspResourcePrice` (`ahsp-resource-price-resolution.kernel.ts:377`)
returns `NEEDS_REVIEW` whenever more than one compatible candidate survives —
whatever each candidate's `assetScope` is. SIMPROK menghitung, manusia
memutuskan.

Two pre-existing facts are reported as REALITY, not extended:

- `BasicPriceService.findByResource` orders `workspaceId desc, effectiveDate
  desc`. That is a **display order on a read**, it predates RM-03C, nothing
  downstream selects from it, and it was left byte-identical. A unit test pins
  it and asserts `assetScope` never enters it.
- The kernel's multi-candidate rule (`> 1 → NEEDS_REVIEW`) is the existing,
  explicit, human-decides answer. It was not touched.

The Cost Kernel proof is deliberately built where the question cannot arise:
`ELIGIBLE_PRIVATE_COUNT = 1`, `ELIGIBLE_CATALOG_COMPETITOR_COUNT = 0`, asserted
in the E2E rather than assumed.

---

## 4. Migration and backfill

`prisma/migrations/20260807090000_rm03c_user_private_basic_price/`

Purely additive: two columns, one FK, three indexes, five CHECK constraints.
No column dropped, retyped, renamed or rewritten. No existing migration edited.
No squash. No reset. Reversible by dropping the two columns and the enum.

**Backfill is proved, not assumed.** Every pre-RM-03C row is `SIMPROK_CATALOG`
because:

1. the only production creator is `price-submission-review.service.ts` (the
   ACCEPT branch of catalog curation), and the only other production writer is
   `basic-price-publication.service.ts` updating a row that writer created —
   an inventory pinned byte-for-byte by `basic-price-writer-inventory.spec.ts`;
2. before this migration there was no representation of privateness at all, so
   no row *could* have been private.

The column is added NULLABLE, backfilled by one explicit and reviewable
`UPDATE`, and only then made `NOT NULL DEFAULT 'SIMPROK_CATALOG'` — the
classification is visible in the diff rather than hidden in a column default.
The default is the catalog value so an un-migrated writer fails closed into the
curated world and can never accidentally mint a private price.

### The four private-asset invariants, enforced by the database

| # | Constraint | Meaning |
|---|---|---|
| I1 | `private_requires_workspace_check` | a private asset belongs to exactly ONE workspace; a null-workspace "private" row is unrepresentable |
| I2 | `private_not_submission_born_check` | a private asset never carries a `PriceSubmission` — it never enters the curation queue |
| I3 | `private_never_published_check` | `status <> 'PUBLISHED' AND verificationStatus <> 'PUBLISHED'` — no fake publication, at DB level |
| I4a/b | `private_requires_import_row_provenance_check` / `import_row_link_private_only_check` | a private asset always has traceable evidence, and the direct import-row link is the private channel only |

Postgres validates each against every existing row at `ADD CONSTRAINT` time, so
an unclassifiable historical row would stop the migration — fail-closed, never
a silent partial classification.

> A future authorized gate that adds manual private entry must **widen** I4a to
> accept its own honest evidence record, never drop it to allow evidence-free
> rows.

---

## 5. The private writer

`POST /basic-price-imports/:batchId/keep-private`
→ `BasicPricePrivateAssetService.keepBatchPrivate`

The sibling of `submit`, not a replacement, and not exclusive with it.

**Why the import row, and not a free-text price form.** SIMPROK does not create
prices, it finds them. Every private price is materialized from a
`BasicPriceImportRow` a human already resolved, so it inherits the evidence the
import subsystem already recorded — workbook SHA-256, sheet, row number, the
code/name/unit/price cell addresses, the raw cell value, plus the batch's
supplier/organization name, region and effective date. **No second provenance
subsystem.** Nothing is invented: missing region, effective date, source origin,
resource identity or canonical price each fail closed with a named reason.

**Authority chain** (`TrustedBasicPriceActorService`, fail-closed, no fallback):

```
JWT Account
  → ACTIVE WorkspaceMembership for the selected workspace   (guard-verified,
                                                             re-asserted here)
    → ACTIVE User profile belonging to that membership
      → trusted { accountId, userId, workspaceId }
```

The workspace comes from `PermissionsGuard`'s resolved context and the account
from the verified JWT. A client `workspaceId` in body, query or header can never
steer the write. Because a private price has no verifier and no publisher, this
write-time chain is the only authority chain it will ever have — which is why
every `ACTIVE` predicate is re-asserted rather than assumed from the guard.

**What it never does:** no `status`, no `verificationStatus` (both omitted so
the row takes the honest schema defaults `UNPUBLISHED` / `UNVERIFIED`), no
`PriceSubmission`, no review, no `BasicPricePublicationAudit`, no second human,
no batch or row lifecycle advance. Idempotent via the unique index on
`sourceImportRowId`, not via a status flag.

**Permission: `BASIC_PRICE_SUBMIT`, deliberately not a new code.** It is the
identical authority ("materialize my own resolved import rows") held by the
identical people, and keeping rows private is strictly the *less* powerful of
the two — it produces nothing outside the caller's own workspace. A new code
would either need adding to `ACTIVE_MEMBERSHIP_BASELINE_PERMISSION_CODES` (an
Owner decision this gate has no authority to take — Amendment A1) or leave the
capability 403 everywhere pending activation, contradicting "usable
immediately, no second human". `NEW_PERMISSION_CODE = 0`,
`NEW_BASELINE_CODE = 0`.

---

## 6. Private eligibility

`basic-price-eligibility.policy.ts` — `BASIC_PRICE_ELIGIBILITY_POLICY_VERSION =
RM03C_PRIVATE_BASIC_PRICE_ELIGIBILITY_V1`

```
eligible(workspace) =
      catalogBranch:  status='PUBLISHED' AND verificationStatus=PUBLISHED
                      AND (workspaceId = me OR workspaceId IS NULL)
   OR privateBranch:  assetScope=WORKSPACE_PRIVATE
                      AND workspaceId = me            <- STRICT equality
                      AND verificationStatus <> REJECTED
```

`publicEligibilityWhere()` is **untouched** and still means PUBLICATION. A
regression test asserts it still returns exactly `{status, verificationStatus}`
with no `assetScope`, no `workspaceId` and no `OR` leaked into it.

**Strict equality in the private branch is the security property.** Reusing the
catalog branch's `OR: [{workspaceId}, {workspaceId: null}]` would have made
every null-workspace row eligible for every tenant at once. The DB makes that
case unrepresentable too (I1) — belt *and* braces.

**One predicate, every consumer.** Explorer list, Explorer detail, by-resource
lookup, Project AHSP resource resolution, the AHSP re-verification read, and
the Cost Kernel persistence re-read all build from `buildUsableBasicPriceWhere`.
If the picker could offer a price the resolver would refuse — or vice versa —
that gap would be the privilege escalation.

---

## 7. Cost Kernel

`GOLDEN_THREAD_UNCHANGED`: `canonicalUnitCode=PERSON_DAY`, `quantityFactor=1`,
`priceOperation=IDENTITY`. No unit-engine expansion, no kernel fork, no
convenience conversion, no manual unit-price authority.

`assertTraceableProvenance` now dispatches on the row's OWN `assetScope` — never
on the absence of a submission id, which would be an inference from a hole. The
private branch proves a different but equally exacting chain:

```
BasicPrice(WORKSPACE_PRIVATE, workspaceId = trusted server workspace)
  sourceSubmissionId IS NULL          (a private asset is never submission-born)
  → BasicPriceImportRow  resourceCatalogId == BasicPrice.resourceId
                         resolutionStatus == RESOLVED
    → BasicPriceImportBatch  workspaceId / organizationId / regionId all equal
                             sourceSha256, sourceOrigin, effectiveDate all present
```

Every link is bound by exact equality and fails closed with the **same** single
reason code (`BASIC_PRICE_PROVENANCE_INCOMPLETE`) as the catalog chain, so a
failure never discloses which asset family a price belonged to. As with the
catalog chain, a historical actor's *current* status is not re-litigated.

---

## 8. Public catalog preservation

```
PUBLIC_ELIGIBILITY_PREDICATE_REGRESSION = NO
PUBLIC_CATALOG_VISIBILITY_REGRESSION    = NO
PUBLIC_REVIEW_PUBLICATION_REGRESSION    = NO
```

- The catalog branch is the pre-RM-03C predicate, meaning-for-meaning, and the
  unit specs assert each condition individually rather than trusting a shape.
- `assetScope` is deliberately NOT added to the catalog branch: narrowing
  publication by an ownership condition would change what "published" means.
  It is also unnecessary — I3 makes a published private row impossible.
- `getPublicationQueue` gained a positive `assetScope: 'SIMPROK_CATALOG'`
  filter. The catalog result set is provably unchanged (every pre-RM-03C row is
  catalog, and a private row can never reach `UNPUBLISHED+VERIFIED` because it
  never passes through the ACCEPT branch that writes `VERIFIED`). This is the
  belt to that structural brace.
- Verifier/publisher semantics, the review path and the publication ladder are
  byte-unchanged. No general-user verifier/publisher/review/publication control
  was added anywhere.

---

## 9. Writer inventory

```
EXPECTED = 3
  basic-price/basic-price-private-asset.service.ts        create   (RM-03C)
  basic-price/basic-price-publication.service.ts          update
  reality-intake/price-submission-review.service.ts       create
UNREGISTERED_BASIC_PRICE_WRITER_COUNT = 0
```

Order-dependent and exact by design. Migration SQL is not a runtime writer and
is out of that test's scope. Two further byte trip-wires were added: the private
writer's `data` literal must not contain `status`/`verificationStatus`, must
state `assetScope` explicitly, and must not reference any submission, review or
publication-audit model.

---

## 10. Deliberately deferred

- **PROPOSE_TO_SIMPROK** — not required to close RM-03C, and not implemented.
  The seam exists for free: `keep-private` advances neither batch nor row
  lifecycle, so a kept-private batch remains submittable through the existing
  `submit` route. A private asset stays private regardless of any future
  proposal outcome.
- **UI** — no frontend was built. The backend Explorer projection gained an
  additive `assetScope` field so a future door can label a private price
  honestly; no door was opened, so no false door was created.
- **Manual private entry** — would need its own honest evidence record and a
  widening of I4a. Out of scope.

Soli Deo Gloria. Haleluya. Amin.
