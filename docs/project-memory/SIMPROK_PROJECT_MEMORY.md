# SIMPROK - Living Project Memory

Owner: Feky de Fretes
PM / Gate Keeper: ChatGPT
Repository: fekyigo-rgb/SIMPROK

## 1. Status Produk Terkini

- Main clean dan sinkron dengan origin/main.
- P6B/P6C: LOCKED.
- P7A: LOCKED.
- P7B: LOCKED.
- P7C: CANONICAL INTAKE CONTRACT IMPLEMENTED_ON_BRANCH.
- Coding P7C: AWAITING_OWNER_REVIEW.
- Basic Price–AHSP Implementation Blueprint v1.0: OWNER PASS — FOUNDATION LOCKED.
- BP-AHSP Phase 1 Deterministic Resource Price Resolution Proof: COMMITTED_PASS melalui PR #22, merge commit `217b5f8dca983d24b51be18208d2ab00f6a38845`.
- BP-AHSP Phase 2 Project AHSP Occurrence Persistence: OWNER/PM IMPLEMENTATION GATE — GO.

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

- Kamus konteks universal AHSP.
- Profil sensitivitas keluarga pekerjaan.
- Profil spesifik AHSP.
- Matriks sumber harga x cakupan x mobilisasi x EF.
- Repository reality audit sebelum first implementation slice.
- Semantik final ACCEPT / VERIFIED / PUBLISHED pada Basic Price.
- Precedence ResourceCatalog dan Basic Price global vs workspace.

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

## 9. ACTIVE BOUNDED IMPLEMENTATION GATE — PHASE 2

- Gate document:
  `docs/implementation-gates/BP_AHSP_PHASE2_PROJECT_OCCURRENCE_PERSISTENCE.md`
- Status:
  `OWNER/PM IMPLEMENTATION GATE — GO`
- Scope:
  `Create ProjectAhspOccurrence and ProjectAhspResourceResolution; wire the Phase 1 kernel into a guarded backend runtime endpoint; persist RESOLVED, UNRESOLVED, or NEEDS_REVIEW outcomes and the selected Basic Price trace inside the project AHSP occurrence.`
- Placement:
  `Do not store resource-level selection in BoqItem or RAB. Do not mutate master AHSP or old snapshots.`
- Forbidden in this phase:
  `No frontend, no override, no comparison UI, no multi-price ranking, no publication fix, no global/workspace precedence rule, no universal unit engine, no Cost Kernel arithmetic, no AHSP unit-price calculation, no RAB change, and no snapshot backfill.`
- Delivery rule:
  `Implement on feat/bp-ahsp-phase2-occurrence-persistence; do not merge or create PR before PM code review; return IMPLEMENTATION_PASS_AWAITING_PM_GATE or STOP/FAIL.`