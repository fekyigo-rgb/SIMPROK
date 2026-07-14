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
- Basic Price–AHSP Implementation Blueprint v1.0: OWNER REVIEW DRAFT — BASIS BEFORE IMPLEMENTATION PROMPT.

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
- Version:
  `v1.0`
- Status:
  `OWNER REVIEW DRAFT — BASIS BEFORE IMPLEMENTATION PROMPT`
- Implementation authority:
  `NONE until explicit Owner PASS and a separate bounded implementation gate`
- Core placement law:
  `SIMPROK automatically selects Basic Price inside the project AHSP occurrence; the user may inspect, compare, and override; RAB only consumes the resulting AHSP unit price.`
- Master law:
  `Master AHSP remains authoritative and unchanged. Project price resolution, conversion evidence, selection, and override belong to the project AHSP occurrence/snapshot.`
- Retrieval rule:
  Read this blueprint before creating or executing any Basic Price, resource bridge, unit conversion, AHSP price-resolution, Cost Kernel, or Golden Thread implementation prompt.
- Duplication rule:
  Do not copy the full blueprint into Project Memory. Keep only this pointer/status to prevent two versions of truth.
