# SIMPROK - Living Project Memory

Owner: Feky de Fretes
PM / Gate Keeper: ChatGPT
Repository: fekyigo-rgb/SIMPROK

## 1. Status Produk Terkini

- KAMUS Unit Kernel 01A: `MERGED`; production activation `PASS_SUBSTANTIVE` for canonical source, schema/reference data in `simprok_db`, and the bounded backend application path. Column Evidence Addendum V1.1: `PASS`. Backend HTTP runtime: `NOT_PROVEN`; frontend integration, 01B, Cost Kernel, Execution Factor, and RAB arithmetic remain closed. Documentation closure and Owner acceptance are `PASS`; PR #31 merge is authorized only under the exact final guards. 01B and the next product slice remain closed.

- Main clean dan sinkron dengan origin/main.
- P6B/P6C: LOCKED.
- P7A: LOCKED.
- P7B: LOCKED.
- P7C: CANONICAL INTAKE CONTRACT IMPLEMENTED_ON_BRANCH.
- Coding P7C: AWAITING_OWNER_REVIEW.
- Basic Price–AHSP Implementation Blueprint v1.0: OWNER PASS — FOUNDATION LOCKED.
- Project, RAB, Authority & Unit Law v1.0: OWNER LOCKED — CANONICAL.
- BP-AHSP Phase 1 Deterministic Resource Price Resolution Proof: COMMITTED_PASS melalui PR #22, merge commit `217b5f8dca983d24b51be18208d2ab00f6a38845`.
- Security prerequisite — Project Permission Workspace Authority: MERGED_PASS melalui PR #23, merge commit `6dc7000456e8f6a58aed9f66fbe1f17eb5d5e4eb`.
- BP-AHSP Phase 2 Commit B — freshness-aware deterministic resolution: `61e98fe546f689df65c884db894298bbbc525e6e`; PM GATE PASS; OWNER PASS; LOCKED.
- BP-AHSP Phase 2 Commit C — project occurrence persistence schema: `04767a0f4cde035ff38446ba8a867ab09b0b809e`; PM GATE PASS; OWNER PASS; LOCKED.
- BP-AHSP Phase 2 Commit D — guarded runtime persistence wiring: IMPLEMENTED and MERGED; implementation commit `97377ac0ef51b8cbfd49240af4f0b297556501c2`; Phase 2 merge commit `e89ba7c3dddc2335827831efd57cfbedd53ac32b`.
- BP-AHSP Phase 2 first real Project AHSP occurrence: `PASS_RESOLVED`; runtime proof `CLOSED_WITH_DB_REVERIFICATION_PASS`; documentation closure `MERGED_VIA_PR_28` through PR #28, merge commit `1510a0457e983c0bf8cbb3bedf4d3535bfc76fde`.
- Phase 2 implementation/runtime-proof baseline — PR #27 main head at the time of proof: `032529662021961e06f646d6bd8b20642900dfab`; canonical production entrypoint: `node dist/src/main`.

## 2. Keputusan Owner

### DEC-RAB-001 - Enam Intake Modes

A. BOQ + spesifikasi
B. BOQ tanpa spesifikasi
C. BOQ + spesifikasi + pagu
D. BOQ + pagu
E. Tanpa BOQ + pagu
F. Tanpa BOQ dan tanpa pagu

**Status:** OWNER DECIDED

### DEC-EF-001 - Execution Factor Tidak Menyimpan Rupiah

Execution Factor menjelaskan kondisi pelaksanaan.

Biaya lahir melalui:

Execution Factor
-> Execution Requirement
-> Resource Requirement
-> Cost Engine
-> RAB

**Status:** FOUNDATION LOCKED

### DEC-AHSP-001 - AHSP Contextual Applicability

Satu AHSP master dapat digunakan pada banyak BOQ item.

Execution context dan keputusan EF melekat pada setiap occurrence/item, bukan pada master AHSP.

**Status:** P7C CORE LAW - menunggu Owner PASS final P7C.

### DEC-BP-AHSP-001 - Basic Price Selection Inside Project AHSP Occurrence

- Basic Price mencatat fakta harga; nominal tinggi/rendah bukan alasan peringatan.
- Identitas publik utama: Harga Pemerintah, Harga Toko/Supplier, atau Harga Lapangan.
- SIMPROK memilih Basic Price secara otomatis di dalam project AHSP occurrence.
- User dapat melihat alasan, melihat harga pembanding, dan mengganti harga.
- Pilihan dan override disimpan di AHSP occurrence/snapshot, bukan di baris RAB.
- Master AHSP tetap otoritatif dan tidak berubah karena konteks harga proyek.
- Basic Price menyesuaikan satu arah ke satuan AHSP melalui konversi deterministik dan berbukti.
- Snapshot lama tidak pernah di-backfill.
- RAB hanya mengonsumsi Harga Satuan hasil AHSP.

