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
