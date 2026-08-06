# RM-03 / ONE_LIVE_RAB_ROW — 01 TRACE MATRIX

### Dalam Nama Tuhan Yesus Kristus.

Audit performed read-only at `BASE_SHA 3eaa6e4a53d45461192970628b9cf2a3c269d681`.
Every row cites repository evidence. Nothing here is inferred from memory.

---

## PART 1 — CURRENT-REALITY MATRIX

Status vocabulary: `WORKING` · `PARTIAL` · `DISCONNECTED` · `MISSING` ·
`BLOCKED_BY_REAL_DATA` · `BLOCKED_BY_HUMAN_ACTOR` · `BLOCKED_BY_SCHEMA`.

### A. BASIC PRICE

| Capability | Status | Evidence | Gap | Minimum change |
|---|---|---|---|---|
| Import / intake | WORKING | `basic-price-import.controller.ts:59-166` | — | none |
| Submission | WORKING | `POST /basic-price-imports/:batchId/submit`, `:165` (`BASIC_PRICE_SUBMIT`) | — | none |
| Review queue + detail | WORKING | `basic-price-review.controller.ts:32-53` | — | none |
| Verification (ACCEPT) | WORKING | `price-submission-review.service.ts:293-316` | — | none |
| Publication | WORKING | `basic-price-publication.service.ts:109-230` | — | none |
| Verifier ≠ publisher | WORKING | `basic-price-publication.service.ts:211-215` `VERIFIER_CANNOT_PUBLISH` | — | none |
| Auto-publish forbidden | WORKING | status omitted on create → schema default `UNPUBLISHED`, `price-submission-review.service.ts:307-315`; writer inventory `basic-price-writer-inventory.spec.ts:17-43` | — | none |
| Atomic two-axis publication | WORKING | `basic-price-publication.service.ts:218-230` inside `$transaction` `:109` | — | none |
| Publication audit | WORKING | `basic-price-publication.service.ts:223-230` | records publisher only; verifier re-derived from `PriceSubmissionReviewDecision` | out of scope |
| Eligibility for AHSP resolution | WORKING | `basic-price-eligibility.policy.ts:78-86` — requires `status=PUBLISHED` AND `verificationStatus=PUBLISHED` | — | none |
| UI: review queue / detail / verify | WORKING | `BasicPriceReviewQueuePage.tsx:26`, `BasicPriceReviewDetailPage.tsx:56,200-227` | — | none |
| UI: publish | WORKING | `BasicPricePublicationQueuePage.tsx:72-88,129-135` | — | none |
| UI: actor-separation error | PARTIAL | `basicPriceWorkflowDisplay.ts:184,192` collapses 409 to a generic "state changed" message | `VERIFIER_CANNOT_PUBLISH` not distinguished | out of scope |
| **Permission seeding** | **MISSING** | `seed-rbac-permissions.ts:14-93` carries only `BASIC_PRICE_VIEW`/`_MANAGE` | `_SUBMIT`, `_VERIFY`, `_PUBLISH`, `_REVIEW_VIEW`, `_IMPORT`, `_RESOLVE` absent → cannot be granted in production | **Owner/PM production-activation decision** (already recorded as UTANG-PERMISSION-08) |
| Second human actor | BLOCKED_BY_HUMAN_ACTOR | only `fekyigo@gmail.com` / DIRECTOR is proven | publication is structurally impossible with one human | **Owner must supply a real second actor** |

### B. AHSP

