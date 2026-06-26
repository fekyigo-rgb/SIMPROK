# SIMPROK REALITY AUDIT-001

Date: 2026-06-26  
Scope: Repository reality evidence harvest for SCM-001  
Mode: read-only repository audit + evidence reporter

This audit does not close any roadmap.  
This audit does not authorize implementation.  
This audit does not modify repository production code, schema, or migrations.  
This audit only reports installed reality.

## 1. Repository State Snapshot

Command evidence:

- `cd C:\SIMPROK; git status`: FAIL, `fatal: not a git repository (or any of the parent directories): .git`.
- `cd C:\SIMPROK\backend; git status --short --branch`: PASS, branch `master`, dirty working tree.

Root folder structure from `dir C:\SIMPROK`:

- `adr`
- `architecture`
- `backend`
- `docs`
- `frontend`
- `package-lock.json`
- `workspace-files.txt`

Folder existence:

- Backend exists: `C:\SIMPROK\backend`
- Frontend exists: `C:\SIMPROK\frontend`

Package manager evidence:

- Root: `package-lock.json`
- Backend: `package.json`, `package-lock.json`, `node_modules`
- Frontend: `package.json`, `package-lock.json`, `node_modules`

Git state:

- Root repository status: git unavailable at `C:\SIMPROK`
- Backend repository status: branch `master`
- Dirty working tree: yes
- Modified tracked examples: `package.json`, `package-lock.json`, `prisma/schema.prisma`, `src/app.module.ts`, auth/organization/prisma/users files, `tsconfig.build.json`
- Deleted tracked examples: `prisma.config.ts`, `scripts/assign-role-to-user.ts`, `scripts/seed-role-permissions.ts`, `scripts/seed-roles.ts`
- Untracked examples: `REPORT-BASELINE-002.md`, `baseline-002-artifacts/`, `generated/`, multiple Prisma migrations, seed files, `src/ahsp/`, `src/project/`, `src/reality-intake/`, `src/progress/`, acceptance tests

## 2. Backend Inventory

Backend top-level entries:

- Directories: `baseline-002-artifacts`, `coverage`, `dist`, `generated`, `node_modules`, `prisma`, `scripts`, `src`, `test`
- Key files: `.env`, `.gitignore`, `package.json`, `package-lock.json`, `README.md`, `nest-cli.json`, `tsconfig.json`, `tsconfig.build.json`
- Existing generated/report artifacts: `REPORT-BASELINE-002.md`, PDFs/text/scripts in backend root

Backend package scripts from `package.json`:

- `build`: `nest build`
- `format`: `prettier --write "src/**/*.ts" "test/**/*.ts"`
- `start`: `nest start`
- `start:dev`: `nest start --watch`
- `start:debug`: `nest start --debug --watch`
- `start:prod`: `node dist/main`
- `db:seed:acceptance`: `ts-node prisma/seed-acceptance.ts`
- `lint`: `eslint "{src,apps,libs,test}/**/*.ts" --fix`
- `test`: `jest`
- `test:watch`: `jest --watch`
- `test:cov`: `jest --coverage`
- `test:debug`: `node --inspect-brk -r tsconfig-paths/register -r ts-node/register node_modules/.bin/jest --runInBand`
- `test:e2e`: `jest --config ./test/jest-e2e.json`

Backend `src` module structure:

- `ahsp`
- `audit`
- `auth`
- `authority`
- `common`
- `organization`
- `permissions`
- `prisma`
- `progress`
- `project`
- `reality-intake`
- `roles`
- `users`
- `workspace`
- `workspace-membership`

Prisma:

- `prisma/schema.prisma`: present
- `prisma/migrations`: present
- Seed files present: `seed.ts`, `seed-auth.ts`, `seed-foreman.ts`, `seed-step03.ts`, `seed-acceptance.ts`

Tests:

- Backend root test folder exists: `test`
- Unit/spec files exist under `src`
- Acceptance/e2e files exist under `test/acceptance`

## 3. Prisma / Schema Reality

`npx prisma validate`:

- First sandbox run: FAIL, Prisma attempted `https://binaries.prisma.sh/.../schema-engine.exe.gz.sha256` and failed with `connect ECONNREFUSED 127.0.0.1:9`.
- Escalated rerun: PASS, exit code `0`.

All models found in `prisma/schema.prisma`:

