# RM-02D2A2 Contract Inventory

```text
EXECUTION_SPEC_ID=RM02D2A2-BASIC-PRICE-REVIEW-PUBLICATION-UI-V2
SOURCE_SHA=fb7f89aaa6d2de9418c4839e0d957402db02fc2b
INVENTORY_BASIS=BYTE_ACTUAL_AT_SOURCE_SHA
BACKEND_CHANGE=NO
FABRICATED_DATA=NO
CONTRACT_GAP=YES
D2A2_CODING=NO
STOP_AND_REPORT=YES
```

## Backend symbols and route contracts

All routes use `JwtAuthGuard` and `PermissionsGuard`. The latter resolves the
workspace from `x-workspace-id`, requires an active workspace membership, and
returns 403 for a missing account context, inaccessible workspace, or missing
permission. A missing workspace header is 400. Authentication failure is 401.

### Human review

Source:

- `backend/src/reality-intake/basic-price-review.controller.ts`
  (`BasicPriceReviewController`)
- `backend/src/reality-intake/price-submission-review.service.ts`
  (`PriceSubmissionReviewService`)
- `backend/src/reality-intake/dto/price-submission-review-decision.dto.ts`
- `backend/prisma/schema.prisma`

| Method and path | Permission | Query/body | Actual success response |
| --- | --- | --- | --- |
| `GET /basic-price-reviews` | `BASIC_PRICE_REVIEW_VIEW` | Optional query `slaState`; controller types it as `ReviewSlaState`, but no explicit DTO validator is attached | Bare array from `priceSubmissionReview.findMany()`. Each row has `id`, `priceSubmissionId`, `workspaceId`, `organizationId`, `slaState`, `openedAt`, nullable `escalatedAt`, `expiredAt`, `resolvedAt`, nullable `assignedToUserId`, `createdAt`, and `updatedAt`. It does not include the submission or resource relation. |
| `GET /basic-price-reviews/:reviewId` | `BASIC_PRICE_REVIEW_VIEW` | UUID-like route string; no route DTO validation | One review row plus `submission`, where submission includes all scalar `PriceSubmission` fields and a `revisions` array. No `resource`, `region`, assigned-user, or decision relation is included. Cross-tenant/missing review is 404 `Price submission review not found`. |
| `POST /basic-price-reviews/:reviewId/accept` | `BASIC_PRICE_VERIFY` | `AcceptPriceSubmissionReviewDto`: optional boolean `explicitGeneralRegion`; optional string `note` | `{ processed, reviewId, priceSubmissionId, decisionId, basicPriceId, status, priceSubmissionStatus, basicPriceStatus, basicPriceVerificationStatus, publiclyEligible }`. A new accept produces `ACCEPTED`, `VERIFIED`, `UNPUBLISHED`, `VERIFIED`, and `false`. It does not call publication. |
| `POST /basic-price-reviews/:reviewId/reject` | `BASIC_PRICE_VERIFY` | `RejectPriceSubmissionReviewDto`: required string `note`, `MinLength(1)`; service also trims and rejects empty notes | `{ processed, reviewId, priceSubmissionId, decisionId, status: "REJECTED" }` |
| `POST /basic-price-reviews/:reviewId/reassign` | `BASIC_PRICE_VERIFY` | `ReassignPriceSubmissionReviewDto`: optional UUID `assignedToUserId`; optional string `note` | `{ processed, reviewId, decisionId, status: "REASSIGNED" }` |

Review/SLA enum values from the schema are `OPEN`, `ESCALATED`, `EXPIRED`, and
`RESOLVED`. Service transition guards allow decisions only while the live state
is not `RESOLVED` or `EXPIRED`; therefore only `OPEN` and `ESCALATED` are
actionable.

The current revision is identified by `submission.currentRevisionId`; revision
fields are `id`, `submissionId`, integer `revisionNumber`, `value` (`Decimal(18,
2)`), nullable `effectiveDate`, nullable `validUntil`, nullable `photoUrl`,
nullable `gpsLat`/`gpsLng`, nullable `note`, `validationPassed`,
`validationMessage`, and `createdAt`.

Accept transition conflicts (409) include
`ACCEPT_CONCURRENTLY_COMPLETED`,
`ACCEPT_IDEMPOTENCY_EVIDENCE_INCONSISTENT`,
`CORRECTION_RESUBMISSION_REQUIRED`, `SUBMISSION_NOT_UNDER_REVIEW`,
`REVIEW_NOT_ACTIONABLE`, `EFFECTIVE_DATE_REQUIRED_BEFORE_ACCEPT`,
`REGION_DECISION_CONFLICT`, and
`REGION_REQUIRED_OR_EXPLICIT_GENERAL_REGION`. Tenant mismatch/missing records
produce 404. Permission failures produce 403.

