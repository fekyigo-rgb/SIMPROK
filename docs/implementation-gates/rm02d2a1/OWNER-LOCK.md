# RM-02D2A-1 — Owner Lock

Status: LOCKED per `RM02D2A-1-BACKEND-RUNTIME-LIFECYCLE-CLOSURE-V2` prompt,
2026-07-29. Implemented verbatim by this slice. Not open to reinterpretation
by future code changes without a separate Owner decision.

```text
OWNER_LOCK_RM02D2A=LOCKED

VERIFICATION_AND_PUBLICATION=SEPARATE_HUMAN_ACTIONS
VERIFIED_TO_PUBLISHED_TRIGGER=BASIC_PRICE_PUBLISH
PUBLICATION_TRANSITION=ATOMIC_TWO_AXIS
VERIFIER_MUST_DIFFER_FROM_PUBLISHER=YES
AUTO_PUBLISH=FORBIDDEN

TARGET_BATCH_MUTATION_IN_D2A=NO
PROVENANCE=FREEZE
MERGE=NO

TWO_AXIS_REDUNDANCY=INTENTIONAL_FAIL_SAFE
SINGLE_PERSON_WORKSPACE_PUBLICATION=IMPOSSIBLE_UNDER_CURRENT_LOCK
SINGLE_PERSON_PRODUCT_RISK=OWNER_ACCEPTED
GOVERNED_EXCEPTION_PATH=DEFERRED_TO_SEPARATE_OWNER_DECISION
```

## Status contract (implemented exactly)

```text
PriceSubmission + Review
  -- human with BASIC_PRICE_VERIFY accepts -->
BasicPrice = UNPUBLISHED + VERIFIED

BasicPrice = UNPUBLISHED + VERIFIED
  -- a DIFFERENT human with BASIC_PRICE_PUBLISH -->
BasicPrice = PUBLISHED + PUBLISHED
```

For the RM-02 import path, before ACCEPT the authoritative object is
`PriceSubmission + PriceSubmissionReview`; no `BasicPrice` exists yet.
`acceptPriceSubmissionReview()` never creates a premature
`BasicPrice UNPUBLISHED + UNVERIFIED` row just to materialize a conceptual
state — ACCEPT creates exactly one `BasicPrice` directly at
`UNPUBLISHED + VERIFIED`. Implemented in
`backend/src/reality-intake/price-submission-review.service.ts`
(`acceptPriceSubmissionReview`).

`VERIFIED` means the price has been checked but is not yet officially
available. `PUBLISHED + PUBLISHED` means a verified price has been
published by a *different* human and is only then eligible. Implemented
in `backend/src/basic-price/basic-price-publication.service.ts`
(`publish`, D-01..D-15) and enforced for reads by
`backend/src/basic-price/basic-price-eligibility.policy.ts`
(unchanged — both axes required, never simplified).

Any older document, code comment, or test asserting that ACCEPT directly
publishes a `BasicPrice` is superseded by this Owner Lock. The specific
legacy writer this static-trace-confirmed and removed is documented in
`IMPLEMENTATION-REPORT.md` under "Legacy auto-publish static trace."

## Risk accepted by Owner (§2.1, implemented as designed, not a defect)

`VERIFIER_MUST_DIFFER_FROM_PUBLISHER=YES` and `AUTO_PUBLISH=FORBIDDEN` are
deliberately preserved with these consequences:

- A workspace with only one human cannot publish a Basic Price through
  this normal path.
- A solo estimator or a very small firm cannot close the Golden Thread
  through this route.
- This is **not a D2A-1 bug** — it is a product risk the Owner has
  accepted.
- No bypass, self-approval, admin fallback, auto-publish, or hidden
  exception was added anywhere in this slice. Verified by `rg` (see
  IMPLEMENTATION-REPORT.md, "No stray PUBLISHED writers").
- A governed exception path may only be defined later, by a separate
  Owner decision. This slice does not propose or sketch one.

## Two-axis redundancy is intentional (§2.2)

The only normal terminal states this slice's code path can produce are:

```text
UNPUBLISHED + VERIFIED
PUBLISHED + PUBLISHED
```

`status` and `verificationStatus` look redundant at the terminal state, but
they are a deliberate fail-safe: an accidental write to only one axis must
never make a price eligible. `BasicPricePublicationService.publish()`
(D-09) writes both axes atomically in one `UPDATE`, inside one
transaction, guarded by a row lock (D-02) and a source-state precondition
that only accepts the exact `UNPUBLISHED + VERIFIED` pair (D-04), failing
closed — never self-healing — on every other combination, including
partial-drift states like `PUBLISHED + VERIFIED` or
`UNPUBLISHED + PUBLISHED` (D-12). `BasicPriceEligibilityPolicy`'s two-field
predicate (`status='PUBLISHED' AND verificationStatus='PUBLISHED'`) was not
simplified, not had one field removed, and no silent self-heal was added
anywhere in this slice.

Soli Deo Gloria. Haleluya. Amin.