`Account`, `Organization`, `Workspace`, `WorkspaceMembership`, `User`, `Permission`, `Role`, `RolePermission`, `MembershipRole`, `Position`, `PositionAssignment`, `ApprovalMatrix`, `Project`, `ProjectContract`, `ProjectStakeholder`, `ProjectAssignment`, `WbsNode`, `AHSP`, `AHSPVersion`, `AHSPResource`, `AHSPSourceDocument`, `AHSPImportJob`, `AHSPImportLine`, `AHSPImportEvidence`, `AHSPSnapshot`, `AHSPSnapshotResource`, `AHSPAuditLog`, `Authority`, `PositionAuthority`, `ResourceCatalog`, `PriceSubmission`, `PriceSubmissionRevision`, `PriceSubmissionAudit`, `SourceDocument`, `IntakeJob`, `ExtractionArtifact`, `CanonicalPricePoint`, `KnowledgeCandidate`, `ValidationResult`, `ReviewTask`, `ReviewDecision`, `PriceSubmissionReview`, `PriceSubmissionReviewDecision`, `KnowledgeEvent`, `BasicPrice`, `BoqStructure`, `BoqItem`, `RabDocument`, `ProjectBaseline`, `ProgressReport`, `ProgressEntry`, `DeviationSignal`, `ProjectRisk`, `ProjectForecast`, `Recommendation`, `RecommendationOption`, `FormalDecision`.

All enums found:

`AccountStatus`, `OrganizationType`, `MembershipStatus`, `UserStatus`, `ProjectType`, `ProjectStatus`, `StakeholderType`, `AssignmentStatus`, `WbsNodeType`, `MethodType`, `LocationType`, `AhspVersionStatus`, `SourceType`, `ImportStatus`, `OwnershipType`, `ReviewStatus`, `ResourceType`, `PriceSourceType`, `PriceVerificationStatus`, `PriceSourceOrigin`, `PriceFreshnessStatus`, `PriceSubmissionStatus`, `PriceSubmissionActorType`, `IntakeJobStatus`, `KnowledgeLifecycleStatus`, `ValidationStatus`, `ReviewSlaState`, `ReviewActionType`, `PriceReviewActionType`, `BoqItemType`, `DeviationType`, `SeverityLevel`, `PriorityLevel`, `TrendDirection`, `RiskCategory`, `RiskStatus`, `ConfidenceLevel`, `RecommendationTrigger`, `RecommendationCategory`, `RecommendationStatus`, `DecisionStatus`.

Important relations observed:

- `Workspace.organizationId -> Organization`
- `WorkspaceMembership.accountId -> Account`, `WorkspaceMembership.workspaceId -> Workspace`
- `Role.workspaceId -> Workspace`
- `Project.workspaceId -> Workspace`, `Project.organizationId -> Organization`
- `ProjectContract.projectId -> Project`
- `ProjectStakeholder.projectId -> Project`, `ProjectStakeholder.workspaceId -> Workspace`
- `ProjectAssignment.projectId -> Project`
- `WbsNode.projectId -> Project`
- AHSP/AHSPSnapshot/ResourceCatalog/PriceSubmission/BasicPrice have workspace tenant relations where defined
- Reality intake models are linked by `SourceDocument`, `IntakeJob`, `ExtractionArtifact`, `KnowledgeCandidate`, `ValidationResult`, `KnowledgeEvent`
- Price review models link `PriceSubmissionReview.priceSubmissionId -> PriceSubmission`, decisions to review/user
- Project runtime models link `BoqStructure`, `RabDocument`, `ProjectBaseline`, `ProgressReport`, `ProgressEntry`, `DeviationSignal`, `ProjectRisk`, `ProjectForecast`, `Recommendation`, `FormalDecision` to `Project`

Tenant fields observed:

- `accountId`: `WorkspaceMembership`, indexes/unique; price submission audit/account fields also use account references.
- `workspaceId`: present across `WorkspaceMembership`, `User`, `Role`, `Position`, `ApprovalMatrix`, `Project`, `ProjectStakeholder`, AHSP, `ResourceCatalog`, price governance, reality intake, knowledge, basic price.
- `organizationId`: present on `Workspace`, `Project`, price governance, reality intake, knowledge, basic price.
- `projectId`: present on contracts, stakeholders, assignments, WBS, BOQ/RAB/baseline/progress/deviation/risk/forecast/recommendation/decision.

Audit-related models:

- `AHSPAuditLog`
- `PriceSubmissionAudit`
- `KnowledgeEvent` with provenance chain
- No generic persistent project-access audit model found in schema.

