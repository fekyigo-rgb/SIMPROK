# RM-03B — 03 SCHEMA DECISION PACKET (Basic Price private semantics)

### Dalam Nama Tuhan Yesus Kristus.

```
STATE = STOP_SCHEMA_DECISION_REQUIRED
```

No migration was written. No writer was added. No status was overloaded. No
private semantics were inferred. This packet exists so the Owner/Architect can
decide, not so an executor can proceed.

> This document also records the resulting bounded split. A separate
> `03-SCOPE-SPLIT.md` is deliberately NOT created: the split is *caused by* this
> schema stop, and duplicating it across two files would create two sources of
> truth for one decision.

---

## 1. The exact missing semantic

Owner law requires four distinct meanings to be distinguishable **fail-closed**:

| # | Meaning | Usable by owner? | Publicly usable? |
|---|---|---|---|
| 1 | `PRIVATE_USABLE` — a workspace's own price | **YES, now** | no |
| 2 | `CATALOG_IN_REVIEW_PIPELINE` — a submission moving through curation | **no** | no |
| 3 | `PUBLIC_PUBLISHED` — curated national price | yes | yes |
| 4 | `REJECTED / EXPIRED / INAPPLICABLE` | no | no |

The existing schema can express 2, 3 and 4. **It cannot express 1.**

There is no field on `BasicPrice` whose meaning is *"this row is a
workspace-private asset, usable by its owner, and was never intended for the
national catalog."*

---

## 2. Actual model and fields

`backend/prisma/schema.prisma:1408-1442`

| Field | Type | Carries ownership-kind? |
|---|---|---|
| `workspaceId` | `String?` | **No** — tenancy. The curation pipeline sets it too. |
| `organizationId` | `String?` | No — bare column, no relation, no FK. |
| `sourceSubmissionId` | `String? @unique` | No — see §4. |
| `status` | **plain `String`**, default `"UNPUBLISHED"` | Publication axis only. Not an enum; no CHECK constraint. |
| `verificationStatus` | `PriceVerificationStatus` | Curation axis only. |
| `sourceType` / `sourceOrigin` | enums | Provenance of the *price*, not of the *asset*. |
| `freshnessStatus`, `validUntil`, `effectiveDate` | — | Temporal validity. |

Enum values: `PriceVerificationStatus = UNVERIFIED, SUBMITTED, UNDER_REVIEW,
VERIFIED, REJECTED, PUBLISHED`. Every value belongs to the **curation ladder**.
None means "private".

---

## 3. Every existing writer

Verified exhaustively; **no raw-SQL writer exists anywhere** in `src/`,
`scripts/`, `prisma/`, or `test/`.

| # | Writer | Method | Sets |
|---|---|---|---|
| W1 | `reality-intake/price-submission-review.service.ts` | `create` | `sourceSubmissionId` = the submission, `workspaceId`/`organizationId` from it, `verificationStatus: 'VERIFIED'`; `status` **omitted** → DB default `UNPUBLISHED` |
| W2 | `basic-price/basic-price-publication.service.ts` | `update` | exactly `{ status: 'PUBLISHED', verificationStatus: 'PUBLISHED' }` |
| — | `scripts/rm02d2a2/visual-acceptance-fixture.ts` | `create` | dev script, outside `src/` |
| — | `backend/test/acceptance/*` | `create`/`createMany` | test fixtures only |

Guard: `basic-price-writer-inventory.spec.ts:18-42` asserts an **order-dependent
exact array** of exactly those two `src/` writers. Adding a third requires
updating it — by design.

**Both production writers belong to the curation pipeline. There is no
private-direct-entry path at all.**

---

## 4. Why `sourceSubmissionId IS NULL` cannot be the marker

The task permits this inference **only if every creation path and its invariants
prove the value is specific to private direct entry.** They do not:

1. W1 — the only production creator — **always** sets it.
2. `NULL` is produced today **only** by test fixtures and one dev script.
3. Nothing constrains it: no CHECK, no trigger, no partial index. A future
   writer could legitimately create a `NULL`-submission catalog row.

So the predicate would mean *"a row that no production writer created"* — an
inference from an absence manufactured by test code. Adopting it would make
**every existing test fixture** retroactively "private-usable".

---

## 5. Every reader that would be affected

`publicEligibilityWhere()` (`basic-price-eligibility.policy.ts:78-86`) returns
`{ status: 'PUBLISHED', verificationStatus: PUBLISHED }` and is the **sole**
gate on every use path:

| Consumer | Purpose |
|---|---|
| `basic-price.service.ts:179, 322, 345` | public Explorer list / detail / by-resource |
| `project-ahsp.service.ts:208, 294` | AHSP resource resolution + selected-row re-verification |
| `rab-kernel-persistence.service.ts:222` | Cost Kernel persistence re-read |

`BasicPriceEligibilityPolicy.evaluate()` — the richer reason-coded predicate —
has **zero production call sites**.

