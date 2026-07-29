# RM-02D2A-1 — Backend Runtime Lifecycle Closure — Implementation Report

`EXECUTION_SPEC_ID=RM02D2A-1-BACKEND-RUNTIME-LIFECYCLE-CLOSURE-V2`

## Before / after

```text
BEFORE_SHA (branch point) = ccb6983419b8b134d6cfc4b1dba87518af3db59a
NEW_BRANCH = feat/rm02d2a1-backend-runtime-lifecycle
NEW_PR_BASE = feat/rm02d1-resource-identity-mapping
AFTER_SHA = see commit recorded after this document; single commit on this branch
```

Preflight (verified before any change): worktree `C:\Users\asus\SIMPROK-WT-RM02D1`
was on `feat/rm02d1-resource-identity-mapping` at exactly `ccb6983...`,
`git status --short --untracked-files=all` was empty, `origin/feat/rm02d1-resource-identity-mapping`
pointed at the same SHA. PR #53 (`main` <- `feat/rm02c3-acceptance-permission`,
head `6a11276...`) and PR #54 (`feat/rm02c3-acceptance-permission` <-
`feat/rm02d1-resource-identity-mapping`, head `ccb6983...`) were both
`OPEN`/Draft via `gh pr view`. Neither PR's base/head/body was touched by
this slice. Branch `feat/rm02d2a1-backend-runtime-lifecycle` did not exist
locally or on `origin` before this slice created it.

## Changed paths

Modified:
- `backend/src/basic-price/basic-price-import.controller.ts` — removed
  `BasicPricePublicationController` (moved to its own file with a new route).
- `backend/src/basic-price/basic-price-import.service.ts` — `submitBatch()`
  now calls the canonical review-creation helper inside its own transaction.
- `backend/src/basic-price/basic-price-import.service.spec.ts` — new
  provider mock + 2 new assertions/tests (Work Package A).
- `backend/src/basic-price/basic-price-publication.service.ts` — rewritten:
  workspace-scoped, atomic two-axis, D-01..D-15.
- `backend/src/basic-price/basic-price-publication.service.spec.ts` —
  CONTRACT_UPDATE: full rewrite for the new signature/semantics.
- `backend/src/basic-price/basic-price.module.ts` — new controller wired,
  imports `RealityIntakeModule`.
- `backend/src/common/constants/permissions.ts` — Work Package E catalog fix.
- `backend/src/common/constants/permissions.spec.ts` — renamed import/symbol.
- `backend/src/reality-intake/price-submission-review.service.ts` —
  rewritten: canonical review-creation helper, hardened ACCEPT, legacy
  auto-publish writer removed, actionability locking, new read/resolve helpers.
- `backend/src/reality-intake/reality-intake.module.ts` — new controller
  registered, exports `PriceSubmissionReviewService`.
- `backend/test/acceptance/basic-price-import.e2e-spec.ts` — CONTRACT_UPDATE:
  publication describe-block rewritten for the new route/semantics; submit
  test updated for the now-synchronous review creation; cleanup order fixed.
- `backend/test/acceptance/reality-intake-price-submission-review.e2e-spec.ts` —
  CONTRACT_UPDATE: ACCEPT return-shape assertion, removed legacy
  auto-publish assertions, added assertions proving they no longer happen.

New:
- `backend/src/basic-price/basic-price-publication.controller.ts` — new
  `/basic-price-publications` route.
- `backend/src/reality-intake/basic-price-review.controller.ts` — new
  `/basic-price-reviews` route (Work Package B).
- `backend/src/reality-intake/dto/price-submission-review-decision.dto.ts`.
- `backend/src/reality-intake/price-submission-review.service.spec.ts` —
  new unit suite.
- `backend/test/acceptance/rm02d2a1-basic-price-lifecycle.e2e-spec.ts` —
  new dedicated safe E2E (Work Package F §11.3).
- `docs/implementation-gates/rm02d2a1/OWNER-LOCK.md`,
  `docs/implementation-gates/rm02d2a1/IMPLEMENTATION-REPORT.md` (this file).

Confirmed via `git diff --name-only`: **zero** files under `backend/prisma/`
or `frontend/` appear anywhere in the diff.

## Static trace §4 — legacy auto-publish writer (verified, then removed)

At `BEFORE_SHA=ccb6983...`, `backend/src/reality-intake/price-submission-review.service.ts`,
inside `acceptPriceSubmissionReview()`:

```text
LEGACY_ACCEPT_WRITES_PRICE_SUBMISSION_PUBLISHED=YES
  — line 206-209 (pre-D2A-1): `tx.priceSubmission.update({ where: { id: review.submission.id }, data: { status: 'PUBLISHED' } })`
LEGACY_ACCEPT_WRITES_STEP_2_6B_AUDIT=YES
  — line 211-220 (pre-D2A-1): `tx.priceSubmissionAudit.create({ data: { ..., fromStatus: 'VERIFIED', toStatus: 'PUBLISHED', actorType: 'SYSTEM', actorAccountId: null, reason: 'STEP-2.6b_BASIC_PRICE_ACTIVATED; ...' } })`
LEGACY_TESTS_ASSERT_AUTO_PUBLISH:
  - backend/test/acceptance/reality-intake-price-submission-review.e2e-spec.ts:413 — `expect(submission.status).toBe('PUBLISHED')`
  - backend/test/acceptance/reality-intake-price-submission-review.e2e-spec.ts:425-436 — asserted the `STEP-2.6b_BASIC_PRICE_ACTIVATED` audit row's exact shape
```

Both writers existed and were confirmed by reading the file before any edit
(not assumed from documentation). Per Owner Lock §2/§8, both were removed
in this slice. `LEGACY_AUTO_PUBLISH_REMOVAL=APPLIED` (not
`NOT_APPLICABLE` — the legacy writer was real). The three tests above were
updated (see "Existing tests changed" register below); no test outside
that register was touched.

## Three schema assumptions — verified read-only against the schema file at `BEFORE_SHA`, then re-verified unchanged after (schema itself was never edited)

```text
BasicPricePublicationAudit.reason String?                — CONFIRMED (schema.prisma, model BasicPricePublicationAudit)
PriceSubmissionReviewDecision.decidedByUserId + FK to User — CONFIRMED (schema.prisma: `decidedByUserId String @db.Uuid`, `decidedBy User @relation(...)`)
User.workspaceMembershipId @unique                         — CONFIRMED (schema.prisma, model User: `workspaceMembershipId String @unique @db.Uuid`)
```

Verifier trace path implemented exactly as specified:
`BasicPrice.sourceSubmission -> PriceSubmission.review -> PriceSubmissionReviewDecision(action=ACCEPT) -> decidedByUserId -> User.workspaceMembershipId (unique) -> WorkspaceMembership.accountId`
— see `basic-price-publication.service.ts`, `publish()`, D-05/D-06.
No schema or migration change was needed or made; `PRISMA_SCHEMA_CHANGE_COUNT=0`,
`MIGRATION_CHANGE_COUNT=0`, `OLD_MIGRATIONS_UNCHANGED=YES`.

## Migration hash verification (unchanged)

```text
20260728103627_rm02d1_resource_identity_mapping/migration.sql
  0E5227CA68FB30DC51C02FB5747D70FB5049B5A3A58D48E483150C73A7A042AA — MATCH
20260728123955_rm02d1_source_equivalence_provenance/migration.sql
  4219D536053A27B6D4294F88BDC2A8AAD5987A0EF3335B5BBE32BA32CA7931AC — MATCH
```
Computed via `sha256sum` against the working tree after all code changes.

## Lifecycle before -> after