Reality Intake models:

- `SourceDocument`
- `IntakeJob`
- `ExtractionArtifact`
- `CanonicalPricePoint`
- `KnowledgeCandidate`
- `ValidationResult`
- `ReviewTask`
- `ReviewDecision`
- `KnowledgeEvent`

Price Governance models:

- `ResourceCatalog`
- `PriceSubmission`
- `PriceSubmissionRevision`
- `PriceSubmissionAudit`
- `PriceSubmissionReview`
- `PriceSubmissionReviewDecision`
- `BasicPrice`
- Supporting enums: source type, verification status, source origin, freshness, submission status, actor type, SLA, review action.

Project models:

- `Project`
- `ProjectContract`
- `ProjectStakeholder`
- `ProjectAssignment`
- `WbsNode`
- `BoqStructure`
- `BoqItem`
- `RabDocument`
- `ProjectBaseline`
- `ProgressReport`
- `ProgressEntry`
- `DeviationSignal`
- `ProjectRisk`
- `ProjectForecast`
- `Recommendation`
- `RecommendationOption`
- `FormalDecision`

User/Auth/RBAC models:

- `Account`
- `User`
- `WorkspaceMembership`
- `Role`
- `Permission`
- `RolePermission`
- `MembershipRole`
- `Position`
- `PositionAssignment`
- `ApprovalMatrix`
- `Authority`
- `PositionAuthority`

## 4. Migration Reality

Migration folder exists: `prisma/migrations`

Migration entries:

- `20260530065635_init`
- `20260530114809_add_rbacnpx`
- `20260531174021_add_user_password_hash`
- `20260603063535_add_organization`
- `20260608000000_add_workspace_foundation`
- `20260608214943_workspace_membership_foundation`
- `20260611134031_authority_foundation`
- `20260612055148_rbac_foundation`
- `20260615153231_init_project_engine`
- `20260616025156_schema_baseline_001`
- `20260617092356_ahsp_domain`
- `20260618014215_add_ownership_and_review_status_to_ahsp`
- `20260619101739_init_intelligence_domains`
- `20260624091701_baseline_002_rework`
- `20260624110043_step_1_3_price_submission`
- `20260625022625_fase2_step_2_1_zone_schema_foundation`
- `20260626044807_step_2_6b_schema_patch_001`
- `migration_lock.toml`

Last migration:

- `20260626044807_step_2_6b_schema_patch_001`

Baseline migration evidence:

- Initial migration exists: `20260530065635_init`
- Baseline migration exists: `20260616025156_schema_baseline_001`
- Baseline 002 rework exists: `20260624091701_baseline_002_rework`

STEP-2.6b migration evidence:

- `20260626044807_step_2_6b_schema_patch_001` exists
- It creates `PriceReviewActionType`, `price_submission_reviews`, `price_submission_review_decisions`, indexes, and foreign keys.
- It warns a unique constraint on `basic_prices.sourceSubmissionId` may fail if duplicates exist.

Potentially unclear/suspicious migration naming:

- `20260530114809_add_rbacnpx` includes `npx` in name.
- Multiple migrations are untracked in backend git status.
- Migration lock file is modified.

No migrations were executed.

## 5. Backend Capability Inventory

Legend: yes means repository file evidence exists. no means not found in repository evidence for that axis.