Reject requires a nonblank note and can return 409 `DECISION_NOTE_REQUIRED` or
`REVIEW_NOT_ACTIONABLE`; tenant mismatch/missing records produce 404.

Reassign can return 409 `REVIEW_NOT_ACTIONABLE` and 404 `Reviewer not found`.
The backend verifies an assigned user as an active User connected to an active
workspace membership and active Account.

### Request correction (inventory only; forbidden in D2A2 UI)

`POST /basic-price-reviews/:reviewId/request-correction` exists on the backend
and requires `BASIC_PRICE_VERIFY` plus a nonblank note. It moves the submission
to `NEEDS_CORRECTION` without resolving the review. No resubmission controller
path from `NEEDS_CORRECTION` back to an accept-ready state exists on this SHA.

```text
REQUEST_CORRECTION_ALLOWED_IN_D2A2=NO
REQUEST_CORRECTION_API_WRAPPER=ABSENT_AT_BASELINE_FRONTEND
REQUEST_CORRECTION_ONCLICK_HANDLER=ABSENT_AT_BASELINE_FRONTEND
```

### Publication

Source:

- `backend/src/basic-price/basic-price-publication.controller.ts`
  (`BasicPricePublicationController`)
- `backend/src/basic-price/basic-price-publication.service.ts`
  (`BasicPricePublicationService`)
- `backend/prisma/schema.prisma`

| Method and path | Permission | Query/body | Actual success response |
| --- | --- | --- | --- |
| `GET /basic-price-publications` | `BASIC_PRICE_PUBLISH` | None | Bare array from `basicPrice.findMany()` restricted to `workspaceId`, `status: "UNPUBLISHED"`, and `verificationStatus: "VERIFIED"`. Each row has all scalar `BasicPrice` fields, but no `resource`, `region`, source-submission, verifier, or publication-audit relation. |
| `POST /basic-price-publications/:basicPriceId/publish` | `BASIC_PRICE_PUBLISH` | No body | The updated bare `BasicPrice` row. The only allowed source axes are `UNPUBLISHED+VERIFIED`; success atomically writes `PUBLISHED+PUBLISHED`. |

Publication failures include:

- 403 `PUBLISHER_NOT_ACTIVE_IN_WORKSPACE`;
- 404 `Workspace not found` or `BasicPrice not found`;
- 409 `PUBLISH_ACTOR_REQUIRED`, `PUBLICATION_CONCURRENTLY_COMPLETED`,
  `INCONSISTENT_BASIC_PRICE_STATE`, `VERIFIER_EVIDENCE_MISSING`, or
  `VERIFIER_CANNOT_PUBLISH`.

`BasicPrice.value` is declared as Prisma `Decimal(18, 2)`. The controller
returns the Prisma object directly. No application serializer/interceptor and
no E2E assertion on the JSON type or exact textual preservation of `value` was
found on the source SHA. Consequently this inventory cannot prove from the
current byte/test contract that the HTTP JSON field is always a decimal string.

The old `POST /basic-prices/:id/publish` controller route is absent. The only
production publish controller path is
`POST /basic-price-publications/:basicPriceId/publish`.

## Active-human reviewer lookup

No tenant-scoped endpoint that lists/searches active reviewer candidates was
found. `workspace-membership` list methods are scoped to the authenticated
Account rather than listing other active humans in the workspace. A
`GET /workspace-membership/user/:userId` lookup requires a pre-existing raw
user ID and only exposes a membership belonging to the authenticated Account.
It is not a safe reviewer selector.

Therefore reassign cannot expose a live selector or raw UUID input in D2A2.

## Safety-critical gap

The detail endpoint exposes `submission.resourceId`, and the publication queue
exposes `basicPrice.resourceId`, but neither response includes a human-readable
resource code/name or the `ResourceCatalog` relation. A UUID alone is not
sufficient resource identity for a human to safely verify or publish a price.
The responses likewise expose only `regionId`, not a region name; this is a
display omission when a non-null region is already authoritative, but it
further limits human-readable provenance.

The exact-money requirement is also not locked by the HTTP contract: source
declares Prisma Decimal, but the current API tests do not prove that JSON
serialization returns a string and preserves its exact textual representation.