**Before (confirmed by the prior RM-02-FINAL-EXIT-GATE audit and by this
slice's own static trace before editing):**
- `submitBatch()` created `PriceSubmission` rows at `SUBMITTED` with no
  review ever created by any runtime path — `PriceSubmissionReviewService`
  had zero controller/worker/cron wiring anywhere.
- `acceptPriceSubmissionReview()` existed but was reachable only from a
  test file, and it silently advanced `PriceSubmission.status` to
  `PUBLISHED` and wrote a `STEP-2.6b_BASIC_PRICE_ACTIVATED` audit claiming
  a publication that never actually happened at the `BasicPrice` level
  (`BasicPrice.status` stayed `UNPUBLISHED`).
- `BasicPricePublicationService.publish(basicPriceId, actorAccountId)` had
  no workspace scoping, no verifier-evidence trace, and no separation-of-
  duties check — any actor with `BASIC_PRICE_PUBLISH` could publish any
  `VERIFIED` price, including one they had just verified themselves. It
  only ever wrote `status='PUBLISHED'`, never touching `verificationStatus`
  — so a row that went through this path would end at
  `status=PUBLISHED, verificationStatus=VERIFIED`, which
  `BasicPriceEligibilityPolicy` correctly rejects (`NOT_VERIFICATION_TERMINAL`).
  This was `BLOCKER_RM02_PUBLICATION_ELIGIBILITY_01` from the prior audit.

**After (this slice):**
1. `BasicPriceImportService.submitBatch()` creates each `PriceSubmission`
   and, in the SAME transaction, calls
   `PriceSubmissionReviewService.createReviewWithinTransaction(tx, ...)` —
   a `PriceSubmissionReview` (`slaState=OPEN`) always exists the instant
   `submitBatch()` returns 201; `PriceSubmission.status` is `UNDER_REVIEW`,
   never left at bare `SUBMITTED`.
2. `POST /basic-price-reviews/:reviewId/accept` (new controller,
   `BASIC_PRICE_VERIFY`) resolves the acting `User.id` server-side from the
   JWT's `Account.id` + workspace, and calls the hardened
   `acceptPriceSubmissionReview()`, which now:
   - row-locks the review, checks live `slaState` (never acts on a
     `RESOLVED`/`EXPIRED` review except the documented ACCEPT-idempotent
     replay),
   - creates exactly one `PriceSubmissionReviewDecision(ACCEPT)`,
   - sets `PriceSubmission.status = VERIFIED` (stays there — never
     advanced further by this method),
   - creates exactly one `BasicPrice` at `status=UNPUBLISHED` (schema
     default, never hardcoded), `verificationStatus=VERIFIED`,
   - writes **zero** `BasicPricePublicationAudit` rows,
   - returns an honest payload: `{ priceSubmissionStatus: 'VERIFIED', basicPriceStatus: 'UNPUBLISHED', basicPriceVerificationStatus: 'VERIFIED', publiclyEligible: false }`.
3. `POST /basic-price-publications/:basicPriceId/publish` (new controller,
   route moved from `/basic-prices/:id/publish`, `BASIC_PRICE_PUBLISH`)
   resolves `workspaceId` + `publisherAccountId` server-side, and the
   rewritten `BasicPricePublicationService.publish()` enforces D-01..D-15:
   publisher must be an active human in the workspace; the target row is
   row-locked and tenant-scoped (unknown/cross-tenant id -> 404); the
   source state must be exactly `UNPUBLISHED+VERIFIED` (any other
   combination, including partial drift, fails closed, `409
   INCONSISTENT_BASIC_PRICE_STATE`); the ACCEPT decision's verifier account
   is traced deterministically; if that verifier account equals the
   publisher account, `409 VERIFIER_CANNOT_PUBLISH` and zero writes; else
   both axes are set to `PUBLISHED` atomically and exactly one
   `BasicPricePublicationAudit(action=PUBLISH)` row is written in the same
   transaction. Idempotent only at the `PUBLISHED+PUBLISHED` terminal state.
4. `BasicPriceEligibilityPolicy`'s two-axis predicate is unchanged — a row
   that completed step 3 is now genuinely, provably eligible
   (`publicEligibilityWhere()` matches it; `GET /basic-prices/:id` returns
   it; before step 3 it 404s).

## API / permission matrix

| Route | Method | Permission | New/changed |
|---|---|---|---|
| `/basic-price-reviews` | GET | `BASIC_PRICE_REVIEW_VIEW` | new |
| `/basic-price-reviews/:reviewId` | GET | `BASIC_PRICE_REVIEW_VIEW` | new |
| `/basic-price-reviews/:reviewId/accept` | POST | `BASIC_PRICE_VERIFY` | new |
| `/basic-price-reviews/:reviewId/reject` | POST | `BASIC_PRICE_VERIFY` | new |
| `/basic-price-reviews/:reviewId/request-correction` | POST | `BASIC_PRICE_VERIFY` | new |
| `/basic-price-reviews/:reviewId/reassign` | POST | `BASIC_PRICE_VERIFY` | new |
| `/basic-price-publications` | GET | `BASIC_PRICE_PUBLISH` | new |
| `/basic-price-publications/:basicPriceId/publish` | POST | `BASIC_PRICE_PUBLISH` | **replaces** `POST /basic-prices/:basicPriceId/publish` |

`decidedByUserId` / `publisherAccountId` / `workspaceId` / `organizationId`
are always server-resolved (JWT + `x-workspace-id` + DB lookups) — no DTO
in `backend/src/reality-intake/dto/price-submission-review-decision.dto.ts`
accepts any of them from the client.

## Breaking route change — caller audit

```text
OLD=POST /basic-prices/:id/publish   (BasicPricePublicationController, removed from basic-price-import.controller.ts)
NEW=POST /basic-price-publications/:basicPriceId/publish
```
`rg` across `frontend/src` for `/publish` and for any reference to
`basic-price-reviews`/`basic-price-publications`: **zero matches** — no
frontend caller existed for the old route and none was added for the new
ones (UI is explicitly D2A-2 scope). The only callers of the old route
anywhere in the repository were this backend's own e2e spec
(`basic-price-import.e2e-spec.ts`), updated in this same change (see
register below). No compatibility alias was added; the old route no
longer exists.

## Actor-separation proof

Three genuinely distinct, least-privilege human actors, proven via a live
`test:e2e:safe` run (`backend/test/acceptance/rm02d2a1-basic-price-lifecycle.e2e-spec.ts`):

```text
ACTOR_1 (assigned@test.local):    BASIC_PRICE_IMPORT, BASIC_PRICE_REVIEW_VIEW, BASIC_PRICE_RESOLVE, BASIC_PRICE_SUBMIT
ACTOR_2 (nonassigned@test.local): BASIC_PRICE_REVIEW_VIEW, BASIC_PRICE_VERIFY
ACTOR_3 (foreman@test.local):     BASIC_PRICE_PUBLISH, BASIC_PRICE_VIEW
ACTOR_BOTH (rm02d2a1-actor-both@test.local, fixture-only): BASIC_PRICE_REVIEW_VIEW, BASIC_PRICE_VERIFY, BASIC_PRICE_PUBLISH
```
No wildcard/admin/superuser role was used anywhere. The dedicated
`ACTOR_BOTH` fixture proves the D-08 case explicitly requested by the
prompt: a human holding **both** `BASIC_PRICE_VERIFY` and
`BASIC_PRICE_PUBLISH` (so the permission guard lets the HTTP call through)
is still refused by the service-level check when trying to publish a price
they personally verified (`409 VERIFIER_CANNOT_PUBLISH`, zero writes).

## Test commands and actual counts

```text
backend: npm run build                          -> PASS
backend: npx dotenv-cli -e .env.test -- npx prisma validate  -> PASS ("The schema ... is valid")
backend: npm test -- --runInBand                 -> 57 suites / 606 tests passed (baseline 573) — 0 failed
frontend: npm run build                          -> PASS
frontend: npm test -- --run                      -> 48/48 passed (baseline 48) — 0 failed
backend: npm run test:e2e:safe                   -> 32 suites / 362 tests passed (baseline 357) — 0 failed
                                                     RESIDUAL_RESULT: PASS — final simprok_e2e state matches the reset baseline byte-for-byte
repo: git diff --check                           -> PASS (no whitespace errors)
```

`prisma validate` loads `DATABASE_URL` from `.env.test` via `dotenv-cli`
into the subprocess environment only — its contents were never read or
printed to this session. `prisma validate` is a static schema check; it
opens no database connection (confirmed: it errors immediately if
`DATABASE_URL` is merely unset, with no network delay, and Prisma's own
documented behavior for this command is schema-file-only validation).

## Database write / connection counts

```text
SIMPROK_TEST_WRITE_COUNT=0
SIMPROK_DB_CONNECTION_COUNT=0
SIMPROK_DB_QUERY_COUNT=0
SIMPROK_DB_WRITE_COUNT=0
TARGET_BATCH_ID=1c9d66ff-76d1-4a01-bb19-ecb04dbe3763
TARGET_BATCH_MUTATION_COUNT=0
```
This session never opened a connection to `simprok_test` or `simprok_db`.
All executable proof (unit tests with mocked Prisma, and the safe E2E
suite) ran exclusively against `simprok_e2e`, which
`scripts/run-e2e-safe.ts` resets and reseeds from migrations + the
acceptance seed script before every run and fingerprints before/after
(`RESIDUAL_RESULT: PASS`). `rg` confirms the Owner's real batch UUID
(`1c9d66ff-76d1-4a01-bb19-ecb04dbe3763`) does not appear anywhere in any
file changed or added by this slice.

## Existing tests changed (CONTRACT_UPDATE register — complete)

| Path + test | Old expectation | New expectation | Owner Lock reason |
|---|---|---|---|
| `basic-price-import.service.spec.ts` — "creates exactly one PriceSubmission..." | No review-service interaction asserted | Asserts `PriceSubmissionReviewService.createReviewWithinTransaction` is called once, in the same `tx`, with the new submission | Work Package A: review creation moved into the same transaction as submit |
| `basic-price-publication.service.spec.ts` — entire suite | `publish(basicPriceId, actorAccountId)`, single-axis `status` write, no verifier trace | `publish({ workspaceId, basicPriceId, publisherAccountId })`, atomic two-axis write, D-01..D-15 (publisher-active, tenant-scoped, source-state, verifier-trace, separation-of-duties) | Work Package D: signature and semantics both changed per Owner Lock |
| `basic-price-import.e2e-spec.ts` — "submits every READY_FOR_SUBMISSION row..." | `submissions[0].status === 'SUBMITTED'`, 1 audit row | `submissions[0].status === 'UNDER_REVIEW'`, 2 audit rows, a `PriceSubmissionReview(slaState=OPEN)` exists | Work Package A: review now created synchronously with submit |
| `basic-price-import.e2e-spec.ts` — `describe('publication', ...)` (2 tests) | `POST /basic-prices/:id/publish`, no verifier-chain fixture, single-axis assertions | `POST /basic-price-publications/:id/publish`; full 4-test rewrite: not-yet-VERIFIED, no-evidence, same-verifier-409, different-publisher-succeeds-idempotent | Work Package D: breaking route change + D-01..D-15 contract |
| `basic-price-import.e2e-spec.ts` — `afterEach`/`afterAll` cleanup order | `priceSubmission.deleteMany` before `basicPrice.deleteMany` | `basicPrice.deleteMany` before `priceSubmission.deleteMany` | `BasicPrice.sourceSubmissionId -> PriceSubmission` FK now actually exercised by the new publication fixtures; old order would violate it |
| `reality-intake-price-submission-review.e2e-spec.ts` — "human ACCEPT resolves review..." | `.resolves.toMatchObject({ status: 'UNPUBLISHED' })` | `.resolves.toMatchObject({ status: 'ACCEPTED', priceSubmissionStatus: 'VERIFIED', basicPriceStatus: 'UNPUBLISHED', basicPriceVerificationStatus: 'VERIFIED', publiclyEligible: false })` | Work Package C: `status` field is now the decision outcome (consistent with reject/reassign), not an echo of the row's own status |
| `reality-intake-price-submission-review.e2e-spec.ts` — same test | `expect(submission.status).toBe('PUBLISHED')` | `expect(submission.status).toBe('VERIFIED')` | Legacy auto-publish writer removed (static-trace-confirmed, see above) |
| `reality-intake-price-submission-review.e2e-spec.ts` — same test | Asserted the `STEP-2.6b_BASIC_PRICE_ACTIVATED` audit row's exact shape | Asserts that audit is `null`, and that zero `BasicPricePublicationAudit` rows exist | Legacy auto-publish writer removed |
| `common/constants/permissions.spec.ts` | Imported `DECLARED_NOT_SEEDED_PERMISSION_CODES` | Imported `GOVERNED_ACTIVATION_PERMISSION_CODES` | Work Package E: renamed export, environment-agnostic semantics |

`EXISTING_TESTS_CHANGED_COUNT=8` (rows above; the permissions.spec.ts entry
is a mechanical rename with no behavior change). No test outside this
register was modified. No assertion was weakened, made generic, skipped,
retried-to-hide-a-race, or had its fixture altered to stop exercising a
negative path — every change above either tightens the assertion (checks
MORE than before: e.g. asserting the legacy audit is now absent) or
reflects a deliberate, Owner-Lock-mandated contract change.
`TEST_WEAKENING_OUTSIDE_REGISTER_COUNT=0`.

## New tests (separate from the register above)

- `basic-price-import.service.spec.ts`: "rolls back the whole submission
  when review creation fails."
- `basic-price-publication.service.spec.ts`: 11 new cases covering D-01,
  D-02/03, D-04/12 (both directions), D-07 (3 variants), D-08, D-13, and
  the publication queue.
- `reality-intake/price-submission-review.service.spec.ts`: new file, 19
  tests covering `createReviewWithinTransaction` idempotency,
  `acceptPriceSubmissionReview`'s honest UNPUBLISHED+VERIFIED contract and
  its idempotent/blocked-state behavior, reject/request-correction/reassign
  actionability and note requirements, `resolveActingUserId`, and
  `resolveOrganizationId`.
- `test/acceptance/rm02d2a1-basic-price-lifecycle.e2e-spec.ts`: new file,
  3 tests — unauthenticated 401s, the full three-actor happy path with an
  embedded negative matrix (403 x3, 404 cross-tenant, 409 invalid
  lifecycle, 409 same-actor-not-yet-applicable-here since Actor 2 lacks
  PUBLISH), and the dedicated D-08 same-human-both-permissions case.

## No frontend changes

`git diff --name-only` contains zero paths under `frontend/`. `rg` for
`/publish`, `basic-price-reviews`, `basic-price-publications` under
`frontend/src` returns zero matches. `FRONTEND_CHANGE_COUNT=0`.
`UI_IMPLEMENTATION=DEFERRED_TO_D2A-2`.

## Known open gates / debts

- `UTANG-TESTCRED-01` — OPEN, untouched by this slice (no `.env*` file was
  read or printed; `dotenv-cli` was used exactly as
  `database-role-guards.ts` already does).
- `UTANG-UI-MONEY-01` — OPEN, untouched (no frontend file changed).
- `UTANG-SNAPSHOT-02` — OPEN, untouched (no RAB/AHSP snapshot code touched).
- `UTANG-PERMISSION-DRIFT-03` — this slice's Work Package E changes
  `backend/src/common/constants/permissions.ts` so the catalog no longer
  claims a specific environment's DB seeding state (renamed
  `DECLARED_NOT_SEEDED_PERMISSION_CODES` -> `GOVERNED_ACTIVATION_PERMISSION_CODES`,
  rewrote every RM-02 catalog entry's `note` to be environment-agnostic).
  Per the closure condition stated in the governing prompt ("boleh CLOSED
  hanya jika source catalog menjadi environment-agnostic dan tidak lagi
  mengklaim keadaan DB runtime"), this condition is now met — see
  `docs/control/DEBT.md` for the closure entry.
- `RUNTIME_HUMAN_REVIEW_ENTRYPOINT` — was `MISSING` per the prior RM-02
  final exit-gate audit; is now `AVAILABLE` (Work Package B).
- `BLOCKER_RM02_PUBLICATION_ELIGIBILITY_01` — was `CONFIRMED`; the
  structural gap (publish never advancing `verificationStatus`) is closed
  by Work Package D's atomic two-axis write. Not yet exercised against the
  Owner's real 271-row batch — that is explicitly D2B scope.

## What this slice does NOT claim

- The Owner's real 271-row import batch (`1c9d66ff-76d1-4a01-bb19-ecb04dbe3763`)
  was not operated on in any way — 0 rows resolved, submitted, reviewed,
  or published by this slice. `TARGET_BATCH_MUTATION_COUNT=0`.
- `BASIC_PRICE_IMPORT_100_PERCENT=NO`. RM-02 is not 100% complete. This
  slice closes the backend runtime lifecycle machinery; a human still has
  to actually operate it against the real batch (identity review,
  submission, verification, publication) and the UI to do that from a
  browser is D2A-2/D2B scope, not built here.
- `RM02_EXIT_GATE=OPEN`.

Soli Deo Gloria. Haleluya. Amin.

---

# RM-02D2A-1-REMEDIATION-01-CONTINUATION

## Identity and disposition

```text
EXECUTION_SPEC_ID=RM02D2A-1-REMEDIATION-01-CONTINUATION-V1
BEFORE_SHA=99c50e449d929a39ae749e775dbaad172eed5970
AFTER_SHA=THIS_COMMIT (the immutable value is reported in Draft PR #55 and the execution report)
TARGET_PR=55
OWNER_LOCK_RM02D2A=PRESERVED
CORE_D2A1_REWRITTEN=NO
MERGE=NO
PRODUCTION_ACTIVATION=NO
```

The continuation preserved the dirty remediation work already present at
session start. It hardened the existing D2A-1 lifecycle; it did not create a
second lifecycle or publication endpoint.

## Gatekeeper remediation: before and after

| Finding | Before | After and proof |
|---|---|---|
| R-01 region provenance | ACCEPT could take `regionId` from caller params | ACCEPT DTO/controller no longer expose that parameter. The transaction rereads the tenant-scoped live submission and copies its exact `regionId`. Null region requires `explicitGeneralRegion=true`; a contradictory explicit-general choice is rejected before writes. Unit and safe-E2E provenance/zero-write cases pass. |
| R-01 effective-date provenance | Current revision used `effectiveDate ?? new Date()` | The live current revision is authoritative. No clock fallback remains. Missing current revision/effective date yields `EFFECTIVE_DATE_REQUIRED_BEFORE_ACCEPT` before writes. Unit and safe-E2E cases pass. |
| R-02 correction gate | `REQUEST_CORRECTION` left an OPEN review that ACCEPT could still use | Effective first ACCEPT now requires live `PriceSubmission.status=UNDER_REVIEW` inside the transaction. `NEEDS_CORRECTION` yields `CORRECTION_RESUBMISSION_REQUIRED`; persisted state proves zero ACCEPT/BasicPrice effects. |
| R-03 verifier evidence | Publication did not tenant-check every evidence hop | The publication transaction resolves target organization server-side, locks BasicPrice by workspace+organization, and validates source submission, review, exactly one ACCEPT, verifier User, exact membership, linked Account, workspace, organization, and active states. Missing/ambiguous/cross-tenant evidence yields `VERIFIER_EVIDENCE_MISSING` before either publication-axis write. |
| R-04 active humans | User ACTIVE was checked without the complete membership/account chain | The canonical review actor/assignee validator requires ACTIVE User, ACTIVE exact WorkspaceMembership in the target workspace, and ACTIVE linked Account. Publisher and historical verifier evidence use the corresponding exact tenant-linked chain. Negative unit/safe-E2E proof passes. |
| R-05 concurrency/rollback/forgery | Required persisted proofs were absent | Safe E2E now proves deterministic overlapping ACCEPT and publish, exactly-once effects, transaction rollback after an injected audit-create failure, authenticated actor dominance over forged body fields, and cross-tenant evidence rejection. |
| R-06 CI evidence | Initial SHA had no remote status | Remote checks/workflow runs are inspected only after push. Absence of an applicable run is reported as `NOT_RUN`, never PASS. |

`ACCEPT` still produces `BasicPrice=UNPUBLISHED+VERIFIED` and
`PriceSubmission=VERIFIED`. Only
`BasicPricePublicationService.publish()` writes
`BasicPrice=PUBLISHED+PUBLISHED`, atomically with one publication audit, and
the publisher must be a different human from the verifier.

## Live state, correction, and static trace

The ACCEPT transaction locks the exact tenant-scoped review, then rereads the
exact tenant-scoped submission and current revision. Review state, live
submission status, region decision, effective date, and idempotency evidence
are all validated before the first mutation.

Static tracing found only initial revision creation in
`business-subscription.service.ts` and `basic-price-import.service.ts`, and
only canonical review creation moves a submission to `UNDER_REVIEW`. No
writer implements a corrected revision/resubmission transition from
`NEEDS_CORRECTION` back to `UNDER_REVIEW`.

```text
CORRECTION_RESUBMISSION_ENTRYPOINT=ABSENT_DEFERRED
CORRECTION_DIRECT_ACCEPT=BLOCKED
CORRECTION_ROUND_TRIP_READY=NO
```

The production consumer scan found no consumer depending on
`PriceSubmission.status === 'PUBLISHED'`. The only hits were an explanatory
comment and negative test assertions that PriceSubmission never becomes
PUBLISHED. Static writer tracing found the one canonical two-axis BasicPrice
publication update in `basic-price-publication.service.ts`; unrelated
`publication-worker.service.ts` and constitutional-boundary occurrences use
different domain models and were not changed.

## Six previously failing safe-E2E cases

The initial continuation run was `356/362`, with six failures:

- four legacy publication fixtures omitted the now-required matching
  `BasicPrice.organizationId`;
- two legacy review fixtures remained `SUBMITTED` instead of the valid live
  `UNDER_REVIEW` state.

The fixtures were made lifecycle-valid without changing their assertions:
publication fixtures now carry the target organization, and reviewed
submissions enter `UNDER_REVIEW`. No guard was bypassed. A subsequent
`368/368` run exposed three suite-created permission residuals, which were
added to the suite's existing tracked cleanup. A later concurrency proof
showed both requests could miss genuine overlap; the test was hardened with a
test-only pre-lock barrier (no sleep/retry and no production flag). The final
safe-E2E run is `368/368`, residual PASS.

## Existing-test change register

| Path + test/setup | Old assertion/setup | New assertion/setup | Classification | TEST_WEAKENING |
|---|---|---|---|---|
| `basic-price-publication.service.spec.ts` — suite publisher/evidence fixtures | User-only/partial tenant fixtures | Exact organization, membership, Account, and pre-lock state fixtures; original outcomes retained | TEST_HARDENING | NO |
| `basic-price-publication.service.spec.ts` — idempotent terminal publish | Terminal replay fixture lacked pre-lock distinction | Terminal state exists both before and after lock; still returns the same BasicPrice with no duplicate audit | TEST_HARDENING | NO |
| `price-submission-review.service.spec.ts` — ACCEPT happy path fixture | Region could be null implicitly | Valid region is explicit; original UNPUBLISHED+VERIFIED assertions retained and provenance assertions added | TEST_HARDENING | NO |
| `price-submission-review.service.spec.ts` — repeated ACCEPT | Partial idempotency fixture | Exact ACCEPT+BasicPrice evidence and pre-lock state; same no-duplicate assertions retained | TEST_HARDENING | NO |
| `price-submission-review.service.spec.ts` — missing current revision | Generic missing-revision error | Deterministic `EFFECTIVE_DATE_REQUIRED_BEFORE_ACCEPT`, with zero writes | REMEDIATION_CONTRACT_UPDATE | NO |
| `price-submission-review.service.spec.ts` — acting user/reassign fixtures | Active User alone | Exact ACTIVE membership+Account chain; original authorized outcome retained | TEST_HARDENING | NO |
| `basic-price-import.e2e-spec.ts` — four publication cases | BasicPrice fixture omitted organization | Fixture uses the target workspace organization; every original HTTP/state assertion is unchanged | TEST_HARDENING | NO |
| `reality-intake-price-submission-review.e2e-spec.ts` — two review cases | Reviewed submission fixture stayed SUBMITTED | Fixture is lifecycle-valid UNDER_REVIEW; every original decision/state assertion is unchanged | TEST_HARDENING | NO |
| `rm02d2a1-basic-price-lifecycle.e2e-spec.ts` — full lifecycle | No forged actor/region fields or exact provenance assertion | Adds forged fields and proves authenticated actor plus submission region/current-revision date win | TEST_HARDENING | NO |
| `rm02d2a1-basic-price-lifecycle.e2e-spec.ts` — D-08 and cleanup setup | Fixture omitted required live state/region; three created permissions were not tracked | Valid UNDER_REVIEW/region fixture and permission IDs tracked for cleanup; D-08 separation assertions retained | TEST_HARDENING | NO |

```text
EXISTING_TESTS_CHANGED_COUNT=10
EXISTING_TESTS_CHANGE_REGISTER=COMPLETE
TEST_WEAKENING_COUNT=0
TEST_SKIP_TODO_ONLY_COUNT=0
```

## New tests

Fifteen new backend unit tests cover authoritative region/date, both
explicit-general branches, missing provenance, correction zero-write,
inactive actor/assignee membership and Account, tenant-safe submission and
verifier evidence, inactive verifier membership/Account, and publication
audit failure propagation.

Six new safe-E2E tests cover:

1. concurrent ACCEPT: one success, one deterministic conflict, one ACCEPT
   decision, one BasicPrice, and one human verification audit;
2. concurrent publish: one success, one deterministic conflict, final
   PUBLISHED+PUBLISHED, and one publication audit;
3. persisted audit-failure rollback using a test-only transaction-client
   Proxy that throws only on `BasicPricePublicationAudit.create`, followed by
   an independent database reread proving UNPUBLISHED+VERIFIED and zero audit;
4. REQUEST_CORRECTION followed by direct ACCEPT, with NEEDS_CORRECTION and
   zero ACCEPT/BasicPrice effects;
5. missing authoritative region/effective date, both zero-write;
6. deterministic cross-tenant verifier evidence, with unchanged publication
   axes and zero publication audit.

The existing full-lifecycle test additionally proves forged actor/region
fields cannot control persisted identity or provenance.

```text
NEW_TESTS_ADDED_COUNT=21
CONCURRENT_ACCEPT_DECISION_COUNT=1
CONCURRENT_ACCEPT_BASIC_PRICE_COUNT=1
CONCURRENT_ACCEPT_VERIFY_AUDIT_COUNT=1
CONCURRENT_PUBLISH_AUDIT_COUNT=1
PUBLICATION_STATE_AFTER_FORCED_AUDIT_FAILURE=UNPUBLISHED+VERIFIED
```

## Local quality gates

```text
backend: npm run build                                      -> PASS
backend: npm test -- --runInBand                           -> PASS (57 suites, 621/621)
backend: npx dotenv-cli -e .env.test -- npx prisma validate -> PASS
frontend: npm run build                                     -> PASS
frontend: npm test -- --runInBand                           -> PASS (48/48)
backend: npm run test:e2e:safe                              -> PASS (32 suites, 368/368; RESIDUAL_RESULT=PASS)
repo: git diff --check                                      -> PASS
```

The backend build and frontend build provide the repository's non-mutating
typecheck gates. The backend's configured `lint` script uses forbidden
`--fix`, so it was not run. A direct non-mutating full-repo ESLint diagnostic
failed on thousands of baseline style/unsafe-any findings; a changed-file
diagnostic likewise reported 793 findings (719 errors, 74 warnings), mostly
Prettier and established test/controller `any` patterns. No broad formatting
or lint rewrite was applied because that would violate the bounded remediation
surface. This diagnostic is reported as baseline debt, not misreported PASS.

## Scope and data-safety evidence

```text
FRONTEND_CHANGE_COUNT=0
PRISMA_SCHEMA_CHANGE_COUNT=0
MIGRATION_CHANGE_COUNT=0
OLD_MIGRATIONS_CHANGED=NO
DEPENDENCY_CHANGE_COUNT=0
WORKFLOW_CHANGE_COUNT=0
TARGET_BATCH_ID=1c9d66ff-76d1-4a01-bb19-ecb04dbe3763
TARGET_BATCH_MUTATION_COUNT=0
SIMPROK_TEST_BUSINESS_DATA_MUTATION=0
SIMPROK_DB_CONNECTION_COUNT=0
SIMPROK_DB_QUERY_COUNT=0
SIMPROK_DB_WRITE_COUNT=0
SECRET_EXPOSURE_COUNT=0
```

The target UUID has zero hits under `backend/src` and `backend/test`. All
mutating proof ran only through the official guarded safe-E2E runner against
`simprok_e2e`; its database-name guard and residual fingerprint passed. No
`.env*` content, connection string, credential, or secret was read or printed.

## Residual gates and debts

- `CORRECTION_RESUBMISSION_ENTRYPOINT=ABSENT_DEFERRED`; direct ACCEPT is
  closed, but the correction round trip is not claimed ready.
- `UTANG-TESTCRED-01=OPEN`.
- `UTANG-UI-MONEY-01=OPEN`.
- `UTANG-SNAPSHOT-02=OPEN`.
- `D2A2_UI=HOLD_PENDING_REAUDIT`.
- `RM02_EXIT_GATE=OPEN`.
- `RM04_LINKAGE=BLOCKED_BY_OPERATIONS`.
- `TARGET_BATCH_271=UNTOUCHED`.
- `MERGE=NO`.

Soli Deo Gloria. Haleluya. Amin.