| Domain | Capability | File path found | Service | Controller | Module | Schema Model | Test | Runtime Evidence | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Identity & Security | Account | `src/auth/*`, `prisma/schema.prisma` | yes | yes | yes | yes | no direct | build PASS | Auth service registers/logins against `Account`. |
| Identity & Security | User | `src/users/users.service.ts`, schema | yes | no | yes | yes | no | build PASS | Users module present; no users controller found. |
| Identity & Security | Workspace | `src/workspace/*` | yes | yes | yes | yes | yes | build PASS, tests FAIL | Workspace tests exist but fail due missing providers. |
| Identity & Security | Organization | `src/organization/*` | yes | yes | yes | yes | no | build PASS | CRUD controller exists. |
| Identity & Security | Workspace Membership | `src/workspace-membership/*` | yes | yes | yes | yes | no direct | build PASS | Controller has read/update-style routes. |
| Identity & Security | Authentication | `src/auth/auth.controller.ts`, `src/auth/auth.service.ts` | yes | yes | yes | yes | no direct | build PASS | Register, login, profile endpoints. |
| Identity & Security | Authorization | guards/decorators | yes | yes by guarded controllers | yes | yes | partial | build PASS | Guards exist and used. |
| Identity & Security | RBAC | roles/permissions/membership roles | partial | partial | yes | yes | no direct | build PASS | `RolesModule`, `PermissionsModule`, guards; no roles controller found. |
| Identity & Security | Permission | `src/permissions`, decorators/guard | partial | no | yes | yes | no direct | build PASS | Permission guard/decorator present. |
| Identity & Security | JWT | `src/auth/strategies/jwt.strategy.ts`, `jwt-auth.guard.ts` | yes | yes | yes | n/a | no direct | build PASS | JWT auth guard/strategy present. |
| Identity & Security | Project Access Guard | `src/auth/guards/project-access.guard.ts` | guard yes | n/a | via auth/app usage | yes | yes | build PASS, test suite partly FAIL overall | Guard has spec file; TODO notes for admin bypass/audit/lifecycle restrictions. |
| Project Foundation | Project | `src/project/*` | yes | yes | yes | yes | no direct | build PASS | CRUD/read endpoints and intelligence rooms data access. |
| Project Foundation | Project Assignment | `ProjectAssignment` schema, guard usage | partial | no direct | partial | yes | guard test | build PASS | Guard checks assignment; no standalone assignment controller found. |
| Project Foundation | Project Team | `ProjectStakeholder`, `ProjectAssignment` schema | partial | no direct | no direct | yes | no | schema/build | No explicit team runtime module found. |
| Project Foundation | WBS | `WbsNode` schema, project setup DTO uses WBS code | partial | partial via project initiate | yes | yes | no | build PASS | No standalone WBS controller found. |
| Project Foundation | Project Status | `ProjectStatus`, project service | yes | yes | yes | yes | no direct | build PASS | Service updates project to `ACTIVE`. |
| Project Foundation | Baseline | `ProjectBaseline`, project service | yes | yes via initiate | yes | yes | no direct | build PASS | Baseline created in project setup. |
| Project Foundation | Versioning | version fields on baseline/RAB/AHSP/intake | partial | partial | partial | yes | no direct | build PASS | No general project versioning service found. |
| Reality Intake | Upload | `src/reality-intake/upload.controller.ts` | yes | yes | yes | yes | e2e | build PASS, tests FAIL overall | XLSX/PDF upload endpoint. |
| Reality Intake | IntakeJob | `intake-enqueue.service.ts`, schema | yes | upload controller | yes | yes | unit/e2e | build PASS | Enqueues `QUEUED` jobs with idempotency. |
| Reality Intake | Queue | `intake-enqueue.service.ts` | yes | upload controller | yes | yes | unit/e2e | build PASS | DB-backed queue status; no external queue found. |
| Reality Intake | Worker | extraction/understanding/publication/business services | yes | no | yes | yes | e2e | build PASS | Workers run only if env flags are true. |
| Reality Intake | Extraction | `extraction-worker.service.ts`, `xlsx-extraction.helper.ts` | yes | no | yes | yes | e2e | build PASS | XLSX supported; PDF extraction deferred in code. |
| Reality Intake | Understanding | `understanding-validation.service.ts` | yes | no | yes | yes | e2e | build PASS | Header dictionary/rule-based price point understanding. |
| Reality Intake | Validation | `understanding-validation.service.ts`, `ValidationResult` | yes | no | yes | yes | e2e | build PASS | Produces `ValidationResult`. |
| Reality Intake | Publication | `publication-worker.service.ts` | yes | no | yes | yes | e2e | build PASS | Publishes validated price-point candidates to `KnowledgeEvent`. |
| Reality Intake | KnowledgeEvent | `KnowledgeEvent` schema, publication/business services | yes | no | yes | yes | e2e | build PASS | Append-like events present; immutability not fully proven by tests here. |
| Knowledge Foundation | Knowledge Repository | `KnowledgeEvent`, `KnowledgeCandidate`, canonical models | partial | no | via reality-intake | yes | e2e | build PASS | Repository exists as schema/service path, no standalone knowledge module/controller found. |
| Knowledge Foundation | Knowledge Event | `KnowledgeEvent` | yes | no | via reality-intake | yes | e2e | build PASS | Publication creates event records. |
| Knowledge Foundation | Canonical Data | `CanonicalPricePoint` | yes | no | via reality-intake | yes | e2e | build PASS | Canonical price point creation in understanding service. |
| Knowledge Foundation | Knowledge Envelope | `KnowledgeCandidate.envelopeId` implied by publication using candidate id as envelope | partial | no | via reality-intake | partial | e2e | build PASS | No model literally named `KnowledgeEnvelope`. |
| Knowledge Foundation | Append Only | `KnowledgeEvent` with sequence/revision | partial | no | partial | yes | partial | build PASS | Append-only behavior not fully proven by repository audit. |
| Knowledge Foundation | Immutability | UNKNOWN / NOT FOUND IN REPOSITORY | no | no | no | unknown | no | unknown | No clear immutable enforcement found. |
| Knowledge Foundation | Version History | revisions/version fields | partial | no | partial | yes | partial | build PASS | Present in schema fields; not a standalone capability. |
| Price Governance | Resource Catalog | schema, business subscription | partial | no | via services | yes | acceptance indirect | build PASS | No controller found for catalog management. |
| Price Governance | Basic Price | `BasicPrice`, price review service | yes | no | via reality-intake | yes | acceptance | build PASS | Created on accepted price submission review. |
| Price Governance | Price Submission | schema, business subscription | yes | no | via reality-intake | yes | acceptance | build PASS | Business subscription creates submissions. |
| Price Governance | Price Review | `price-submission-review.service.ts` | yes | no | yes | yes | acceptance | build PASS | No HTTP controller found for review actions. |
| Price Governance | SLA | review service | yes | no | yes | yes | acceptance | build PASS | Escalated/expired transitions implemented. |
| Price Governance | Human Review | review service | yes | no | yes | yes | acceptance | build PASS | Accept/reject/correction/reassign methods exist. |
| Price Governance | Region | `regionId` fields | no direct | no | no | partial | no | schema only | No `Region` model found in model list. |
| Price Governance | Verification | review/basic price statuses | yes | no | yes | yes | acceptance | build PASS | `VERIFIED`/`PUBLISHED` transitions. |
| Price Governance | Freshness | `PriceFreshnessStatus`, `BasicPrice.freshnessStatus` | partial | no | partial | yes | no direct | schema/build | Freshness status exists; no full freshness engine found. |
| Price Governance | Audit Trail | `PriceSubmissionAudit`, AHSP audit | yes | no | yes | yes | acceptance | build PASS | Audit rows created by service methods. |

