# RM-02B0 — Complete RM-02B Test Matrix

STATUS: `PROVISIONAL_PENDING_ARCHITECT_REVIEW` — this matrix is a design artifact for the future RM-02B implementation task. No test file was created by this task.

Column legend: **ID** · **NAME** · **LAYER** (PARSER_UNIT / SERVICE_UNIT / E2E / DB_TRANSACTION) · **FIXTURE** · **ACTOR** · **PRECONDITIONS** · **ACTION** · **EXPECTED_STATUS** · **EXPECTED_MUTATION_COUNT** · **EXPECTED_AUDIT_EVENT** · **FAIL_CLOSED_REASON**

All fixtures reuse the real, reconfirmed workbook facts from RM-02A discovery where noted (e.g. real duplicate-name/collision rows, real `#REF!` formula cells, real high-scale decimal values) rather than inventing synthetic-only data, so the test suite exercises genuine, previously-observed source anomalies.

## PARSER (A01–A15)

| ID | NAME | LAYER | FIXTURE | ACTOR | PRECONDITIONS | ACTION | EXPECTED_STATUS | EXPECTED_MUTATION_COUNT | EXPECTED_AUDIT_EVENT | FAIL_CLOSED_REASON |
|---|---|---|---|---|---|---|---|---|---|---|
| A01 | Valid workbook parses | PARSER_UNIT | portable Basic Price fixture (3 sections, mirrors real workbook shape) | — | none | `adapter.parse(buffer, name, sheet)` | 201 (via preview endpoint) / success (unit) | 0 | — | — |
| A02 | Exact workbook SHA-256 recorded | PARSER_UNIT | same | — | none | parse, inspect `sourceSha256` | success | 0 | — | — |
| A03 | Three workbook sections detected | PARSER_UNIT | fixture with LABOR/MATERIAL/EQUIPMENT banners (mirrors real `DAFTAR HARGA SATUAN UPAH` / `...BAHAN` / `...SEWA PERALATAN`) | — | none | parse, inspect row `sourceSection` per row | success | 0 | — | — |
| A04 | Duplicate "SATUAN" headers handled without silent misread | PARSER_UNIT | fixture with two adjacent columns both literally headed "SATUAN" (real, confirmed source pattern) | — | none | parse | success — both raw values captured distinctly, never merged/confused | 0 | — | — |
| A05 | Merged-cell banner rows read via master-cell mirroring | PARSER_UNIT | fixture with a `B1:G1`-style merge (real pattern) | — | none | parse banner row | success — all cells in range read the master value | 0 | — | — |
| A06 | Formula cell with cached result | PARSER_UNIT | fixture cell `{formula, result: number}` | — | none | parse | `rawPriceCachedResultRoundTripString` populated | 0 | — | — |
| A07 | Formula without cached result | PARSER_UNIT | fixture cell `{formula}`, no `result` | — | none | parse | `resolutionStatus=NEEDS_REVIEW`, `CANONICAL_PRICE_AVAILABLE=NO` | 0 | — | FORMULA_NO_CACHED_RESULT |
| A08 | Nested formula error (`#REF!`) | PARSER_UNIT | real-shaped fixture cell `{formula:'#REF!/160', result:{error:'#REF!'}}` (matches actual reconfirmed workbook KET column) | — | none | parse | `rawPriceFormulaError='#REF!'`, `resolutionStatus=NEEDS_REVIEW` | 0 | — | FORMULA_ERROR |
| A09 | Object-shaped resource-code cell | PARSER_UNIT | fixture with a richText/hyperlink-shaped code cell (matches real material-section D-column pattern) | — | none | parse | classified explicitly, never `[object Object]` string | 0 | — | UNRECOGNIZED_CELL_SHAPE (only if truly unclassifiable) |
| A10 | Object-shaped unit cell | PARSER_UNIT | same pattern, unit column | — | none | parse | same as A09 | 0 | — | UNRECOGNIZED_CELL_SHAPE |
| A11 | Invalid workbook (non-xlsx bytes) | PARSER_UNIT | `Buffer.from('bad')` | — | none | preview endpoint | 400 | 0 | — | INVALID_WORKBOOK |
| A12 | Missing sheet | PARSER_UNIT | valid xlsx, wrong `selectedSheet` | — | none | preview endpoint | 400/404 | 0 | — | SHEET_NOT_FOUND |
| A13 | Missing required header | PARSER_UNIT | fixture with no "HARGA" column | — | none | parse | 400 | 0 | — | REQUIRED_HEADER_NOT_FOUND |
| A14 | Trailing scratch rows excluded | PARSER_UNIT | fixture with bare numeric cells past the last real section (matches real rows 331–336) | — | none | parse | those rows never become `BasicPriceImportRow`s | 0 | — | — |
| A15 | Empty price cell retained for review, not dropped | PARSER_UNIT | fixture row with name present, price blank (matches real row 39 "Kawat BRC") | — | none | parse | row created, `resolutionStatus` reflects missing price | 0 rows dropped | — | EMPTY_PRICE_NEEDS_REVIEW |

