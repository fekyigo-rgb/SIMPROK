# RM-02B0 — Effective Date Callsite Audit

STATUS: `PROVISIONAL_PENDING_PRODUCTION_PREFLIGHT`

Audit performed by grepping `effectiveDate` across `backend/src` at commit `6ca0aa0d1d237dc97134eeb26d2117ba35a01181` and reading each match in context. No repository file was modified.

## The fallback in question

```
backend/src/reality-intake/price-submission-review.service.ts:191
  effectiveDate: revision.effectiveDate ?? new Date(),
```

This is the **only** callsite that implements a `new Date()` fallback for a `PriceSubmissionRevision.effectiveDate ⇒ BasicPrice.effectiveDate` transfer. Owner's policy (§1.3 / §10 of the governing prompt) forbids RM-02 from ever reaching this fallback.

## Every effectiveDate callsite found

| File:Line | Field | Behavior | Relevant to RM-02 fallback? |
|---|---|---|---|
| `src/reality-intake/price-submission-review.service.ts:191` | `BasicPrice.effectiveDate` | `revision.effectiveDate ?? new Date()` | **YES — the fallback itself** |
| `src/reality-intake/business-subscription.service.ts:172` | `PriceSubmissionRevision.effectiveDate` | `effectiveDate: canonical.effectiveDate` (passthrough, no fallback at this line) | **YES, indirectly** — see finding below: this callsite's upstream source (`CanonicalPricePoint.effectiveDate`) is *always* `null` (see next row), meaning any `PriceSubmission` created via this pipeline reaches the fallback above with near-certainty whenever it is later accepted |
| `src/reality-intake/understanding-validation.service.ts:156` | `CanonicalPricePoint.effectiveDate` | `effectiveDate: null` — always explicitly null, unconditionally, for every candidate created on this path | Upstream cause of the above — not itself a fallback, but the reason the fallback is live-reachable today |
| `src/ahsp/services/ahsp-version.service.ts:21,60` | `AHSPVersion.effectiveDate` | plain passthrough of caller-supplied `data.effectiveDate` | NO — unrelated model (AHSP version regulation date, not Basic Price) |
| `src/project-ahsp/project-ahsp.service.ts:224` | `ProjectAhspResourceResolution.selectedEffectiveDate` | reads (`price.effectiveDate`) an already-resolved `BasicPrice.effectiveDate` for evidence recording | NO — read-only consumer downstream of publication, not a creation-time fallback |
| `src/basic-price/basic-price.service.ts:50,107,203` and `dto/get-basic-prices.dto.ts:62-63` | query/sort parameter | filters/sorts existing `BasicPrice.effectiveDate` values | NO — read-side only |
| `*.spec.ts` files (ahsp-version, project-ahsp, basic-price) | test fixtures | hardcoded `new Date('2026-...')` literals in test setup | NO — test fixture data, not production fallback logic |

```
EFFECTIVE_DATE_CALLSITE_COUNT=7 distinct production (non-spec) references found; 1 is the fallback itself, 2 form its live-reachable upstream chain, 4 are unrelated fields/read-only consumers
EFFECTIVE_DATE_CALLSITE_FILES=
  backend/src/reality-intake/price-submission-review.service.ts (line 191 — the fallback)
  backend/src/reality-intake/business-subscription.service.ts (line 172 — upstream passthrough)
  backend/src/reality-intake/understanding-validation.service.ts (line 156 — root cause, always null)
  backend/src/ahsp/services/ahsp-version.service.ts (unrelated model)
  backend/src/project-ahsp/project-ahsp.service.ts (unrelated, read-only)
  backend/src/basic-price/basic-price.service.ts (unrelated, read-side query only)
  backend/src/basic-price/dto/get-basic-prices.dto.ts (unrelated, read-side query only)
```

## Real finding: the fallback is not dormant

`BusinessSubscriptionService.processOnce()` (`business-subscription.service.ts:146-183`) creates a `PriceSubmission` + `PriceSubmissionRevision` from a `KnowledgeEvent` → `CanonicalPricePoint`, and `CanonicalPricePoint.effectiveDate` is **unconditionally `null`** at its only creation site (`understanding-validation.service.ts:156`). This means: **every `PriceSubmission` created by the existing `BusinessSubscriptionService` pipeline has `revision.effectiveDate = null` by construction**, so if such a submission is ever accepted via `acceptPriceSubmissionReview()`, it *will* hit `?? new Date()` — not hypothetically, but as the guaranteed outcome of the current code paths as written.

This worker is disabled by default (`INTAKE_BUSINESS_SUBSCRIPTION_WORKER_ENABLED` is unset/`false` in `.env.test`, per prior RM-02A discovery of the same environment variable pattern used for the other three intake workers) — so this is not currently firing in the default configuration. But it is real, live code, not a hypothetical.

## Decision (per governing prompt §10)

```
SHARED_SERVICE_FALLBACK_REMOVED_NOW=NO
```

The fallback is **not** removed by this task. Removing it would change behavior for the existing `BusinessSubscriptionService` → `acceptPriceSubmissionReview()` path, which is unrelated to RM-02 and outside this task's authorization (`Dilarang mengubah tracked source`). Instead:

```
UTANG-RM02-EFFECTIVE-DATE-FALLBACK-01=OPEN

Debt description: price-submission-review.service.ts:191's
`revision.effectiveDate ?? new Date()` fallback exists for a reason unrelated
to RM-02 (it silently backstops the BusinessSubscriptionService pipeline,
whose upstream CanonicalPricePoint.effectiveDate is always null by design).
RM-02's own code path must never be able to reach this fallback — enforced
by requiring BasicPriceImportBatch.effectiveDate to be human-set and
validated BEFORE any PriceSubmission is created from an RM-02 import row
(see 01-RM02B0-SCHEMA-CONTRACT.md §4/§12.2, state transition
READY_FOR_REVIEW -> APPROVED_FOR_SUBMISSION). Whether the fallback itself
should eventually be removed for the BusinessSubscriptionService path is a
separate decision for Architect/Owner, once that pipeline's own effective-date
sourcing is examined on its own terms — not bundled into RM-02.
```

## Output block

```
EFFECTIVE_DATE_SOURCE=human, at BasicPriceImportBatch level (see 01-RM02B0-SCHEMA-CONTRACT.md §4)
BATCH_LEVEL_EFFECTIVE_DATE_REQUIRED=YES
ROW_OVERRIDE_SUPPORTED=YES
RM02_VALIDATION_LAYER=dedicated transition guard evaluated inside the batch-approval transaction, before any PriceSubmission is created
RM02_FALLBACK_REACHABLE=NO
SHARED_FALLBACK_ACTION=RETAIN_PENDING_CALLSITE_AUDIT
HUMAN_DATE_EVIDENCE_FIELDS=BasicPriceImportBatch.effectiveDateSetByAccountId, BasicPriceImportBatch.effectiveDateSetAt
MISSING_DATE_FAIL_CLOSED_REASON=EFFECTIVE_DATE_REQUIRED_BEFORE_SUBMISSION
EFFECTIVE_DATE_CALLSITE_COUNT=7
EFFECTIVE_DATE_CALLSITE_FILES=see table above
UTANG_RM02_EFFECTIVE_DATE_FALLBACK_01=OPEN
```
