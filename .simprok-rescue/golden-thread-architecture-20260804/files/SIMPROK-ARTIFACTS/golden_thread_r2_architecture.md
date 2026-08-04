# SIMPROK — GOLDEN THREAD R2 ARCHITECTURE GATE (V2.0 FINAL, REVISED V3.0)

**Document ID:** `SIMPROK-GOLDEN-THREAD-R2-ARCHITECTURE-GATE-V3_0`
**Prompt lineage:** `SIMPROK-GOLDEN-THREAD-R2-ARCHITECTURE-GATE-V2_0-FINAL` → `SIMPROK-GOLDEN-THREAD-R2-ARCHITECTURE-TARGETED-REVISION-V3_0`
**Executor:** CLAUDE_CODE — READ_ONLY_REPOSITORY_ARCHITECTURE_AUDIT
**Mode:** design-only; zero source/schema/migration/DB/branch/commit/PR writes
**Repository:** `fekyigo-rgb/SIMPROK`

```text
SOURCE_AUDIT_BASE=c4b0107edcc2be8a10fceb6ca2f23a069d85673a
CURRENT_PRODUCT_LAW_BASE=703984d18e52fbe8da987fab6dae460a0977f113
SOURCE_DIFF_AFTER_PR34=DOCUMENTATION_ONLY
SOURCE_FINDINGS_REMAIN_VALID=YES
FINAL_DECISIONS_HARMONIZED_TO_CURRENT_MAIN=YES
```

Dalam Nama Tuhan Yesus Kristus.

---

# EXECUTIVE_VERDICT

This document is a design-only architecture gate for Golden Thread R2. No source, schema, migration, or database was touched to produce it (verified: `git status --short` clean throughout; `git diff c4b0107..703984d` proves the only change between the original audit base and current `main` is two documentation files, 1155 insertions, 0 deletions, 0 source files — see §2).

The R2 gap is now fully diagnosed with file:line evidence (§1), harmonized against `SIMPROK_RAB_TRANSITION_INTERACTION_SYNTHESIS_AND_UNCERTAINTY_LAW.md` v1.1 (§2), and closed with one final domain model (§3), an exact schema/migration plan (§4–§5), three new/revised API contracts (§6), explicit transaction/concurrency rules (§7), a stable-draft reconciliation algorithm (§8), a benchmark-gated (not guessed) query plan (§9), an explicit permission slice with an Owner decision flagged, not invented (§10), a legacy/rollback policy that never claims a destructive rollback is free (§11), and a test matrix (§12) mapped to five sequenced implementation slices with individual STOP conditions (§13).

No fake zero, no client-authoritative kernel money, no nullable occurrence link, no duplicated AHSP authority, no unproven hard performance ceiling, no undefined concurrency behavior, and no incomplete legacy policy remain in this design. Permission is sequenced as the mandatory first slice (`R2-PERM-00`), not deferred and not invented on Owner's behalf.

```text
FINAL_VERDICT=R2_ARCHITECTURE_READY_FOR_PM_OWNER_DECISION
```

---

# 1. CURRENT_TRUTH_TABLE

All rows below are verified against `main@c4b0107` (source) — unchanged at `main@703984d` per §2. Each row cites exact file:line evidence gathered by direct read or dedicated read-only research pass. Nothing here is inferred from documentation alone.

## 1.A — RAB Lifecycle

| # | Finding | Evidence |
|---|---|---|
| A1 | `Project.status` (enum `PLANNED\|ACTIVE\|ON_HOLD\|COMPLETED\|ARCHIVED\|CANCELLED`) is the **only** signal `ProjectListPage.tsx` uses to pick the primary action button. No BoQ/RabDocument/ProjectBaseline row is queried on that page. | `frontend/src/pages/ProjectListPage.tsx:21-41` (`mapProjectToItem`), `:157-186` (`primaryAction`) |
| A2 | `ProjectRabDoorPage.tsx` (route `project/:projectId/rab`, distinct from the editor at `project/:projectId/rab/workspace`) derives `rabSource` from which of `GET /projects/:id/boq` (baseline) or `GET /projects/:id/boq/draft` (draft) returns non-empty rows, and derives `project.status` display text independently from raw `Project.status`. Two independent, uncoordinated status signals. | `frontend/src/pages/ProjectRabDoorPage.tsx:114-181`, `:118-121`, `frontend/src/App.tsx:37-38` |
| A3 | **Defect confirmed at source level, not just by browser.** The Addendum button's only guard is `!archived` (`archived = project.status === 'Selesai'`). It is not gated by `readOnly`, `isDraftPreview`, or `rabSource`. Since a fresh project's `Project.status` becomes `'ACTIVE'` immediately at `initiateSetup` (A5) and a Draft-only project maps to display status `'Draft'` (≠ `'Selesai'`), Addendum renders on an un-baselined Draft. | `frontend/src/pages/ProjectRabDoorPage.tsx:312-316`, `:255-263` (`handleAddendumAction` checks only `archived`) |
| A4 | No backend lifecycle/status service or DTO exists anywhere in `backend/src/project/`. `getIntakeMode` computes *intake mode*, not RAB lifecycle. No controller route returns a computed lifecycle field — the frontend re-derives it independently on two different pages (A1, A2), which is exactly why they disagree. | `backend/src/project/project.service.ts:402-444` (`getIntakeMode`, unrelated concern), full `project.controller.ts` route list has no lifecycle/status endpoint |
| A5 | **Root cause of A3.** `initiateSetup` — gated by `PROJECT_CREATE`, run once at project creation completion — creates a `BoqStructure` named `'Main BOQ'`, a `RabDocument` with `status: 'APPROVED'`, a `ProjectBaseline` with `status: 'ACTIVE'`, and sets `Project.status = 'ACTIVE'`, all inside one transaction, immediately, with **zero real review/approval workflow**. This is structurally disconnected from the `'Working Draft'` `BoqStructure`/`RabDocument` (`status: 'DRAFT'`) that `RabWorkspacePage`/Cost Kernel R1 actually edit. Two parallel, unreconciled BOQ tracks exist per project today. | `backend/src/project/project.service.ts:149-263` (full method, read verbatim), esp. `:221-259` |
| A6 | `getBoq()` reads baseline items via `ProjectBaseline{status:'ACTIVE'} → RabDocument → boqStructureId`; `getDraftBoq()`/`saveDraftBoq()` read/write via `BoqStructure{name:'Working Draft', status:'DRAFT'}`. These are **structurally isolated item sets** — nothing today promotes Draft → Baseline, and nothing reconciles them. | `project.service.ts:480-528`, `:530-617` |
| A7 | No lock/approve endpoint exists anywhere in `project.controller.ts`. The only "Kunci RAB" affordance is a disabled frontend placeholder calling `openPlaceholder(...)`, not an API. | `frontend/src/pages/RabWorkspacePage.tsx:564-565` (`aria-disabled={true}`, `onClick={() => openPlaceholder(...)}`) |

## 1.B — Stable Draft / downstream relations

| # | Finding | Evidence |
|---|---|---|
| B1 | `saveDraftBoq` is **delete-then-recreate on every save**: `updateMany({parentId:null})` → `deleteMany({boqStructureId})` → loop-`create` every row with a fresh UUID, building a `tempId→realId` map as it goes. Confirmed unchanged at current base. | `project.service.ts:530-617`, comment at `:542` |
| B2 | Parent/child resolution is order-dependent and fails silently. `tempIdMap` is populated only *after* a row is created (`:575`); if a child references a `parentTempId` not yet seen, `tempIdMap.get(...)` returns `undefined`, coerced by `?? null` to a silent root-level orphan — no error raised. | `project.service.ts:550-551` |
| B3 | Exactly two Prisma relations point at `BoqItem`: `BoqItem.parentId` (self-relation, harmless here because `saveDraftBoq` explicitly nulls `parentId` before delete) and `ProgressEntry.boqItemId` (`onDelete` unspecified → Postgres default; confirmed by migration SQL to be `ON DELETE RESTRICT ON UPDATE CASCADE`). | `schema.prisma:1529` (self), `schema.prisma:1637`; SQL: `backend/prisma/migrations/20260619101739_init_intelligence_domains/migration.sql:411` — `ALTER TABLE "progress_entries" ADD CONSTRAINT ... FOREIGN KEY ("boqItemId") REFERENCES "boq_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;` |
| B4 | Today this RESTRICT is inert: `progress.service.ts` (`submitFieldProgress`) validates `boqItem.boqStructureId === baseline.rabDocument.boqStructureId` before creating `ProgressEntry`, and `getBoq()` (source of field-progress `boqItemId` choices) only ever reads the baseline structure, never `'Working Draft'`. `saveDraftBoq`'s delete-recreate only ever targets `'Working Draft'`. No collision today — but the RESTRICT becomes a live hazard the moment a reconciliation-based save is ever pointed at a structure that also carries progress history (relevant once Addendum work reuses BOQ-editing machinery on a post-baseline structure). | `backend/src/progress/progress.service.ts:39-40`, `project.service.ts:480-497` |
| B5 | No other model has a `boqItemId` field or relation to `BoqItem`. `RabDocument` links via `boqStructureId` only (structure-level, unaffected by item-level churn). | full-schema grep, confirmed by two independent passes |
| B6 | No consumer persists a `BoqItem.id` value across a save cycle. Cost Kernel (`cost-kernel.service.ts`) resolves items live per-request and returns `BOQ_ITEM_NOT_FOUND` for a stale id — no crash, just silent loss of that row's calculated state client-side. No `localStorage`/cache/second table found. | `cost-kernel.service.ts:42,49`; grep of `.boqItemId` across `backend/src` and `frontend/src` |
| B7 | `SaveDraftBoqDto`'s row shape carries **only** `tempId`/`parentTempId` (both client-generated). There is no field of any kind for a previously-persisted real `BoqItem.id`. The frontend/backend contract has zero concept of a stable server id today. | `backend/src/project/dto/save-draft-boq.dto.ts:5-43` |
| B8 | `BoqStructure.version` is hard-coded to the literal `1` at **every** creation site and never read or incremented anywhere else in `project.service.ts`. It is not used as a business document version (Addendum v2/v3 never bump it) and not used as a concurrency counter (`saveDraftBoq` never reads or writes it). It is currently a dead, always-`1` field. | grep `version:` in `project.service.ts` → hits at `:159`, `:226`, `:538`, `:600`, all literal `1` |

## 1.C — Permission / RBAC