## NUMERIC (B01–B12)

| ID | NAME | LAYER | FIXTURE | ACTOR | PRECONDITIONS | ACTION | EXPECTED_STATUS | EXPECTED_MUTATION_COUNT | EXPECTED_AUDIT_EVENT | FAIL_CLOSED_REASON |
|---|---|---|---|---|---|---|---|---|---|---|
| B01 | Raw numeric round-trip string retained | PARSER_UNIT | cell value `158333.33333333334` (real, reconfirmed source value) | — | none | parse | `rawPriceNumericRoundTripString="158333.33333333334"` exactly | 0 | — | — |
| B02 | Display text retained separately | PARSER_UNIT | same cell, numFmt `#,##0.00` | — | none | parse | `rawPriceDisplayText="158,333.33"`, distinct field from raw | 0 | — | — |
| B03 | Formula text retained | PARSER_UNIT | formula cell | — | none | parse | `rawPriceFormulaText` populated verbatim | 0 | — | — |
| B04 | Cached formula result retained | PARSER_UNIT | formula cell with result | — | none | parse | `rawPriceCachedResultRoundTripString` populated | 0 | — | — |
| B05 | ROUND_HALF_UP below half | SERVICE_UNIT | raw `"10.121"` | — | none | compute `proposedCanonicalPrice` | `10.12` | 0 | — | — |
| B06 | ROUND_HALF_UP exact tie | SERVICE_UNIT | raw `"0.125"` | — | none | compute | `0.13` (tie rounds up) | 0 | — | — |
| B07 | ROUND_HALF_UP above half | SERVICE_UNIT | raw `"10.126"` | — | none | compute | `10.13` | 0 | — | — |
| B08 | No JavaScript Number authority | SERVICE_UNIT | raw string with >15 significant digits | — | none | compute via Prisma.Decimal | exact result, no float artifact | 0 | — | — |
| B09 | Null not converted to zero | SERVICE_UNIT | row with no price at all | — | none | compute | `proposedCanonicalPrice=null`, never `0` | 0 | — | NULL_PRICE_NOT_ZEROED |
| B10 | No intermediate rounding across resourceCost chain | SERVICE_UNIT | mirrors §17 arithmetic-chain proof values (`158333.33`, `0.75`) | — | none | compute chain | matches exact proof in `01-RM02B0-SCHEMA-CONTRACT.md` §7 (`118749.9975`, not `118750.00`) | 0 | — | PREMATURE_ROUNDING_FORBIDDEN |
| B11 | Raw evidence immutable after row creation | DB_TRANSACTION | created row | resolver | attempt to UPDATE a `raw*` column via the resolution service | resolution service call | update rejected/no-op on raw* columns; only resolution-owned columns change | 0 raw-column mutations | — | RAW_EVIDENCE_IMMUTABLE |
| B12 | Canonical price scale 2 | SERVICE_UNIT | any resolved row | — | none | inspect `proposedCanonicalPrice` | `Decimal(18,2)`, exactly 2 decimal places | 0 | — | — |

## METADATA (C01–C10)

| ID | NAME | LAYER | FIXTURE | ACTOR | PRECONDITIONS | ACTION | EXPECTED_STATUS | EXPECTED_MUTATION_COUNT | EXPECTED_AUDIT_EVENT | FAIL_CLOSED_REASON |
|---|---|---|---|---|---|---|---|---|---|---|
| C01 | Missing Region fails closed at submission | E2E | batch with `regionId=null` | Human (submitter) | rows READY_FOR_SUBMISSION | attempt batch approval | 409/400 | 0 | — | REGION_REQUIRED_BEFORE_SUBMISSION |
| C02 | Dummy Region forbidden | SERVICE_UNIT | attempt to reference a placeholder "General"/"Unknown" region code | — | none | region lookup | rejected — no such row exists, none seeded | 0 | — | DUMMY_REGION_FORBIDDEN |
| C03 | Unknown Region not treated as global | SERVICE_UNIT | `regionId=null` row | — | none | eligibility check | `REGION_IDENTITY_MISSING`, never `ELIGIBLE` | 0 | — | UNKNOWN_REGION_NOT_GLOBAL |
| C04 | Missing effective date fails closed | E2E | batch with `effectiveDate=null` | Human | rows READY_FOR_SUBMISSION | attempt batch approval | 409/400 | 0 | — | EFFECTIVE_DATE_REQUIRED_BEFORE_SUBMISSION |
| C05 | Current-date fallback forbidden | SERVICE_UNIT | batch with null date | — | none | attempt submission creation directly | rejected, `new Date()` never observed in resulting `PriceSubmissionRevision.effectiveDate` | 0 | — | CURRENT_DATE_FALLBACK_FORBIDDEN |
| C06 | Approval-date fallback forbidden | SERVICE_UNIT | same | — | none | same | same | 0 | — | APPROVAL_DATE_FALLBACK_FORBIDDEN |
| C07 | Batch metadata included in fingerprint | SERVICE_UNIT | same file, two different regions | — | none | compute fingerprint twice | two distinct fingerprints | 0 | — | — |
| C08 | Per-row effective date override | SERVICE_UNIT | batch date set, one row overridden | Human | batch approved | submit | row's `PriceSubmissionRevision.effectiveDate` reflects override, not batch date | 1 submission | PriceSubmissionAudit | — |
| C09 | Coverage unknown requires review | E2E | row with no coverage declaration | — | none | eligibility check | not publishable without human confirmation | 0 | — | COVERAGE_CONFIRMATION_REQUIRED |
| C10 | Transport/loading/unloading never inferred from filename | SERVICE_UNIT | file named e.g. "delivered-prices.xlsx" | — | none | parse + resolve | coverage booleans remain `null` unless human sets them | 0 | — | NO_FILENAME_INFERENCE |

