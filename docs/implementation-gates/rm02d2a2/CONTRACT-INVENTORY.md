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

WITHOUT_VIEW_EXPLORER_COMPONENT_IMPORTED_STATICALLY=YES (BasicPriceSpacePage
  statically imports BasicPriceExplorerPage — that import exists in exactly
  one file)
WITHOUT_VIEW_EXPLORER_COMPONENT_MOUNTED=NO (BasicPriceSpacePage branches on
  mayReachExplorerFetch before ever mounting it — a static import is not a
  mount)
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

SOURCE_FAMILY_MAP=OWNER_LOCKED_FOR_CURRENT_SCOPE (docs/project-memory/
  SIMPROK_BASIC_PRICE_AHSP_IMPLEMENTATION_BLUEPRINT.md §5/§6.5 — PEMERINTAH/
  TOKO_SUPPLIER/USULAN_USER families, "Harga Pemerintah"/"Harga Toko,
  Supplier"/"Harga Lapangan" public labels — governing this slice's own
  prompt as the Owner-supplied mapping for THIS scope, not re-guessed or
  contradicted; no source-family mapping code was touched)
CANONICAL_REPOSITORY_RATIFICATION=PENDING (this project-memory blueprint is
  not registered in docs/control/DECISIONS.md as an OD-xx/AD-xx; canonical
  ratification is a separate, future decision — not claimed here)
SOURCE_MAPPING_CODE_CHANGE=NO
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

## RM02D2A2-REMEDIATION-03-FINAL — ONE SIMPROK BASIC PRICE PRODUCT MODEL