**Status:** OWNER PASS — FOUNDATION LOCKED pada 14 Juli 2026.

## 3. Keputusan Terbuka

### UTANG-PLATFORM-03 — IMPORT-FIRST-01 vertical-local intake sementara

Adapter XLSX IMPORT-FIRST-01 adalah vertical-local intake sementara. Doc-03 Article-05 dan Doc-02 Article-13 mengenai Reality Intake asynchronous di Platform Layer belum dipenuhi. Jalur ini diizinkan Owner khusus untuk BOQ XLSX → Preview → Persetujuan manusia → Working Draft kosong → Frontend RAB. Adapter wajib tetap terpisah, pure, tanpa database dan tanpa business dependency agar dapat dipindahkan melalui perubahan wiring tanpa menulis ulang parser. Utang ditutup ketika Platform Reality Intake dibuka sesuai ADR-002.

- Kamus konteks universal AHSP.
- Profil sensitivitas keluarga pekerjaan.
- Profil spesifik AHSP.
- Matriks sumber harga x cakupan x mobilisasi x EF.
- Repository reality audit sebelum first implementation slice.
- Semantik final ACCEPT / VERIFIED / PUBLISHED pada Basic Price.
- Precedence ResourceCatalog dan Basic Price global vs workspace.
- Final permission catalog for RAB draft editing and project AHSP occurrence writing.

## 4. Keputusan yang Digantikan

### SUPERSEDED - Tujuh Intake Modes

Mode lama C dan E ternyata duplikat.

Digantikan oleh enam mode final A-F.

## 5. Bukti Implementasi

| Bagian | Status | Bukti |
|---|---|---|
| P7A | LOCKED | commit 982b135 |
| P7B | LOCKED | commit bf24a32 |
| P7C Canonical Intake Contract | IMPLEMENTED_ON_BRANCH | branch feat/p7c-canonical-intake-contract; migration 20260711000000_p7c_canonical_intake_contract; API PATCH /projects/:projectId/intake-context and GET /projects/:projectId/intake-mode; backend build PASS; backend unit 122 PASS; serial e2e 114 PASS; frontend build PASS; runtime API Mode C/F PASS; browser visual audit not run because no browser automation/tooling available |
| BP-AHSP Phase 1 | COMMITTED_PASS | PR #22; merge commit `217b5f8dca983d24b51be18208d2ab00f6a38845`; pure deterministic worker-price resolution kernel; focused 19/19 PASS; backend unit 33 suites/263 tests PASS; safe E2E 18 suites/172 tests PASS; residual PASS; PR Quality Gate SUCCESS |
| Security Project Permission Workspace Authority | MERGED_PASS | PR #23; merge commit `6dc7000456e8f6a58aed9f66fbe1f17eb5d5e4eb`; focused PermissionsGuard unit 10/10 PASS; focused security E2E 9/9 PASS; backend unit 34 suites/273 tests PASS; safe E2E 18 suites/176 tests PASS; frontend build PASS; PR Quality Gate SUCCESS |
| BP-AHSP Phase 2 | IMPLEMENTED_MERGED; RUNTIME_PROOF_CLOSED | implementation commit `97377ac0ef51b8cbfd49240af4f0b297556501c2`; merge commit `e89ba7c3dddc2335827831efd57cfbedd53ac32b`; first real occurrence `PASS_RESOLVED`; DB-only closure audit PASS; detailed evidence: `docs/implementation-gates/BP_AHSP_PHASE2_FIRST_REAL_OCCURRENCE_CLOSURE.md` |

## 5.1 P7C Implementation Notes

- Pagu source of truth: `Project.budgetBaseline`.
- Main material specification source of truth: `Project.mainMaterialSpec`.
- `Project.description` remains project narrative; no automatic parsing/backfill from legacy description text.
- Mode AF is derived by `backend/src/project/intake-mode.kernel.ts`; no mode is stored in the database.
- Temporary permission debt: PATCH intake context uses `PROJECT_CREATE` with `ProjectAccessGuard` + `PermissionsGuard`.
- Limitations still not implemented: AHSP Recommendation Engine, Basic Price Recommendation Engine, Execution Factor Engine, Daftar Kebutuhan Material, logistics, monitoring.