| # | Finding | Evidence |
|---|---|---|
| C1 | 16 permission codes exist, **all** `SEEDED_CURRENT`. `RAB_VIEW`, `RAB_DRAFT_EDIT`, `RAB_LOCK`, `RAB_APPROVE` do not exist anywhere in code — only as a TODO comment and in law/docs. | `backend/src/common/constants/permissions.ts:14-40,75-181,183-200,203`; grep confirms `RAB_*` absent from `schema.prisma` and all frontend source |
| C2 | `PermissionsGuard` resolves **Workspace Role→Permission only** (`workspaceMembership.membershipRoles[].role.rolePermissions[].permission.code`). It never reads `ProjectAssignment.roleInProject`. `ProjectAccessGuard`/`ProjectAccessPolicyService` separately checks only that an active `ASSIGNED` `ProjectAssignment` row *exists* — `roleInProject`'s value is passthrough data, never branched on. | `backend/src/auth/guards/permissions.guard.ts:86-119,126-136`; `project-access-policy.service.ts:108,152-196` |
| C3 | Guard order is fixed and correct: `ProjectAccessGuard` before `PermissionsGuard` on every project-scoped route (security-prerequisite gate already locked and merged, PR #23). `PermissionsGuard` binds workspace authoritatively from `request.projectAccess.workspaceId` when present, rejecting a mismatched client-supplied workspace with 403. | `docs/implementation-gates/SECURITY_PROJECT_PERMISSION_WORKSPACE_AUTHORITY_SUPPLEMENT.md:1-21`; `permissions.guard.ts:43-70` |
| C4 | `PROJECT_CREATE` currently gates 4 project-domain routes beyond actual project creation: `initiateSetup` (`:45`), `updateIntakeContext` (`:142`, TODO comment present), and **`saveDraftBoq`** (`:189`, inline TODO `// TODO: promote to RAB_DRAFT_EDIT when that permission is seeded`). | `project.controller.ts:29,45,142,189` |
| C5 | **Concrete authorization defect, not merely a naming debt.** `seed-rbac-permissions.ts` grants `PROJECT_CREATE` to role `DIRECTOR`, and the same file documents `DIRECTOR` as `// DIRECTOR is view-only; must never submit field progress`. Because `saveDraftBoq` is gated by the same `PROJECT_CREATE` code, a DIRECTOR granted that permission for legitimate project-creation purposes today also incidentally gains RAB-draft-write access, contradicting the role's own documented intent. | `backend/prisma/seed-rbac-permissions.ts:86-105` |
| C6 | Full current `project.controller.ts` permission map (18 routes) confirmed line-by-line; every route not covered above uses `PROJECT_VIEW`, `PROJECT_CREATE`, `OBSERVATORY_VIEW`, or `AHSP_VIEW` — no route uses anything RAB-specific because nothing RAB-specific exists. | full controller read |

## 1.D — Occurrence / Phase 2 / Performance

| # | Finding | Evidence |
|---|---|---|
| D1 | `CreateProjectAhspOccurrenceDto` accepts exactly **one** `ahspResourceId: string` (not an array). `POST /projects/:projectId/ahsp-occurrences` therefore creates exactly one `ProjectAhspOccurrence` + one `ProjectAhspResourceResolution` per HTTP call. There is no server-side fan-out over an `AHSPVersion`'s full resource set. Confirmed independently by direct read (not only by subagent). | `backend/src/project-ahsp/dto/create-project-ahsp-occurrence.dto.ts:4-16`; controller `project-ahsp.controller.ts:24-51`, `@Permissions(PERMISSIONS.AHSP_MANAGE)` |
| D2 | Consequence: resolving all N resources of one `AHSPVersion` today requires N separate POSTs, each creating a **separate** `ProjectAhspOccurrence` (since `idempotencyKey` is per-occurrence) — never one occurrence with N resolutions. | derived directly from D1 + `@@unique([projectId, idempotencyKey])` at `schema.prisma:1424` |
| D3 | `ProjectAhspOccurrence`/`ProjectAhspResourceResolution` are **confirmed append-only**: repo-wide grep for `.update(`, `.updateMany(`, `.upsert(`, `.delete(` against either model returns zero matches; the only writes are `.create(...)` inside one transaction. | `project-ahsp.service.ts:350-361`; grep across `backend/src` |
| D4 | **No `boqItemId` field exists on either model, confirmed at schema level and re-confirmed as an explicit constitutional boundary**, not an oversight: `BP_AHSP_PHASE2_OCCURRENCE_IDENTITY_CLARIFICATION.md` §4 explicitly forbids adding `boqItemId` to `ProjectAhspOccurrence` in Phase 2, and §6 explicitly anticipates a *future, separate* structural entity that may *reference* `ProjectAhspOccurrence` without mutating it. | `schema.prisma:1409-1481`; `docs/implementation-gates/BP_AHSP_PHASE2_OCCURRENCE_IDENTITY_CLARIFICATION.md:61-107` |
| D5 | Cost Kernel today infers occurrence purely from `{projectId, workspaceId, ahspVersionId}` — never from a BoqItem-specific link. `buildResult` treats `occurrences.length === 1` as the only resolvable case; ≥2 occurrences sharing one `ahspVersionId` yields `occurrence = null` and an ambiguous/ownership-mismatch failure path. Two `BoqItem`s sharing one `ahspVersionId` collide on the same lookup today. | `backend/src/project/cost-kernel.service.ts` `loadOccurrenceGroups`/`buildResult` (verified in the PR #32 session and re-confirmed here) |
| D6 | Per-resolution query order (single-resource call): idempotency `findFirst` → `AHSPVersion.findFirst` + `AHSPResource.findUnique` → `ResourceCatalog.findMany` (**all** workspace/global catalogs, unfiltered) → **N+1**: one `BasicPrice.findMany` per returned catalog row (`Promise.all` over catalogs, not over AHSP resources — the N+1 axis that exists today is catalog count, not resource count, only because resource count is currently always 1) → conditional `UnitKernelService.resolve()` calls (one per catalog-name match, plus one per matching price row) → `findOneForWorkspace` revalidation → transactional create. | `project-ahsp.service.ts:243-376` (full method traced) |
| D7 | `UnitKernelService.resolve()` costs 2 DB round trips minimum (`Promise.all` of two `unitAlias.findMany` calls) or 3 when source/target unit definitions differ (adds `unitConversionRule.findMany`). **Zero caching of any kind** — no in-memory, no request-scoped memoization, no static field. Every call re-queries even for a repeated identical `(rawSourceUnit, rawTargetUnit)` pair within the same request. | `backend/src/unit-kernel/unit-kernel.service.ts:11-37` |
| D8 | No AHSP-resource-count fixture, seed, or `MAX_*` constant exists anywhere in `backend/src` for AHSP resources per version. The only related constant, `MAX_AHSP_CANDIDATES = 25`, caps AHSP-*version* candidates in an unrelated intelligence-suggestion feature, not resource counts. Cost Kernel R1's 13-resource fixture (PR #32) is the only empirical data point in the repository. | grep across `backend/src`; `rab-intelligence-proposal.service.ts:13` |

---

# 2. HARMONIZATION_WITH_CURRENT_MAIN

## 2.1 Base verification

```text
git diff --stat c4b0107edcc2be8a10fceb6ca2f23a069d85673a..703984d18e52fbe8da987fab6dae460a0977f113
 docs/project-memory/README.md                                              |   43 +
 docs/project-memory/SIMPROK_RAB_TRANSITION_INTERACTION_SYNTHESIS_AND_UNCERTAINTY_LAW.md | 1112 ++++
 2 files changed, 1155 insertions(+), 0 deletions(-)
```

Zero source, schema, migration, test, seed, or package files changed. Every §1 finding derived from `main@c4b0107` source is therefore **unchanged and still true** at `main@703984d`. The intervening commits (`c7926a8`, `95bd4e4`, `8b1d864`, `54b52b4`, merge `703984d`) are `docs(rab):`/`docs(memory):` only — confirmed by `git log --oneline` on the range.

## 2.2 New law absorbed: `SIMPROK_RAB_TRANSITION_INTERACTION_SYNTHESIS_AND_UNCERTAINTY_LAW.md` v1.1

This document is **explicitly non-superseding** (§1.1/§23 of that law: only one named conversational statement is superseded; "Tidak ada locked AHSP, Basic Price, Unit, Cost Kernel, lifecycle, authority, atau baseline law lain yang digantikan"). It does not redefine occurrence, permission, navigation, or unit law — it governs "Ruang Transisi"/"Ruang Interaksi" UX and the completeness/uncertainty vocabulary, which is exactly the vocabulary R2's money-authority and completeness design needs. Locked decisions directly binding on R2:

- `LOCKED_10 AI_TIDAK_MENCIPTAKAN_BASIC_PRICE_ATAU_ANGKA` and `LOCKED_11 COST_KERNEL_TETAP_FAIL_CLOSED_TERHADAP_INPUT_BELUM_RESOLVED` — this is the **normative source**, not merely a PM preference, for banning fake-zero fallbacks anywhere in this design (§3.11, §6, §8).
- `LOCKED_12 TIDAK_MENGHITUNG_SEBAGIAN_KOMPONEN_AHSP_LALU_MENYEBUT_LENGKAP` and §14.3 (`EXPECTED_AHSP_RESOURCE_SET == RESOLVED_RESOURCE_SET`) — this is the normative source for the exact-resource-set completeness gate already required by the original V2.0 prompt §E; it is now doubly locked, not merely requested.
- §14.1's four non-mixable states — `COMPUTATIONALLY_RESOLVED ≠ TRUST_VERIFIED ≠ CALCULATION_READY ≠ BASELINE_READY` — is the exact vocabulary this document uses in §3 and §6 for the AHSP-selection/Cost-Kernel boundary. It is adopted verbatim, not paraphrased into a competing vocabulary, per the law's own §2.3 repetition rule (one normative home, this document only *points* to it).
- §14.4's three completeness dimensions (Structural / AHSP-component / Monetary) map directly onto this document's schema: Structural completeness is a BOQ-editor concern (out of R2 scope — RAB rows already exist once entered); AHSP-component completeness is exactly §3.9's exact-resource-set gate; Monetary completeness is exactly §6/§7's money-authority rule.
- §18's runtime-honesty admission (`ProjectSetupPage.tsx` intake gates, no BOQ-journey selector, no Ruang Interaksi engine) confirms this new law's own scope (Ruang Transisi/Interaksi/Template Synthesis/BOQ Enrichment) is **not implemented** and is **explicitly out of R2 scope** — R2 does not touch `ProjectSetupPage.tsx`, Template Synthesis, BOQ Enrichment, or Ruang Interaksi in any slice below. This document's §22 prohibition list (`#5,#6,#9,#19`) is respected by keeping R2 strictly inside Draft-editor/AHSP-application/Cost-Kernel scope.

No conflict found between the new law and this document's design. No design section below needed structural revision because of it — it *sharpened* vocabulary and made the fake-zero/completeness rules doubly binding, which §3 of the revision prompt had already independently required from repository evidence (Cost Kernel R1's own `FAIL_CLOSED` contract, PR #32).

## 2.3 PR #34 conflict check

`git log --oneline` confirms PR #34's merge commit is `703984d`, containing only the two doc commits above. No conflict exists between this document and PR #34 because PR #34 changed no code this document's design touches. `SOURCE_DIFF_AFTER_PR34=DOCUMENTATION_ONLY` is proven, not asserted.

---

# 3. FINAL_DOMAIN_MODEL

One model. Not a menu of options.

## 3.1 The application entity

`ProjectRabLineAhspApplication` is the *only* new persistent entity R2 introduces. It answers exactly one question: **which `ProjectAhspOccurrence` is currently the authoritative AHSP resolution for this `BoqItem`, and what was that answer historically?**

It does **not** duplicate `ahspVersionId`, `projectId`, `workspaceId`, `idempotencyKey`, or resolution status — those remain owned by `ProjectAhspOccurrence`/`ProjectAhspResourceResolution` (§C.1 of `SIMPROK_PROJECT_RAB_AUTHORITY_UNIT_LAW.md`: "AHSP is the authority... Project context must not overwrite master AHSP evidence" — extended here to mean the *application* record must not re-express occurrence-owned facts as a second source of truth). Reading any occurrence-owned fact for an applied line means: `application.projectAhspOccurrenceId → ProjectAhspOccurrence → ProjectAhspResourceResolution[]`. One join, one authority.

`RabLineApplicationStatus` has exactly two values — `ACTIVE`, `SUPERSEDED` — because *this enum describes only the human-selection lifecycle*, never resolution/trust quality. A `NEEDS_REVIEW` or `UNRESOLVED` occurrence can still back an `ACTIVE` application (§3.9 "Honest snapshot policy": the human's current choice remains `ACTIVE` even if its technical resolution is incomplete — that incompleteness is read from the occurrence/resolution projection, never encoded a second time on the application). This directly satisfies §14.1 of the new Transition law: application status is a selection-lifecycle fact, resolution status is a separate, occurrence-owned fact — they must not be mixed into one enum.

## 3.2 Legacy `BoqItem.ahspVersionId` — explicit, permanent policy

```text
AUTHORITY_FOR_R2_AND_ALL_NEW_FLOWS = ACTIVE ProjectRabLineAhspApplication
BoqItem.ahspVersionId               = LEGACY_READ_ONLY

RULES:
  - R2 selection endpoint (§6.3) never writes BoqItem.ahspVersionId.
  - R2 Cost Kernel (§6, R2-03) never reads BoqItem.ahspVersionId for calculation.
  - If BoqItem.ahspVersionId != (active application's occurrence).ahspVersionId:
      -> record as a DIAGNOSTIC only (surfaced in RabLifecycleProjection evidence, §6.1)
      -> no auto-repair, no silent overwrite, no baseline mutation, no backfill
  - Removal of BoqItem.ahspVersionId is explicitly NOT part of R2.
    It requires a separate migration, a data inventory of existing non-null values
    across all projects, and explicit Owner authorization. Not designed here.
```

This resolves §3.5 of the revision directive precisely: the legacy field is neither deleted nor trusted; it becomes inert evidence, and any drift is a *reported gap*, matching this law's own §2.2 precedence rule ("Repository reality menentukan apa yang hidup, tetapi tidak boleh dipakai untuk mengubah hukum diam-diam... Ketidaksesuaian adalah gap, bukan alasan mengarang kesesuaian").

## 3.3 `selectedByAccountId` FK decision

Repository precedent for a nullable actor-reference column on an append-only AHSP model already exists and is unambiguous: `ProjectAhspOccurrence.createdByAccountId String? @db.Uuid` (`schema.prisma:1415`) — nullable, **no** `@relation` to `Account` (unenforced at the DB level). `ProjectRabLineAhspApplication.selectedByAccountId` follows this exact existing convention: `String? @db.Uuid`, no FK constraint. This is a "sesuai keputusan FK existing" resolution, not a new architectural choice.

## 3.4 `BoqStructure.version` ambiguity — resolved

Evidence (§1.B8) proves `version` is hard-coded to `1` at every write site and read nowhere. It carries **neither** business-document-version meaning (Addendum versions never increment it) **nor** concurrency-revision meaning (`saveDraftBoq` never touches it) today. Overloading a field that is provably dead for two *different* future purposes (a real Addendum version counter vs. a per-save optimistic-concurrency counter) would recreate exactly the "two meanings, one field" defect this document is required to avoid.

**Decision:** add a new, single-purpose field. `BoqStructure.draftRevision Int @default(0)` — an optimistic-concurrency counter, incremented exactly once per successful `saveDraftBoq`/reconciliation transaction (§8). `BoqStructure.version` remains untouched, reserved for a possible future Addendum-version-numbering design outside R2 scope.

---

# 4. EXACT_SCHEMA_DIFF

Presented as the exact `schema.prisma` diff this design requires. **Not applied** — `PRISMA_SCHEMA_WRITE=FORBIDDEN` honored; `git status --short` remains clean for the duration of this audit.

```diff
--- a/backend/prisma/schema.prisma
+++ b/backend/prisma/schema.prisma
@@ model BoqStructure (existing, ~line 1487) @@
 model BoqStructure {
   id        String   @id @default(uuid()) @db.Uuid
   projectId String?  @db.Uuid
   name      String
   version   Int
   status    String   @default("DRAFT")
+  draftRevision Int  @default(0)
   createdAt DateTime @default(now())
   updatedAt DateTime @updatedAt

   project Project?      @relation(fields: [projectId], references: [id], onDelete: Cascade)
   items   BoqItem[]
   rabs    RabDocument[]

   @@index([projectId])
   @@map("boq_structures")
 }

@@ model BoqItem (existing, ~line 1510) — additive reverse relation only, no column change @@
 model BoqItem {
   ... (all existing fields unchanged) ...

   boqStructure    BoqStructure    @relation(fields: [boqStructureId], references: [id], onDelete: Cascade)
   parent          BoqItem?        @relation("BoqItemToParent", fields: [parentId], references: [id])
   children        BoqItem[]       @relation("BoqItemToParent")
   wbsNode         WbsNode?        @relation(fields: [wbsNodeId], references: [id])
   ahspVersion     AHSPVersion?    @relation(fields: [ahspVersionId], references: [id])
   ahspSnapshot    AHSPSnapshot?   @relation(fields: [ahspSnapshotId], references: [id])
   progressEntries ProgressEntry[]
+  rabLineAhspApplications ProjectRabLineAhspApplication[]

   @@index([boqStructureId])
   @@index([parentId])
   @@index([wbsNodeId])
   @@map("boq_items")
 }

@@ model ProjectAhspOccurrence (existing, ~line 1409) — additive reverse relation only, ZERO field/column change @@
 model ProjectAhspOccurrence {
   ... (all existing fields unchanged — Phase 2 endpoint contract untouched) ...

   workspace           Workspace                       @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
   project             Project                         @relation(fields: [projectId], references: [id], onDelete: Cascade)
   ahspVersion         AHSPVersion                     @relation(fields: [ahspVersionId], references: [id], onDelete: Restrict)
   resourceResolutions ProjectAhspResourceResolution[]
+  rabLineApplication  ProjectRabLineAhspApplication?

   @@unique([projectId, idempotencyKey])
   @@index([workspaceId])
   @@index([projectId])
   @@index([ahspVersionId])
   @@map("project_ahsp_occurrences")
 }

@@ new section: SECTION K — RAB LINE AHSP APPLICATION DOMAIN @@
+enum RabLineApplicationStatus {
+  ACTIVE
+  SUPERSEDED
+}
+
+model ProjectRabLineAhspApplication {
+  id                      String                   @id @default(uuid()) @db.Uuid
+  boqItemId               String                   @db.Uuid
+  projectAhspOccurrenceId String                   @db.Uuid @unique
+  status                  RabLineApplicationStatus @default(ACTIVE)
+  selectedByAccountId     String?                  @db.Uuid
+  supersededAt            DateTime?
+  createdAt               DateTime                 @default(now())
+  updatedAt               DateTime                 @updatedAt
+
+  boqItem               BoqItem               @relation(fields: [boqItemId], references: [id], onDelete: Cascade)
+  projectAhspOccurrence ProjectAhspOccurrence @relation(fields: [projectAhspOccurrenceId], references: [id], onDelete: Restrict)
+
+  @@index([boqItemId])
+  @@index([projectAhspOccurrenceId])
+  @@index([status])
+  @@map("project_rab_line_ahsp_applications")
+}
```

**Not expressible in `schema.prisma` DSL** (Prisma 6.4.1, stable feature set, no `previewFeatures` for partial indexes are enabled in this repo's `schema.prisma` generator block): the partial unique index `boqItemId WHERE status = 'ACTIVE'` that enforces "one active application per line" at the database level. This must be hand-authored directly into the generated migration SQL (§5) after `prisma migrate dev --create-only` scaffolds the table — a normal, supported Prisma workflow for constraints outside the schema DSL, not a workaround.

**Zero changes** to `ProjectAhspOccurrence`'s or `ProjectAhspResourceResolution`'s own fields, `@@unique`, or `@@index` clauses. Phase 2's POST/GET endpoints, DTO, and service remain byte-for-byte unchanged (§6.3 confirms this at the API layer).

---

# 5. EXACT_MIGRATION_SQL_INVENTORY

Two migrations, in two different implementation slices (§13), described here — **not created**.

## 5.1 Migration A — `R2-01`: `..._r2_boq_structure_draft_revision`

```sql
ALTER TABLE "boq_structures" ADD COLUMN "draftRevision" INTEGER NOT NULL DEFAULT 0;
```

1 `ALTER TABLE`. 0 data writes. 0 index changes. Fully additive; existing rows default to `0`.

## 5.2 Migration B — `R2-02`: `..._r2_rab_line_ahsp_application`

```sql
CREATE TYPE "RabLineApplicationStatus" AS ENUM ('ACTIVE', 'SUPERSEDED');

CREATE TABLE "project_rab_line_ahsp_applications" (
  "id"                      UUID NOT NULL,
  "boqItemId"               UUID NOT NULL,
  "projectAhspOccurrenceId" UUID NOT NULL,
  "status"                  "RabLineApplicationStatus" NOT NULL DEFAULT 'ACTIVE',
  "selectedByAccountId"     UUID,
  "supersededAt"            TIMESTAMP(3),
  "createdAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"               TIMESTAMP(3) NOT NULL,

  CONSTRAINT "project_rab_line_ahsp_applications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "project_rab_line_ahsp_applications_projectAhspOccurrenceId_key"
  ON "project_rab_line_ahsp_applications"("projectAhspOccurrenceId");

CREATE INDEX "project_rab_line_ahsp_applications_boqItemId_idx"
  ON "project_rab_line_ahsp_applications"("boqItemId");

CREATE INDEX "project_rab_line_ahsp_applications_projectAhspOccurrenceId_idx"
  ON "project_rab_line_ahsp_applications"("projectAhspOccurrenceId");

CREATE INDEX "project_rab_line_ahsp_applications_status_idx"
  ON "project_rab_line_ahsp_applications"("status");

-- Hand-authored addition (not Prisma-DSL-generated): enforce one ACTIVE application per line.
CREATE UNIQUE INDEX "project_rab_line_ahsp_applications_one_active_per_boq_item"
  ON "project_rab_line_ahsp_applications"("boqItemId")
  WHERE "status" = 'ACTIVE';

ALTER TABLE "project_rab_line_ahsp_applications"
  ADD CONSTRAINT "project_rab_line_ahsp_applications_boqItemId_fkey"
  FOREIGN KEY ("boqItemId") REFERENCES "boq_items"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "project_rab_line_ahsp_applications"
  ADD CONSTRAINT "project_rab_line_ahsp_applications_projectAhspOccurrenceId_fkey"
  FOREIGN KEY ("projectAhspOccurrenceId") REFERENCES "project_ahsp_occurrences"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
```

Inventory: 1 `CREATE TYPE`; 1 `CREATE TABLE`; 1 `CREATE UNIQUE INDEX` (occurrence FK uniqueness); 3 `CREATE INDEX`; 1 hand-authored `CREATE UNIQUE INDEX ... WHERE` (partial, one-active-per-line); 2 `FOREIGN KEY`; **0 data writes**; **0 changes to any pre-existing table, column, type, or constraint**.

`FOREIGN KEY (boqItemId) ... ON DELETE CASCADE` mirrors this design's own §3.1 (applications are lifecycle history of a *specific line*; if the line itself is ever hard-deleted — not the same as Draft's delete-recreate, which the reconciliation algorithm in §8 explicitly replaces — its application history should not become an orphaned-FK blocker). `FOREIGN KEY (projectAhspOccurrenceId) ... ON DELETE RESTRICT` protects Phase 2's append-only guarantee: an occurrence can never be deleted while an application still references it, matching the existing `ahspVersion ... onDelete: Restrict` convention already used on `ProjectAhspOccurrence` itself (`schema.prisma:1421`).

---

# 6. API_CONTRACTS

## 6.1 `GET /projects/:projectId/rab/lifecycle` — new, `R2-00`

Guards: `JwtAuthGuard, ProjectAccessGuard, PermissionsGuard`; `@Permissions('RAB_VIEW')` (§10). Tenant-safe: unassigned/foreign project → `404` (matches existing `ProjectAccessGuard` behavior, `project-access.guard.ts:48`).

```ts
interface RabLifecycleProjection {
  state:
    | 'EMPTY' | 'DRAFT' | 'UNDER_REVIEW'
    | 'BASELINE_ACTIVE' | 'ADDENDUM_DRAFT' | 'ARCHIVED';
  capabilities: {
    canViewRab: boolean;
    canContinueDraft: boolean;
    canEditDraft: boolean;
    canSubmitReview: boolean;
    canApprove: boolean;
    canLock: boolean;
    canRequestAddendum: boolean;
    canContinueAddendum: boolean;
    canOpenMonitoring: boolean;
  };
  evidence: {
    hasWorkingDraft: boolean;
    draftBoqItemCount: number;
    activeBaselineId: string | null;
    baselineRabDocumentId: string | null;
    addendumIdentity: null; // no Addendum entity exists yet — never fabricated
    legacyAhspVersionMismatchCount: number; // §3.2 diagnostic, count only, no row detail leaked here
  };
}
```

### Derivation (never from `Project.status`)

```text
1. hasWorkingDraft   = BoqStructure{projectId, name:'Working Draft', status:'DRAFT'} exists
                        AND has >=1 BoqItem
2. hasActiveBaseline = ProjectBaseline{projectId, status:'ACTIVE'} exists
                        with RabDocument{status:'APPROVED'} having >=1 BoqItem
3. hasAddendumDraft  = FALSE for R2 (no Addendum entity exists — §3.6 rule below)

state =
  NOT hasWorkingDraft AND NOT hasActiveBaseline           -> EMPTY
  hasWorkingDraft AND NOT hasActiveBaseline                -> DRAFT
  hasActiveBaseline AND NOT hasWorkingDraft                -> BASELINE_ACTIVE
  hasActiveBaseline AND hasWorkingDraft                     -> INCONSISTENT_STATE (see below)
  Project.status == 'COMPLETED'                             -> ARCHIVED (terminal, overrides above)
```

`UNDER_REVIEW` and `ADDENDUM_DRAFT` are **reserved enum members with no derivation rule in R2** — no review-workflow entity and no Addendum entity exist in the repository (§1.A7, confirmed). Per the revision directive §3.6 ("Dilarang menyimpulkan setiap Draft yang hidup bersama baseline sebagai Addendum... hasil harus menjadi inconsistent/unsupported state yang jujur atau tetap BASELINE_ACTIVE dengan diagnostic, bukan tebakan"):

```text
hasActiveBaseline AND hasWorkingDraft (today's actual repo condition for EVERY existing project,
per §1.A5 — initiateSetup always creates both 'Main BOQ'/baseline immediately AND nothing prevents
a later 'Working Draft' from also existing)
  -> state = BASELINE_ACTIVE
  -> evidence.legacyAhspVersionMismatchCount and a new evidence.hasUnreconciledWorkingDraft: true flag
     surface the condition honestly
  -> capabilities.canRequestAddendum = false until a real Addendum entity/workflow exists (R2 does not
     build one — §7 "Jangan Membuat Addendum Engine" of the original prompt's prohibitions, carried
     forward)
```

This directly fixes §1.A3's defect: Addendum becomes derivable-false by construction, not by a frontend `!archived` guard that happened to be wrong.

## 6.2 `PUT /projects/:projectId/boq/draft` — revised contract, `R2-01`

Guards unchanged in kind, permission changed: `@Permissions('RAB_DRAFT_EDIT')` (§10), replacing borrowed `PROJECT_CREATE` (§1.C4).

```ts
interface SaveDraftBoqRequestV2 {
  expectedRevision: number;              // BoqStructure.draftRevision, required
  marginPercent?: string;                // decimal string, unchanged concern
  taxPercent?: string;
  rows: DraftRowV2[];
}

interface DraftRowV2 {
  id: string | null;                     // persisted BoqItem.id, or null for a new row
  clientKey: string;                     // stable per-row client identity, always required
  parentRef: { id: string } | { clientKey: string } | null;
  itemType: 'FOLDER' | 'WORK_ITEM' | 'NOTE';
  name: string;
  wbsCode?: string;
  quantity: string;                      // decimal string — NEVER a JSON number
  unit?: string;
  unitPrice?: string;                    // decimal string; see money-authority rule below
  sortOrder: number;
}
```

**Money-authority rule (binding on this endpoint specifically):**

```text
FOR EACH row WHERE row.id resolves to a BoqItem with an ACTIVE ProjectRabLineAhspApplication:
  IF row.unitPrice is present AND non-null
    -> HTTP 400, error code KERNEL_MANAGED_LINE_REJECTS_CLIENT_UNIT_PRICE
    -> do not silently drop the field, do not silently accept and ignore it
  (row.quantity, row.unit, row.name, row.sortOrder remain freely editable —
   editing these invalidates the application's calculation freshness at the
   frontend display layer, per the already-shipped PR #32 invalidateRow()
   contract; it does NOT touch the application row itself, which is a
   selection-lifecycle fact, not a calculation-freshness fact)
FOR EACH row WHERE row has no ACTIVE application (manual line):
  unitPrice, if present, is stored as today, labeled MANUAL per the Transition
  law §12.2 vocabulary (label surface is a frontend/R2-03 concern, not a schema
  field this migration adds — no new "source" enum column is introduced by R2;
  "manual" is simply "no ACTIVE application exists for this BoqItem")
```

Response:

```ts
interface SaveDraftBoqResponseV2 {
  structureId: string;
  newRevision: number;                   // BoqStructure.draftRevision after increment
  rows: { clientKey: string; id: string }[]; // authoritative id for every row, keyed by clientKey
  recap: DraftRecapResponse;             // unchanged shape
}
```

`409 Conflict` (body: `{ error: 'DRAFT_REVISION_MISMATCH', currentRevision: number }`) when `expectedRevision` does not match — see §7, §8.

## 6.3 `POST /projects/:projectId/boq/items/:boqItemId/ahsp-selection` — new, `R2-02`

Guards: `JwtAuthGuard, ProjectAccessGuard, PermissionsGuard`; `@Permissions('RAB_DRAFT_EDIT')`.

```ts
interface AhspSelectionRequest {
  ahspVersionId: string;
  idempotencyKey: string;                // opaque client-generated key, same semantics as Phase 2's
  expectedDraftRevision: number;         // BoqStructure.draftRevision of the line's structure
}

type AhspSelectionResponse =
  | {
      status: 'APPLIED';
      applicationId: string;
      occurrenceId: string;
      resourceResolutionSummary: {
        expectedResourceCount: number;
        resolvedCount: number;
        unresolvedCount: number;
        needsReviewCount: number;
      };
      calculationReady: boolean;          // §3.11 CALCULATION_READY, computed, never guessed
    }
  | { status: 'REJECTED'; reason: 'ZERO_RESOURCE_AHSP_VERSION' | 'AHSP_VERSION_NOT_TENANT_VISIBLE' | 'BOQ_ITEM_NOT_IN_EDITABLE_DRAFT' }
  | { status: 'CONFLICT_DRAFT_REVISION'; currentRevision: number }   // 409
  | { status: 'CONFLICT_IDEMPOTENCY_PAYLOAD_MISMATCH' };            // 409
```

Reuses the **existing** `ProjectAhspOccurrence`/`ProjectAhspResourceResolution` models and the **existing** Phase 2 idempotency authority `@@unique([projectId, idempotencyKey])` — no new idempotency mechanism, no new hash field, per §3.10's explicit instruction. **This is a new endpoint; `POST /projects/:projectId/ahsp-occurrences` (Phase 2) is untouched, unrouted-through, and remains independently callable exactly as it is today** (§D1–§D3 preserved verbatim).

Rule ordering inside the transaction (full algorithm in §7.2):

```text
1. resolve BoqItem, its BoqStructure, confirm status:'DRAFT' and structure.draftRevision == expectedDraftRevision
   -> mismatch: 409 CONFLICT_DRAFT_REVISION
2. resolve AHSPVersion, confirm tenant-visible
3. load ALL AHSPResource rows for that version, ordered by id
   -> zero rows: REJECTED ZERO_RESOURCE_AHSP_VERSION (fail-closed, never an empty-but-"applied" occurrence)
4. resolve every resource (§9 query plan) — batched, not looped
5. create ONE ProjectAhspOccurrence + exactly N ProjectAhspResourceResolution rows,
   N == AHSPResource count from step 3, in the SAME transaction (§3.9 exact-set rule)
6. supersede the current ACTIVE application for this boqItemId (if any): status=SUPERSEDED, supersededAt=now()
7. insert new ACTIVE application row for (boqItemId, new occurrenceId)
8. commit
```

Honest-snapshot policy (§3.9, §14.1 of the Transition law): step 5 persists the occurrence **even if** some resolutions are `UNRESOLVED`/`NEEDS_REVIEW` — the application still becomes `ACTIVE` in step 7, because that reflects the human's current *selection*, not calculation readiness. `calculationReady` in the response is computed (§3.11) from the resolution set, never used to block persistence of the human's choice, and never used to fabricate a partial money result.

---

# 7. TRANSACTION_AND_CONCURRENCY_BOUNDARIES

## 7.1 Draft save (`R2-01`)

One `prisma.$transaction`. Optimistic concurrency via a single conditional statement, not a read-then-write race:

```sql
UPDATE boq_structures SET "draftRevision" = "draftRevision" + 1
WHERE id = :structureId AND "draftRevision" = :expectedRevision;
-- Prisma: tx.boqStructure.updateMany({ where: { id, draftRevision: expectedRevision }, data: { draftRevision: { increment: 1 } } })
```

`updateMany` result `.count === 0` → abort transaction, return `409`. `.count === 1` → proceed with the reconciliation writes (§8) inside the *same* transaction, using the now-claimed revision. Two concurrent saves against the same `expectedRevision` race on this single atomic statement; exactly one wins, the other gets a clean `409` with the current revision so the client can re-fetch and retry — never a silent last-write-wins merge.

## 7.2 AHSP selection (`R2-02`)

One `prisma.$transaction`, `SELECT ... FOR UPDATE`-equivalent row lock acquired first on the current `ACTIVE` application row for `boqItemId` (Prisma: a `SELECT` inside the transaction against a table with the partial unique index is sufficient to serialize concurrent writers through Postgres's row-level locking on that index; no raw SQL needed beyond what §5.2 already adds). Two concurrent selections on the *same* line therefore serialize: the second transaction blocks until the first commits, then observes the first's new `ACTIVE` row as current and supersedes *that* (not the stale pre-first-transaction row) — giving a deterministic, sequential "last selection wins" outcome with exactly one `ACTIVE` row at all times. The partial unique index from §5.2 is the second, defense-in-depth layer: even if the lock is ever bypassed, a duplicate `ACTIVE` insert is rejected by Postgres with `23505`, mapped to the `CONFLICT_*` response family, never silently accepted.

```text
concurrent identical (idempotencyKey, boqItemId, ahspVersionId) -> unique violation on
  @@unique([projectId, idempotencyKey]) -> loser re-reads via findFirst (same pattern
  already proven in project-ahsp.service.ts today) -> returns the SAME occurrence/application,
  not a duplicate (§3.10)
same idempotencyKey, different boqItemId or ahspVersionId       -> 409 CONFLICT_IDEMPOTENCY_PAYLOAD_MISMATCH
  (payload fingerprint = {boqItemId, ahspVersionId} compared against the existing occurrence's
   ahspVersionId + the existing application's boqItemId; no new hash column needed — this is a
   direct field comparison against already-persisted rows, matching §3.10's "tanpa harus menambah
   hash field spekulatif, kecuali benar-benar dibutuhkan")
reselect (different ahspVersionId, same boqItemId)               -> always a NEW occurrence (Phase 2's
  append-only guarantee, §D3, is never violated) + supersede + new ACTIVE application
```

## 7.3 Untouched by every transaction above

Per §3.9/§D3/§D4, both transaction families in §7.1 and §7.2 never touch: `ProjectBaseline`, baseline `RabDocument`, any *other* line's `ProjectAhspOccurrence`/`ProjectAhspResourceResolution`, or `BoqItem.unitPrice`/`BoqItem.lineTotal` (money-authority rule, §6.2 — Cost Kernel result is never copied into `BoqItem` columns; those columns remain either `null` for kernel-managed lines or the last-saved manual value for manual lines, exactly as PR #32 already established for the read path).

---

# 8. DRAFT_RECONCILIATION_ALGORITHM

Runs inside the transaction opened by §7.1, after the `draftRevision` claim succeeds.

```text
INPUT: rows: DraftRowV2[] (from §6.2), structureId, workspaceId, projectId

PHASE 0 — LOAD
  currentRows = SELECT * FROM boq_items WHERE boqStructureId = :structureId
  currentIds  = set of currentRows.id
  currentApplications = SELECT boqItemId FROM project_rab_line_ahsp_applications
                         WHERE status = 'ACTIVE' AND boqItemId IN currentIds
    -- loaded only to know which ids are kernel-managed for the money-authority
    -- rejection in §6.2; never mutated by this algorithm (§7.3)

PHASE 1 — VALIDATE (entirely in memory, before any write)
  1. every row.id (non-null) must be a member of currentIds
     -> else 404 FOREIGN_ROW_ID (tenant/cross-structure id, fail-safe as not-found, not 403 —
        never confirms existence of another tenant's row)
  2. no duplicate non-null row.id across the payload
     -> else 400 DUPLICATE_PERSISTED_ID
  3. no duplicate row.clientKey across the payload
     -> else 400 DUPLICATE_CLIENT_KEY
  4. for every row with a money-authority violation (§6.2 rule)
     -> else 400 KERNEL_MANAGED_LINE_REJECTS_CLIENT_UNIT_PRICE
  5. build idOrKeyIndex: clientKey -> row, and id -> row, for parentRef resolution
  6. for every row.parentRef:
     - null -> root-level, OK
     - {id: X} -> X must be in currentIds (existing persisted parent) OR be the id of
       another row in THIS payload -> else 404 ORPHAN_PARENT_REF
     - {clientKey: K} -> K must be a clientKey present in THIS payload -> else 400 ORPHAN_PARENT_REF
     - parent row's itemType must be 'FOLDER' -> else 400 INVALID_PARENT_TYPE
       (WORK_ITEM/NOTE as parent is always invalid, per original schema intent)
  7. build the full parent graph (rows + parentRef, resolved to a single id/clientKey space)
     and topologically validate:
     - no row is its own parent (direct self-cycle) -> 400 SELF_PARENT
     - no cycle of any depth (DFS with visited-set) -> 400 PARENT_CYCLE
  8. every row.quantity is a syntactically valid decimal string (matches
     /^-?\d+(\.\d+)?$/, same shape already proven correct by rabCostDisplay.ts's
     addDecimalStrings in PR #32) -> else 400 INVALID_DECIMAL
  9. no write proceeds until steps 1-8 all pass for the ENTIRE payload — partial
     application of a partially-valid payload is forbidden

PHASE 2 — DIFF
  toDelete = currentIds - {row.id : row in rows, row.id != null}
  toUpdate = {row : row in rows, row.id != null, row.id in currentIds}
  toCreate = {row : row in rows, row.id == null}

PHASE 3 — NULL PARENT REFS ON AFFECTED ROWS ONLY (not a blanket nullify)
  For every row in toDelete: no action needed if nothing references it as parent
    (already proven by Phase 1 step 6 that only currentIds/payload rows may be
    referenced — a toDelete id can only be referenced if some payload row still
    points at it, which Phase 1 already treats as that row still existing, i.e.
    it would NOT be in toDelete's computed set; toDelete is exactly "rows the
    client dropped and nothing in the new payload still parents to")
  For any toUpdate/toCreate row whose OLD persisted parentId no longer matches
  its new parentRef: defer the actual parent write to Phase 6 (two-phase parent
  assignment, replacing the old algorithm's blanket updateMany({parentId:null})
  with a targeted one)

PHASE 4 — DELETE
  DELETE FROM boq_items WHERE id IN toDelete
    -- safe: Phase 1 proved no remaining row parents to a toDelete id;
    -- ProgressEntry RESTRICT (§1.B3/B4) cannot fire because toDelete rows are,
    -- by construction, rows in a status:'DRAFT' structure, which progress.service.ts
    -- never links to (§1.B4) — if this invariant is ever violated by a future slice,
    -- the RESTRICT correctly aborts the transaction rather than silently losing history

PHASE 5 — UPDATE EXISTING ROWS (id preserved, never touched)
  FOR EACH row IN toUpdate:
    UPDATE boq_items SET name=, wbsCode=, quantity=, unit=, sortOrder=, itemType=
    WHERE id = row.id
    -- parentId intentionally NOT written here; deferred to Phase 6

PHASE 6 — CREATE NEW ROWS + BUILD clientKey -> id MAP
  clientKeyToId = {}
  FOR EACH row IN toCreate (in payload order — Phase 1 already proved no forward
  reference within toCreate can be unresolved, because cycle-checking in Phase 1
  step 7 ran over the FULL graph including clientKey refs, not just already-created
  ones; safe to create in any order that respects the validated DAG, e.g. topological
  order derived once in Phase 1):
    newId = INSERT INTO boq_items (..., parentId: NULL) RETURNING id
      -- temporarily null; Phase 7 sets the real value
    clientKeyToId[row.clientKey] = newId
  FOR EACH row IN toUpdate: clientKeyToId[row.clientKey] = row.id  -- unify lookup space

PHASE 7 — SET FINAL PARENT ON EVERY ROW (single pass, using the now-complete map)
  FOR EACH row IN toUpdate + toCreate:
    finalParentId =
      row.parentRef == null                    ? NULL
      : row.parentRef has .id                  ? row.parentRef.id
      : clientKeyToId[row.parentRef.clientKey]
    UPDATE boq_items SET parentId = finalParentId WHERE id = clientKeyToId[row.clientKey]

PHASE 8 — REVISION
  (already claimed atomically in §7.1, before Phase 0; no separate increment here)

OUTPUT: { rows: [{clientKey, id}], newRevision }  -- per §6.2 response shape
```

This satisfies §3.8's numbered requirements 1–15 exactly: stable ids across saves (Phase 5 never re-creates an existing row), new `clientKey` always yields a new UUID (Phase 6), out-of-order parent references are validated and resolved regardless of payload order (Phase 1 step 7 + Phase 6/7's two-phase assignment), duplicate/orphan/cycle/invalid-parent-type/invalid-decimal are all explicit `400`/`404` outcomes with no silent coercion (fixing §1.B2's silent-orphan defect), foreign/cross-tenant ids fail as `404` (Phase 1 step 1), the revision check is atomic (`§7.1`), baseline/application/occurrence/resolution/kernel-money are never touched (Phase 3 note, §7.3), and authoritative ids are returned (Output).

---

# 9. QUERY_PLAN_AND_BENCHMARK_GATE

No hard number is locked without a benchmark. Every ceiling below is `PROVISIONAL_UNTIL_BENCHMARK`.

## 9.1 Ten query stages (§6.3's transaction, replacing today's per-resource loop, §D6)

```text
STAGE 1  Load project + Draft structure + line + ProjectAssignment context — scoped, single query
         (one SELECT joining boq_items -> boq_structures -> project, filtered by tenant)
STAGE 2  Load AHSPVersion + ALL its AHSPResource rows, ordered — single query
         (findFirst + findMany, 2 queries, not N)
STAGE 3  Targeted ResourceCatalog lookup — filtered to the DISTINCT resource
         references from Stage 2's result set only (replaces today's D6 unfiltered
         "all workspace/global catalogs" scan)
STAGE 4  Batch BasicPrice lookup — single findMany with
         resourceCatalogId IN (candidate ids from Stage 3), replacing today's
         D6 N+1-by-catalog-count pattern
STAGE 5  Batch UnitAlias lookup — single findMany with
         normalizedAlias IN (all DISTINCT raw source/target unit strings
         collected across every resource in Stage 2, computed once)
STAGE 6  Batch UnitConversionRule lookup — single findMany, filtered to
         DISTINCT (sourceUnitId, targetUnitId) pairs actually requiring
         conversion after Stage 5's exact-match short-circuit
STAGE 7  In-memory deterministic resolution — zero DB calls; a request-local
         Map<string,UnitResolutionResult> memoizes any (source,target) pair
         seen more than once within the request (directly closes §D7 — the
         confirmed zero-caching gap in UnitKernelService.resolve())
STAGE 8  INSERT ProjectAhspOccurrence — 1 statement
STAGE 9  Bulk INSERT ProjectAhspResourceResolution — 1 statement
         (Prisma nested create or createMany, N rows, 1 round trip, not N)
STAGE10  Supersede old ACTIVE application (1 UPDATE) + insert new ACTIVE
         application (1 INSERT) — 2 statements, both inside the row-locked
         transaction from §7.2
```

Budget shape: **a fixed number of query-stage round trips independent of resource count** (Stages 1–7 ≈ 7 round trips regardless of N) **plus** documented per-row bulk-insert statements (Stages 8–10, which are O(1) round trips via bulk insert, not O(N)). This replaces the withdrawn "exactly 7 queries" claim with a *shape* guarantee (constant stage count) that is provable by code review, while the *absolute* round-trip count and wall-clock latency remain benchmark output, not a locked number.

## 9.2 Required benchmark fixtures

```text
13   resources  (PR #32's proven Cost Kernel R1 fixture size — regression floor)
50   resources  (mid-size AHSP, no repository precedent — first real data point)
100  resources  (stress case, no repository precedent)
repository-informed worst case: re-derive from production AHSPResource counts
  via a read-only COUNT(*) GROUP BY ahspVersionId query against simprok_db
  BEFORE R2-02 implementation begins — this document does not invent that
  number (§D8 proved no such data exists in the repo today)
```

## 9.3 Instrumentation requirement

A Jest spy on `PrismaService` call count is explicitly **insufficient** on its own (it proves call *count* but not query *shape* — a spy cannot distinguish "one filtered findMany" from "one findMany that happens to be unfiltered and slow"). Required: Prisma query-event logging (`prisma.$on('query', ...)`) captured in an isolated benchmark test, asserting both (a) total query count per stage matches §9.1's shape, and (b) each query's `WHERE`/`IN` clause is bounded by the candidate set computed in the prior stage (i.e., Stage 4's `BasicPrice` query must be provably filtered by Stage 3's candidate ids, not a full scan) — this is the concrete, code-reviewable proof that closes §D6's confirmed N+1/unfiltered-scan gap, not a guess.

## 9.4 Provisional target (explicitly not a lock)

```text
PROVISIONAL_UNTIL_BENCHMARK: p95 end-to-end AHSP-selection latency at 100 resources
  should not exceed the same order of magnitude as today's single-resource POST
  (Phase 2's existing endpoint, D6) multiplied by the stage-count ratio, not by N.
  Exact millisecond figures are set after the R2-02 benchmark run, not in this document.
```

---

# 10. PERMISSION_DECISION_REQUIRED

## 10.1 Mandatory first slice — `R2-PERM-00`

Sequenced strictly *before* `R2-00` (§13). No later slice may borrow `PROJECT_CREATE` or invent an ad hoc code.

**Architecture-required now:**

```text
RAB_VIEW        — read RabLifecycleProjection (§6.1), read Draft/Baseline BOQ
RAB_DRAFT_EDIT  — saveDraftBoq (§6.2), ahsp-selection (§6.3)
```

**Deferred — declared in the catalog as `NEEDED_NOT_SEEDED` but not wired to any route until the workflow it gates actually exists:**

```text
RAB_SUBMIT_REVIEW   — no review workflow exists (§1.A7); do not gate a non-existent route
RAB_APPROVE          — no approval endpoint exists (§1.A7)
RAB_LOCK              — "Kunci RAB" is a disabled frontend placeholder only (§1.A7)
RAB_ADDENDUM_CREATE   — no Addendum entity exists (§6.1's derivation explicitly refuses to fabricate one)
```

`R2-PERM-00` scope: declare the 6 codes above in `permissions.ts` (2 `SEEDED_CURRENT`, 4 `NEEDED_NOT_SEEDED` per the existing `PERMISSION_CATALOG_STATES` vocabulary already in the file, §1.C1); add idempotent seed entries for the 2 seeded codes only; replace `@Permissions('PROJECT_CREATE')` with `@Permissions('RAB_DRAFT_EDIT')` on `saveDraftBoq` (§1.C4) and add `@Permissions('RAB_VIEW')` to the new lifecycle/read routes; negative tests (missing `RAB_VIEW`, missing `RAB_DRAFT_EDIT`, `DIRECTOR`-role no-longer-implicitly-authorized regression test directly targeting §1.C5's confirmed defect); seed idempotency test (re-running the seed twice produces no duplicate `Permission`/`RolePermission` rows, matching the existing seed script's `upsert` pattern already used for other codes).

## 10.2 OWNER DECISION REQUIRED — explicitly not resolved here

```text
QUESTION: which seeded Role(s) receive RAB_VIEW and RAB_DRAFT_EDIT in production?

FACTS ON RECORD FOR THE OWNER (not a recommendation, not a default):
  - DIRECTOR currently holds PROJECT_CREATE (source of §1.C5's defect) and is
    documented in-repo as "view-only" for a DIFFERENT permission (FIELD_PROGRESS_SUBMIT
    is explicitly forbidden to DIRECTOR in the same seed file) — the seed author's
    own intent for DIRECTOR's write scope is inconsistent with what PROJECT_CREATE
    currently grants it by accident.
  - FOREMAN (seed-acceptance.ts) currently holds only PROJECT_VIEW.
  - No seeded role today matches "the person who actually edits a RAB Draft" as a
    documented intent — DEBT-PERMISSION-01 (SIMPROK_PROJECT_RAB_AUTHORITY_UNIT_LAW.md
    §B.2) names this exact gap and requires a "dedicated permission-catalog slice,"
    which R2-PERM-00 is.

THIS DOCUMENT DOES NOT ASSIGN RAB_VIEW/RAB_DRAFT_EDIT TO ANY ROLE.
Engineer implementing R2-PERM-00 must receive an explicit Owner role-mapping
decision before writing the seed's role-grant rows. Declaring the permission
codes and wiring the guards does not require this decision; granting them to
a specific Role in seed data does.
```

---

# 11. LEGACY_DATA_AND_ROLLBACK_POLICY

## 11.1 Terminology correction

`Synthetic Baseline` is removed from this document's vocabulary entirely — it was never a product term and risks implying SIMPROK fabricates baseline data, contradicting `LOCKED_10`/`LOCKED_11` of the Transition law (§2.2). Replacement, diagnostic-only, never product-facing:

```text
LEGACY_BASELINE_DIAGNOSTIC = the observation (§1.A5/§6.1) that every existing
  project's initiateSetup-created baseline was never subjected to a real review/
  approval workflow. This is a fact surfaced in RabLifecycleProjection.evidence
  for operator/PM visibility. It is NEVER used to justify mutating, backfilling,
  or re-deriving that baseline's data.
```

## 11.2 Legacy data policy

```text
- Every existing ACTIVE ProjectBaseline (including project ACC-X, referenced in
  prior audit evidence) remains BASELINE_ACTIVE under §6.1's derivation and is
  NEVER mutated by any R2 slice.
- No R2 slice backfills a ProjectAhspOccurrence, ProjectAhspResourceResolution,
  or ProjectRabLineAhspApplication for any existing BoqItem. A pre-R2 BoqItem
  with a non-null legacy ahspVersionId and no ACTIVE application is simply
  "not yet migrated to R2" — surfaced honestly (§3.2's diagnostic), never
  silently upgraded.
- Manual lines are not a "Cost Kernel bypass" — they are a distinct, first-class
  calculation mode (Transition law §12.2/§12.3: mode is explicit, one mode never
  silently overwrites the other). R2 does not add a "source" enum column to
  BoqItem to formalize this distinction; "manual" remains, as today, simply
  the absence of an ACTIVE application for that line.
- Production activation of R2 for existing live projects (i.e., actually running
  the new AHSP-selection flow against real ACC-X-style data) requires a SEPARATE
  Owner/PM implementation gate, exactly as every prior BP-AHSP phase required
  (§ Project Memory §8, §9). This document authorizes architecture, not
  activation.
```

## 11.3 Rollback policy — pre- vs. post-production data

```text
PRE_PRODUCTION_DATA (R2 tables have never received a real production write —
  true immediately after Migration A/B in §5 are first applied to a fresh or
  test environment):
    - migration rollback MAY DROP the additive table/type
      (project_rab_line_ahsp_applications, RabLineApplicationStatus,
      boq_structures.draftRevision) on an isolated test/shadow database.
    - this is safe ONLY because no application/occurrence history yet exists
      to lose.

POST_PRODUCTION_DATA (any ProjectRabLineAhspApplication row has been created
  against real project data):
    - DROP TABLE is FORBIDDEN.
    - rollback means: disable the R2 feature path (route/guard level — stop
      accepting new §6.3 requests), NOT deleting the schema.
    - application/occurrence history (§D3's append-only guarantee) MUST be
      preserved even during a rollback — it is audit evidence, not disposable
      state.
    - a genuinely destructive rollback (e.g. correcting a proven data-corruption
      bug) requires: a full data export/backup (matching the precedent already
      set at KAMUS_UNIT_KERNEL_01A's pre-activation backup discipline, Project
      Memory §11.2), explicit Owner authorization, and its own dedicated
      migration + implementation gate — never bundled into a routine deploy
      rollback.
```

---

# 12. TEST_MATRIX

Organized by concern; each row is a required test, not a suggestion.

**Lifecycle:** `EMPTY`, `DRAFT`, `UNDER_REVIEW` (reserved — assert no derivation path reaches it in R2), `BASELINE_ACTIVE`, `ARCHIVED`; Addendum hidden/false on Draft; Addendum hidden/false on `hasActiveBaseline && hasWorkingDraft` (the actual current repo condition, §6.1); direct-URL access to a lifecycle-gated route enforces the same guard as the derived capability; `Project.status` changing does NOT change `RabLifecycleProjection.state` independently of the real BOQ/baseline data (regression test directly targeting §1.A1/A2's root cause).

**Permission/security (`R2-PERM-00`):** missing `RAB_VIEW` → 403; missing `RAB_DRAFT_EDIT` → 403; no `ProjectAssignment` → 404 (not 403 — tenant-safe); foreign project → 404; cross-tenant permission (Workspace B permission against Workspace A project) → 403 (existing `PermissionsGuard` contract, §1.C3, must still hold for the new codes); spoofed `x-workspace-id` header on a project-scoped RAB route → 403; seed idempotency (re-seed twice, assert no duplicate rows); `DIRECTOR` role, post-migration, does NOT gain `RAB_DRAFT_EDIT` merely from holding `PROJECT_CREATE` (direct regression test for §1.C5).

**Draft identity (`R2-01`):** `BoqItem.id` stable across two sequential saves with no row changes; a row with `clientKey` but `id: null` returns a NEW `id` in the response, and that same `id` is stable on the NEXT save when the client echoes it back; out-of-order parent reference (child before parent in payload array) still resolves correctly (regression for §1.B2); duplicate persisted `id` in payload → 400; duplicate `clientKey` → 400; orphan parent reference (`id` or `clientKey` not in payload/currentIds) → 404/400 per §8 Phase 1; self-parent → 400; deep cycle (3+ hops) → 400; `WORK_ITEM`/`NOTE` as a `parentRef` target → 400; foreign-structure row `id` → 404 (never leaks existence); exact `expectedRevision` mismatch → 409 with current revision in body; two concurrent saves against the same `expectedRevision` → exactly one 200, one 409 (never two 200s); baseline (`ProjectBaseline`/baseline `RabDocument`/baseline `BoqItem` rows) unchanged after any Draft save; `ProjectRabLineAhspApplication` rows unchanged by an ordinary Draft save that only edits `quantity`/`unit`/`name` (never superseded by a save that isn't an AHSP reselection).

**AHSP application (`R2-02`):** foreign/non-tenant-visible `AHSPVersion` → `REJECTED`; `BoqItem` not in an editable Draft (e.g. targeting a baseline line) → `REJECTED BOQ_ITEM_NOT_IN_EDITABLE_DRAFT`; zero-resource `AHSPVersion` → `REJECTED ZERO_RESOURCE_AHSP_VERSION`, no occurrence created; exact resource-set completeness — occurrence's resolution count exactly equals the `AHSPVersion`'s resource count, never fewer (regression for §14.3/`LOCKED_12` of the Transition law); missing resource in the resolved set → structurally impossible by construction (assert the INSERT is always N-for-N, not merely "usually"); foreign-version resource reference → rejected before persistence; two different `BoqItem`s selecting the same `AHSPVersion` create two SEPARATE `ProjectAhspOccurrence` rows (§D2, unchanged by R2); one `ProjectAhspOccurrence` cannot back two `ProjectRabLineAhspApplication` rows (DB-level `@unique` on `projectAhspOccurrenceId`, tested via forced double-insert attempt); reselect on the same line preserves the OLD occurrence unchanged and untouched (§D3) while creating a NEW occurrence + application; exactly one `ACTIVE` application per `boqItemId` at all times, including immediately after a reselect (assert via the partial unique index firing on a forced race); same `idempotencyKey` + same semantic payload replay → returns the identical existing occurrence/application, not a duplicate; same `idempotencyKey` + different `boqItemId`/`ahspVersionId` → `CONFLICT_IDEMPOTENCY_PAYLOAD_MISMATCH` (409); concurrent identical request (two simultaneous POSTs, same key+payload) → exactly one occurrence/application row exists after both resolve (race test, not merely sequential); concurrent DIFFERENT selections on the same line → exactly one `ACTIVE` application survives (either deterministic-serialized or 409-on-loser, both acceptable per §7.2), never two.

**Cost Kernel (`R2-03`):** loads its occurrence exclusively through the line's `ACTIVE` `ProjectRabLineAhspApplication` (regression proving §D5's ambiguous project/workspace/version inference path is no longer reachable for R2-migrated lines); a `SUPERSEDED` application is never read by the calculation path; a `BoqItem` with no `ACTIVE` application fails closed (no money, no zero, explicit "not calculated" state) — never falls back to the legacy `BoqItem.ahspVersionId` (§3.2); an occurrence with any `UNRESOLVED`/`NEEDS_REVIEW` resolution produces no `ahspUnitPrice`/`lineTotal` (`null`/omitted, not `0` — direct regression for the fake-zero prohibition, §3.3/§14.2 of the Transition law); exact `Prisma.Decimal` arithmetic reproduced from PR #32's 13-resource fixture (`2004055`/`20040550`) continues to pass unchanged through the new occurrence-lookup path; resource order reversal produces no drift (existing PR #32 test, must still pass); editing `quantity`/`unit` on a kernel-managed line marks its PR #32 frontend result stale (existing `invalidateRow` contract, unaffected by R2); client-supplied `unitPrice` on a kernel-managed line is rejected `400`, never silently dropped (§6.2, direct test); Cost Kernel result is never written to `BoqItem.unitPrice`/`lineTotal` (assert the columns are unchanged after a calculation read, matching PR #32's own already-proven "read-only, never persists" test); a manual line (no `ACTIVE` application) never enters the Cost Kernel resolution path even if it happens to share a `unitPrice` value with a calculated line; the workspace recap total uses the exact backend decimal-string result (existing `computeDirectCostTotal`/`addDecimalStrings` contract, unaffected).

**Performance (`R2-02`/`R2-03`):** no per-resource query at 13/50/100 fixture sizes (query-count assertion per §9.1's stage shape, not a fixed magic number); each stage's query is provably filtered by the prior stage's candidate set (§9.3 — assert `WHERE ... IN (...)` bounds, not just a spy call count); `UnitKernelService` memoization hit for a repeated `(source,target)` pair within one selection request (§9.1 Stage 7); bulk-insert of N resolution rows is one round trip, not N; benchmark output captured and stored as the PROVISIONAL_UNTIL_BENCHMARK evidence artifact (§9.4).

**Compatibility:** Phase 2's existing `POST`/`GET /projects/:projectId/ahsp-occurrences[...]` endpoints, DTO, guards, and all their existing tests continue to pass completely unmodified (regression law — no existing Phase 2 test file may be edited, matching the precedent already set by `SECURITY_PROJECT_PERMISSION_WORKSPACE_AUTHORITY_SUPPLEMENT.md`'s "Regression Honesty Law"); every existing PR #32 Cost Kernel test continues to pass; no test manufactures a production hard-coded fixture; no test performs a real production-database backfill; Execution Factor is not touched by any R2 test; no rounding policy is invented or tested (kernel `Decimal` output remains unrounded, exactly as PR #32 shipped it).

---

# 13. IMPLEMENTATION_SPLIT_AND_STOP_CONDITIONS

## R2-PERM-00 — RAB Permission Foundation

```text
SCOPE: declare RAB_VIEW, RAB_DRAFT_EDIT (seeded), RAB_SUBMIT_REVIEW,
  RAB_APPROVE, RAB_LOCK, RAB_ADDENDUM_CREATE (declared, NOT seeded) in
  permissions.ts; idempotent seed additions for the 2 seeded codes only;
  replace PROJECT_CREATE with RAB_DRAFT_EDIT on saveDraftBoq.
FILES: backend/src/common/constants/permissions.ts,
  backend/prisma/seed-rbac-permissions.ts (or equivalent),
  backend/src/project/project.controller.ts (decorator swap only, 1 line)
MIGRATION: none (permission catalog and seed are application-level, not schema)
PREREQUISITES: Owner role-mapping decision (§10.2) for the seed-grant step only;
  declaring codes and swapping the decorator do not require it.
TESTS: §12 Permission/security block.
GATES: existing PermissionsGuard/ProjectAccessGuard unit+E2E suites pass
  unmodified; new negative tests pass; seed idempotent.
FORBIDDEN: inventing a role-mapping default; touching any route unrelated
  to RAB; seeding the 4 deferred codes to any role.
ROLLBACK: pre-production — revert the catalog/seed additions freely.
  post-production — once RAB_DRAFT_EDIT is seeded to a real role, removing
  it is a permission change requiring the same Owner sign-off as granting it.
VERDICT: BLOCKED_ON_OWNER_ROLE_MAPPING for the seed-grant step;
  CODE-LEVEL SCOPE READY.
```

## R2-00 — RAB Lifecycle Projection

```text
SCOPE: GET /projects/:projectId/rab/lifecycle (§6.1); frontend consumption
  by ProjectListPage.tsx and ProjectRabDoorPage.tsx replacing their
  independent Project.status-derived logic (§1.A1/A2); Addendum button
  gated by capabilities.canRequestAddendum, closing §1.A3's defect.
FILES: backend/src/project/rab-lifecycle.service.ts (new),
  project.controller.ts (new route), frontend/src/pages/ProjectListPage.tsx,
  frontend/src/pages/ProjectRabDoorPage.tsx
MIGRATION: none (read-only projection over existing tables)
PREREQUISITES: R2-PERM-00 (RAB_VIEW must exist and be seeded to at least
  the roles that already use these two pages today, or the pages regress
  to 403 for existing users — this ordering constraint is itself part of
  the Owner role-mapping decision in §10.2)
TESTS: §12 Lifecycle block.
GATES: existing ProjectListPage/ProjectRabDoorPage tests (if any) pass;
  new lifecycle derivation tests pass; no Project.status-only regression.
FORBIDDEN: building a review/approval/lock workflow; building an Addendum
  entity; touching initiateSetup's baseline-creation behavior.
ROLLBACK: pre- and post-production both safe — this is an additive
  read-only endpoint; disabling it reverts the two frontend pages to
  their prior (defective but unchanged) behavior.
VERDICT: READY, sequenced after R2-PERM-00.
```

## R2-01 — Stable Draft Identity and Reconciliation

```text
SCOPE: §6.2 revised PUT contract; §8 reconciliation algorithm replacing
  §1.B1's delete-recreate; BoqStructure.draftRevision field and optimistic
  concurrency (§7.1).
FILES: backend/src/project/project.service.ts (saveDraftBoq rewrite),
  backend/src/project/dto/save-draft-boq.dto.ts (new shape, §6.2),
  backend/prisma/schema.prisma (Migration A, §5.1), frontend draft-editor
  save call site (RabWorkspacePage.tsx-equivalent request builder)
MIGRATION: A (§5.1) — 1 ALTER TABLE, additive, 0 data writes.
PREREQUISITES: R2-PERM-00 (RAB_DRAFT_EDIT replaces PROJECT_CREATE on this
  exact route, §1.C4).
TESTS: §12 Draft identity block.
GATES: full existing backend unit + safe E2E suites pass unmodified;
  ProgressEntry RESTRICT never fires in any test (§1.B3/B4 regression);
  no existing saveDraftBoq caller breaks (money-authority rule §6.2 is
  net-new rejection behavior, not a breaking change to non-kernel rows).
FORBIDDEN: touching AHSP application/occurrence in any way (§7.3); reusing
  BoqStructure.version for concurrency (§3.4's resolved decision).
ROLLBACK: pre-production — drop draftRevision column freely. post-production
  — column stays (harmless extra field); revert only the service logic to
  the delete-recreate algorithm if truly necessary, accepting the
  reintroduction of §1.B1/B2's known defects as a documented regression,
  never silently.
VERDICT: READY, sequenced after R2-PERM-00, independent of R2-02/R2-03.
```

## R2-02 — AHSP Line Application and Batched Resolver

```text
SCOPE: ProjectRabLineAhspApplication model (§3-§5); §6.3 endpoint; §7.2
  transaction/concurrency; §9 batched query plan replacing §D6's N+1/
  unfiltered-scan pattern; §9.2 benchmark.
FILES: backend/prisma/schema.prisma (Migration B, §5.2),
  backend/src/project/rab-line-ahsp-application.service.ts (new),
  backend/src/project/project.controller.ts (new route),
  backend/src/project-ahsp/project-ahsp.service.ts (READ-ONLY reuse of its
  resolution logic via extraction into a shared, batchable function — the
  existing single-resource POST path itself is not modified, §D1-D3 preserved)
MIGRATION: B (§5.2) — 1 CREATE TYPE, 1 CREATE TABLE, indexes, 1 partial
  unique index (hand-authored), 2 FKs, 0 data writes, 0 changes to Phase 2
  tables.
PREREQUISITES: R2-PERM-00, R2-01 (needs draftRevision for
  expectedDraftRevision check, §6.3).
TESTS: §12 AHSP application block + Performance block.
GATES: every existing Phase 2 test passes completely unmodified (Regression
  Honesty Law, §12 Compatibility); benchmark captured at 13/50/100 and the
  repository-informed worst case (§9.2) BEFORE this slice is declared
  complete, not after.
FORBIDDEN: modifying CreateProjectAhspOccurrenceDto or POST
  /projects/:projectId/ahsp-occurrences in any way; adding boqItemId to
  ProjectAhspOccurrence/ProjectAhspResourceResolution (re-violating the
  locked BP_AHSP_PHASE2_OCCURRENCE_IDENTITY_CLARIFICATION.md boundary);
  locking a hard performance ceiling before the benchmark exists.
ROLLBACK: pre-production — DROP TABLE/TYPE freely (§11.3). post-production
  — disable the §6.3 route only; ProjectRabLineAhspApplication and every
  ProjectAhspOccurrence it references remain untouched, permanent audit
  history (§11.3).
VERDICT: READY, sequenced after R2-01, before R2-03.
```

## R2-03 — AHSP Selection UI, Cost Kernel Projection Rewire, Manual/Kernel Separation

```text
SCOPE: frontend AHSP-selection UI calling §6.3; Cost Kernel's occurrence
  lookup rewired to resolve exclusively through the ACTIVE
  ProjectRabLineAhspApplication (closing §D5's ambiguous-inference path);
  frontend money-authority enforcement (reject/disable manual unitPrice
  editing for kernel-managed lines, matching §6.2's backend 400); manual-
  line labeling per Transition law §12.2 vocabulary (presentation only,
  no new schema field, §11.2).
FILES: backend/src/project/cost-kernel.service.ts (occurrence-lookup
  rewrite only — contracts.ts's CostCalculationResult shape and the
  existing GET /projects/:projectId/boq/cost-calculations HTTP contract
  are UNCHANGED, §6 note), frontend RAB workspace editor components
MIGRATION: none.
PREREQUISITES: R2-02 (ACTIVE application must exist to resolve against).
TESTS: §12 Cost Kernel block.
GATES: every existing PR #32 Cost Kernel test passes unmodified except the
  ones this slice explicitly supersedes with a stronger, named replacement
  (the ambiguous project/workspace/version inference tests, replaced by
  §12's "loads exclusively through ACTIVE application" tests — a named,
  reviewed replacement, never a silent deletion); fake-zero prohibition
  tests (§12) all pass.
FORBIDDEN: rounding policy invention; Execution Factor; Addendum engine;
  AI-generated Basic Price or any invented provenance field.
ROLLBACK: pre- and post-production — this slice can be feature-flagged off
  at the frontend/route level without any data-loss risk, since it performs
  no new writes beyond what R2-02 already committed.
VERDICT: READY, sequenced last.
```

## STOP_CONDITIONS (apply across every slice above)

```text
STOP_FAKE_ZERO_DETECTED
  — any code path returns ahspUnitPrice/lineTotal = "0" or 0 for an
    unresolved/incomplete resource set instead of null/omitted + BLOCKED/
    NEEDS_REVIEW status.
STOP_KERNEL_MONEY_PERSISTED_TO_BOQITEM
  — any write touches BoqItem.unitPrice/lineTotal from a Cost Kernel result
    before a rounding/persistence policy is separately Owner-gated.
STOP_OCCURRENCE_IDENTITY_SCOPE
  — any change adds boqItemId, occurrenceKey, WBS/schedule/EF identity to
    ProjectAhspOccurrence/ProjectAhspResourceResolution (re-violates the
    already-locked Phase 2 constitutional boundary, §D4).
STOP_DUPLICATE_ACTIVE_APPLICATION
  — the partial unique index (§5.2) is ever bypassed or removed without an
    equivalent guarantee proven by test.
STOP_PERMISSION_ROLE_MAPPING_GUESSED
  — any commit seeds RAB_VIEW/RAB_DRAFT_EDIT to a Role without a recorded
    Owner decision (§10.2).
STOP_PHASE2_BACKWARD_COMPATIBILITY_BROKEN
  — any existing Phase 2 test file is edited to make a new change pass
    (Regression Honesty Law, carried forward from
    SECURITY_PROJECT_PERMISSION_WORKSPACE_AUTHORITY_SUPPLEMENT.md §2).
STOP_HARD_PERFORMANCE_CEILING_LOCKED_WITHOUT_BENCHMARK
  — any implementation prompt encodes a specific millisecond/query-count
    ceiling not derived from §9.2's actual benchmark run.
STOP_PRODUCTION_GOLDEN_THREAD_CLAIMED_LIVE
  — any report from any slice claims "Golden Thread is live" or "R2 is in
    production" — this document authorizes architecture only (§11.2).
```

---

# 14. FINAL_VERDICT

```text
FAKE_ZERO_PRESENT                          = NO  (§3.9, §6.3, §12 Cost Kernel block)
KERNEL_MONEY_PERSISTED_TO_BOQITEM          = NO  (§6.2, §7.3)
NULLABLE_OCCURRENCE_LINK                   = NO  (projectAhspOccurrenceId is NOT NULL, §4)
DUPLICATED_AHSP_AUTHORITY                  = NO  (§3.1 — application never re-expresses occurrence facts)
PERMISSION_MISSING_FROM_SEQUENCE           = NO  (R2-PERM-00 is slice one, §13)
UNPROVEN_HARD_PERFORMANCE_LIMIT_LOCKED     = NO  (§9 — every number is PROVISIONAL_UNTIL_BENCHMARK)
UNDEFINED_CONCURRENCY_BEHAVIOR             = NO  (§7.1, §7.2 — every race has a named, deterministic outcome)
INCOMPLETE_LEGACY_POLICY                   = NO  (§11)
CONFLICT_WITH_PR_34                        = NO  (§2 — PR #34 is documentation-only, verified)

FINAL_VERDICT=R2_ARCHITECTURE_READY_FOR_PM_OWNER_DECISION
```

No claim of production activation, live Golden Thread, or implementation completion is made anywhere in this document. Owner decision required and explicitly flagged, not guessed: `RAB_VIEW`/`RAB_DRAFT_EDIT` role mapping (§10.2).

---

# REVISION_CHANGELOG

This is the first fully written version of this document — no prior draft was persisted to a file before the V3.0 revision directive arrived; V2.0's execution was still in the read-only evidence-gathering phase (four parallel research passes covering §1.A–§1.D) when V3.0's corrections were issued. The entries below therefore document, per V3.0's explicit instruction set, exactly which failure modes were designed out of this first published cut before publication — named honestly as corrections against the *naive default* a first draft would otherwise have contained, not as a diff against a fabricated prior document text.

| OLD_STATEMENT (naive default, never published) | NEW_STATEMENT (this document) | REASON | AFFECTED_SECTION |
|---|---|---|---|
| Cost Kernel returns `ahspUnitPrice: "0"` / `lineTotal: "0"` when a resource is unresolved. | `null`/omitted + `BLOCKED`/`NEEDS_REVIEW` status; Cost Kernel not run for that line. | Fake zero is indistinguishable from a real zero-value economic fact; forbidden explicitly by `LOCKED_10`/`LOCKED_11` of the Transition law and by V3.0 §3.2. | §3.9, §6.3, §12, §14 |
| Client-supplied `unitPrice` on a kernel-managed line is silently ignored by `saveDraftBoq`. | Explicit `HTTP 400 KERNEL_MANAGED_LINE_REJECTS_CLIENT_UNIT_PRICE`. | Silent ignoring hides a client bug and risks a future regression re-trusting the field; V3.0 §3.3 requires visible rejection. | §6.2, §8 Phase 1, §12 |
| Cost Kernel result is written into `BoqItem.unitPrice`/`lineTotal` once calculated, "to keep the recap fast." | Cost Kernel remains a read-only backend projection; `BoqItem` money columns are never touched by R2. | Persisting derived money before a rounding/persistence policy is Owner-gated creates a second source of truth and a silent precision-loss risk; V3.0 §3.3. | §6.3, §7.3, §11.2 |
| `ProjectRabLineAhspApplication` duplicates `ahspVersionId`, `projectId`, `workspaceId`, and resolution status for query convenience. | Those facts are read only via the `projectAhspOccurrenceId` join; the application table carries none of them. | Duplication creates exactly the "two canonical homes for one fact" pattern `SIMPROK_PROJECT_RAB_AUTHORITY_UNIT_LAW.md` §D.6 forbids for unit conversion, generalized here to AHSP application; V3.0 §3.4 explicit instruction. | §3.1, §4 |
| A resolution-quality state (`RESOLVED`/`NEEDS_REVIEW`/etc.) is added to `RabLineApplicationStatus`. | `RabLineApplicationStatus` has exactly `ACTIVE`/`SUPERSEDED` — selection lifecycle only. | Mixing selection-lifecycle and resolution-trust meaning into one enum violates the four-state distinction locked in `SIMPROK_RAB_TRANSITION_INTERACTION_SYNTHESIS_AND_UNCERTAINTY_LAW.md` §14.1; V3.0 §3.9 "Honest snapshot policy." | §3.1, §4, §6.3 |
| Query/latency ceilings ("max 250 resources," "5 second timeout," "exactly 7 queries") are stated as locked limits. | Every number is `PROVISIONAL_UNTIL_BENCHMARK`; only query *shape* (constant-stage, batched, no per-resource loop) is locked by design. | No repository evidence supports any specific number (§D8 proved this directly); locking an unproven number is exactly the kind of invented precision V3.0 §3.12 forbids. | §9, §12, §13 |
| A production Role→permission mapping for `RAB_VIEW`/`RAB_DRAFT_EDIT` is proposed as a default (e.g., "grant to DIRECTOR"). | Role mapping is explicitly `OWNER DECISION REQUIRED`, with only the confirmed repository facts (§1.C5's `DIRECTOR` inconsistency) presented, no recommendation made. | Assigning permission-to-role mapping is a product/security decision reserved to the Owner per `SIMPROK_PROJECT_RAB_AUTHORITY_UNIT_LAW.md` §B.2 (`DEBT-PERMISSION-01`) and V3.0 §3.7/§10.2's explicit prohibition on engineer-guessed role mapping. | §10 |
| Migration rollback is described generically as "reversible" without distinguishing pre- vs. post-production data. | Explicit `PRE_PRODUCTION_DATA` (DROP allowed on isolated DB) vs. `POST_PRODUCTION_DATA` (DROP forbidden; disable-path-only rollback; history preserved) split. | "Additive migration" was already shown by `BP_AHSP_PHASE2_OCCURRENCE_IDENTITY_CLARIFICATION.md` §5 to be necessary-but-not-sufficient honesty; V3.0 §3.14 requires the same distinction be made explicit here rather than implying any rollback is free. | §11.3, §13 |
| `BoqStructure.version` is reused directly as the new optimistic-concurrency counter for Draft saves. | A new, single-purpose `draftRevision` field is added; `version` is left untouched and unclaimed. | Direct grep proof (§1.B8) that `version` is hard-coded to `1` everywhere and read nowhere means it currently carries no meaning at all — reusing it would silently assign it a *second*, different future meaning (Addendum version numbering) without ever resolving which one it means; V3.0 §3.8's explicit instruction to decide, not leave ambiguous. | §3.4, §4, §5.1 |
| "Synthetic Baseline" used as a product-facing term for `initiateSetup`'s auto-approved baseline. | `LEGACY_BASELINE_DIAGNOSTIC` — internal diagnostic only, never product vocabulary. | The term risked implying SIMPROK fabricates baseline data; V3.0 §3.13 explicit removal instruction. | §11.1 |
| Two `BoqItem`s sharing an `ahspVersionId` "should probably just share the occurrence" (accepting §D5's current ambiguity as acceptable). | Cost Kernel resolves exclusively through each line's own `ACTIVE` application; ambiguity by shared version is structurally eliminated for every R2-migrated line. | The revision directive names this exact gap explicitly ("belum ada hubungan eksplisit BoqItem ke ProjectAhspOccurrence... Cost Kernel masih melakukan inferensi occurrence melalui project/workspace/AHSP version") as a defect to close, not a tolerable quirk. | §3.1, §D5, §12 |

Soli Deo Gloria. Segala kemuliaan hanya bagi Tuhan Yesus Kristus. Haleluya. Amin.
