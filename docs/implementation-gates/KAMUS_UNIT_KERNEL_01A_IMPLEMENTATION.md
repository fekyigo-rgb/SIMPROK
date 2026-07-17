# KAMUS Unit Kernel 01A Implementation

Status: IMPLEMENTED_ON_BRANCH — READY_FOR_PM_REVIEW

Branch: `feat/kamus-unit-kernel-01a`

Baseline: `e204674790ec4ee1ba1a6232351ccac76ac04a6f`

## Delivered bounded scope

- Backend canonical `UnitDefinition`, `UnitAlias`, and directional `UnitConversionRule` models.
- Conservative NFKC alias resolver with fail-closed unknown, ambiguity, missing evidence, competing-rule, invalid-factor, and not-convertible outcomes.
- Bounded reference identities: PERSON_DAY, KG, M1, M2, M3, SAK, ROLL, and TRUCK. No assumed production package/capacity conversions.
- Phase 2 LABOR cutover consumes validated Unit Kernel metadata; the production kernel no longer owns a hard-coded alias set.
- Future occurrence evidence uses nullable canonical unit/rule identities and `quantityFactor`; legacy `conversionFactor` is no longer written authoritatively.
- New AHSP versions require a uniquely resolved output unit and reject submitted legacy conversion factors.
- Snapshots freeze raw and canonical output-unit identity and reject unresolved output units.
- Internal BOQ/AHSP output-unit compatibility evaluation returns metadata only. No BOQ/RAB quantity or money calculation was introduced.
- Frontend dictionaries remain prototype/preview and non-canonical; no frontend source was changed.

## PM remediation 01

- Removed normalized raw-string equality as the Basic Price unit-compatibility authority.
- `ProjectAhspService` now resolves AHSP-to-catalog units and every resource-matching Basic Price unit through `UnitKernelService`.
- The pure price-resolution kernel consumes typed per-candidate resolver metadata keyed by the Basic Price candidate identity and admits only canonical PERSON_DAY identity/factor-1 outcomes.
- Cross-alias regression intent is preserved: OH and Orang/Hari Basic Price aliases resolve against an Org/Hari catalog unit; Jam remains excluded; one compatible plus one Jam selects the compatible candidate; multiple compatible active candidates remain `NEEDS_REVIEW`.
- Production first-occurrence read-only audit: `BasicPrice` has no independent unit column; its effective unit comes from its ResourceCatalog. The exact selected source and resolved catalog both report `Org/Hari`.

## PM remediation 02

- Resolver metadata is bound to the exact raw source/target pair it certifies for both AHSP-to-catalog and every Basic Price candidate-to-catalog decision.
- Valid PERSON_DAY/factor-1 metadata cannot be reused for a different raw pair; negative kernel tests enforce fail-closed behavior.
- Missing, null, empty, and whitespace-only AHSP `outputUnit` values are rejected as `AHSP_OUTPUT_UNIT_UNRESOLVED` before UnitKernelService or database writes.
- No schema or migration change was introduced by this remediation.

## Database safety

- Legacy audit ran in one `REPEATABLE READ, READ ONLY` transaction.
- Existing non-null legacy factor values were numerically equal to 1.
- Exactly one additive migration was created.
- Migration applied to `simprok_test` by the official guarded E2E runner: YES.
- Migration applied to `simprok_db`: NO.
- Existing Phase 2 occurrence/resolution was not modified, replayed, backfilled, or recalculated.

## Validation evidence

- `prisma format`: PASS
- `prisma validate`: PASS
- `prisma generate`: PASS
- Focused unit/regression: 6 suites / 65 tests PASS
- Backend unit: 37 suites / 321 tests PASS
- Backend build: PASS
- Official safe E2E: 19 suites / 190 tests PASS; database guard PASS; residual PASS; advisory lock released
- Frontend unchanged-regression build: PASS

## Closed boundaries preserved

01B, package-price adaptation, material/equipment Project AHSP resolution, AHSP unit-price, Cost Kernel, Execution Factor, BOQ/RAB arithmetic, frontend production work, runtime/API proof, override, and snapshot backfill remain closed.