## 6. Frontend Capability Inventory

Frontend structure:

- `src/App.tsx`
- `src/contexts/AuthContext.tsx`
- `src/components/atoms`
- `src/components/molecules`
- `src/components/organisms`
- `src/components/layout`
- `src/pages`
- `src/pages/field`

Routes from `src/App.tsx`:

- `/login`
- `/workspace-select`
- `/`
- `/project/new`
- `/project/:id`
- `/showcase`
- `/field`
- `/field/project/:projectId`
- `/field/project/:projectId/progress/:boqItemId`

API connectivity evidence:

- Real HTTP calls use hardcoded `http://localhost:3000`.
- `AuthContext` calls `/auth/profile`.
- `LoginPage` calls `/auth/login`.
- `ObservatoryPage` calls `/projects`.
- `ProjectSetupPage` calls `/projects` and `/projects/:id/initiate`.
- `ProjectWarRoomPage` calls `/projects/:id`, `/reality`, `/horizon`, `/storm`, `/wisdom`, `/authority`.
- Field pages call `/projects/workspace/:workspaceId`, `/projects/:projectId/boq`, `/projects/:projectId/progress/field`.
- No central API client folder found.

| UI Capability | File path | Real API or Mock | Language | Connected to Backend | Shell Only |
| --- | --- | --- | --- | --- | --- |
| Auth UI | `src/pages/LoginPage.tsx`, `src/contexts/AuthContext.tsx` | real API | English | yes | no |
| Workspace Select | `src/pages/WorkspaceSelectPage.tsx` | account context from backend profile | English | partial | no |
| Dashboard / Observatory | `src/pages/ObservatoryPage.tsx`, dashboard layout/components | real `/projects` API plus fallback labels | English | yes | partial |
| Project Setup | `src/pages/ProjectSetupPage.tsx` | real `/projects` and `/initiate` API | English | yes | no |
| Project War Room | `src/pages/ProjectWarRoomPage.tsx` | real project APIs; seed-only warnings in Horizon/Storm/Wisdom | English | yes | partial |
| Reality UI | `ProjectWarRoomPage`, `ProgressCard`, `DeviationSignal` | real `/reality`; some UI comments/mock planned variance labels | English | yes | partial |
| Progress / Field UI | `src/pages/field/*` | real project/BOQ/progress APIs | English | yes | no |
| Price Governance UI | UNKNOWN / NOT FOUND IN REPOSITORY | not found | unknown | no | not found |
| Reality Intake UI | UNKNOWN / NOT FOUND IN REPOSITORY | not found | unknown | no | not found |
| War Room UI | `src/pages/ProjectWarRoomPage.tsx` | mixed real APIs and seed-only/engine-not-activated panels | English | yes | partial |
| Observatory UI | `src/pages/ObservatoryPage.tsx` | real `/projects` API | English | yes | partial |
| Showcase UI | `src/pages/ShowcasePage.tsx` | visual showcase/static props | English | no direct evidence | yes |

