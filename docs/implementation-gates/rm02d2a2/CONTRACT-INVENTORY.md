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
```
