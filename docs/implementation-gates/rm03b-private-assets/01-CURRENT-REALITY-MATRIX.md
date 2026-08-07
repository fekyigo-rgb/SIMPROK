# RM-03B — 01 CURRENT REALITY MATRIX

### Dalam Nama Tuhan Yesus Kristus.

Audited read-only at `99eff0019f84fe737234bd5fe8586475fd9794ce` (post PR #65
merge), by four parallel read-only audits plus three adversarial refutation
passes. Both central claims **survived refutation** (`refuted=false`, 3/3).

Status vocabulary: `WORKING` · `PARTIAL` · `CONTRADICTS_OWNER_LAW` · `MISSING` ·
`BLOCKED_BY_SCHEMA` · `BLOCKED_BY_REAL_SOURCE` · `SCOPE_SPLIT_REQUIRED`.

---

## A. AHSP PRIVATE USE

| Capability | Owner law | Current code | Status | Minimum change | Stop gate |
|---|---|---|---|---|---|
| Ownership discriminator | private assets are distinguishable | `ownershipType` enum `SIMPROK_ASSET/APPROVED_COMMUNITY_ASSET/USER_ASSET`, schema.prisma:665, `@default(USER_ASSET)` | WORKING | none | — |
| Workspace ownership | workspace-scoped | `AHSP.workspaceId` :657 ("NULL for Official Repository"); `AHSPVersion.workspaceId` :715 | WORKING | none | — |
| Indexes for the branch | — | `@@index([ownershipType])` :703, `@@index([workspaceId, ownershipType])` :705 | WORKING | none | — |
| Private asset is actually produced | user creates their own | `ahsp.service.ts:83` hardcodes `ownershipType: 'USER_ASSET'` on every create | WORKING | none | — |
| `reviewStatus` | not required for private use | `@default(PENDING)` :666; read only by `ahsp-ownership.policy.ts` as a mutation guard | WORKING | none | — |
| `AhspVersion.status` | private use must not need publication | enum has only the national ladder `DRAFT/UNDER_REVIEW/VERIFIED/PUBLISHED/SUPERSEDED/ARCHIVED` :533-540; create hardcodes `DRAFT` (`ahsp-version.service.ts:58`) | PARTIAL | private branch keys on ownership, not on status | — |
| Any production path setting `PUBLISHED` | — | **MISSING.** `AhspVersionService.updateStatus` :79-90 has **zero** callers — no controller route, no service. `PUBLISHED` is written only by a test fixture | MISSING | none (out of scope) | Level-B blocker |
| `outputUnit` completeness | must be compatible | :723, required by predicate | WORKING | none | — |
| Resource completeness | must be complete | `resources: { some: {} }` + `version.resources.length === 0` check | WORKING | none | — |
| `eligible-versions` | private must be listable | `project-ahsp.service.ts:55` `status: PUBLISHED` was the **only** failing condition | CONTRADICTS_OWNER_LAW | additive OR-branch | — |
| `select-ahsp` revalidation | same rule as the list | `:172` same single failing condition | CONTRADICTS_OWNER_LAW | same shared builder | — |
| `archivedAt` in predicates | archived must not be usable | **MISSING** from both predicates (only `deletedAt` checked, :61 / :177) | MISSING | asserted on the private branch | — |
| `ProjectAhspOccurrence` | — | append-only, transactional | WORKING | none | — |
| Resource resolution | must resolve deterministically | `ahsp-resource-price-resolution.kernel.ts` | WORKING | none | — |

### AHSP verdict

`AHSP_SCHEMA_CHANGE = NO`. Every field the private branch needs already exists,
is already written by the live create path, and is already indexed. Exactly
**two lines** gated the whole capability.

---

## B. BASIC PRICE PRIVATE USE

| Capability | Owner law | Current code | Status | Minimum change | Stop gate |
|---|---|---|---|---|---|
| Ownership/scope discriminator | private prices are distinguishable | **MISSING.** `BasicPrice` (schema.prisma:1408-1442) has no ownership field of any kind | **BLOCKED_BY_SCHEMA** | new explicit field | **STOP** |
| `workspaceId` | tenancy | :1411, nullable — but the curation pipeline sets it too (`price-submission-review.service.ts:297`) | PARTIAL — tenancy ≠ asset kind | — | — |
| `status` | publication axis | :1424, **plain `String`**, default `"UNPUBLISHED"`, no enum, no CHECK constraint | PARTIAL | — | — |
| `verificationStatus` | curation axis | :1418 enum, default `UNVERIFIED` | PARTIAL | — | — |
| `sourceSubmissionId` | provenance to a submission | :1414, nullable, `@unique` | PARTIAL — see below | — | — |
| Writers | must be enumerable | exactly **two** in `src/`: `price-submission-review.service.ts` (`create`) and `basic-price-publication.service.ts` (`update`). **No raw-SQL writer anywhere** | WORKING | a private writer would be a third | blocked by schema |
| Writer inventory guard | — | `basic-price-writer-inventory.spec.ts:18-42`, order-dependent exact `toEqual` on those two | WORKING | would need updating | blocked |
| Eligibility for use | private must be usable by owner | `publicEligibilityWhere()` = `{status:'PUBLISHED', verificationStatus:PUBLISHED}` — the **sole** gate on every use path | **CONTRADICTS_OWNER_LAW** | — | **STOP** |
| Direct-create endpoint | user creates own price | **MISSING.** `basic-price.controller.ts` has only `@Get` routes | MISSING | blocked by schema | **STOP** |
| Cost Kernel acceptance | — | `assertTraceableProvenance` (`rab-kernel-persistence.service.ts:440-523`) requires the full publication chain | WORKING | — | blocked |

