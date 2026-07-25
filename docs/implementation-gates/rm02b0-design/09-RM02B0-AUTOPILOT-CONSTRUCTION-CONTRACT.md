# RM-02B0 — RM-02B Autopilot 4/5 Construction Contract

STATUS: `PROVISIONAL_PENDING_ARCHITECT_REVIEW`

This is the fence for a **future** RM-02B construction task. Nothing in this document authorizes that task to begin — it defines what it may touch, once separately invoked, after the gates in `00-RM02B0-FINAL-REPORT.md`'s `NEXT_GATE` chain are satisfied in order.

```
PROPOSED_BRANCH=feat/rm02-basic-price-import
```

## What Autopilot 4/5 may do, once separately authorized

- create the branch/worktree above;
- edit exactly the allowlisted files below;
- create **one** reviewed migration, translating `08-RM02B0-PROVISIONAL-MIGRATION-DESIGN.md` into real Prisma migration files, only after production preflight facts are reconciled;
- start a disposable PostgreSQL instance (never `simprok_db`, never port 5432 against a real server);
- run Prisma migrations only against that disposable instance or `simprok_test`;
- implement `BasicPriceXlsxIntakeAdapter` and `BASIC_PRICE_PARSER_CONTRACT_VERSION`;
- implement preview (batch/row creation from a workbook);
- implement staging (row resolution UI/API);
- implement row resolution (resource/unit assignment, collision surfacing);
- implement `PriceSubmission` creation for resolved rows only;
- implement the publication capability (§8 of the schema contract — Option C);
- implement the shared eligibility policy (§10 of the schema contract);
- implement the Basic Price import/review UI (replacing the current `Sidebar.tsx:27` placeholder door);
- write tests (unit + e2e, matching `10-RM02B0-COMPLETE-TEST-MATRIX.md`);
- run builds (backend, frontend);
- run safe E2E (`npm run test:e2e:safe`, disposable/`simprok_test` only);
- commit, push, open a PR, and wait for CI.

## What Autopilot 4/5 must stop before, unconditionally

- merge;
- any connection to `simprok_db`;
- production role provisioning (files 04/05 remain proposals until separately authorized);
- production preflight execution (files 06/07 remain proposals until separately authorized);
- production migration execution;
- production workbook import.

## Proposed file allowlist

```
PROPOSED_SCHEMA_FILES=
  backend/prisma/schema.prisma (additive changes only, matching 01-RM02B0-SCHEMA-CONTRACT.md)

PROPOSED_MIGRATION_FILES=
  backend/prisma/migrations/<timestamp>_rm02_basic_price_import_foundation/migration.sql
  (single migration, sequenced per 08-RM02B0-PROVISIONAL-MIGRATION-DESIGN.md — split into
  more than one migration file only if Architect determines the Region-FK gating step
  genuinely needs to be separated from the rest after preflight facts are known)

PROPOSED_BACKEND_FILES=
  backend/src/basic-price/basic-price-xlsx-intake.adapter.ts
  backend/src/basic-price/basic-price-xlsx-intake.adapter.spec.ts
  backend/src/basic-price/basic-price-import.service.ts
  backend/src/basic-price/basic-price-import.service.spec.ts
  backend/src/basic-price/basic-price-import.controller.ts
  backend/src/basic-price/basic-price-row-resolution.service.ts
  backend/src/basic-price/basic-price-row-resolution.service.spec.ts
  backend/src/basic-price/basic-price-publication.service.ts
  backend/src/basic-price/basic-price-publication.service.spec.ts
  backend/src/basic-price/basic-price-eligibility.policy.ts
  backend/src/basic-price/basic-price-eligibility.policy.spec.ts
  backend/src/basic-price/dto/*.ts (new DTOs for import/resolve/submit/verify/publish requests)
  backend/src/common/constants/permissions.ts (additive: BASIC_PRICE_IMPORT, BASIC_PRICE_RESOLVE,
    BASIC_PRICE_SUBMIT, BASIC_PRICE_VERIFY, BASIC_PRICE_PUBLISH, BASIC_PRICE_REVIEW_VIEW)
  backend/src/basic-price/basic-price.controller.ts (extend only — reuse the eligibility policy
    in the three existing read methods; do not change existing route paths or response shapes)
  backend/src/basic-price/basic-price.service.ts (refactor to call the shared eligibility
    policy instead of its inline predicate — behavior-preserving only)
  backend/src/basic-price/basic-price.module.ts (wire new providers/controllers)
  backend/src/reality-intake/price-submission-review.service.ts (narrow, targeted change only:
    stop setting BasicPrice.status explicitly in acceptPriceSubmissionReview() so it takes the
    new safe default; do not touch any other method in this file)

PROPOSED_FRONTEND_FILES=
  frontend/src/pages/BasicPriceImportPage.tsx
  frontend/src/pages/BasicPriceReviewPage.tsx (row resolution UI)
  frontend/src/api/basicPriceImport.ts (API client)
  frontend/src/components/layout/Sidebar.tsx (narrow, targeted change only: replace the
    'Placeholder Basic Price' JUJUR-door label/route with the live route; do not touch any
    other sidebar entry)

PROPOSED_TEST_FILES=
  backend/test/acceptance/basic-price-import.e2e-spec.ts
  backend/test/fixtures/basic-price-xlsx.fixture.ts
  (plus the *.spec.ts unit test files listed inline under PROPOSED_BACKEND_FILES above)
```