| Capability | Status | Evidence | Gap | Minimum change |
|---|---|---|---|---|
| `AHSP` / `AHSPVersion` / `AHSPResource` | WORKING | `schema.prisma:655,712,743` | — | none |
| Output unit | WORKING | `schema.prisma:731` | — | none |
| Coefficients | WORKING | `AHSPResource.coefficient` `Decimal(18,6)`, `schema.prisma:748` | — | none |
| Eligible-version search | WORKING | `GET .../eligible-versions`, `project-ahsp.service.ts:53-86`; re-applied on selection `:169-198` | dropdown only, no text search | out of scope |
| Binding (`select-ahsp`) | WORKING | `project-ahsp.controller.ts:48`; `project-ahsp.service.ts:97-442` | — | none |
| Occurrence persistence | WORKING | `project-ahsp.service.ts:392-411`, append-only, gate-tested by `project-ahsp-occurrence-append-only.spec.ts:18-33` | — | none |
| Resource resolution | WORKING | `ahsp-resource-price-resolution.kernel.ts:203-429` | matching is normalized-name+type, not catalog identity (`AHSPResource.resourceId` is a String, `schema.prisma:746`) | out of scope — RM-02C1A lineage |
| Snapshots of source/adapted price | WORKING | `ProjectAhspResourceResolution`, `schema.prisma:1802-1852` | — | none |
| Unit adaptation | PARTIAL | `kernel.ts:321-329` accepts only `canonicalUnit=PERSON_DAY`, `quantityFactor='1'`, `priceOperation=IDENTITY` | any real conversion → `UNRESOLVED / UNIT_NOT_SUPPORTED` | **Level-B constraint — see Blocker 3** |
| **Version → PUBLISHED transition** | **MISSING** | `AhspVersionService.updateStatus` (`ahsp-version.service.ts:79-90`) has **no controller route** and no production caller; versions are created hardcoded `DRAFT` (`:58`); only `PUBLISHED` is bindable (`project-ahsp.service.ts:55,172`) | no production path can make an AHSP bindable | **Level-B blocker — see Blocker 1** |

### C. RAB / BOQ

| Capability | Status | Evidence | Gap | Minimum change |
|---|---|---|---|---|
| Add/edit BOQ item, volume, unit | WORKING | `RabWorkspacePage.tsx:1445-1464`, `PUT /boq/draft` | — | none |
| `select-ahsp` from UI | WORKING | `RabWorkspacePage.tsx:738-763` | — | none |
| Server Cost Kernel | WORKING | `cost-kernel.kernel.ts:43-123`, exact `Prisma.Decimal` throughout | — | none |
| Atomic persistence | WORKING | `rab-kernel-persistence.service.ts:75-407`, single `$transaction`, `FOR UPDATE` at `:78-82` | — | none |
| Fail-closed on unresolved | WORKING | `rab-kernel-persistence.service.ts:193-198`; kernel `cost-kernel.kernel.ts:84-85` | — | none |
| `priceOrigin` truth at DB boundary | WORKING | `boq_items_price_origin_truth_check`, Gate-2A migration | — | none |
| Persist endpoint | WORKING | `project.controller.ts:306` | — | none |
| **Read-only recomputation after reload** | **DISCONNECTED** | `cost-kernel.service.ts:52-56,60-64,89-100,109-116` resolves occurrences **only** via `workingOccurrenceId`; persist nulls it at `rab-kernel-persistence.service.ts:336` → persisted line returns `OCCURRENCE_NOT_FOUND` | the Golden Thread's final link | **THIS GATE** — new read-only route following `calculationOccurrenceId` |
| **Workspace row after hard reload** | **DISCONNECTED** | `RabWorkspacePage.tsx` `mapBoqToRows` dropped `priceOrigin`/`lineTotal`/`calculationAsOfDate`; price rendered only from the transient batch, which fails as above | saved price displayed as `—` | **THIS GATE** — render persisted truth |
| **Per-resource breakdown** | **MISSING** | kernel computes `resources[]` (`cost-kernel.kernel.ts:101-107`) but persist discards it; no endpoint keyed by `boqItemId` returns it; `rabCostDisplay.ts:1-16` drops it from the wire type | no traceable breakdown for a persisted row | **THIS GATE** — return and render it |
| Manual/kernel row distinction in workspace | **DISCONNECTED** | `manualUnitPrice` inferred from presence of `unitPrice`, so kernel rows were flagged manual and blocked on save with `SERVER_ROW_UNIT_PRICE_OVERWRITE_FORBIDDEN` (`project.service.ts:764-782`) | persisted line could not be edited again | **THIS GATE** — derive from `priceOrigin` |

### D. PERSISTED BREAKDOWN — schema capability

The decisive question for `STOP_SCHEMA_DECISION_REQUIRED`.