```
EXECUTION_SPEC_ID=RM02D2A2-REMEDIATION-03-FINAL
OWNER_DECISION=docs/control/DECISIONS.md AD-RM02D2A2-01
ROOT_CAUSE_CORRECTED=PM/reviewer treated Basic Price as a role/permission
  -dependent capability space instead of one universal product

CHECKPOINT_1_COMMIT=90732dc21e03042d279d670fdf74ffb0b0d4f002
  (align basic price access and import ownership)
CHECKPOINT_2_COMMIT=a95c42fe165ee7b6a366d2398b1c193df0e91a0a
  (restore the owner basic price product model)
BASE_HEAD_SHA=922bde84f6512f654dd89e72f6a9c173276db4fa

ACTIVE_MEMBERSHIP_BASELINE_CAPABILITIES=BASIC_PRICE_VIEW,BASIC_PRICE_IMPORT,
  BASIC_PRICE_RESOLVE,BASIC_PRICE_SUBMIT (granted structurally by
  WorkspacePermissionResolverService.resolve() to every ACTIVE
  WorkspaceMembership; no role-by-role/email-literal grant; unioned with
  role-derived permissions, unique+sorted)
INTERNAL_CAPABILITIES_NOT_BASELINE=BASIC_PRICE_REVIEW_VIEW,BASIC_PRICE_VERIFY,
  BASIC_PRICE_PUBLISH (unchanged: governed/role-granted only)
PERMISSION_SEED_CHANGE=NO
SCHEMA_CHANGE=NO
MIGRATION_CHANGE=NO

USER_OWNED_IMPORT_BOUNDARY=ENFORCED via
  basic-price-import-ownership.util.ts (assertBatchOwnedByCaller), applied
  in getBatch/updateBatchMetadata/submitBatch
  (basic-price-import.service.ts), assertBatchRowMutable
  (basic-price-row-resolution.service.ts, shared by resolveRow/rejectRow),
  and findCandidatesForRow (basic-price-row-mapping-candidates.service.ts).
  Fails closed as the same 404 "Batch/Row not found" already used for a
  workspace mismatch — ownership denial is never distinguishable from
  non-existence.
IMPORT_PERMISSION_CODE_CORRECTION=basic-price-import.controller.ts GET
  :batchId and GET rows/:rowId/candidates moved from BASIC_PRICE_REVIEW_VIEW
  to BASIC_PRICE_IMPORT/BASIC_PRICE_RESOLVE respectively;
  basic-price-import-lookup.controller.ts resources/units moved from
  BASIC_PRICE_REVIEW_VIEW to BASIC_PRICE_RESOLVE. Frontend
  basic-price/import/:batchId/review route permission corrected to match
  (App.tsx).

OBSOLETE_CAPABILITY_SPACE_REMOVED=YES — deleted
  frontend/src/pages/BasicPriceSpacePage.tsx,
  frontend/src/utils/basicPriceSpaceViewModel.ts (+ its .test.ts),
  BasicPriceSpaceRoute (components/layout/ProtectedRoute.tsx). Sidebar.tsx
  and BasicPriceExplorerPage.tsx no longer compute or branch on the
  capability-space view model.
EXPECTED_OBSOLETE_CAPABILITY_SPACE_ARTIFACT_COUNT=0 (verified: zero
  remaining references to basicPriceSpaceViewModel/BasicPriceSpacePage/
  BasicPriceSpaceRoute anywhere in frontend/src — grep confirmed)

PUBLIC_BASIC_PRICE_ROUTE=DIRECT_EXPLORER (App.tsx: `basic-price` ->
  <BasicPriceExplorerPage /> directly, no wrapper gate beyond the existing
  outer ProtectedRoute)
SIDEBAR_BASIC_PRICE_UNIVERSAL=YES (Sidebar.tsx renders navItems
  unconditionally; Basic Price is no longer filtered by any capability)
PUBLIC_IMPORT_DOOR_VISIBLE=YES (BasicPriceExplorerPage always renders
  "Impor / Masukkan Harga", no permission gate)
PUBLIC_REVIEW_LINK_VISIBLE=NO
PUBLIC_PUBLICATION_LINK_VISIBLE=NO
CAPABILITY_LANDING_REMOVED=YES
EXPECTED_PRODUCT_PAGE_INTERNAL_LINK_MATCH_COUNT=0 (grepped
  BasicPriceExplorerPage.tsx and Sidebar.tsx for "/basic-price/reviews",
  "/basic-price/publications", "Antrean Review", "Antrean Publikasi",
  "Manajemen Basic Price" — zero hits; the only remaining hits repo-wide
  are BasicPriceReviewQueuePage.tsx's own heading/aria-label and its
  internal queue<->detail navigation, i.e. internal-to-internal, never
  linked from a product page)
INTERNAL_ROUTES_STILL_FAIL_CLOSED=YES (basic-price/reviews,
  basic-price/reviews/:reviewId, basic-price/publications unchanged in
  App.tsx — still PermissionRoute-gated by BASIC_PRICE_REVIEW_VIEW /
  BASIC_PRICE_PUBLISH; backend guards on basic-price-review.controller.ts
  and basic-price-publication.controller.ts untouched)

RESOURCE_TYPE_FILTER=IMPLEMENTED (canonical ResourceCatalog.type; DTO field
  `resourceType`, human labels Material/Bahan, Upah/Tenaga Kerja, Peralatan;
  no new enum/schema)
SOURCE_FAMILY_FILTER=IMPLEMENTED (basic-price-source-family.util.ts; DTO
  field `sourceFamily` in {GOVERNMENT, STORE_SUPPLIER, FIELD_PRICE}, maps to
  sourceOrigin IN [...]; intersects with an exact `sourceOrigin` filter when
  both given, never widening eligibility; existing exact `sourceOrigin`
  filter unchanged for backward compatibility)
SUBCATEGORY_FILTER=DEFERRED_NO_CANONICAL_FIELD (unchanged — no canonical
  subcategory field exists; specifications JSON not used as a fake category)

## LEGACY_TEST_CHANGE_REGISTER (Amendment A2)

1. FILE: backend/src/auth/workspace-permission-resolver.service.spec.ts
   TEST_NAME: cases asserting an ACTIVE membership's resolved permissions
   (tests 1, 5, 6, 7, 9)
   OLD_EXPECTATION: an ACTIVE membership resolved to exactly its
   RolePermission-granted codes; zero role grants resolved to an empty
   (non-null) array.
   NEW_EXPECTATION: an ACTIVE membership always resolves to at least
   ACTIVE_MEMBERSHIP_BASELINE_PERMISSION_CODES, unioned with role grants,
   unique+sorted.
   REASON: Owner Decision AD-RM02D2A2-01 — SIMPROK has no role-based Basic
   Price product variant.
   OWNER_LAW_REFERENCE: docs/control/DECISIONS.md AD-RM02D2A2-01.
   SECURITY_BOUNDARY_PRESERVED: YES — missing/inactive membership still
   resolves null (test 2, unchanged); internal curation codes still never
   auto-granted (test 8); cross-workspace scoping unchanged (test 4).
   TEST_WEAKENING: NO.

2. FILE: backend/src/common/constants/permissions.spec.ts
   TEST_NAME: "should categorize every permission as either seeded or
   governed_activation"
   OLD_EXPECTATION: every permission code categorized in
   SEEDED_PERMISSION_CODES ∪ GOVERNED_ACTIVATION_PERMISSION_CODES (two
   categories).
   NEW_EXPECTATION: categorized in SEEDED ∪ GOVERNED_ACTIVATION ∪
   ACTIVE_MEMBERSHIP_BASELINE_PERMISSION_CODES (three categories) — a
   strict superset, plus two new locking tests asserting
   REVIEW_VIEW/VERIFY/PUBLISH stay GOVERNED_ACTIVATION and out of the
   baseline.
   REASON: honest new catalog state for capabilities the resolver grants
   structurally.
   OWNER_LAW_REFERENCE: AD-RM02D2A2-01 (permission catalog honesty).
   SECURITY_BOUNDARY_PRESERVED: YES — no code left uncategorized, no
   governed/internal code removed from GOVERNED_ACTIVATION_PERMISSION_CODES.
   TEST_WEAKENING: NO.

3. FILE: backend/src/basic-price/basic-price-import.service.spec.ts
   TEST_NAME: all submitBatch(...) cases; new getBatch/updateBatchMetadata
   describe blocks
   OLD_EXPECTATION: `service.submitBatch(workspaceId, batchId)` — no
   ownership check; getBatch/updateBatchMetadata had zero test coverage.
   NEW_EXPECTATION: `service.submitBatch(workspaceId, batchId,
   currentAccountId)`; a caller who is not the batch's uploadedByAccountId
   is denied 404. getBatch/updateBatchMetadata now covered, including an
   ownership-denial negative case each.
   REASON: user-owned import boundary (Owner Decision §5, Amendment A1).
   OWNER_LAW_REFERENCE: AD-RM02D2A2-01.
   SECURITY_BOUNDARY_PRESERVED: YES — three new ownership-negative tests
   added; every prior positive-path assertion still holds with the correct
   uploader account.
   TEST_WEAKENING: NO.

4. FILE: backend/src/basic-price/basic-price-row-resolution.service.spec.ts
   TEST_NAME: baseBatch fixture; reject() cases; new
   "USER-OWNED IMPORT BOUNDARY" describe block
   OLD_EXPECTATION: baseBatch had no uploadedByAccountId;
   `rejectRow(workspaceId, batchId, rowId, dto)` — 4 args, no ownership.
   NEW_EXPECTATION: baseBatch.uploadedByAccountId = REVIEWER_ID (the acting
   caller, since resolveRow/rejectRow are user-owned-batch actions);
   `rejectRow(workspaceId, batchId, rowId, currentAccountId, dto)` — 5 args;
   two new negative tests (resolveRow/rejectRow denied for a foreign
   same-workspace account).
   REASON: ownership enforcement added to the shared assertBatchRowMutable.
   OWNER_LAW_REFERENCE: AD-RM02D2A2-01 §5.
   SECURITY_BOUNDARY_PRESERVED: YES — the existing workspace-mismatch
   negative test is unchanged; two ownership-negative tests added, none
   removed.
   TEST_WEAKENING: NO.

5. FILE:
   backend/src/basic-price/basic-price-row-mapping-candidates.service.spec.ts
   TEST_NAME: baseRow.batch fixture; all findCandidatesForRow(...) call
   sites; new ownership-negative test
   OLD_EXPECTATION: `findCandidatesForRow(workspaceId, batchId, rowId)` — 3
   args, no ownership.
   NEW_EXPECTATION: `findCandidatesForRow(workspaceId, batchId, rowId,
   currentAccountId)` — 4 args; UPLOADER_ID fixture added; one new negative
   test for a foreign same-workspace account.
   REASON: ownership enforcement.
   OWNER_LAW_REFERENCE: AD-RM02D2A2-01 §5.
   SECURITY_BOUNDARY_PRESERVED: YES — existing workspace/row-not-found
   negative tests unchanged; one ownership-negative test added.
   TEST_WEAKENING: NO.

6. FILE: frontend/src/utils/basicPriceSpaceViewModel.ts +
   basicPriceSpaceViewModel.test.ts (both DELETED)
   TEST_NAME: all 13 tests in basicPriceSpaceViewModel.test.ts
   OLD_EXPECTATION: a capability-space view model decided Explorer-vs-
   capability-landing and door visibility from VIEW/IMPORT/REVIEW_VIEW/
   PUBLISH combinations.
   NEW_EXPECTATION: file removed entirely. The Explorer is the ONE product
   experience for /basic-price, never chosen from a capability matrix;
   Sidebar and the route show/render it universally.
   REASON: this abstraction itself was the wrong product model the Owner
   corrected — a role/permission-dependent Basic Price experience.
   OWNER_LAW_REFERENCE: AD-RM02D2A2-01 §4.
   SECURITY_BOUNDARY_PRESERVED: YES — nothing this view model gated was a
   security boundary (only which links/landing rendered); the internal
   routes it fed into (BasicPriceSpaceRoute) are removed along with it, and
   the internal Review/Publication routes remain independently
   PermissionRoute-gated and backend-guarded, untouched by this deletion.
   TEST_WEAKENING: NO (obsolete-architecture removal, not a weakened
   assertion of a still-live contract).

7. FILE: frontend/src/App.tsx
   TEST_NAME: n/a (route registration; no dedicated frontend test exists
   for route-level permission strings in this repo's test infra) — recorded
   for completeness since the route's required permission changed.
   OLD_EXPECTATION: `basic-price/import/:batchId/review` gated by
   `PermissionRoute permission="BASIC_PRICE_REVIEW_VIEW"`.
   NEW_EXPECTATION: gated by `permission="BASIC_PRICE_RESOLVE"`, matching
   the corrected backend guard on the same user-owned batch-review flow.
   REASON: this route is Activity A (user's own batch review), never
   internal curation — REVIEW_VIEW was the wrong permission for it.
   OWNER_LAW_REFERENCE: AD-RM02D2A2-01 §5, §12 (governing prompt).
   SECURITY_BOUNDARY_PRESERVED: YES — backend GET :batchId/rows/:rowId no
   longer accepts BASIC_PRICE_REVIEW_VIEW either (see item
   IMPORT_PERMISSION_CODE_CORRECTION above); still fails closed without
   BASIC_PRICE_RESOLVE, and additionally now requires uploader ownership.
   TEST_WEAKENING: NO.

8. FILE: backend/test/acceptance/basic-price-import.e2e-spec.ts
   TEST_NAME: "RM-02C2 catalog lookup boundary › requires authentication
   and the bounded review permission"; "permission boundary › the current
   default state (permission not granted) fails closed with 403, never
   500" (renamed)
   OLD_EXPECTATION: foremanToken (ACTIVE membership, granted only
   BASIC_PRICE_PUBLISH via role) is denied 403 on
   GET /basic-price-import-lookups/resources and
   POST /basic-price-imports/preview.
   NEW_EXPECTATION: both succeed (200/201) — foreman's ACTIVE membership
   structurally holds BASIC_PRICE_IMPORT/_RESOLVE via the baseline.
   REASON: Safe E2E run (this slice) surfaced these as real, expected
   failures against the new resolver; confirmed foreman's WorkspaceMembership
   is genuinely ACTIVE (seed-acceptance.ts) with no Basic-Price role beyond
   the explicit PUBLISH grant.
   OWNER_LAW_REFERENCE: AD-RM02D2A2-01.
   SECURITY_BOUNDARY_PRESERVED: YES — unauthenticated still 401; foreman
   still lacks BASIC_PRICE_VERIFY/_REVIEW_VIEW (governed-only, unaffected).
   TEST_WEAKENING: NO.

9. FILE: backend/test/acceptance/basic-price.e2e-spec.ts
   TEST_NAME: "rejects 403 without BASIC_PRICE_VIEW" (both the
   GET /basic-prices and GET /basic-prices/lookups/regions variants,
   renamed)
   OLD_EXPECTATION: tokenNoRole (an ACTIVE membership created with zero
   MembershipRole rows at all) is denied 403.
   NEW_EXPECTATION: both succeed (200) — this is the literal "role kosong"
   case Owner Law names explicitly.
   REASON: Safe E2E run surfaced these as real, expected failures.
   OWNER_LAW_REFERENCE: AD-RM02D2A2-01, Amendment A1.
   SECURITY_BOUNDARY_PRESERVED: YES — unauthenticated still 401 (separate,
   unchanged test); cross-tenant eligibility tests elsewhere in the same
   file are unaffected.
   TEST_WEAKENING: NO.

10. FILE: backend/test/acceptance/rm02d1-resource-identity-mapping.e2e-spec.ts
    TEST_NAME: "candidate suggestions › requires authentication and the
    bounded review permission" (renamed)
    OLD_EXPECTATION: foremanToken (a different account than the batch
    uploader, assignedToken) is denied 403 for lacking
    BASIC_PRICE_REVIEW_VIEW.
    NEW_EXPECTATION: denied 404 — foreman's baseline BASIC_PRICE_RESOLVE now
    clears the permission guard, so the user-owned import boundary's
    ownership check is what correctly denies it instead (a same-workspace
    account that is not this batch's uploader).
    REASON: Safe E2E run surfaced this as a real, expected failure; this is
    a strictly stronger, ownership-scoped denial than the old
    permission-only check, not a widened one.
    OWNER_LAW_REFERENCE: AD-RM02D2A2-01 §5.
    SECURITY_BOUNDARY_PRESERVED: YES — unauthenticated still 401; the
    cross-workspace 404 test in the same describe block is unaffected;
    assignedToken (the actual uploader) still succeeds 200.
    TEST_WEAKENING: NO.

LEGACY_TEST_BEHAVIOR_CHANGE_COUNT=10 (all registered above)
TEST_WEAKENING_COUNT=0

BACKEND_BUILD=PASS (nest build via tsc -p tsconfig.build.json --noEmit,
  clean)
BACKEND_UNIT=PASS (724/724, up from 713/713 pre-existing baseline before
  this slice; delta = 11 new focused tests)
PRISMA_VALIDATE=PASS (schema unchanged)
BACKEND_LINT=PASS on every changed production file (eslint --fix applied;
  remaining findings are the pre-existing `request: any`
  @typescript-eslint/no-unsafe-* pattern used throughout every controller
  in this codebase, confirmed present at HEAD before this slice — not a
  regression)
FRONTEND_BUILD=PASS (tsc -b && vite build, clean)
FRONTEND_UNIT=PASS (86/86 node:test, 0 failures). Net effect on the suite:
  basicPriceSpaceViewModel.test.ts (13 tests) deleted with its obsolete
  source file; basicPriceExplorerDisplay.test.ts gained 3 tests
  (resourceTypeLabel, sourceFamilyLabel, resourceType/sourceFamily query
  params). package.json's `test` script updated to drop the deleted file.
FRONTEND_LINT=PASS on every changed file (zero errors/warnings)

SAFE_E2E=PENDING (attempted after this section is written — see below)
VISUAL_ACCEPTANCE_FIXTURE=PENDING
BROWSER_ACCEPTANCE=STOP_FOR_OWNER_VISUAL_DECISION
COWORK_PRODUCT_REVIEW=PENDING
COWORK_SECURITY_REVIEW=PENDING
MERGE_READY=NO
PRODUCT_LIVE=NO
```