## RESOURCE/UNIT (D01–D10)

| ID | NAME | LAYER | FIXTURE | ACTOR | PRECONDITIONS | ACTION | EXPECTED_STATUS | EXPECTED_MUTATION_COUNT | EXPECTED_AUDIT_EVENT | FAIL_CLOSED_REASON |
|---|---|---|---|---|---|---|---|---|---|---|
| D01 | Exact resource match | SERVICE_UNIT | code matches seeded `ResourceCatalog` exactly | resolver | catalog seeded | resolve row | `resolutionStatus` advances toward RESOLVED | 0 | — | — |
| D02 | Unknown resource retained, not dropped | SERVICE_UNIT | code with no catalog match | resolver | none | resolve attempt | `resolutionStatus=RESOURCE_UNKNOWN`, row still exists | 0 | — | RESOURCE_UNKNOWN |
| D03 | Ambiguous resource retained | SERVICE_UNIT | name matching 2+ catalog entries | resolver | none | resolve attempt | `RESOURCE_AMBIGUOUS`, human choice required | 0 | — | RESOURCE_AMBIGUOUS |
| D04 | Resource type conflict retained | SERVICE_UNIT | code matches catalog entry of a different `ResourceType` | resolver | none | resolve attempt | `RESOURCE_TYPE_CONFLICT` | 0 | — | RESOURCE_TYPE_CONFLICT |
| D05 | Exact unit match | SERVICE_UNIT | raw unit == canonical `UnitDefinition.code` | resolver | none | resolve | unit resolved | 0 | — | — |
| D06 | Alias match | SERVICE_UNIT | raw unit matches a `UnitAlias` | resolver | alias seeded | resolve | unit resolved via alias, alias id recorded in reason codes | 0 | — | — |
| D07 | Unknown unit retained | SERVICE_UNIT | raw unit e.g. real `"[unresolved-object-cell]"` case | resolver | none | resolve attempt | `UNIT_UNKNOWN` | 0 | — | UNIT_UNKNOWN |
| D08 | Ambiguous unit retained | SERVICE_UNIT | raw unit matching casing variants both present (e.g. real `"Kg"` vs `"kg"`) resolving to two different definitions | resolver | none | resolve attempt | `UNIT_AMBIGUOUS` | 0 | — | UNIT_AMBIGUOUS |
| D09 | Absent conversion rule fails closed | SERVICE_UNIT | unit requires conversion, no `UnitConversionRule` exists | resolver | none | resolve attempt | `UNIT_CONVERSION_REQUIRED`, blocked | 0 | — | CONVERSION_RULE_MISSING |
| D10 | Fuzzy recommendation never auto-approved | SERVICE_UNIT | near-match name/unit suggestion surfaced | resolver | suggestion generated | inspect row state after suggestion | row remains `NEEDS_REVIEW` until explicit human action | 0 | — | FUZZY_MATCH_NOT_AUTO_APPROVED |

## COLLISION (E01–E09)

