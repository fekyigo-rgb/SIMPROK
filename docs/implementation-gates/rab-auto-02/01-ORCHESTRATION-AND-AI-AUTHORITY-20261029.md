# RAB-AUTO-02 — Governing Orchestration and AI Authority Audit
29 October 2026 | Computer 1 isolated from canonical main f0fe040 | Read-only product baseline

## Owner mandate
Enable real, connected RAB intelligence by reusing existing kernels/orchestrators. No rebuild, no duplicate AHSP/BP/Unit/Cost engines. Inspect whether SIMPROK relies on its own intelligence or an external AI orchestra.

## Found actual internal execution
- `ProjectAhspService.searchEligibleVersions`: existing workspace/as-of current eligibility + bounded server-side candidates, optional classification/name/unit preference.
- `ProjectAhspService.selectForBoqItem`: the SINGLE existing transaction-managed binding writer; validates tenancy/working draft, version/currentness, Project lifecycle, region, Unit Kernel compatibility, monetary identity; invokes existing `AhspResourceResolutionOrchestrator` for complete resource + Basic Price resolution; persists occurrence/provenance and BOQ link.
- `CostKernelService` calculates BOQ and batch with authoritative price source and partial subtotal, not an AI model.
- `RabWorkspacePage.handlePickAhsp`: current runtime ONLY calls the above writer on manual click after a selected version AND region; no verified unattended automation route in current main.

## AI orchestra — separate purpose and current actual runtime
- `SimprokIntelligenceOrchestrator` exists with Provider Registry → Provider Adapter → Constitutional AI Boundary → append-only Evidence → **DRAFT-ONLY proposal**.
- `RabIntelligenceProposalService` supplies no trusted Basic Price candidates (`basicPriceCandidates: []`) and bounds BOQ to 20; only APPROVED parent AHSP candidates (up to 25) are exposed. It does NOT call `selectForBoqItem` or Cost Kernel nor write RAB.
- Orchestrator explicitly applies `AHSP_APPLICABILITY_UNVERIFIED`, drops unknown candidate IDs, prevents READY when true domain applicability has not been proven. The AI EF path is hard locked.
- Actual permanent backend env `SIMPROK_AI_PROVIDER` absent -> registry default **disabled**. `OPENAI_API_KEY` and `SIMPROK_OPENAI_MODEL` absent. Thus current runtime RAB arithmetic is **independent of external AI**, whereas optional AI draft assistance is present in code but not enabled in production.
- Authority: canonical facts + deterministic SIMPROK engines must independently prove identity/specification, Unit, Basic Price, as-of, region and calculation. AI cannot promote unproven proposals to verified money.

## Pilot live permanent DB read-only (separate prior evidence)
- Project Uji Klasifikasi dan Konteks: 32 WORK_ITEM, zero linked.
- 5 active AHSP after prior 79 intentionally soft-deleted; B.64 current private DRAFT v1 with source description DS 10A 140×140 cm with cover, output unit m, nine components. Its availability does NOT prove price eligibility.
- BOQ 2.1 unit m volume 1.00 is a candidate for the B.64 formula; BOQ 5.11 unit m1 volume 1.50 is NOT automatically monetarily interchangeable with m.
- Region price authority is not established (project location text blank); do not infer region from IP or user profile.

## New narrow backend delta in this worktree
- Pure READ-ONLY one-BOQ `GET /projects/:projectId/ahsp-occurrences/boq-items/:boqItemId/automation-readiness?businessPricingAsOfDate=...`.
- Uses same trusted ProjectAccess/AHSP_VIEW guards and `ProjectAhspService.searchEligibleVersions` with **empty q**, 50-candidate bound. Returns `NO_ELIGIBLE_AHSP`, `NO_PROVEN_MATCH`, `MULTIPLE_RECOMMENDATIONS`, `CANDIDATE_UNIVERSE_INCOMPLETE`, `CANDIDATE_REQUIRES_IDENTITY_PROOF`, `INCOMPLETE_LINK_REQUIRES_REVIEW`, or `ALREADY_LINKED`.
- No AI provider call, no Resource Identity re-resolve, no second matcher, no DB writes, no second AHSP selector.
- **Crucial limitation:** existing preference is NOT a proven BOQ→AHSP canonical association; a single recommended row does NOT auto-bind; region is not yet lawfully selected. Additional authority is required before the existing binding writer can be called unattended.
- Frontend RAB branch on Computer 2 is currently offline and separately owns AHSP search & exception presentations. This Computer 1 backend branch did NOT touch those source files.

## Status / no false PASS
- Backend isolated npm ci: PASS (835 dependencies installed in this worktree only).
- Focused Jest tests: 3/3 suites **40/40 PASS** covering new readiness gate, eligible AHSP search and AHSP eligibility policy.
- NestJS production backend build: **PASS** after correcting type-only response shaping; no backend source kernel change.
- Scoped ESLint for new controller, service, test, and module: **PASS** (no warnings/errors) after test-only formatting and typed mock corrections.
- Final edited readiness unit suite: **7/7 PASS**; full focused eligibility+search+readiness suite earlier **40/40 PASS**; backend build PASS.
- NO real automatic binding of BOQ 2.1 or real pricing; no authenticated browser readback or isolated-DB end-to-end gate on new route. The new response has NO authority to call the existing canonical write command from a mere ranked candidate.
- No main mutation, no permanent database mutation, no merge, push or runtime promotion.
- Next required seam: canonical BOQ→AHSP association evidence, authorized region/as-of selection, and lawful proof of Basic Price resources before unattended `selectForBoqItem`; reuse proven decisions within scope; honest exceptions for all other rows. DO NOT place an AI-suggested ID into the write endpoint.

VERDICT: deterministic native SIMPROK engines exist; optional AI orchestration is draft-only/disabled in runtime. Read-only orchestration connection implemented in isolated worktree; real automatic binding remains gated.