## 6. Aturan Pengelolaan

- Hanya Owner yang memberi PASS / REVISE / STOP.
- Keputusan lama tidak dihapus; tandai SUPERSEDED.
- Desain tidak boleh disebut implemented tanpa bukti repository/runtime.
- Masukan AI lain adalah bahan, bukan keputusan.
- Jangan membuat checkpoint baru kecuali Owner meminta.

### 6.1 REPOSITORY SYNCHRONIZATION LAW — OWNER LOCKED

Tujuan: komputer Owner, clone lokal `C:\SIMPROK`, branch kerja, `origin/main`, branch remote, PR, dan GitHub Actions tidak boleh tertinggal jauh atau membawa kebenaran yang berbeda.

**Sebelum setiap pekerjaan:**

1. `git fetch origin --prune`
2. Buktikan branch aktif, `HEAD`, `origin/main`, dan `git status --short`.
3. Untuk pekerjaan baru, mulai dari latest clean `origin/main` yang memuat seluruh commit dokumentasi/gate terbaru.
4. Jangan bekerja dari branch lokal lama hanya karena branch itu masih terbuka.
5. Bila local dan remote divergen atau worktree tidak bersih, STOP dan laporkan sebelum edit.

**Sebelum commit dan push:**

1. Jalankan gate yang diwajibkan.
2. Jalankan `git diff --check`.
3. Periksa `git status --short` dan scope file.
4. Commit hanya setelah hasil akhir gate diketahui, bukan ketika task masih berjalan.
5. Push branch dan buktikan local `HEAD` sama dengan remote branch head.

**Sebelum PR dan merge:**

1. PM/Gatekeeper membandingkan branch terhadap current `main` dan memeriksa exact changed files.
2. CI harus selesai dan PASS.
3. Merge memakai exact reviewed head SHA agar perubahan tersembunyi ditolak.
4. Owner memberi PASS eksplisit sebelum merge.

**Sesudah merge:**

1. GitHub merge status dan merge commit diverifikasi.
2. Owner menyelaraskan clone lokal dengan:
   `git checkout main` lalu `git pull --ff-only origin main`.
3. Buktikan `HEAD = origin/main` dan worktree clean.
4. Branch fitur berikutnya dibuat dari `main` terbaru setelah seluruh gate/document commits masuk.
5. PM tidak boleh menyatakan tahap berikutnya aktif tanpa menyebut expected base SHA/commit.

**Pembagian kebenaran:**

- GitHub remote/commit/PR/CI: diverifikasi langsung oleh PM/Gatekeeper.
- Runtime lokal, port, browser, `.env.test`, dan database lokal: dibuktikan melalui PowerShell Owner atau implementer, lalu dicocokkan dengan repository evidence.
- Laporan implementer bukan sumber kebenaran tunggal.

**Status:** OWNER LOCKED pada 14 Juli 2026.

## P7C PRODUCT INTELLIGENCE LAW

- Current document version:
  `v1.0-DRAFT`
- Status:
  `DRAFT — DESIGN ONLY`
- Owner PASS:
  `NOT YET GIVEN`
- Active policy version remains:
  `P8A_CONSTITUTIONAL_AI_BOUNDARY_V1`
- Future policy version after explicit Owner PASS:
  `P7C_PRODUCT_INTELLIGENCE_LAW_V1`
- Implementation authority:
  `NONE until separate Owner/PM implementation gate`
- Key direction carried by the draft:
  `AHSP One — Applications Many — EF Contextual per Occurrence`
- Completed occurrence verdict:
  `B — current boqItemRef is only the current proxy; it is not a structural Work Occurrence guarantee. A distinct occurrence reference will eventually be required.`
- Current AI EF path:
  `HARD LOCKED / NOT_ALLOWED under P8A_CONSTITUTIONAL_AI_BOUNDARY_V1. P7C LAW-6.7 is draft alignment, not new implementation authority.`
- Retrieval rule:
  Read Project Memory first, then the canonical P7C document, then locked Foundation/ADR sources and repository reality.
- Duplication rule:
  Do not copy the full P7C law into Project Memory. Keep only this pointer/status to prevent two versions of truth.

## 7. BASIC PRICE–AHSP IMPLEMENTATION BLUEPRINT

- Canonical document:
  `docs/project-memory/SIMPROK_BASIC_PRICE_AHSP_IMPLEMENTATION_BLUEPRINT.md`
- Owner Lock Record:
  `docs/project-memory/SIMPROK_BASIC_PRICE_AHSP_IMPLEMENTATION_BLUEPRINT_OWNER_LOCK.md`
