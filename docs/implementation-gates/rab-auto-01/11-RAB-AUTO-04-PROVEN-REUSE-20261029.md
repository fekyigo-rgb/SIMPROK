# RAB-AUTO-04 — Activate existing proven BOQ→AHSP intelligence, without guessing
Date: 2026-10-29 | project SIMPROK / RI-01 | isolated Computer 2
Base: GitHub main 3383cf7 (merged PR #223). Source branch: feat/rab-auto-01-one-real-line-20261028.

## Goal and constitutional boundary
The native SIMPROK engines already decide AHSP eligibility/currentness, resource identity, unit compatibility, regional Basic Price selection and Cost Kernel money. This seam is NOT another AHSP name matcher, a second formula identity classifier or an LLM price generator.

When a person has already governed an AHSP selection on one canonical BOQ source fact in the same project Working Draft, reuse that decision on a second row ONLY if:
- Both BoqItem records have the exact same nonnull wbsNodeId and wbsCode, full source work description and unit; any substantive wording/specification, unit or WBS difference refuses.
- Source is inside the same workspace/project Working Draft, contains an actual selected AHSP version and its original governed occurrence (manual-root decision, createdByAccountId nonnull; auto-derived idempotency prefixes never become a new root).
- Source occurrence's project/workspace/version/date/referenceRegionId exactly equal the current requested decision, and the region is in the project's recorded ProjectRegionSelection.
- There is EXACTLY one proven source for that target. Zero or multiple sources fail closed. Only 2 source rows need be scanned for this decision.
- On POST: current target is wholly undecided: no AHSP version, no working/calculation occurrence, no manual/previously saved pricing.
- Existing selectForBoqItem exclusively performs the transaction, project FOR UPDATE, lifecycle gate, source proof RECHECK inside the same transaction, current AHSP/version eligibility, Unit Kernel, monetary identity, Resource Identity/Basic Price resolution, and append-only persisted occurrence + BOQ association. No new writer or schema.
- Idempotency key includes target, source, version, date and region; payload hash includes optional source row only on auto path; existing manual path remains unchanged.
- Each BOQ line failure stays isolated and honest; zero source => NO_PROVEN_ASSOCIATION, incomplete source => SOURCE_IDENTITY_NOT_ESTABLISHED, ambiguous => MULTIPLE_SOURCE_DECISIONS, invalid dated or regional authority => SOURCE_CONTEXT_NOT_AUTHORIZED, transaction conflict => REUSE_REVALIDATION_REQUIRED.
- No permanent RAB approval, lock, fallback Rp0, or use of AI output as authority.

## User journey (existing RAB page, no new door/module)
- "Lengkapi Otomatis" is one RAB-level action available on a saved editable Working Draft with outstanding BOQ.
- The guarded POST uses only existing project actor/workspace and RAB_DRAFT_EDIT+AHSP_VIEW, up to 25 BOQ items per page.
- When proven source reuse succeeds, the existing RAB-level auto-price-ready operation calls the existing Cost Kernel and canonical RAB persistence. Frozen proof and manual price are protected.
- An Indonesian result message survives RAB reload. If none could be reused, SIMPROK explicitly states it did not guess an AHSP candidate.
- The existing single row manual selection remains available for genuinely first-time human evidence.

## Verification and environmental limitations
- Scoped backend Jest after minimal code preservation patch: 9 suites / **74 tests PASS**, including PR #223 One-Truth import safety/reconciliation, old AHSP search/eligibility, RAB readiness, RAB price-ready, and auto-source transaction refusal.
- Scoped frontend **63/63 PASS**. Backend NestJS production build PASS after minimal code preservation patch; frontend production build PASS after final notice patch.
- ESLint for all new backend files PASS. Existing ProjectAhspService carries pre-existing lint debt; current lint issues <= its legacy baseline. RAB UI lint remains 9 errors/2 warnings, equal to previous baseline, no regression.
- ProjectAhspService originally suffered a broad formatter diff; restored exactly the original source style and retained ONLY 65 lines of surgical addendum, with diff/check/build and 74 tests rerun PASS.
- No permanent simprok_db mutation, no GitHub merge, push, or runtime sync.
- No authenticated browser real-data E2E or persistence/F5 proof yet. Tests use mocks, not proof that every real project has governed source records.
- IMPORTANT: "Uji Klasifikasi dan Konteks" has historically 0 ProjectAhspOccurrence and 0 of 32 linked BOQ. Therefore this restricted reuse path correctly cannot magically bind its first-ever B.64 by name alone. The region selection contains Jakarta Selatan/Menteng/Sawah Besar, not a single unambiguous pricing region.
- Future lawful step for first-time, never-reviewed BOQ is an explicit canonical BOQ–AHSP source association evidence mechanism or a legitimate first Owner decision; then reuse within proven scope. Do not fabricate it from token similarity.

VERDICT: NATIVE PROVEN-DECISION REUSE WIRED LOCALLY; FULL FIRST-EVER BOQ-AHSP AUTOMATION AND LIVE PROOF HOLD.