| ID | NAME | LAYER | FIXTURE | ACTOR | PRECONDITIONS | ACTION | EXPECTED_STATUS | EXPECTED_MUTATION_COUNT | EXPECTED_AUDIT_EVENT | FAIL_CLOSED_REASON |
|---|---|---|---|---|---|---|---|---|---|---|
| E01 | Exact duplicate | SERVICE_UNIT | two byte-identical rows | — | none | collision scan | `EXACT_DUPLICATE` on the later row | 0 | — | COLLISION_NEEDS_REVIEW |
| E02 | Same identity / same value | SERVICE_UNIT | two rows, same resource+region+date, same price | — | none | scan | `SAME_IDENTITY_SAME_VALUE` | 0 | — | COLLISION_NEEDS_REVIEW |
| E03 | Same identity / different value | SERVICE_UNIT | real pattern — "Pintu gulung besi" rows 136/137 (30 vs 31) | — | none | scan | `SAME_IDENTITY_DIFFERENT_VALUE` | 0 | — | COLLISION_NEEDS_REVIEW |
| E04 | Code collision | SERVICE_UNIT | real pattern — duplicate code `"M.05.a.3"` | — | none | scan | `CODE_COLLISION` | 0 | — | COLLISION_NEEDS_REVIEW |
| E05 | Name collision | SERVICE_UNIT | real pattern — "Sealant" rows 157/161 | — | none | scan | `NAME_COLLISION` | 0 | — | COLLISION_NEEDS_REVIEW |
| E06 | Unit collision | SERVICE_UNIT | real pattern — "Porslen" rows 200/201 (Doos vs Buah) | — | none | scan | `UNIT_COLLISION` | 0 | — | COLLISION_NEEDS_REVIEW |
| E07 | Human collision decision recorded | E2E | any collision-flagged row pair | Human (resolver) | collision detected | resolve one row, mark the other `REJECTED` with reason | both rows updated with resolver/timestamp evidence | 0 submissions until resolved | resolution audit | — |
| E08 | No last-write-wins | SERVICE_UNIT | two colliding rows submitted concurrently | — | collision unresolved | attempt submission | both blocked pending explicit human decision, neither silently wins | 0 | — | NO_LAST_WRITE_WINS |
| E09 | No first-write-wins | SERVICE_UNIT | same | — | same | same | same | 0 | — | NO_FIRST_WRITE_WINS |

## STAGING/SUBMISSION (F01–F14)

| ID | NAME | LAYER | FIXTURE | ACTOR | PRECONDITIONS | ACTION | EXPECTED_STATUS | EXPECTED_MUTATION_COUNT | EXPECTED_AUDIT_EVENT | FAIL_CLOSED_REASON |
|---|---|---|---|---|---|---|---|---|---|---|
| F01 | Preview writes no DB rows | E2E | valid workbook | Human (importer) | none | preview call (if a stateless preview step is retained ahead of persisted batch creation) | 200, zero rows in any RM-02 table | 0 | — | — |
| F02 | Approve creates batch/rows | E2E | valid workbook | Human (importer) | none | import call | 201, one batch + N rows created | 1 batch + N rows | batch creation | — |
| F03 | Unresolved row creates no submission | E2E | batch with ≥1 `NEEDS_REVIEW` row | Human | batch otherwise ready | attempt batch approval | blocked or partial — unresolved row excluded | 0 submissions for that row | — | UNRESOLVED_ROW_NO_SUBMISSION |
| F04 | Resolved row creates submission | E2E | fully resolved row | Human | batch approved | approval transaction | 1 `PriceSubmission` + `PriceSubmissionRevision` per resolved row | 1 submission + 1 revision | PriceSubmissionAudit | — |
| F05 | Raw row survives resolution | SERVICE_UNIT | resolved row | — | none | inspect row after resolution | `raw*` fields byte-identical to creation time | 0 | — | — |
| F06 | Rejected row survives with evidence | SERVICE_UNIT | rejected row | Human | reason supplied | reject | row remains queryable, `status=REJECTED`, reason recorded | 0 deletions | rejection audit | — |
| F07 | PriceSubmission starts SUBMITTED | E2E | resolved row submitted | — | F04 done | inspect | `status='SUBMITTED'` | — | — | — |
| F08 | Review created | E2E | submitted submission | System (existing `processSubmittedPriceSubmissionReviewOnce`) | none | run review-creation step | `PriceSubmissionReview` created, `status='UNDER_REVIEW'` | 1 review | PriceSubmissionAudit | — |
| F09 | No BasicPrice before human verification | E2E | submission still `UNDER_REVIEW` | — | none | inspect | zero `BasicPrice` rows linked | 0 | — | NO_BASIC_PRICE_BEFORE_VERIFICATION |
| F10 | Transaction rollback preserves prior state | DB_TRANSACTION | batch approval with a deliberately-injected mid-transaction failure | — | forced fault | approval transaction | full rollback, batch/rows unchanged from before the attempt | 0 net | — | ROLLBACK_ON_PARTIAL_FAILURE |
| F11 | Cross-workspace denied | E2E | batch in Workspace A | User with no Workspace A access | none | attempt access from another workspace | 403/404 | 0 | — | CROSS_WORKSPACE_DENIED |
| F12 | Cross-organization denied | E2E | batch in Org A | User in Org B | none | attempt access | 403/404 | 0 | — | CROSS_ORGANIZATION_DENIED |
| F13 | RM-02 path requires effective date | E2E | same as C04 | — | — | — | — | — | — | EFFECTIVE_DATE_REQUIRED_BEFORE_SUBMISSION |
| F14 | RM-02 path never reaches shared current-date fallback | SERVICE_UNIT | null-date batch | — | none | attempt submission creation | rejected before reaching `price-submission-review.service.ts:191`-style code path; that fallback is only ever exercised by the pre-existing, unrelated `BusinessSubscriptionService` chain | 0 | — | RM02_FALLBACK_UNREACHABLE |