- Version:
  `v1.0`
- Status:
  `OWNER PASS — FOUNDATION LOCKED`
- Owner PASS:
  `14 Juli 2026`
- Implementation authority:
  `FOUNDATION LOCKED; each production slice requires a separate bounded Owner/PM implementation gate`
- Core placement law:
  `SIMPROK automatically selects Basic Price inside the project AHSP occurrence; the user may inspect, compare, and override; RAB only consumes the resulting AHSP unit price.`
- Master law:
  `Master AHSP remains authoritative and unchanged. Project price resolution, conversion evidence, selection, and override belong to the project AHSP occurrence/snapshot.`
- Retrieval rule:
  Read Project Memory first, then the Owner Lock Record, then the canonical blueprint, before creating or executing any Basic Price, resource bridge, unit conversion, AHSP price-resolution, Cost Kernel, or Golden Thread implementation prompt.
- Duplication rule:
  Do not copy the full blueprint into Project Memory. Keep only this pointer/status to prevent two versions of truth.

## 8. COMPLETED BOUNDED IMPLEMENTATION GATE — PHASE 1

- Gate document:
  `docs/implementation-gates/BP_AHSP_PHASE1_DETERMINISTIC_RESOURCE_PROOF.md`
- Status:
  `COMMITTED_PASS`
- Merge evidence:
  `PR #22; merge commit 217b5f8dca983d24b51be18208d2ab00f6a38845`
- Delivered scope:
  `Pure backend deterministic proof: Pekerja + LABOR + OH → Pekerja + LABOR + Org/Hari → exactly one public-eligible Basic Price → AUTO_SELECTED with factor 1 and explanation.`
- Runtime limitation:
  `Kernel exists on main but is not yet wired to production persistence or an endpoint.`

## 9. COMPLETED BOUNDED IMPLEMENTATION GATE — PHASE 2

- Gate document:
  `docs/implementation-gates/BP_AHSP_PHASE2_PROJECT_OCCURRENCE_PERSISTENCE.md`
- Status:
  `IMPLEMENTED_MERGED — COMMIT B, COMMIT C, AND COMMIT D COMPLETE; FIRST REAL OCCURRENCE PASS_RESOLVED; RUNTIME PROOF CLOSED WITH DB REVERIFICATION PASS; DOCUMENTATION CLOSURE MERGED VIA PR #28; MERGE COMMIT 1510a0457e983c0bf8cbb3bedf4d3535bfc76fde.`
- Security prerequisite evidence:
  `PR #23; merge commit 6dc7000456e8f6a58aed9f66fbe1f17eb5d5e4eb`
- Security prerequisite documents:
  - `docs/implementation-gates/BP_AHSP_PHASE2_ARCHITECT_FINAL_REVIEW_DECISIONS.md`
  - `docs/implementation-gates/SECURITY_PROJECT_PERMISSION_WORKSPACE_AUTHORITY_SUPPLEMENT.md`
- Completed bounded scope:
  `Commit B completed the freshness-aware deterministic resolution kernel. Commit C completed the additive ProjectAhspOccurrence and ProjectAhspResourceResolution persistence schema and migration. Commit D wired the guarded POST and GET project-AHSP occurrence endpoints and persists truthful RESOLVED, UNRESOLVED, or NEEDS_REVIEW outcomes.`
- Closure evidence:
  `The bounded first real occurrence is PASS_RESOLVED and the DB-only closure audit passed in a REPEATABLE READ, READ ONLY transaction. Detailed identities and values remain in docs/implementation-gates/BP_AHSP_PHASE2_FIRST_REAL_OCCURRENCE_CLOSURE.md.`
- Placement:
  `Do not store resource-level selection in BoqItem or RAB. Do not mutate master AHSP or old snapshots.`
- Forbidden in this phase:
  `No frontend, no override, no comparison UI, no multi-price ranking, no publication fix, no global/workspace precedence rule, no universal unit engine, no Cost Kernel arithmetic, no AHSP unit-price calculation, no RAB change, and no snapshot backfill.`
- Historical delivery rule — `SUPERSEDED_BY_IMPLEMENTATION_AND_RUNTIME_PROOF`:
  `Synchronize the Phase 2 implementation branch with latest main containing PR #23 and this status update. Do not merge or create a Phase 2 PR before PM code review and complete gates. Commit D must start from the exact reviewed post-memory-sync baseline. No PR or merge is authorized. No schema, migration, index, kernel, BasicPriceService, security guard, permission catalog, seed, package, frontend, Cost Kernel, AHSP unit-price, RAB, Execution Factor, or snapshot change may be added to Commit D.`