These are safety-critical rather than decorative omissions. The V2 prompt
forbids a backend change and requires stopping when such a contract is absent.
No UI source implementation or frontend API wrapper may be created under this
inventory.

```text
RESOURCE_HUMAN_READABLE_IDENTITY=ABSENT
REGION_HUMAN_READABLE_NAME=ABSENT
ACTIVE_REVIEWER_SELECTOR=ABSENT
PRICE_JSON_STRING_CONTRACT=NOT_PROVEN
DISPLAY_FIELD_OMITTED=REGION_NAME
CONTRACT_GAP=YES
BACKEND_CHANGE=NO
FABRICATED_DATA=NO
D2A2_CODING=NO
STOP_AND_REPORT=YES
```

---

## RM02D2A2 V2 — re-implementation status (this branch)

Everything above is the byte-accurate BASELINE at the parent SHA
(`fb7f89aaa6d2de9418c4839e0d957402db02fc2b`). Under the V2 execution
(`RM02D2A2-REIMPLEMENTATION-FROM-LOCKED-CONTRACT-V2`) the contract gaps it
documented are now CLOSED in source on
`feat/rm02d2a2-basic-price-review-publication-ui`. This is a fresh
re-implementation from the locked contract — NOT a byte recovery of any old
SHA. Only statuses actually exercised by an available gate are marked proven;
browser and safe-E2E proof are held for Owner local acceptance.

```text
CONTRACT_GAP_AT_PARENT=YES
PARENT_D2A2_CODING=NO
REIMPLEMENTATION_FROM_LOCKED_CONTRACT=YES
OLD_REPORTED_SHA_RECOVERED=NO
BYTE_EQUIVALENCE_TO_OLD_SHA=NOT_CLAIMED

SCHEMA_CHANGE=NO
MIGRATION_CHANGE=NO

# Closed in source and proven by available (non-browser) unit gates:
RESOURCE_HUMAN_READABLE_IDENTITY=IMPLEMENTED_UNIT_PROVEN
REGION_HUMAN_READABLE_NAME=IMPLEMENTED_UNIT_PROVEN
ACTIVE_REVIEWER_SELECTOR=IMPLEMENTED_UNIT_PROVEN
EXACT_DECIMAL_STRING_TWO_DIGITS=IMPLEMENTED_UNIT_PROVEN

# Real source, build green, pure-helper unit tests — NOT browser-proven:
REVIEW_UI=IMPLEMENTED_SOURCE_BUILD_GREEN
PUBLICATION_UI=IMPLEMENTED_SOURCE_BUILD_GREEN

# Deliberately absent (resubmission path unapproved/untested):
REQUEST_CORRECTION_UI=ABSENT_BY_DESIGN

# Held for Owner local acceptance:
SAFE_E2E=HOLD_MISSING_SAFE_LOCAL_ENV
BROWSER_THREE_ACTOR_JOURNEY=HOLD_FOR_OWNER_LOCAL_ACCEPTANCE

MERGE=NO
PRODUCTION_ACTIVATION=NO
```

### Contracts closed in source

- **Resource human-readable identity** (code/name/type) — projected in the
  review queue, review detail, and publication queue; backend + frontend unit
  tests.
- **Region human-readable name** (`code — name`) — projections, new
  `GET /basic-price-import-lookups/regions`, and the import Region selector
  (the raw-UUID text field is removed); unit tests.
- **Active reviewer selector** — new
  `GET /basic-price-reviews/reviewer-candidates` restricted to the active
  User→Membership→Account chain, tenant-scoped from server context; reassign
  selector; cross-tenant / inactive-Account / inactive-membership /
  inactive-User / dangling negative unit tests.
- **Exact two-digit decimal price string** — `toDecimalString2` (backend) and
  the reused string-based `formatBackendRupiah` (frontend); no
  `Number`/`parseFloat`/float math; backend + frontend unit tests (including a
  beyond-IEEE-754 case).
- **Review & publication UI** — real pages with honest LOADING / EMPTY /
  FORBIDDEN / NOT_FOUND / CONFLICT / SERVER_ERROR / SUCCESS states; a success
  message is sticky across refetch.

### Deliberately still ABSENT

- request-correction UI / button / frontend API wrapper / menu — the backend
  route is untouched and NOT exposed to any user journey.

---

## RM02D2A2-REMEDIATION-01-V2.1-FINAL — Basic Price product mental model