## VERIFICATION/PUBLICATION (G01–G15)

| ID | NAME | LAYER | FIXTURE | ACTOR | PRECONDITIONS | ACTION | EXPECTED_STATUS | EXPECTED_MUTATION_COUNT | EXPECTED_AUDIT_EVENT | FAIL_CLOSED_REASON |
|---|---|---|---|---|---|---|---|---|---|---|
| G01 | Human verification required | E2E | UNDER_REVIEW submission | Human | assertHumanInWorkspace passes | accept | `VERIFIED` | 1 status change | PriceSubmissionAudit + ReviewDecision | — |
| G02 | AI/system cannot verify | SERVICE_UNIT | same | System/AI actor attempt | — | attempt accept as non-human | rejected | 0 | — | HUMAN_REQUIRED |
| G03 | Verification does not publish | E2E | just-verified submission | — | G01 done | inspect resulting `BasicPrice` | `status` defaults to `'UNPUBLISHED'` (new safe default), `verificationStatus='VERIFIED'` | 1 BasicPrice created | — | — |
| G04 | Verified price excluded from public API | E2E | same | anonymous/public caller | — | `GET /basic-prices` | verified-but-unpublished row absent from results | 0 | — | NOT_PUBLISHED |
| G05 | Verified price excluded from eligibility policy | SERVICE_UNIT | same | — | none | `BasicPriceEligibilityPolicy` check | `eligible=false`, `reasonCode=NOT_PUBLISHED` | 0 | — | NOT_PUBLISHED |
| G06 | Explicit publication required | E2E | verified BasicPrice | Human (publisher) | `BASIC_PRICE_PUBLISH` granted | publish call | `status='PUBLISHED'` | 1 | BasicPricePublicationAudit | — |
| G07 | Unauthorized publish denied | E2E | same | User without `BASIC_PRICE_PUBLISH` | none | publish call | 403 | 0 | — | PERMISSION_DENIED |
| G08 | Authorized publish succeeds | E2E | same as G06 | — | — | — | 200/201 | 1 | BasicPricePublicationAudit | — |
| G09 | Publication audit created | E2E | same | — | G08 | inspect | one `BasicPricePublicationAudit` row, `action='PUBLISH'`, non-null `actorAccountId` | 1 audit row | BasicPricePublicationAudit | — |
| G10 | Publish idempotent | E2E | already-published BasicPrice | Human | — | publish again | 200, same state, no duplicate audit row | 0 net | — | ALREADY_PUBLISHED_IDEMPOTENT |
| G11 | Concurrent publication serialized | DB_TRANSACTION | two simultaneous publish calls | Human ×2 | row lock in place | `Promise.all` both calls | one performs the transition, the other returns the same idempotent result | 1 net status change | 1 audit row (not 2) | — |
| G12 | Published price public-visible | E2E | published BasicPrice | anonymous caller | G08 done | `GET /basic-prices` | row appears | 0 | — | — |
| G13 | Published price eligibility-visible | SERVICE_UNIT | same | — | — | eligibility check | `eligible=true`, `reasonCode=ELIGIBLE` (assuming all other axes also pass) | 0 | — | — |
| G14 | No auto-publish from parser success | SERVICE_UNIT | freshly parsed row, zero human action | — | none | inspect | no `BasicPrice` exists at all yet | 0 | — | — |
| G15 | No auto-publish from collision-free row | SERVICE_UNIT | resolved, collision-free row | — | resolved | inspect immediately after resolution | still no `BasicPrice` — resolution alone never publishes | 0 | — | — |

## RBAC (H01–H09)