- Documentation closure result:
  `PM review and Owner acceptance passed for final reviewed head 625d2eb6fd3aa2d982a6c4091bc347f448783a05. PR #28 merged through merge commit 1510a0457e983c0bf8cbb3bedf4d3535bfc76fde after final-head CI succeeded. This closure does not open the next product slice.`

## 9.1 BP-AHSP PHASE 2 COMMIT CHECKPOINTS

### Commit B — Freshness-Aware Deterministic Resolution

- Commit:
  `61e98fe546f689df65c884db894298bbbc525e6e`
- Message:
  `feat(ahsp): add freshness-aware deterministic resolution`
- Status:
  `COMMIT_B_PM_GATE_PASS; OWNER_PASS_COMMIT_B; LOCKED`
- Scope:
  `Exactly the deterministic price-resolution kernel and its focused specification.`
- Evidence:
  `Focused kernel 1 suite / 24 tests PASS; backend unit 34 suites / 278 tests PASS; backend build PASS.`

### Commit C — Project Occurrence Persistence Schema

- Commit:
  `04767a0f4cde035ff38446ba8a867ab09b0b809e`
- Parent:
  `61e98fe546f689df65c884db894298bbbc525e6e`
- Message:
  `feat(ahsp): add project occurrence persistence schema`
- Migration:
  `20260715113019_bp_ahsp_phase2_project_occurrence_persistence`
- SQL SHA-256:
  `b2a842cfbd623348cacff8be536c6f6b69340d8c146e0d778a03dae84850ac74`
- Status:
  `COMMIT_C_PM_GATE_PASS; OWNER_PASS_COMMIT_C; LOCKED`
- Scope:
  `Three enums, ProjectAhspOccurrence, ProjectAhspResourceResolution, and one additive migration.`
- SQL inventory:
  `3 CREATE TYPE; 2 CREATE TABLE; 2 CREATE UNIQUE INDEX; 8 CREATE INDEX; 7 FOREIGN KEY; 0 data writes.`
- Evidence:
  `Prisma format and validate PASS; backend build PASS; focused kernel 24 tests PASS; backend unit 34 suites / 278 tests PASS; safe E2E 18 suites / 176 tests PASS; database fingerprint 60 tables; residual PASS; advisory lock released; frontend build PASS.`
- Accepted non-blocking notes:
  `Prisma format produced verified whitespace-only realignment outside the new schema section, with no semantic drift. The original executor prompt was truncated after section 33, but the continuation prompt restated all mandatory gates and the official safe E2E gate was executed. No amend or corrective commit was required.`

### Commit D — Implementation and Runtime Proof Status

- Status:
  `IMPLEMENTED_MERGED; FIRST REAL OCCURRENCE PASS_RESOLVED; RUNTIME PROOF CLOSED WITH DB REVERIFICATION PASS`
- Implementation commit:
  `97377ac0ef51b8cbfd49240af4f0b297556501c2`
- Phase 2 merge commit:
  `e89ba7c3dddc2335827831efd57cfbedd53ac32b`
- Historical implementation/runtime-proof baseline and production entrypoint:
  `PR #27 main head at the time of proof: 032529662021961e06f646d6bd8b20642900dfab; node dist/src/main`
- Historical preflight status:
  `COMMIT_D_READ_ONLY_PREFLIGHT_PM_GATE_PASS_WITH_EXECUTION_CONDITIONS — SUPERSEDED_BY_IMPLEMENTATION_AND_RUNTIME_PROOF`
- Maximum planned scope:
  `Seven backend/runtime/test files only.`
- Planned endpoints:
  `POST /projects/:projectId/ahsp-occurrences`
  `GET /projects/:projectId/ahsp-occurrences/:occurrenceId`
- Security:
  `JwtAuthGuard → ProjectAccessGuard → PermissionsGuard. Trusted workspace comes from request.projectAccess.workspaceId. Trusted account comes from request.user.id.`
- Temporary permission:
  `POST may use AHSP_MANAGE only for this bounded Phase 2 proof; GET uses AHSP_VIEW. Final project-AHSP write permission remains OPEN debt. AHSP_MANAGE must not become the final authority design.`
- Freshness bridge — PM verified repository reality:
  `BasicPriceService.findByResource() uses Prisma findMany without a top-level select, so BasicPrice scalar fields, including freshnessStatus, are returned. The nested resource select limits only the related ResourceCatalog fields. Commit D must still prove with a real test that freshnessStatus is passed unchanged to the kernel and that EXPIRED prices are never auto-selected. Failure is STOP_ELIGIBILITY.`