Owner Lock (this remediation, implemented in source on the same branch,
commits `c0ace38` (Checkpoint 1) → `dab91cf` (Cowork remediation) →
`9ad1813` (Checkpoint 2)):

```text
PRIMARY_BASIC_PRICE_DOOR=EXPLORER
SECONDARY_BASIC_PRICE_DOOR=IMPORT_CONTRIBUTION
REVIEW_PUBLICATION_MAIN_SIDEBAR=ABSENT
MANAGEMENT_WORKFLOW=PERMISSION_GATED_SECONDARY_AREA

PUBLIC_API_CANONICAL_ROUTE=GET_/basic-prices
PARALLEL_EXPLORER_ENDPOINT=NO
PUBLIC_ELIGIBILITY=PUBLISHED_PLUS_PUBLISHED (unchanged, byte-identical
  basic-price-eligibility.policy.ts — confirmed via `git show` diff, empty)
CROSS_TENANT_PRIVATE_PRICE_LEAK_COUNT=0
DECIMAL_STRING_TWO_DIGITS=IMPLEMENTED_UNIT_PROVEN
SOURCE_NAME_HONESTY=IMPLEMENTED_UNIT_PROVEN (null when provenance absent;
  blank/whitespace-only stored name also treated as absent, never "")
EXPECTED_CURRENT_EXPLORER_STATE=UNVERIFIED_NO_LOCAL_DB (no simprok_test/
  simprok_e2e connection available in this worktree; not assumed either way)

BASIC_PRICE_VIEW_E2E_FIXTURE=REUSED_EXISTING (no new fixture-only grant
  needed — new Explorer/lookup e2e assertions reuse the existing
  BASIC_PRICE_VIEW-holding tokenA fixture already present in
  basic-price.e2e-spec.ts)
PERSISTENT_ACCEPTANCE_BASIC_PRICE_VIEW_ACTIVATION=NOT_PERFORMED (separate
  Owner gate, unchanged)
PRODUCTION_PERMISSION_SEED_CHANGE=NO

VIEW_ONLY_REVIEW_MODE=IMPLEMENTED_SOURCE_BUILD_GREEN (BasicPriceReviewDetailPage:
  accept/reject/reassign controls hidden without BASIC_PRICE_VERIFY; honest
  "Anda memiliki akses melihat, tetapi tidak memiliki kewenangan memutuskan
  review ini." message shown instead)
VERIFY_ACTION_MODE=IMPLEMENTED_SOURCE_BUILD_GREEN
REVIEWER_ENDPOINT_VIEW_ONLY_NETWORK_CALL_COUNT=0 (ReviewerSearchSelect is
  nested inside the BASIC_PRICE_VERIFY-gated block, never mounted for a
  view-only actor, so it is structurally incapable of calling
  reviewer-candidates)

DIRECT_URL_NEGATIVE_MATRIX (rm02d2a1-basic-price-lifecycle.e2e-spec.ts,
  reusing the existing three-actor safe-E2E fixture, source-only — not
  executed here, no local DB):
  VERIFY_WITHOUT_REVIEW_VIEW_LIST=403 (new dedicated actor)
  VERIFY_WITHOUT_REVIEW_VIEW_DETAIL=403 (new dedicated actor)
  REVIEW_VIEW_WITHOUT_VERIFY_REVIEWER_CANDIDATES=403 (existing Actor 1)
  NO_PUBLISH_PERMISSION_QUEUE_AND_PUBLISH=403 (existing Actor 1 + Actor 2)
  NO_IMPORT_PERMISSION=403 (pre-existing test, basic-price-import.e2e-spec.ts)
  EXPLORER_CROSS_TENANT=0 (basic-price.e2e-spec.ts, existing + extended)

COWORK_PRODUCT_REVIEW=REVISI_THEN_FIXED (1 blocker: Color Lock violation —
  Explorer price cards/empty-states used the critical-red
  .simprok-rab-validation-alert with a nonexistent --info modifier; fixed
  to the neutral .simprok-rab-card. Non-blocking sharpenings also applied:
  stale-page dead-end fallback, year input min/max, removed dead
  EXPLORER_DEFAULT_FILTERS constant and pass-through label wrappers, fixed
  doubled "Sumber:" copy. NOT fixed, disclosed as pre-existing debt outside
  this bounded slice: the identical red-box misuse already present in
  BasicPriceReviewQueuePage/BasicPricePublicationQueuePage/
  BasicPriceImportPage/RabWorkspacePage predates this branch; the
  ExplorerRegionFilterSelect/RegionSearchSelect near-duplication is
  intentional — reusing RegionSearchSelect would call the
  BASIC_PRICE_IMPORT-gated lookup for Explorer viewers who may lack that
  permission; unstyled filter <input>/<select> elements would require
  editing the protected frontend/src/index.css.)
COWORK_SECURITY_REVIEW=PASS_WITH_CONDITIONS_THEN_FIXED (0 blockers. Two
  sharpenings fixed: class-validator's IsISO8601 accepted a
  calendar-invalid date that JS Date silently rolls forward, and an
  ISO8601 "basic format" string JS Date cannot parse — both independently
  reproduced by this executor via `node -e` against the installed
  class-validator, then closed with `{strict:true}` at the DTO plus an
  explicit isNaN(getTime()) guard in the service, both failing closed with
  400. Two sharpenings NOT fixed, disclosed as pre-existing/out-of-bounded-
  scope: global ValidationPipe lacks whitelist/forbidNonWhitelisted
  (app-wide config, reviewer confirmed harmless here); GET /basic-prices/:id
  has no ParseUUIDPipe, pre-existing on a route this slice did not create.)
REMEDIATION_LOOP_COUNT=1 (of maximum 2 authorized)

SAFE_E2E=HOLD_MISSING_SAFE_LOCAL_ENV (only .env.test.example present in
  this worktree; no .env.e2e, no .env.test — SAFE_E2E_PASS_CLAIM=NO)
BROWSER_ACCEPTANCE=HOLD_FOR_OWNER_LOCAL_ACCEPTANCE

MERGE=NO
PRODUCTION_ACTIVATION=NO
```