| ID | NAME | LAYER | FIXTURE | ACTOR | PRECONDITIONS | ACTION | EXPECTED_STATUS | EXPECTED_MUTATION_COUNT | EXPECTED_AUDIT_EVENT | FAIL_CLOSED_REASON |
|---|---|---|---|---|---|---|---|---|---|---|
| H01 | Import permission enforced | E2E | — | user without `BASIC_PRICE_IMPORT` | — | import call | 403 | 0 | — | PERMISSION_DENIED |
| H02 | Resolve permission enforced | E2E | — | user without `BASIC_PRICE_RESOLVE` | — | resolve call | 403 | 0 | — | PERMISSION_DENIED |
| H03 | Verify permission enforced | E2E | — | user without `BASIC_PRICE_VERIFY` | — | accept call | 403 | 0 | — | PERMISSION_DENIED |
| H04 | Publish permission enforced | E2E | — | user without `BASIC_PRICE_PUBLISH` | — | publish call | 403 | 0 | — | PERMISSION_DENIED |
| H05 | Self-review policy enforced | E2E | row imported by user X | user X attempts to verify their own submission | — | accept call | denied per four-eyes recommendation | 0 | — | SELF_REVIEW_DENIED |
| H06 | Self-publish policy enforced | E2E | submission verified by user Y | user Y attempts to publish | — | publish call | denied per four-eyes recommendation | 0 | — | SELF_PUBLISH_DENIED |
| H07 | Four-eyes policy end-to-end | E2E | import (X) → resolve (X) → verify (Z) → publish (W), X≠Z≠W | 3 distinct users | — | full chain | succeeds at every stage | full chain mutations | full chain audits | — |
| H08 | Workspace scoping enforced everywhere | E2E | resources in Workspace A | user scoped to Workspace B | — | any RM-02 endpoint | 403/404 | 0 | — | WORKSPACE_SCOPE_DENIED |
| H09 | Organization scoping enforced everywhere | E2E | resources in Org A | user scoped to Org B | — | any RM-02 endpoint | 403/404 | 0 | — | ORGANIZATION_SCOPE_DENIED |

## REPLAY/CONCURRENCY (I01–I08)

| ID | NAME | LAYER | FIXTURE | ACTOR | PRECONDITIONS | ACTION | EXPECTED_STATUS | EXPECTED_MUTATION_COUNT | EXPECTED_AUDIT_EVENT | FAIL_CLOSED_REASON |
|---|---|---|---|---|---|---|---|---|---|---|
| I01 | Same fingerprint returns existing batch | E2E | same workbook, same metadata, imported twice | — | first import done | second import call | 200 (existing batch returned), no new rows | 0 net | — | — |
| I02 | Same file, different metadata yields new fingerprint | E2E | same bytes, different region | — | — | import twice with different region | two distinct batches | 2 batches | — | — |
| I03 | Modified file, old fingerprint fails | E2E | edited workbook, stale fingerprint submitted | — | — | replay old fingerprint | 409 | 0 | — | STALE_FINGERPRINT |
| I04 | Concurrent approve serialized | DB_TRANSACTION | one batch, two simultaneous approve calls | — | row lock | `Promise.all` | one creates submissions, other returns idempotent result | N submissions once, not 2N | — | — |
| I05 | Duplicate submissions prevented | DB_TRANSACTION | same as I04 | — | — | inspect final row count | exactly N submissions for N resolved rows | — | — | — |
| I06 | Stale row version fails | DB_TRANSACTION | row resolved with an outdated `version` supplied | resolver | — | resolve call with stale version | 409 | 0 | — | VERSION_STALE |
| I07 | Replay after resolution drift fails | E2E | row resolved, then re-submitted with pre-drift resolution snapshot | — | — | replay | 409 | 0 | — | RESOLUTION_DRIFT |
| I08 | Deterministic final state under concurrency | DB_TRANSACTION | I04 scenario repeated N times | — | — | — | identical final row/status counts every run | — | — | — |

## LEGACY (J01–J06)