### The decisive finding

`publicEligibilityWhere()` is the **only** gate on every consumer
(`basic-price.service.ts:179,322,345`; `project-ahsp.service.ts:208,294`;
`rab-kernel-persistence.service.ts:222`). So the only way to make a row usable
by **anyone — including its own workspace** — is to stamp it literally
`PUBLISHED` on both axes.

That leaves exactly two dishonest options and no honest one:

1. Mark the private price `PUBLISHED/PUBLISHED` → calls a private asset
   "published" (forbidden), and makes it indistinguishable from a curated
   national price except by an incidental `workspaceId` that catalog pipeline
   rows also carry.
2. Leave it `UNPUBLISHED/VERIFIED` → invisible to every consumer, **and** it
   surfaces in the national publication queue
   (`basic-price-publication.service.ts:36-40`) as something awaiting a
   publisher. Wrong in both directions at once.

### Why `sourceSubmissionId IS NULL` is not the marker

The prompt permits it **only if** every creation path proves it means
private-direct-entry. It does not:

- The only production creator (`price-submission-review.service.ts:295`)
  **always** sets it.
- `NULL` is produced today **only** by test fixtures and one dev script
  (`scripts/rm02d2a2/visual-acceptance-fixture.ts:93`).
- No constraint prevents a future writer producing a `NULL` catalog row.

So `sourceSubmissionId IS NULL` means *"a row no production writer created"* —
an inference from an absence manufactured by test code. Using it as the private
marker would be exactly the dishonest inference §5 forbids.

### Basic Price verdict

```
STOP_SCHEMA_DECISION_REQUIRED
```

See `03-SCHEMA-DECISION-PACKET.md`. No migration written. No writer added. No
status overloaded.

---

## C. PR #65 REGRESSION CONTRACT

| Invariant | Status | Evidence |
|---|---|---|
| Persisted read follows `calculationOccurrenceId` | PRESERVED | `persisted-calculation.service.ts` untouched |
| Recomputation uses frozen resolutions | PRESERVED | untouched |
| No Basic Price re-read on the proof path | PRESERVED | untouched |
| Read-only | PRESERVED | untouched |
| `VERIFIED` / `MISMATCH` / `FAIL_CLOSED` | PRESERVED | untouched |
| Resource breakdown | PRESERVED | untouched |
| Hard-reload persistence | PRESERVED | untouched |

No file delivered by PR #65 is modified by RM-03B.

---

## D. GENERAL-USER UI SURFACE

| Item | Status | Evidence |
|---|---|---|
| Back-office pages reachable by a general user | **NO — clean** | review queue / detail / publication queue gated on `BASIC_PRICE_REVIEW_VIEW` / `BASIC_PRICE_PUBLISH`, both in `GOVERNED_ACTIVATION_PERMISSION_CODES` and explicitly not in the 4-code active-membership baseline; no nav links to them |
| User-facing Basic Price create UI | MISSING | no write route exists at all |
| User-facing AHSP UI | MISSING | no frontend caller of `/ahsp` exists |
| AHSP picker origin labelling | **ADDED HERE** | `ahspOriginDisplay.ts` |

No back-office control is exposed by this gate.

---

## E. TENANT-SECURITY FINDINGS (all pre-existing, all on the private path)

| # | Finding | Location | Disposition |
|---|---|---|---|
| 1 | `body.workspaceId` **overrode** guard-verified context on AHSP create | `ahsp.controller.ts` | **FIXED** |
| 2 | same inversion on version create | `ahsp.controller.ts` | **FIXED** |
| 3 | version create had **no tenant check** on the parent AHSP | `ahsp-version.service.ts` | **FIXED** |
| 4 | `archivedAt` absent from eligibility | `project-ahsp.service.ts` | **FIXED on the private branch** (catalog left untouched by design) |
| 5 | `ownershipType` is user-mutable via transfer + self-grantable approve | `ahsp.service.ts:249`, `ahsp-ownership.policy.ts:64-72` | **MITIGATED** — never the sole authority; strict `workspaceId` equality is |
| 6 | no global `ValidationPipe`; DTOs are plain interfaces | `main.ts` | **REPORTED** — controllers ignore untrusted fields explicitly |
| 7 | null-workspace AHSPs are mutable by any workspace holding `AHSP_MANAGE` | `ahsp.service.ts:100` | **REPORTED** — out of scope, not leaned on |
| 8 | `AHSPResource.resourceId` is a plain String, matched by name | `schema.prisma:746` | **REPORTED** — RM-02C1A lineage, unchanged |

Soli Deo Gloria. Haleluya. Amin.
