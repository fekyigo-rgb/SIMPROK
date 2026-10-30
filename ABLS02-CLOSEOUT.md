# AHSP-ABLS-02 — Automatic Policy Selection & Inheritance

Date: 2026-10-30 | Owner-authorized isolated implementation | Gate: local engineering proof.

## Result
A single shared selector is now used by the AHSP prospective resource resolver and RAB persistence: AHSP_VERSION -> deepest canonical CLASSIFICATION_NODE -> WORKSPACE_FALLBACK. It uses active AhspClassificationAssignment and ConstructionClassificationNode ancestry; no new classification engine, Cost Kernel, Unit Kernel, price kernel, or Basic Price. No modal or per-project user approval was added.

A once-approved central policy can be inherited automatically by subsequent projects. Invalid approval, conflicting equally deep groups, changed policies, or missing policy must fail closed. PR #234 calculation and frozen estimate metadata remain the sole arithmetic and provenance path.

## Files
- backend/prisma/schema.prisma
- backend/prisma/migrations/20261030150000_ahsp_abls02_policy_inheritance/migration.sql
- backend/src/project-ahsp/auxiliary-equipment-estimate.policy.ts
- backend/src/project-ahsp/ahsp-resource-resolution.orchestrator.ts
- backend/src/project/rab-kernel-persistence.service.ts
- backend/src/project-ahsp/auxiliary-equipment-estimate.spec.ts
- backend/src/project-ahsp/auxiliary-equipment-policy-inheritance.spec.ts

## Verified PASS
- Prisma validate and generate: PASS, isolated worktree.
- Backend Nest build: PASS.
- Full backend Jest before the final ancestry hardening: **284/284 suites PASS, 4,838 tests PASS, 9 skipped**. After the narrow ancestry fix: eight affected regression suites **180/180 PASS**; backend build PASS.
- ABLS-02 policy selection unit tests: **16/16 PASS** (included in 180), including invalid parent, malformed classification level, and legal leaf specificity.
- Disposable PostgreSQL on 127.0.0.1:55448 restored from existing PR234 pre-promotion backup; migration chain 90/90 PASS; the test instance was stopped after proof.
- SQL guards: wrong scope rejected, duplicate fallback version rejected, existing append-only trigger still rejects updates.
- Real Prisma against disposable database with centrally approved synthetic policies: AHSP_VERSION 4%, canonical classification 3%, workspace fallback 2.5% selected automatically; cross-workspace use rejected. All numeric examples TEST-ONLY, never production rates.
- Git diff --check: PASS.
- Permanent runtime remains on main 473218e, clean and running (ports 3000/5173/55432); no production DB migration/write, no commit, no push or merge performed in this slice.

## Outstanding gates
1. Final source review, staging, a single commit, one Draft PR and official CI. Merge remains separately Owner-gated.
2. Separate authorized permanent runtime promotion after CI PASS.
3. Centrally governed one-time numeric rates for workspace fallback and/or canonical groups, with supporting estimation evidence; none was seeded and production remains without an approved percentage. No per-project/user approval is needed once central policy exists.
4. Authenticated production/browser calculation after deployment remains unproven. Live project prices also still depend on all non-auxiliary resources being resolved.

**Engineering verdict: ABLS-02 isolated build/regression/DB selection PASS; awaiting Draft PR/official CI and separate Owner merge + permanent activation approvals.**