## Explicit forbidden areas (unconditional, not time-gated)

- RM01B scripts and the `simprok_rm01b_audit` role, in any form;
- AHSP import;
- BOQ/AHSP linkage;
- `ProjectAhspOccurrence` behavior;
- Cost Kernel execution;
- Project lifecycle;
- RAB approval/baseline;
- the generalized Reality Intake worker pipeline (`IntakeJob`/`ExtractionArtifact`/`KnowledgeCandidate`/the three workers) — treated strictly as `REUSE_CANDIDATE`, never as a required dependency (per RM-02A's RM-12 anti-overscope finding, reaffirmed here);
- the RM-12 platform generally;
- any permission change unrelated to the six new Basic-Price-scoped permissions listed above;
- production scripts of any kind;
- any schema model not explicitly listed in `PROPOSED_SCHEMA_FILES` above;
- production seeding;
- current business data, anywhere, in any environment.

```
AUTOPILOT_ALLOWED_FILES=see PROPOSED_* lists above
AUTOPILOT_FORBIDDEN_FILES=everything under backend/src/reality-intake/ EXCEPT the single named line-item change to price-submission-review.service.ts above; everything under backend/scripts/rm01b/; everything AHSP/Cost-Kernel/ProjectAhspOccurrence-related; backend/prisma/seed*.ts (production seeding)
AUTOPILOT_ALLOWED_COMMANDS=git checkout -b, npm run build, npm run test, npm run test:e2e:safe (against disposable/simprok_test only), npx prisma migrate dev/deploy (against disposable/simprok_test only), git add (named files only), git commit, git push, gh pr create
AUTOPILOT_FORBIDDEN_COMMANDS=any command whose DATABASE_URL resolves to simprok_db or port 5432 against a real server; any psql invocation against simprok_db; any invocation of files 04/05/06/07 from this artifact set; git merge; git push --force; gh pr merge
AUTOPILOT_STOP_GATES=before merge; before any simprok_db connection; before production role provisioning; before production preflight; before production migration; before production workbook import
```

## Gate chain this contract sits inside

```
ARCHITECT_FULL_ARTIFACT_REVIEW
→ OWNER_AUTHORIZATION_FOR_DEDICATED_RM02_AUDIT_ROLE
→ RED_ROLE_PROVISION_EXECUTION_AND_POSTCONDITION_PROOF
→ OWNER_RUN_RM02_READ_ONLY_PRODUCTION_PREFLIGHT
→ PRODUCTION_FACT_RECONCILIATION
→ ARCHITECT_FINAL_SCHEMA_CONTRACT
→ RM02B_AUTOPILOT_4_5_CONSTRUCTION   <-- this document governs only this stage
→ PR_AGGREGATE_REVIEW
→ OWNER_MERGE
→ RED_PRODUCTION_MIGRATION_GATE
```

This document does not itself authorize entry into the `RM02B_AUTOPILOT_4_5_CONSTRUCTION` stage — it only defines its boundaries in advance, so that when that stage is eventually authorized, its scope is not decided in the moment.