Frontend build reality:

- `npm run build`: FAIL.
- Errors include unused React imports, `ProjectCardProps` mismatch on `lastUpdated`, number state setters receiving strings in `ProjectSetupPage`, unused imports in `ProjectWarRoomPage`, and `certaintyLevel="C0"` not assignable to `"C1" | "C2"`.

## 7. Test Inventory

Backend test scripts:

- Unit/spec: `npm test`
- E2E: `npm run test:e2e`
- Coverage: `npm run test:cov`

Unit/spec files found:

- `src/app.controller.spec.ts`
- `src/workspace/workspace.service.spec.ts`
- `src/workspace/workspace.controller.spec.ts`
- `src/reality-intake/intake-enqueue.service.spec.ts`
- `src/auth/guards/project-access.guard.spec.ts`
- `src/ahsp/services/ahsp.service.spec.ts`
- `src/ahsp/services/ahsp-version.service.spec.ts`
- `src/ahsp/services/ahsp-snapshot.service.spec.ts`
- `src/ahsp/services/ahsp-import.service.spec.ts`
- `src/ahsp/services/ahsp-audit.service.spec.ts`
- `src/ahsp/domain/ahsp-ownership.policy.spec.ts`

Integration/e2e/acceptance files found:

- `test/app.e2e-spec.ts`
- `test/acceptance/project-access.e2e-spec.ts`
- `test/acceptance/reality-intake-upload.e2e-spec.ts`
- `test/acceptance/reality-intake-extraction.e2e-spec.ts`
- `test/acceptance/reality-intake-understanding-validation.e2e-spec.ts`
- `test/acceptance/reality-intake-publication.e2e-spec.ts`
- `test/acceptance/reality-intake-business-subscription.e2e-spec.ts`
- `test/acceptance/reality-intake-price-submission-review.e2e-spec.ts`

Requested lists:

- Reality-intake tests: upload, extraction, understanding-validation, publication, business-subscription acceptance specs; `intake-enqueue.service.spec.ts`.
- Price-submission-review tests: `test/acceptance/reality-intake-price-submission-review.e2e-spec.ts`.
- Project-access-guard tests: `src/auth/guards/project-access.guard.spec.ts`, `test/acceptance/project-access.e2e-spec.ts`.

`npm test` result:

- FAIL.
- Summary: `Test Suites: 8 failed, 3 passed, 11 total`; `Tests: 8 failed, 27 passed, 35 total`.
- Common failures: Nest cannot resolve dependencies because test modules omit providers/imports such as `PrismaService`, `WorkspaceService`, `AhspAuditService`.

`npm run test:e2e` was not run because `npm test` already failed and e2e may require runtime/database environment.

## 8. Build / Runtime Verification

Backend:

- `npm run build`: PASS, output `nest build`, exit code `0`.
- `npx prisma validate`: PASS after escalated rerun, exit code `0`.
- `npm test`: FAIL as described above.

Frontend:

- `npm run build`: FAIL.
- Important errors:
  - Many `TS6133` unused React/import declarations.
  - `ExecutiveDashboard.tsx` and `ShowcasePage.tsx`: `lastUpdated` prop does not exist on `ProjectCardProps`.
  - `ProjectSetupPage.tsx`: string assigned to numeric state setters.
  - `ProjectWarRoomPage.tsx`: `certaintyLevel="C0"` not assignable to allowed type `"C1" | "C2"`.

Dependency/environment issue:

- Initial Prisma validate required schema-engine access and failed under restricted sandbox network.

## 9. SCM Mapping Draft