| Required per resource | Persisted? | Column |
|---|---|---|
| coefficient | YES | `ahspCoefficient` `Decimal(18,6)` `schema.prisma:1808` |
| source Basic Price id | YES | `selectedBasicPriceId` `:1811` |
| source value | YES | `sourcePriceValue` `Decimal(18,2)` `:1815` |
| adapted value | YES | `adaptedPriceValue` `Decimal(18,2)` `:1817` |
| adaptation / conversion | YES | `conversionFactor` `:1818`, `quantityFactor` `:1823`, `unitConversionRuleId`/`Version` `:1821-1822` |
| reason / provenance | YES | `reasonCodes` `:1828`, `explanation` `:1829`, `selectedSourceOrigin` `:1824`, `selectedFreshnessStatus` `:1825` |
| as-of date | YES | `selectedEffectiveDate` `:1826`; occurrence `businessPricingAsOfDate` `:1767` |
| policy version | YES | `policyVersion` `:1830`; occurrence `resolutionPolicyVersion` `:1769` |
| **resource cost** | **NOT STORED — derived** | `coefficient × adaptedPriceValue`, recomputed exactly on read |

### VERDICT: `STOP_SCHEMA_DECISION_REQUIRED` **DOES NOT APPLY**

Per-resource reproducibility is fully achievable with the existing schema.
`resourceCost` is deliberately **not** given a column: it is a pure function
of two persisted exact-decimal values. Storing it would create a second copy
that could silently drift from the arithmetic it claims to represent, and
would require a migration purely for convenience — which §14 forbids.

`SCHEMA_CHANGE=NO` · `MIGRATION_CHANGE=NO` · `DEPENDENCY_CHANGE=NO`.

---

## PART 2 — E2E TRACE (synthetic)

```
TEST_ONLY_SYNTHETIC_FIXTURE=YES
PRODUCTION_TRUTH=NO
```

Database: `simprok_e2e` only, behind the fail-closed identity gate.
Extends the existing `gate2a-rab-kernel-persistence.e2e-spec.ts`, which already
performs the full three-distinct-actor lifecycle.

| Step | Actor | Fixture / evidence |
|---|---|---|
| Basic Price submission | ephemeral submitter | `PriceSubmission` + revision |
| Verification (ACCEPT) | ephemeral **verifier** (`BASIC_PRICE_VERIFY`) | `PriceSubmissionReviewDecision.action=ACCEPT` → `BasicPrice` `VERIFIED`/`UNPUBLISHED` |
| Publication | ephemeral **publisher** (`BASIC_PRICE_PUBLISH`), distinct account | `BasicPricePublicationAudit.action=PUBLISH`; asserted distinct at spec `:477` |
| AHSP fixture | — | `AHSP` + `AHSPVersion(outputUnit=Kg)` + `AHSPResource(coefficient=2.000000)` |
| Occurrence + resolution | — | `ProjectAhspOccurrence` + one `RESOLVED` resolution, `adaptedPriceValue=100000.00` |
| BOQ item | RAB editor (`RAB_DRAFT_EDIT`) | `quantity=5`, `unit=Kg`, unpriced |
| Cost Kernel persist | RAB editor | `unitPrice=200000.00`, `lineTotal=1000000.00`, `priceOrigin=SERVER_COST_KERNEL` |
| **Hard-reload re-proof** | **RAB viewer (`RAB_VIEW` only)** | `status=VERIFIED`; recomputed == stored; `resourceCost=200000` |
| **Gap proof** | RAB editor | same line via the working-pointer route → `FAIL_CLOSED / OCCURRENCE_NOT_FOUND` |
| **Read-only proof** | RAB viewer | `BoqItem` and occurrence rows byte-identical before/after |
| **Authorization proof** | verifier (no `RAB_VIEW`) | `403` |
| **Honest-state proof** | RAB viewer | unpriced row → `FAIL_CLOSED / NOT_CALCULATED` |
| Cleanup | — | per-spec `afterAll`, then whole-database fingerprint diff by the harness |

Arithmetic asserted: `2.000000 × 100000.00 = 200000` per resource;
`Σ = 200000.00` unit price; `× 5 = 1000000.00` line total. Exact decimal, no
float anywhere on the path.

---

## PART 3 — PRODUCTION TRACE (Level-B) — **EMPTY BY LAW**

These fields must be filled only from real Owner-supplied artefacts. They are
deliberately blank; filling them with test data would be fabrication.