- Request-body security gate:
  `Global ValidationPipe does not whitelist extra fields. The controller must explicitly pick only ahspVersionId, ahspResourceId, and idempotencyKey. Object spread and forwarding the complete body are forbidden. A real spoof-field test must prove that body-supplied workspaceId, projectId, createdByAccountId, status, selected price, and policyVersion are ignored. Failure is STOP_SECURITY_SPOOF_GUARD.`
- AHSP relationship gate:
  `The service must prove that ahspResourceId belongs to the requested ahspVersionId. An explicit real test is mandatory. Failure is STOP_AHSP_RESOURCE_VERSION_MISMATCH.`
- Idempotency:
  `Same project and idempotency key with the same version/resource returns the existing result. Different payload returns 409. Concurrent identical requests create exactly one occurrence and one resolution. A unique race must re-read the winner.`
- Decimal:
  `Money and Decimal values must use Prisma.Decimal or exact strings. Number(), parseFloat(), and JavaScript floating-point arithmetic are forbidden.`
- Kernel:
  `The locked deterministic kernel must remain unchanged and be called exactly once for each new resolution attempt. Expired-only and multiple-active outcomes remain NEEDS_REVIEW without automatic selection.`
- Test integrity:
  `expect(true).toBe(true), focused tests, skipped tests, and fake assertions are forbidden. The official future E2E gate is npm run test:e2e:safe and must finish with residual PASS and advisory-lock release.`
- Policy version:
  `BP_AHSP_PHASE2_NAME_EXACT_OPTION_C_V1`
- Non-equivalence:
  `ProjectAhspOccurrence is not canonical WorkOccurrence or ExecutionAssessment. idempotencyKey is not occurrenceKey. Commit D must not introduce boqItemId, WBS, schedule/activity identity, location/work-face identity, Execution Factor, Cost Kernel, AHSP unit-price arithmetic, RAB arithmetic, snapshot mutation, or master AHSP mutation.`
- Forbidden Commit D changes:
  `No schema, migration, index, kernel, BasicPriceService, security guard, permission catalog, seed, package, frontend, Cost Kernel, RAB, Execution Factor, or snapshot change.`
- First real occurrence and closure:
  `FIRST_PROJECT_AHSP_OCCURRENCE_VERDICT=PASS_RESOLVED; DB_ONLY_CLOSURE_AUDIT=PASS; BP_AHSP_PHASE2_RUNTIME_PROOF=CLOSED_WITH_DB_REVERIFICATION_PASS; DOCUMENTATION_CLOSURE_STATUS=MERGED_VIA_PR_28; DOCUMENTATION_CLOSURE_PR=28; DOCUMENTATION_CLOSURE_MERGE_COMMIT=1510a0457e983c0bf8cbb3bedf4d3535bfc76fde.`
- Bounded ownership decision:
  `The exact Resource Catalog and Basic Price used by the proof remain Workspace A only. This statement is bounded to those exact proof records and does not settle universal workspace/global precedence.`
- Runtime lifecycle debt:
  `BACKEND_LIFECYCLE_DEBT=UTANG_RUNTIME_PROCESS_LIFECYCLE_OPEN_NON_BLOCKING.`
- Bounded exclusions remain active:
  `Phase 2 does not calculate coefficient × price, resource cost, AHSP unit price, subtotal, or RAB total; it does not complete Cost Kernel, Execution Factor, snapshot, override, comparison UI, frontend, or universal workspace/global precedence.`
- Next delivery gate:
  `The locked order remains KAMUS-UNIT-KERNEL-01A → KAMUS-UNIT-KERNEL-01B → one live RAB line, each under its own Owner/PM gate. Selecting or opening the next target requires a new Owner decision and gate.`

## 10. PROJECT, RAB, AUTHORITY & UNIT LAW

- Canonical document:
  `docs/project-memory/SIMPROK_PROJECT_RAB_AUTHORITY_UNIT_LAW.md`
- Version:
  `v1.0`
- Status:
  `OWNER LOCKED — CANONICAL`
- Source:
  `Owner document DESAIN 6. Pintu dan Kewenangan RAB, normalized on 14 Juli 2026.`
- Core authority law:
  `Workspace permission must be evaluated in the project’s real Workspace and combined with ProjectAssignment; membership alone is insufficient.`
- Door law:
  `PROJECT_CREATE is not RAB_DRAFT_EDIT; project creation, RAB viewing/editing, locking, and approval are distinct authorities.`