| Domain | Capability | Schema | Backend Runtime | Frontend Runtime | Test | Verified | Evidence | PM Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Identity & Security | Account/Auth/JWT | PRESENT | PRESENT | PRESENT | PARTIAL | RUNTIME_NO_TEST | `Account`, auth controller/service, login UI | RUNTIME_NO_TEST |
| Identity & Security | Workspace | PRESENT | PRESENT | PRESENT | FAILING | RUNTIME_NO_TEST | workspace module/controller, workspace select UI | RUNTIME_NO_TEST |
| Identity & Security | Organization | PRESENT | PRESENT | NOT_FOUND | UNKNOWN | RUNTIME_NO_TEST | organization controller/service | RUNTIME_NO_TEST |
| Identity & Security | RBAC/Permission | PRESENT | PARTIAL | PARTIAL | UNKNOWN | RUNTIME_NO_TEST | roles/permissions guards/decorators | RUNTIME_NO_TEST |
| Identity & Security | Project Access Guard | PRESENT | PRESENT | n/a | PARTIAL/FAILING OVERALL | RUNTIME_NO_TEST | guard file/spec/e2e file, build PASS, npm test FAIL | RUNTIME_NO_TEST |
| Project Foundation | Project CRUD/View | PRESENT | PRESENT | PRESENT | UNKNOWN | RUNTIME_NO_TEST | project controller/service, observatory/war room | RUNTIME_NO_TEST |
| Project Foundation | Project Assignment | PRESENT | PARTIAL | UNKNOWN | PARTIAL | RUNTIME_NO_TEST | schema + guard check | RUNTIME_NO_TEST |
| Project Foundation | WBS/BOQ/RAB/Baseline | PRESENT | PARTIAL | PRESENT | UNKNOWN | RUNTIME_NO_TEST | project initiate service, setup/field pages | RUNTIME_NO_TEST |
| Project Foundation | Forecast/Risk/Recommendation/Decision | PRESENT | PARTIAL | MOCK_OR_SEED_INDICATED | UNKNOWN | RUNTIME_NO_TEST | project service reads tables; UI says seed-only/engine not activated | RUNTIME_NO_TEST |
| Reality Intake | Upload/Enqueue | PRESENT | PRESENT | NOT_FOUND | PRESENT BUT OVERALL FAIL | RUNTIME_NO_TEST | upload controller, enqueue service, acceptance tests | RUNTIME_NO_TEST |
| Reality Intake | Extraction | PRESENT | PRESENT | NOT_FOUND | PRESENT | RUNTIME_NO_TEST | extraction worker, XLSX helper | RUNTIME_NO_TEST |
| Reality Intake | Understanding/Validation | PRESENT | PRESENT | NOT_FOUND | PRESENT | RUNTIME_NO_TEST | understanding-validation service | RUNTIME_NO_TEST |
| Reality Intake | Publication | PRESENT | PRESENT | NOT_FOUND | PRESENT | RUNTIME_NO_TEST | publication worker | RUNTIME_NO_TEST |
| Knowledge Foundation | Knowledge Event/Canonical Price | PRESENT | PRESENT | NOT_FOUND | PRESENT | RUNTIME_NO_TEST | knowledge event/canonical models/services | RUNTIME_NO_TEST |
| Knowledge Foundation | Immutability | UNKNOWN | UNKNOWN | NOT_FOUND | UNKNOWN | UNKNOWN | No explicit enforcement found | UNKNOWN |
| Price Governance | Resource Catalog | PRESENT | PARTIAL | NOT_FOUND | PARTIAL | RUNTIME_NO_TEST | schema + business subscription | RUNTIME_NO_TEST |
| Price Governance | Price Submission | PRESENT | PRESENT | NOT_FOUND | PRESENT | RUNTIME_NO_TEST | business subscription creates submissions | RUNTIME_NO_TEST |
| Price Governance | Price Review/Human Review/SLA | PRESENT | PRESENT | NOT_FOUND | PRESENT | RUNTIME_NO_TEST | review service + acceptance file | RUNTIME_NO_TEST |
| Price Governance | Basic Price | PRESENT | PRESENT | NOT_FOUND | PRESENT | RUNTIME_NO_TEST | review accept creates basic price | RUNTIME_NO_TEST |
| Price Governance | Region | SCHEMA_ONLY | NOT_FOUND | NOT_FOUND | NOT_FOUND | SCHEMA_ONLY | `regionId` fields, no `Region` model found | SCHEMA_ONLY |
| Progress | Field Progress | PRESENT | PRESENT | PRESENT | UNKNOWN | RUNTIME_NO_TEST | progress controller/service, field UI | RUNTIME_NO_TEST |
| Frontend | App Build | n/a | n/a | PRESENT_BUT_FAILING | n/a | NOT_FOUND | frontend build FAIL | NOT_FOUND |