| ID | NAME | LAYER | FIXTURE | ACTOR | PRECONDITIONS | ACTION | EXPECTED_STATUS | EXPECTED_MUTATION_COUNT | EXPECTED_AUDIT_EVENT | FAIL_CLOSED_REASON |
|---|---|---|---|---|---|---|---|---|---|---|
| J01 | Legacy PUBLISHED/PUBLISHED classified | SERVICE_UNIT | seeded legacy row, both axes PUBLISHED | — | — | eligibility check | classified per §18-selected option (Option 1: grandfathered, tagged) | 0 | — | — |
| J02 | Legacy PUBLISHED/VERIFIED classified | SERVICE_UNIT | seeded legacy row (today's actual accept-flow output shape) | — | — | eligibility check | classified `NOT_VERIFICATION_TERMINAL` — never silently treated as eligible | 0 | — | — |
| J03 | Legacy missing provenance not silently approved | SERVICE_UNIT | legacy row, no batch/row link | — | — | eligibility check for RM-02-specific eligibility variant | `INCOMPLETE_NEW_IMPORT_PROVENANCE` reason available but not applied to legacy rows under Option 1 (grandfathered) — test asserts the grandfather path is explicit, not silent | 0 | — | — |
| J04 | Legacy not silently invalidated | SERVICE_UNIT | legacy row | — | — | run RM-02B migration/eligibility code | row still readable, `status`/`verificationStatus` values unchanged | 0 | — | — |
| J05 | Legacy Cost Kernel use blocked pending disposition | SERVICE_UNIT | legacy row | — | — | Cost Kernel reuse-plan stub (not implemented — this test only proves the eligibility policy itself, which Cost Kernel would call, does not silently expand scope) | consistent with public API decision | 0 | — | LEGACY_DISPOSITION_REQUIRED (if Option other than grandfathering is ever chosen) |
| J06 | Current public behavior unchanged before Owner disposition | E2E | full existing `basic-price.service.spec.ts` suite | — | — | run existing tests unmodified | all pass exactly as before RM-02B changes | 0 behavior change | — | — |

## MIGRATION (K01–K12)

| ID | NAME | LAYER | FIXTURE | ACTOR | PRECONDITIONS | ACTION | EXPECTED_STATUS | EXPECTED_MUTATION_COUNT | EXPECTED_AUDIT_EVENT | FAIL_CLOSED_REASON |
|---|---|---|---|---|---|---|---|---|---|---|
| K01 | Empty disposable DB migration | DB_TRANSACTION | fresh disposable Postgres | — | — | run migration | succeeds cleanly | schema objects created | — | — |
| K02 | Disposable DB with legacy BasicPrice | DB_TRANSACTION | seeded legacy-shaped rows | — | — | run migration | succeeds, legacy rows untouched | 0 legacy row mutation | — | — |
| K03 | Status×verification combinations survive migration | DB_TRANSACTION | rows covering all 8 `PriceVerificationStatus` values × both status strings | — | — | run migration | every row's values byte-identical after migration | 0 | — | — |
| K04 | Null Region legacy rows survive migration | DB_TRANSACTION | rows with `regionId=null` | — | — | run migration | still null, still valid (FK allows null) | 0 | — | — |
| K05 | Existing Region UUID values handled per gating | DB_TRANSACTION | rows with a non-null `regionId` not matching any `regions` row | — | — | attempt FK-addition step | migration step refuses / is skipped pending Owner disposition, per `08-RM02B0-PROVISIONAL-MIGRATION-DESIGN.md` | 0 | — | REGION_FK_GATED_ON_DISPOSITION |
| K06 | BoqItem scale-2 rows widen to scale 6 | DB_TRANSACTION | seeded scale-2 quantities | — | — | run widening ALTER | column type now `Decimal(18,6)` | 0 value change | — | — |
| K07 | Quantity values numerically unchanged after widening | DB_TRANSACTION | same | — | — | compare before/after | byte-for-byte equal numeric value | 0 | — | — |
| K08 | Rollback/restore rehearsal | DB_TRANSACTION | disposable DB, full migration applied | — | — | reverse migration | schema returns to pre-migration shape (except widening caveat noted in `08-...md` ROLLBACK_STRATEGY) | — | — | — |
| K09 | Proposed unique-constraint collision detection | DB_TRANSACTION | duplicate `(workspaceId, importFingerprint)` inserted before constraint exists | — | — | attempt constraint addition | constraint addition fails loudly, not silently | 0 | — | CONSTRAINT_COLLISION |
| K10 | No current-date backfill occurs anywhere in migration | DB_TRANSACTION | rows with null effectiveDate | — | — | run migration | no row's `effectiveDate` populated with `now()` | 0 | — | — |
| K11 | No dummy Region backfill occurs anywhere in migration | DB_TRANSACTION | fresh `regions` table | — | — | run migration | zero rows in `regions` after migration completes | 0 | — | — |
| K12 | Unsafe default PUBLISHED removed/neutralized | DB_TRANSACTION | fresh insert omitting `status` | — | migration step 8 applied | insert `BasicPrice` without `status` | resulting row has `status='UNPUBLISHED'`, not `'PUBLISHED'` | 1 insert | — | — |

## AUDIT ROLE (M01–M12)

| ID | NAME | LAYER | FIXTURE | ACTOR | PRECONDITIONS | ACTION | EXPECTED_STATUS | EXPECTED_MUTATION_COUNT | EXPECTED_AUDIT_EVENT | FAIL_CLOSED_REASON |
|---|---|---|---|---|---|---|---|---|---|---|
| M01 | Existing RM01B role remains unchanged | DB_TRANSACTION (disposable, mirroring prod shape) | `simprok_rm01b_audit` provisioned | — | RM02 role provisioned | inspect RM01B role's grants before/after | byte-identical | 0 | — | — |
| M02 | RM02 role attributes exact | DB_TRANSACTION | provisioned RM02 role | — | — | inspect `pg_roles` | matches `03-RM02B0-RM02-AUDIT-ROLE-CONTRACT.md` §4 exactly | 0 | — | — |
| M03 | RM02 role has no memberships | DB_TRANSACTION | same | — | — | inspect `pg_auth_members` | zero rows | 0 | — | — |
| M04 | RM02 role has no CREATE privilege | DB_TRANSACTION | same | — | — | inspect role attributes | `rolcreatedb=f`, `rolcreaterole=f` | 0 | — | — |
| M05 | RM02 role has no mutation grants | DB_TRANSACTION | same | — | — | inspect `role_table_grants` | zero INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER | 0 | — | — |
| M06 | Exact column allowlist only | DB_TRANSACTION | same | — | — | inspect `role_column_grants` | exactly 31 rows, matching the matrix in file 03 | 0 | — | — |
| M07 | Visibility matrix passes after provisioning | DB_TRANSACTION | provisioned role, migrated schema | — | — | run §23 gate queries | `AUDIT_ROLE_VISIBILITY_SUFFICIENT=YES` | 0 | — | — |
| M08 | Missing one required column fails before substantive SELECT | DB_TRANSACTION | provisioned role with one column grant deliberately withheld | — | — | run preflight SQL | visibility gate fails, `ROLLBACK` reached, zero business-section output produced | 0 | — | VISIBILITY_GAP |
| M09 | Preflight never falls back to another user | DB_TRANSACTION / static | preflight launcher | — | RM02 role login fails (e.g. wrong password) | run launcher | launcher exits nonzero, never retries as any other account | 0 | — | NO_FALLBACK_USER |
| M10 | Preflight transaction is read-only | DB_TRANSACTION | any state | — | — | inspect `current_setting('transaction_read_only')` inside the preflight transaction | `on` | 0 | — | — |
| M11 | Controlled failure reaches explicit rollback | DB_TRANSACTION | visibility gate deliberately failed (M08 scenario) | — | — | run preflight | `ROLLBACK_REACHED=YES` printed, no `COMMIT` anywhere in output | 0 | — | — |
| M12 | Role-provisioning artifact never executes during construction | static (this task) | files 04/05 | — | — | grep this artifact set's own construction transcript | zero psql/launcher invocations occurred | 0 | — | — |

## NEGATIVE SCOPE (L01–L10)

| ID | NAME | LAYER | FIXTURE | ACTOR | PRECONDITIONS | ACTION | EXPECTED_STATUS | EXPECTED_MUTATION_COUNT | EXPECTED_AUDIT_EVENT | FAIL_CLOSED_REASON |
|---|---|---|---|---|---|---|---|---|---|---|
| L01 | No AHSP import anywhere in RM-02 code | static/grep | RM-02B diff | — | — | grep changed files for AHSP import logic | zero matches | 0 | — | — |
| L02 | No BOQ/AHSP linkage touched | static/grep | same | — | — | grep for `ProjectAhspResourceResolution` writes | zero matches | 0 | — | — |
| L03 | No `BoqItem.unitPrice` write | static/grep + DB_TRANSACTION | same | — | — | grep + run full RM-02 test suite, inspect `boq_items.unitPrice` before/after | zero writes | 0 | — | — |
| L04 | No `BoqItem.lineTotal` write | static/grep + DB_TRANSACTION | same | — | — | same | zero writes | 0 | — | — |
| L05 | No `ProjectAhspOccurrence` write | DB_TRANSACTION | same | — | — | run full RM-02 test suite, inspect table | zero rows created | 0 | — | — |
| L06 | No Cost Kernel execution | static/grep | same | — | — | grep for Cost Kernel invocation | zero matches | 0 | — | — |
| L07 | No RAB lifecycle change | static/grep | same | — | — | grep `RabLifecyclePolicyService` for RM-02 modifications | zero matches beyond read-only reference in design docs | 0 | — | — |
| L08 | No approval/baseline change | static/grep | same | — | — | grep `ProjectBaseline`/`RabDocument` writes | zero matches | 0 | — | — |
| L09 | No RM-12 worker/queue built | static/grep | same | — | — | grep for new `IntakeJob`/worker infrastructure | zero new worker files | 0 | — | — |
| L10 | No `simprok_db` contact during construction | static (this task, and future RM-02B construction) | this task's own transcript / RM-02B's own transcript | — | — | review all Bash/DB tool calls | zero connections to `simprok_db` or port 5432 against a real server | 0 | — | — |

```
FULL_TEST_MATRIX_COMPLETE=YES
Total test count: 142 (A15 + B12 + C10 + D10 + E9 + F14 + G15 + H9 + I8 + J6 + K12 + M12 + L10)
```
