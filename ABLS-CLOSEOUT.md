# ABLS-01 Closeout — 2026-10-30

## Scope and verdict

Bounded implementation and isolated-DB proof are complete. Activation is **HOLD**: no Owner production percentage, approval writer, or production policy row exists. Synthetic policy and authority rows were created **only** in a disposable PostgreSQL instance; 89 migrations applied there, zero migrations applied to production. No production runtime or database was modified.

| Slice | Result | Evidence / boundary |
|---|---|---|
| AB-02 | PASS | Append-only, AHSP-version-scoped policy schema; percentage has no default. |
| AB-03 | PASS | Eligibility requires proven catalog identity `Alat Bantu`, EQUIPMENT, Unit Kernel LS identity, non-conflicting source name, sole row, coefficient 1. |
| AB-04 | PASS | Exact Decimal basis uses the canonical coefficient × adapted-price summation. TEMPORARY_ESTIMATE feeds frozen `estimateDerivedAmount`—not its scale-2 display snapshot—to every Cost Kernel caller. |
| AB-05 | PASS | Frozen resolution stores mode, policy/version/percent, exact basis/derived amount, approval and authority provenance. Legacy rows remain nullable. |
| AB-06 | PASS | Persistence and pre-lock have a specific estimate branch and re-proof; normal Basic Price guards remain intact. |
| AB-07 | PASS | Readback re-proves frozen estimate arithmetic and reports a distinct temporary-estimate count. |
| AB-08 | PASS | Existing RAB UI shows `Estimasi sementara` and never labels the estimate `Auto SIMPROK` or catalog Basic Price. |
| AB-09 | PASS | Synthetic focused tests plus existing backend/frontend regressions pass. |
| AB-10 | PARTIAL / HOLD | Isolated database migration + Prisma/Cost Kernel readback + negative guards PASS. Authenticated browser/API proof, Owner commit/PR PASS, merge, and production activation remain HOLD. |

## Fail-closed facts

- Missing, HOLD, revoked, unauthorized, out-of-scope, or drifted policy produces NEEDS_REVIEW/refusal; it never prices automatically.
- A lawful Basic Price, including explicit zero, wins before the estimate path. Missing price is not converted to zero.
- LABOR/LS, other EQUIPMENT/LS, conflicting names, duplicates, coefficient other than 1, unresolved siblings, and a non-positive basis cannot estimate.
- J.75 with its five other unresolved resources remains held; this implementation does not claim J.75 is priced.
- The exact derived contribution is frozen as `Decimal(48,18)`. `adaptedPriceValue(18,2)` remains a display/legacy snapshot; CostKernelService, persistence, and persisted readback use exact `estimateDerivedAmount` for TEMPORARY_ESTIMATE.
- A half-cent boundary proof produces Rp100.01 from exact math versus Rp100.00 after the rejected premature scale-2 rounding.

## Validation

- `prisma validate`: PASS (schema-only dummy URL; no connection).
- `prisma generate`: PASS, Prisma Client 6.4.1.
- Backend `npm run build`: PASS.
- ABLS Jest: PASS — 1 suite, **15 tests**, including precise-money, membership authority, as-of-date refusal and fail-closed evidence.
- Existing targeted regression Jest: PASS — 5 suites, 144 tests.
- Frontend `npm test`: PASS — 1,794 tests, including the distinct estimate-origin assertion.
- Frontend `npm run build`: PASS.
- Isolated database E2E: PASS. PostgreSQL 17.10 on 127.0.0.1:55445, simprok_abls01_isolated; **89/89** migrations PASS; synthetic policy/resource/occurrence data committed; independent Prisma readback and single Cost Kernel recompute PASS (unit 205, volume 3, total 615); four database negative guard cases PASS. Instance was safely stopped; port 55445 closed. Full authenticated API E2E NOT RUN.
- Independent read-only review found one P2: omitted approver account/position IDs in persisted API proof. Both response fields were added to backend contract/mapping and optional frontend wire contract; post-review backend build PASS, **159/159** focused backend tests PASS, **1,794/1,794** frontend tests PASS and frontend build PASS.
- Browser review: NOT RUN; Owner PASS remains required.

## Activation dependency

The governed authority code is `AHSP_AUXILIARY_EQUIPMENT_ESTIMATE_APPROVE`. A separate Owner-approved ceremony/writer must append an approved scoped policy with the actual percentage and full authority evidence. Until that operational dependency and browser review are proven, activation stays HOLD.