- Placement law:
  `Basic Price resolution and selection live inside the project AHSP occurrence; RAB only consumes the resulting AHSP unit price.`
- Unit gate law:
  `AHSPVersion.outputUnit and BOQ-unit compatibility are mandatory before BOQ Volume × AHSP Unit Price; incompatible or unsupported conversion is NEEDS_REVIEW.`
- Conversion truth law:
  `Audit AHSPResource.conversionFactor before introducing UnitConversionRule; two canonical homes for the same conversion factor are forbidden.`
- Current effective order:
  `Security prerequisite (MERGED_PASS) → BP-AHSP Phase 2 persistence (IMPLEMENTED_MERGED; RUNTIME_PROOF_CLOSED) → KAMUS-UNIT-KERNEL-01A → KAMUS-UNIT-KERNEL-01B → one live RAB line → broader Governance/RBAC debts.`
- Retrieval rule:
  `For project/RAB/authority/unit work, read Project Memory, then this canonical law, then the Basic Price–AHSP Owner Lock and Blueprint, then applicable gates and repository/runtime evidence.`
- Duplication rule:
  `Do not copy the full law into other documents. Keep pointers/status only to prevent two versions of truth.`

## 11. KAMUS UNIT KERNEL 01A PRODUCTION ACTIVATION TRUTH RECORD

### 11.1 Status and layered activation boundary

- `KAMUS_UNIT_KERNEL_01A_IMPLEMENTATION_STATUS=MERGED`
- `KAMUS_UNIT_KERNEL_01A_PRODUCTION_ACTIVATION_STATUS=PASS_SUBSTANTIVE`
- `COLUMN_EVIDENCE_ADDENDUM_V1_1=PASS`
- `BACKEND_HTTP_RUNTIME_STATUS=NOT_PROVEN`
- `KAMUS_UNIT_KERNEL_01B_STATUS=CLOSED`
- `NEXT_PRODUCT_SLICE_OPENED=NO`
- PR #30 merged from base `e204674790ec4ee1ba1a6232351ccac76ac04a6f`; canonical main and merge commit are `773e88c47e0f225cdf294da923c4a99a7b501a61`.
- Merged source establishes the three canonical homes `UnitDefinition`, `UnitAlias`, and `UnitConversionRule`; gives `AHSPVersion` output-unit identity; routes the Phase 2 PERSON_DAY path through the resolver; removes hard-coded alias ownership as a second canonical home; and rejects new legacy `conversionFactor` writes.
- The four evidence layers remain distinct: merged source; schema/reference data in `simprok_db`; bounded application-code proof; and backend HTTP/frontend/RAB activation.
- `01A is active in canonical source, schema/reference data in simprok_db, and the bounded backend application path. Backend HTTP, frontend integration, 01B monetary adaptation, Cost Kernel, and RAB arithmetic remain unproven or closed.`

### 11.2 Historical production database and backup evidence

This docs-only closure did not access the database. The following is historical verified activation evidence:

- Database `simprok_db`; migration `20260717010000_kamus_unit_kernel_01a`: record count 1, finished YES, rolled back NO, applied steps 1, failed migration count 0.
- Reference data: `UnitDefinition=8`, `UnitAlias=11`, `UnitConversionRule=0`; canonical-unit duplicate count 0.
- `AHSPVersion.outputUnit` and `AHSPVersion.outputUnitDefinitionId` columns are available.
- Global SAK-to-KG, ROLL-to-M1, and TRUCK-capacity rule counts are each 0. `UnitConversionRule=0` is fail-closed evidence, not a deficiency: no global SAK, ROLL, or TRUCK assumption exists without evidence.
- Pre-activation backup: `C:\SIMPROK_BACKUPS\simprok_db_20260717_131222_pre_kamus_unit_kernel_01a.dump`; 226479 bytes; SHA-256 `53ea17c92c64372144945b6e81c2a78c94e31d97db76ecb43cd9a43db45b3c33`; PostgreSQL 17.10; `PG_RESTORE_LIST_PASS`. A restore was not run.

### 11.3 Locked-column evidence and historical hash limitation