| Field | Value |
|---|---|
| `SOURCE_FILE_PATH` | *(not supplied)* |
| `SOURCE_FILE_NAME` | *(not supplied)* |
| `SOURCE_FILE_SIZE` | *(not supplied)* |
| `SOURCE_FILE_SHA256` | *(not supplied)* |
| `SOURCE_OWNER_OR_PUBLISHER` | *(not supplied)* |
| `SOURCE_DATE_IF_PRESENT` | *(not supplied)* |
| `SOURCE_PAGE_OR_ROW_REFERENCE` | *(not supplied)* |
| `OWNER_REALITY_ACKNOWLEDGEMENT` | **NO** |
| `OWNER_CONFIRMS_SOURCE_IS_REAL` | **NO** |
| Real human verifier | *(not supplied)* |
| Real human publisher | *(not supplied)* |
| Live `BasicPrice.id` | *(none — nothing written to production)* |
| Live `AHSPVersion.id` | *(none)* |
| Live `BoqItem.id` on `Percobaan 1` | *(none)* |

```
STATE = WAITING_OWNER_ONE_ROW_REALITY_INPUT
STATE = WAITING_OWNER_REAL_BASIC_PRICE_ACTOR
```

`PRODUCTION_REALITY_DATA_WRITTEN = NO`.

---

## PART 4 — LEVEL-B BLOCKERS

Real gaps found by the audit. Each is a governance or product-law decision, so
none was implemented here.

### Blocker 1 — No production path publishes an AHSP version

Only `PUBLISHED` versions are bindable (`project-ahsp.service.ts:55,172`), but
versions are created `DRAFT` (`ahsp-version.service.ts:58`) and
`AhspVersionService.updateStatus` (`:79-90`) is exposed by no route and called
by no production code. `AhspController.approve` (`ahsp.controller.ts:106`)
approves the AHSP **parent**, not the version. `updateStatus` also has no
state-machine guard — it would write any status to any status.

**Consequence:** in production `eligible-versions` returns empty and the
Golden Thread cannot start. E2E is unaffected because the fixture creates a
`PUBLISHED` version directly.

**Owner/PM decision required:** who may publish an AHSP version, under which
permission, and with what verifier/publisher separation (mirroring Basic
Price, or not). This is authority design, not executor work.

### Blocker 2 — Basic Price permission codes are not seeded

`BASIC_PRICE_SUBMIT`, `_VERIFY`, `_PUBLISH`, `_REVIEW_VIEW`, `_IMPORT`,
`_RESOLVE` are absent from `seed-rbac-permissions.ts:14-93`, and
`grantPermissionsToRole` throws `STOP: permission <code> was not ensured`
(`:158`) for any unseeded code. Documented as deliberate pending governed
activation (`permissions.ts:316-323`). Already recorded as UTANG-PERMISSION-08.

**Consequence:** the human Basic Price lifecycle cannot be granted to a real
second actor in production until activation is performed.

### Blocker 3 — Resource resolution supports only `PERSON_DAY`, factor 1

`ahsp-resource-price-resolution.kernel.ts:321-329` and `:277-278` require
`canonicalUnit=PERSON_DAY`, `quantityFactor='1'`, `priceOperation=IDENTITY`.
Anything requiring a genuine unit conversion resolves `UNRESOLVED /
UNIT_NOT_SUPPORTED`, and the kernel then fails the whole line closed.

**Consequence:** the first real live row must be chosen so that every one of
its AHSP resources is a labour resource priced per person-day, or resolution
will fail. Owner should select the first real AHSP with this in mind.

### Blocker 4 — Only one real human actor exists

`fekyigo@gmail.com` / DIRECTOR. Publication requires a publisher distinct from
the verifier (`basic-price-publication.service.ts:211-215`), so the production
lifecycle is structurally impossible with one person. No account was created;
`test.local` accounts are forbidden; the separation law was not weakened.

---

## PART 5 — ANTI-FABRICATION DECLARATION

- No AHSP coefficient, Basic Price value, unit, region, effective date, or
  source was invented, recalled from model knowledge, or copied from an
  unsourced example.
- No production row was written, altered, or deleted.
- The only synthetic values in this change are E2E fixtures in `simprok_e2e`,
  labelled `TEST_ONLY_SYNTHETIC_FIXTURE=YES` / `PRODUCTION_TRUTH=NO`.
- The 13-resource unit-test fixture is reused verbatim from the existing
  certified `cost-kernel.service.spec.ts` so both specs must agree.
- No browser verification is claimed anywhere in this gate.

Soli Deo Gloria. Haleluya. Amin.