---

## RM02D2A2-REMEDIATION-02-V2.3-FINAL — date-only semantics + unified capability-aware space

Commits `81f2f51` (Checkpoint 1) → `f8c08d1` (Cowork remediation), on top of
`ae29af7` above.

```text
DATE_ONLY_FORMAT=YYYY-MM-DD (exact regex + year/month/day round-trip,
  backend/src/common/date-only.util.ts — new, reusable)
DATE_FROM_SEMANTICS=INCLUSIVE_UTC_DAY_START
DATE_TO_SEMANTICS=EXCLUSIVE_NEXT_UTC_DAY_START (was a real bug: the prior
  slice's `lte` on a midnight instant silently excluded any non-midnight
  time on the dateTo day itself — BasicPrice.effectiveDate is a
  DateTime(3) column, not a bare date, so this was reachable in practice.
  Confirmed by an e2e fixture at 2026-06-01T18:30:00Z that the OLD code
  would have excluded and the fix includes.)

BASIC_PRICE_DOOR_VISIBILITY=VISIBLE_WITH_VIEW_OR_IMPORT_OR_REVIEW_VIEW_OR_PUBLISH
  (BASIC_PRICE_VERIFY alone insufficient — not one of the view-model's
  four capability inputs)
CAPABILITY_AWARE_BASIC_PRICE_SPACE=IMPLEMENTED (BasicPriceSpaceRoute +
  BasicPriceSpacePage; Explorer for BASIC_PRICE_VIEW holders, a
  permission-aware capability landing — only the actor's own sanctioned
  doors, no Explorer, no GET /basic-prices call — for everyone else)
SIDEBAR_FILTER_SCOPE=BASIC_PRICE_ITEM_ONLY (diff-verified: navItems array
  itself has zero added/removed lines; only the render-time filter and the
  Basic Price item's routeLabel changed)

EXPLORER_REQUIRES_VIEW=YES
IMPORT_DOOR_REQUIRES_IMPORT=YES
REVIEW_DOOR_REQUIRES_REVIEW_VIEW=YES
PUBLICATION_DOOR_REQUIRES_PUBLISH=YES

PROOF_MODE=PRODUCTION_USED_VIEW_MODEL
JSX_RENDER_PROOF=HOLD_FOR_OWNER_BROWSER (no JSX/DOM render harness in this
  repo's current node --test infrastructure; not added, per bounded scope)
STRUCTURAL_COMPONENT_USAGE_PROOF=AVAILABLE (computeBasicPriceSpaceViewModel
  called from ProtectedRoute.tsx, Sidebar.tsx, BasicPriceSpacePage.tsx,
  BasicPriceExplorerPage.tsx; computeReviewActionViewModel called from
  BasicPriceReviewDetailPage.tsx — confirmed by grep, not by trusting a
  comment)

WITHOUT_VIEW_EXPLORER_RENDERED=NO (BasicPriceSpacePage branches on
  mayReachExplorerFetch before ever importing/mounting
  BasicPriceExplorerPage; that import exists in exactly one file)
WITHOUT_VIEW_EXPLORER_FETCH_STRUCTURALLY_REACHABLE=NO

VIEW_ONLY_REVIEW_MODE=UNCHANGED_FROM_PRIOR_REMEDIATION (now sourced from
  reviewActionViewModel instead of inline branching)
VIEW_ONLY_REVIEWER_COMPONENT_MOUNTED=NO
VIEW_ONLY_REVIEWER_CALL_STRUCTURALLY_REACHABLE=NO
RUNTIME_REVIEWER_NETWORK_PROOF=HOLD_FOR_SAFE_E2E_OR_OWNER_BROWSER

ACCEPT_COLOR_LOCK=FIXED (was .simprok-rab-validation-alert, critical-red;
  now .simprok-rab-card, neutral engineering-blue-bordered)
REJECT_COLOR_LOCK=UNCHANGED_CORRECT (critical-red permitted for rejection)
REASSIGN_COLOR_LOCK=FIXED (same swap as Accept)
VIEW_ONLY_MESSAGE_COLOR_LOCK=UNCHANGED_CORRECT (already neutral
  .simprok-rab-card since the prior remediation)

SOURCE_FAMILY_MAP=LOCKED_EXISTING (docs/project-memory/
  SIMPROK_BASIC_PRICE_AHSP_IMPLEMENTATION_BLUEPRINT.md §5/§6.5 — PEMERINTAH/
  TOKO_SUPPLIER/USULAN_USER families, "Harga Pemerintah"/"Harga Toko,
  Supplier"/"Harga Lapangan" public labels; unratified project-memory, not
  DECISIONS.md-locked, but not contradicted or re-guessed by this slice —
  no source-family mapping code was touched)
SOURCE_REPORTER_SEPARATION=PRESERVED (no import/reporting write-path
  touched this slice)
SOURCE_EVIDENCE_POLICY=NON_REGRESSION_ONLY (untouched)

PRIVATE_BASIC_PRICE_OWNER_PRINCIPLE=PRESERVED (docs/control/DECISIONS.md,
  "Basic Price Parallel Curation Pattern", BELUM_DIRATIFIKASI — this
  slice's new capability-landing copy was checked and makes no claim that
  Basic Price must be published before use)
PRIVATE_BASIC_PRICE_IMPLEMENTATION=NOT_IN_THIS_SLICE

OTHER_NAV_ITEM_CHANGE_COUNT=0 (verified: Sidebar.tsx's navItems array has
  zero added/removed lines in this slice's diff)

COWORK_PRODUCT_REVIEW=PASS (0 blockers; 5 sharpenings — 4 fixed:
  mayReachExplorerFetch now the actual gate, shared AccessDeniedPanel
  replacing duplicated Access-Denied JSX incl. an off-palette #dc2626,
  capability-neutral Sidebar tooltip, icons on landing doors. 1 deferred:
  the pre-existing publication-centric Explorer empty-state copy predates
  this slice.)
COWORK_SECURITY_REVIEW=PASS_WITH_CONDITIONS (0 blockers; re-derived the
  date round-trip logic independently via `node -e` against the actual
  parseDateOnlyUtc/nextUtcDayStart code, ran both executable spec files for
  real — 50/50 backend, 94/94 frontend — confirmed zero backend
  @Permissions/@UseGuards diff, zero schema/migration/seed/dependency
  change. 3 sharpenings — 1 fixed: the same-day e2e test's fixture was at
  exact midnight and did not actually discriminate the bug, now uses a
  dedicated non-midnight fixture. 2 disclosed, not fixed: pre-existing tsc
  errors in 6 untouched files; a second hardcoded #dc2626 the product
  reviewer's fix already closed in the same remediation commit.)
REMEDIATION_LOOP_COUNT=1 (of maximum 2 authorized)

SAFE_E2E=HOLD_MISSING_SAFE_LOCAL_ENV (unchanged — still no .env.e2e/
  .env.test in this worktree)
BROWSER_ACCEPTANCE=HOLD_FOR_OWNER_LOCAL_ACCEPTANCE
MERGE_READY=NO
PRODUCT_LIVE=NO
```