Rule note: `VERIFIED` is not assigned to product capabilities because test/build/runtime evidence is mixed: backend build and Prisma validate pass, but `npm test` fails and frontend build fails.

## 10. Gap Register

| Gap ID | Domain | Capability | Finding | Evidence | Impact | Recommended Next Action |
| --- | --- | --- | --- | --- | --- | --- |
| GAP-REPO-001 | Repository | Root Git | `C:\SIMPROK` is not a git repository. | `git status` at root failed. | Root-level state cannot be version-audited as one repo. | Mark root git status as unavailable in SCM. |
| GAP-REPO-002 | Repository | Backend Working Tree | Backend repo is dirty with many modified/deleted/untracked files. | `git status --short --branch` from backend. | Audit evidence includes uncommitted reality. | Record dirty state before SCM decisions. |
| GAP-TEST-001 | Test | Backend Unit Tests | `npm test` fails. | 8 failed suites, missing providers/imports like `PrismaService`. | Capabilities cannot be marked VERIFIED by tests. | Mark tested capabilities as runtime present but not verified. |
| GAP-FE-001 | Frontend | Build | Frontend build fails TypeScript checks. | `npm run build` frontend FAIL. | Frontend runtime cannot be considered build-verified. | Mark frontend as present but failing build. |
| GAP-RA-001 | Reality Intake | UI | No frontend reality-intake upload/review UI found. | Search/list under `frontend/src/pages`, `components`. | Capability exists backend-side only. | Mark frontend runtime NOT_FOUND. |
| GAP-PG-001 | Price Governance | UI | No frontend price governance UI found. | Search/list under frontend source. | Price workflows are not exposed in UI. | Mark frontend runtime NOT_FOUND. |
| GAP-PG-002 | Price Governance | Review API Controller | Price review service exists, but no HTTP controller found. | `price-submission-review.service.ts`; no matching controller in `src/reality-intake`. | Human review runtime may not be externally accessible by API. | Mark backend runtime PARTIAL. |
| GAP-PG-003 | Price Governance | Region | `regionId` fields exist, but no `Region` model found. | Model list from schema. | Region capability is schema-field only. | Mark SCHEMA_ONLY. |
| GAP-KF-001 | Knowledge Foundation | Immutability | No explicit immutability enforcement found. | Schema/service audit. | Append-only/immutability cannot be proven. | Mark UNKNOWN. |
| GAP-AHSP-001 | AHSP | HTTP Runtime | AHSP services/module exist, but no AHSP controller found. | `src/ahsp` file list and `ahsp.module.ts`. | AHSP may not be exposed as API runtime. | Mark backend runtime PARTIAL. |
| GAP-PROJ-001 | Project Foundation | Project Team Runtime | Project assignment/stakeholder schema exists, but no standalone project team controller found. | `ProjectAssignment`, `ProjectStakeholder`; project controller lacks team routes. | Team capability is partial. | Mark PARTIAL. |
| GAP-PROJ-002 | Project Foundation | Forecast/Risk/Recommendation Engines | UI labels indicate seed-only or engine not activated. | `ProjectWarRoomPage.tsx` text for Horizon/Storm/Wisdom/Authority/Logistics. | These screens should not be treated as verified engines. | Mark RUNTIME_NO_TEST or MOCK_ONLY/seed-only where applicable. |
| GAP-AUTH-001 | Identity & Security | Project Access Audit/Admin Bypass | Guard contains TODOs for admin bypass/audit/lifecycle restrictions. | `project-access.guard.ts` comments. | Guard capability is present but incomplete for those concerns. | Mark partial notes in SCM. |
| GAP-API-001 | Frontend | API Client Abstraction | No central API client found; hardcoded localhost calls used. | `rg fetch/http` in frontend source. | Connectivity is environment-specific. | Record as implementation reality, not a roadmap closure. |

## 11. Final Declaration

Reality Before Decision.  
Repository Before Memory.  
Runtime Before Roadmap.  
Evidence Before Opinion.  
SCM Before Strategy.

SIMPROK menghitung.  
Manusia memutuskan.  
SIMPROK menerangi.  
Manusia memilih jalan.

Soli Deo Gloria.  
Segala kemuliaan hanya bagi Tuhan Yesus Kristus. Amin.