- Occurrence `8d1c421f-bfb9-467e-8d67-2cd54dd60a06`: locked projection match YES; no mutation detected in locked projection YES.
- Resolution `c616807f-93db-4f6a-b63e-91011b364915`: locked projection match YES; no mutation detected in locked projection YES.
- Resolution evidence: status `RESOLVED`; selection mode `AUTO_SELECTED`; method `EXACT_DETERMINISTIC`; canonical unit `PERSON_DAY`; source unit `Org/Hari`; source and adapted price `158333.33`; stored legacy `conversionFactor=1.000000`; stored `quantityFactor=NULL`.
- Ownership evidence: `resourceCatalogId=e29aac23-70ff-42ab-b9ca-e96472ba6cf0`; Basic Price `a3266896-da53-4306-9cae-e25535d4e31e`; both Workspace `10000000-0000-4000-8000-000000000004`; selected source origin `FIELD_REPORT`; Basic Price status `PUBLISHED`.
- Reason codes: `EXACT_RESOURCE_NAME_MATCH`, `RESOURCE_TYPE_MATCH`, `LABOR_DAY_UNIT_EQUIVALENT`, `SINGLE_ELIGIBLE_BASIC_PRICE`.
- `No mutation was detected within the locked occurrence and resolution column projections.`
- `Absolute immutability was not proven.`
- Historical hashes exist, but their inline activation projection/serialization procedure was not persisted and is not reproducible. No hash rerun occurred; hashes are therefore not repeatable canonical evidence. This is not evidence of a data mismatch. Reproducible locked-column comparison is the closure evidence; no byte-for-byte hash proof is claimed.

### 11.4 Bounded proof and runtime exclusions

- `BOUNDED_RESOLVER_PROOF=PASS_FROM_PRODUCTION_ACTIVATION_TRANSCRIPT_NOT_RERUN`; rerun NO.
- Historical activation proof: OH and Orang/Hari each resolve to PERSON_DAY with factor 1 and `IDENTITY`; unknown aliases fail closed; SAK to KG without an evidence rule fails closed; first-occurrence re-resolution remains `158333.33`, PERSON_DAY, factor 1; the bounded proof performed no persistence.
- `BACKEND_HTTP_LIVE=NOT_PROVEN`; port 3000 listener count at the V1.1 addendum was 0; API end-to-end proven NO; frontend Unit Kernel connected NO.
- 01B, Cost Kernel, Execution Factor, frontend production, and RAB arithmetic were not opened.

### 11.5 Evidence-addendum history

- V1.0 — prompt `SIMPROK-KAMUS-UNIT-KERNEL-01A-PRODUCTION-ACTIVATION-EVIDENCE-ADDENDUM-V1_0-FINAL`; executor `CLAUDE_CODE`; normalized verdict `STOP_READ_ONLY_LAW_VIOLATED_AND_REPRODUCIBLE_PROCEDURE_UNAVAILABLE`. The historical hash procedure was not reproducible, the bounded-proof procedure was not available as a persisted harness, and at least two temp-file writes occurred. There was no repository or database write, no migration/activation rerun, and no runtime damage detected.
- V1.1 — prompt `SIMPROK-KAMUS-UNIT-KERNEL-01A-COLUMN-EVIDENCE-ADDENDUM-V1_1-FINAL`; executor `CLAUDE_CODE`; verdict `READ_ONLY_COLUMN_EVIDENCE_ADDENDUM_PASS`. Exact repository, backup, database, migration, reference counts, occurrence projection, resolution projection, and ownership matched in a `REPEATABLE READ, READ ONLY` transaction. Filesystem/repository/database/Git/GitHub/backend/API write count was 0. No hash or bounded-proof rerun occurred; HTTP remained unproven and 01B remained closed.

### 11.6 Owner operational clarification — executor coordination

This is an Owner operational clarification, not a Foundation, Kitab, ADR, or universal constitutional amendment. The authorized executor classes are `CODEX`, `CLAUDE_CODE`, and `CURSOR_AGENT`.

`Model and version labels are informational unless the Owner explicitly pins an exact model for a specific task.`

`PR #31 docs-only truth sync executor class: CODEX; reported model label: CODEX_GPT_5; continued under Owner follow-up authorization.`

1. Only one executor is active for one task, branch, and worktree.
2. The Owner appoints the executor in each execution decision; the executor cannot change mid-task without a new Owner decision.
3. Other executors are read-only reviewers. Two executors may not stage, commit, push, merge, or write the database concurrently.
4. Handoff must carry branch, HEAD, worktree, database/migration state, and last verdict.
5. Autopilot 4 Guarded is an operating discipline, not an executor.
6. Single writer means one active writer per task, not a permanent vendor/model monopoly.

### 11.7 Documentation closure state

- `DOCUMENTATION_CLOSURE_STATUS=PASS`
- `OWNER_ACCEPTANCE=PASS`
- `OWNER_MERGE_DECISION=PASS`
- `PR_MERGE_AUTHORIZED=YES`