Three byte-level trip-wires lock current behaviour and would have to be
consciously updated by any private-eligibility work:
`basic-price-eligibility.policy.spec.ts:18-22` (exact `toEqual`),
`basic-price.service.spec.ts:665-671` (exact `where`), and the writer inventory.

Additionally `assertTraceableProvenance`
(`rab-kernel-persistence.service.ts:440-523`) requires the full
submission→review→publication chain, so a privately-created price could not pass
Cost Kernel persistence today even if it were made eligible.

---

## 6. Minimum schema options

### Option A — explicit asset-scope enum on `BasicPrice` (**recommended**)

```
enum BasicPriceAssetScope { WORKSPACE_PRIVATE  SIMPROK_CATALOG }
BasicPrice.assetScope BasicPriceAssetScope @default(SIMPROK_CATALOG)
```

- Mirrors the shape AHSP already proved works (`ownershipType`).
- Backfill is trivially truthful: **every existing row is `SIMPROK_CATALOG`**,
  because every production row came from the curation pipeline.
- Private eligibility becomes a positive assertion:
  `assetScope = WORKSPACE_PRIVATE AND workspaceId = <trusted>`.
- Requires `workspaceId NOT NULL` whenever `assetScope = WORKSPACE_PRIVATE` —
  enforceable as a CHECK constraint, mirroring Gate-2A's truth constraint.
- Public predicate untouched.

### Option B — separate `WorkspacePrivateBasicPrice` model

Strongest isolation (a private row can never appear in a catalog query by
construction), but duplicates resource/unit/region/date/value and forces every
resolver to read two tables. Higher blast radius.

### Option C — reuse existing fields (**rejected**)

Any combination of `workspaceId` / `status` / `verificationStatus` /
`sourceSubmissionId` is ambiguous against rows the curation pipeline already
produces. Documented in `01-CURRENT-REALITY-MATRIX.md` §B. This is the option
the task explicitly forbids guessing into.

**Recommendation: Option A.**

---

## 7. Migration and backfill implications (Option A)

- Additive column with a default; no data loss; no rewrite of existing rows.
- Backfill is a constant (`SIMPROK_CATALOG`) and is **provably** correct because
  W1 is the only production creator.
- Optional CHECK constraint tying `WORKSPACE_PRIVATE` to a non-null
  `workspaceId`, in the Gate-2A style.
- `SIMPROK_CATALOG` default means an un-migrated writer cannot accidentally
  create a private row.
- Reversible: dropping the column restores today's behaviour exactly.

## 8. Tenant-security implications

- Private eligibility must use **strict non-null `workspaceId` equality**, never
  `OR: [{workspaceId}, {workspaceId: null}]`. This is not hypothetical: the same
  mistake on the AHSP side would have leaked every null-workspace row to every
  tenant, and is guarded against in `ahsp-eligibility.policy.spec.ts`.
- The private writer must take `workspaceId` from trusted server context only.
  The AHSP path had exactly this inversion, fixed in this gate.
- Private rows must be excluded from every public/global query by construction,
  not by convention.

## 9. Why a service-only fix is not honest

A service-only fix must *infer* privateness from fields that mean something
else. Inference fails in both directions:

- **False private:** a catalog submission awaiting publication
  (`workspaceId` set, `status=UNPUBLISHED`, `verificationStatus=VERIFIED`) would
  be treated as usable — an unreviewed price entering someone's RAB.
- **False catalog:** a user's own price would be invisible to them, and would
  sit in the national publication queue waiting for a publisher who should never
  have been asked.

Neither is a bug that testing fixes; both follow from the data not carrying the
meaning. **Only an explicit field makes the distinction fail-closed.**

---

## 10. Resulting bounded split

| Slice | Content | State |
|---|---|---|
| **RM-03B1** | private Basic Price identity + writer + tenant isolation | **BLOCKED** — awaiting the decision in this packet |
| **RM-03B2** | private eligibility + private AHSP binding + Cost Kernel | **DELIVERED** in this PR |

RM-03B2 stands on its own: a workspace can use its **own AHSP**, priced from
**published catalog Basic Prices**, through the Cost Kernel, persisted, and
re-proved read-only by the PR #65 path. It does not depend on RM-03B1.

Phase A (the PR #65 merge) is complete and is **not** affected by this stop.

---

## 11. What is needed to proceed with RM-03B1

1. Owner/Architect decision on Option A / B / C.
2. On PASS: a schema design gate for the field + constraint.
3. Then the private writer, with the §6 requirements.
4. Then private eligibility as an isolated additive branch, with the public
   predicate proven unchanged.

```
STATE = STOP_SCHEMA_DECISION_REQUIRED
SCHEMA_CHANGE = NO
MIGRATION_CHANGE = NO
```

Soli Deo Gloria. Haleluya. Amin.
