# SIMPROK — GOLDEN THREAD R2 ARCHITECTURE

## V3.2 — CHIEF ARCHITECT REVISION

### Dalam Nama Tuhan Yesus Kristus. Soli Deo Gloria. Haleluya. Amin.

---

## 0. IDENTITAS ARTEFAK

```text
DOCUMENT_VERSION          = V3_2
DOCUMENT_ID               = SIMPROK-GOLDEN-THREAD-R2-ARCHITECTURE-GATE-V3_2
FILENAME                  = golden_thread_r2_architecture_v3_2.md
ARCHITECTURE_AUTHOR       = Claude (Chief Architect)
PM_GATEKEEPER             = ChatGPT
CONSTITUTION_AUDITOR      = Gemini (belum berjalan)
DOCUMENT_EXECUTOR         = Codex / Claude Code (setelah isi final)
OWNER                     = Feky de Fretes

REPOSITORY_BASE_VERIFIED  = 703984d18e52fbe8da987fab6dae460a0977f113
VERIFICATION_METHOD       = raw fetch api.github.com + raw.githubusercontent.com
PRISMA_VERSION_VERIFIED   = 6.4.1 (backend/package.json)

SOURCE_ARTIFACT           = golden_thread_r2_architecture_v3_0.md / v3_1.md
SOURCE_HASH               = TIDAK DIVERIFIKASI ARSITEK — lihat §0.1
PM_REVIEW_REFERENCE       = PM FULL-FILE FINAL REVIEW (14 blocker, 5 catatan)
ARCHITECT_REVIEW_REFERENCE= Audit Arsitek atas PM Review (3 koreksi, 5 temuan, 1 batas peran)

IMPLEMENTATION_AUTHORIZED = NO
SOURCE_WRITE              = 0
SCHEMA_WRITE              = 0
MIGRATION_WRITE           = 0
DATABASE_WRITE            = 0
```

### 0.1 DEKLARASI KEJUJURAN ARSITEK (Doktrin Cermin)

Saya, Arsitek, **tidak pernah membaca file V3.0/V3.1 secara langsung.** Isi dokumen itu hanya saya ketahui melalui kutipan di dalam PM Review.

Konsekuensi yang tidak boleh disembunyikan:

```text
SOURCE_ARTIFACT_READ_BY_ARCHITECT = NO
SOURCE_SHA256_VERIFIED_BY_ARCHITECT = NO
```

Maka V3.2 **tidak ditulis sebagai revisi baris-per-baris atas V3.1.** V3.2 ditulis sebagai **dokumen canonical berdiri sendiri**, disusun di atas tiga fondasi yang dapat dipertanggungjawabkan:

1. **Repository reality** yang saya fetch dan baca sendiri pada `703984d1`;
2. **Temuan PM** yang telah saya uji ulang terhadap repository;
3. **Keputusan Arsitek** yang saya tulis dan pertanggungjawabkan sendiri.

**KEWAJIBAN REKONSILIASI (RECON-01).** Sebelum V3.2 di-LOCK, satu pihak yang memegang file V3.1 wajib membandingkan V3.2 terhadap V3.1 dan melaporkan setiap materi V3.1 yang **tidak terbawa** ke V3.2. Bagian yang hanya saya ketahui lewat PM ditandai `[VIA_PM]` di seluruh dokumen ini dan berstatus `NEEDS_SOURCE_RECONCILIATION`.

Saya menolak berpura-pura telah membaca dokumen yang tidak saya baca. Itu LAW-0.4.

---

## 1. RINGKASAN EKSEKUTIF

### 1.1 Apa yang R2 selesaikan

R2 menutup satu-satunya jurang yang memisahkan SIMPROK dari **satu baris RAB hidup berangka Rupiah**:

```text
BUKTI SCHEMA (703984d1):
model ProjectAhspOccurrence { workspaceId, projectId, ahspVersionId, idempotencyKey ... }
→ TIDAK ADA boqItemId

model BoqItem { ... ahspVersionId String? ... }
→ hanya pointer versi AHSP, bukan pointer occurrence
```

Artinya: **occurrence yang sudah terbukti hidup (`8d1c421f`) tidak punya jalan pulang ke baris BOQ.** Cost Kernel dapat menghitung, tetapi tidak ada relasi canonical yang menyatakan *baris RAB mana* yang dihitungnya.

`ProjectRabLineAhspApplication` adalah jembatan itu. Itu sebabnya R2 ada.

### 1.2 Verdict atas 14 blocker PM

| Blocker | Verdict Arsitek | Catatan |
|---|---|---|
| BLK-00 identitas artefak | **DITERIMA** | Diselesaikan oleh §0 + RECON-01 |
| BLK-01 `Project.status` + auto-baseline | **DITERIMA, BUKTI DIKUATKAN** | Saya verifikasi sendiri di `project.service.ts:149` |
| BLK-02 capability matrix | **DITERIMA** | §4 |
| BLK-03 urutan slice | **DITERIMA** | §12 |
| BLK-04 GET Draft tanpa revision | **DITERIMA, BUKTI DIKUATKAN** | `BoqStructure` tak punya `draftRevision` |
| BLK-05 first-save race | **DITERIMA, BUKTI DIKUATKAN** | `BoqStructure` hanya `@@index([projectId])` |
| BLK-06 parent graph | **DITERIMA** | §7 |
| BLK-07 CASCADE menghapus histori | **DITERIMA — blocker terberat** | Melanggar Kitab §7 & LAW-7.2 |
| BLK-08 row lock palsu | **DITERIMA** | §8 |
| BLK-09 save vs selection | **DITERIMA** | §8 |
| BLK-10 idempotency | **DITERIMA, BUKTI DIKUATKAN** | `@@unique([projectId, idempotencyKey])` terbukti |
| BLK-11 breaking API | **DITERIMA** | §6 |
| BLK-12 decorator tanpa role grant | **DITERIMA** | §14 |
| BLK-13 rollback delete-recreate | **DITERIMA** | §15 |

### 1.3 Koreksi Arsitek atas resep PM

| # | Resep PM | Keputusan Arsitek |
|---|---|---|
| K-1 | (tidak menyebut) | Partial unique index **wajib custom SQL** (Prisma 6.4.1 tak mendukung `@@unique` berklausa `WHERE`) — §5.3 |
| K-2 | `REPEATABLE READ` / `SERIALIZABLE` | **DITOLAK sebagai baseline.** `READ COMMITTED` + explicit lock — §8.3 |
| K-3 | (tidak menyebut) | `BOQ_STRUCTURE_SOFT_DELETE = NO_IN_R2` — §5.2 |

### 1.4 Temuan Arsitek yang tidak ada pada PM

| # | Temuan | Berat |
|---|---|---|
| **A-1** | `precisionPolicy` tidak pernah ditetapkan | BLOCKER — §11 |
| **A-2** | Nol pemeriksaan Pagu Blindness (LAW-1.4) | BLOCKER — §10 |
| **A-3** | Tenant isolation tabel baru tak diuji | BLOCKER — §9 |
| **A-4** | Interaksi soft-delete × snapshot immutable | BLOCKER — §7.5 |
| **A-5** | `UTANG-GUARD-02` / `UTANG-PERMISSION-01` tak dirujuk | HIGH — §13 |
| **A-6** | **DECIMAL SCALE TRAP** — ditemukan dari schema mentah | **BLOCKER BARU — §11.2** |

---

## 2. HUKUM YANG MENGIKAT DOKUMEN INI

```text
LAW-0.4   Nol fabrikasi. Nol provenance karangan.
LAW-1.4   Pagu Blindness — pagu bukan input pembentuk harga.
LAW-2.x   Basic Price adalah fakta; tidak pernah lahir dari AI.
LAW-4.x   Setiap biaya punya tepat satu rumah canonical.
LAW-5.x   Master AHSP bersih; occurrence memikul konteks.
LAW-6.2   Uang hanya lahir di Cost Kernel deterministik.
LAW-7.2   Evidence append-only; tidak dihapus.
Article-07 No Implicit Access.
Kitab §7  Immutability: snapshot dan evidence tidak diubah.
Kitab §12 JANGAN TAMBAL — mutu Grade A adalah ukuran akhir.
Kitab §14 Mesin dulu. Satu jalur bersih. Buktikan. Baru perluas.
Blueprint Larangan 1–11 (khususnya 1, 2, 9, 10, 11).
Desain-6 §D "Tidak ada pagar baru sebelum satu baris RAB hidup."
```

Setiap keputusan di bawah ini harus dapat dilacak ke salah satu hukum di atas. Keputusan tanpa dasar hukum ditandai `ARCHITECT_JUDGEMENT` dan terbuka untuk dibantah.

---

## 3. LIFECYCLE AUTHORITY

### AD-02 — `Project.status` dikeluarkan dari derivasi state RAB

```text
PROJECT_STATUS_READ_IN_RAB_STATE_DERIVATION = 0
```

**Bukti akar masalah (diverifikasi Arsitek, bukan diterima dari PM):**

`backend/src/project/project.service.ts`, `initiateSetup()` baris 149 dst., dalam satu transaksi membuat:

```text
tx.rabDocument.create({ status: 'APPROVED' })
tx.projectBaseline.create({ status: 'ACTIVE', rabDocumentId })
tx.progressReport.create({ status: 'SUBMITTED' })
tx.project.update({ data: { status: 'ACTIVE' } })
```

Tanpa satu pun review, approval, atau keputusan manusia.

**Ini bukan cacat UI. Ini pelanggaran LAW-0.1** (SIMPROK tidak pernah auto-approve) **dan Konstitusi Doc-01 Article-04** (Human Before Publication). Lifecycle projection yang memproyeksikan keadaan ini sebagai `BASELINE_ACTIVE` normal berarti **membungkus pelanggaran menjadi tampak sah.**

### 3.1 State canonical

```text
REACHABLE_R2:
  NO_RAB              tidak ada BoqStructure sama sekali
  WORKING_DRAFT       ada Working Draft aktif (deletedAt IS NULL)
  BASELINE_ACTIVE     ada ProjectBaseline ACTIVE
  BASELINE_ACTIVE_WITH_UNRECONCILED_DRAFT
                      baseline aktif DAN Working Draft aktif hidup bersama

RESERVED_UNREACHABLE_R2:
  UNDER_REVIEW        menunggu entity review nyata
  ADDENDUM_DRAFT      menunggu entity addendum nyata
  ARCHIVED            menunggu workflow arsip nyata
```

```text
RESERVED_STATE_FABRICATED = 0
```

State reserved **tidak boleh diturunkan dari `Project.status`.** Ia tetap unreachable sampai entity-nya lahir. Ini penerapan Hukum Pintu: lebih baik pintu jujur berkata "belum ada" daripada pintu palsu yang mendarat di ruang kosong.

### 3.2 State keempat adalah pengakuan, bukan normalisasi

`BASELINE_ACTIVE_WITH_UNRECONCILED_DRAFT` sengaja diberi nama panjang dan tidak nyaman. Ia **menandai keadaan tidak sehat sebagai tidak sehat**, bukan menyamarkannya. Selama data warisan `initiateSetup` masih ada, state ini akan muncul — dan memang harus muncul.

```ts
hasUnreconciledWorkingDraft: boolean;   // WAJIB ADA di DTO evidence
```

### AD-02b — Inisialisasi proyek masa depan (OWNER LOCKED)

```text
NEW_PLANNING_PROJECT
  → membuat WORKING_DRAFT
  → NO_AUTO_APPROVED_RAB
  → NO_AUTO_ACTIVE_BASELINE
  → NO_AUTO_PROGRESS_REPORT
  → Project.status TIDAK otomatis ACTIVE

LEGACY_BASELINE_MUTATED   = NO
LEGACY_DATA_BACKFILL      = NO
```

**Dampak monitoring/progress dipisahkan ke gate tersendiri (`GATE-MONITORING-01`).** Bila monitoring saat ini bergantung pada baseline otomatis, memperbaiki `initiateSetup` akan mematikan monitoring untuk proyek baru. Itu keputusan produk, bukan keputusan teknis — tidak diselundupkan ke dalam R2.

---

## 4. CAPABILITY MATRIX

### AD-03 — Satu policy service, dipakai lifecycle endpoint dan setiap write route

**Akar penyakit "dua kebenaran"** sudah pernah kita bayar mahal pada PR #19: endpoint daftar dan guard akses memakai logika berbeda. Jangan ulangi.

```text
CAPABILITY_DERIVATION_SITES = 1
DERIVATION_SERVICE = RabLifecyclePolicyService
```

`saveDraftBoq`, `ahsp-selection`, dan lifecycle endpoint **memanggil service yang sama.** Frontend tidak pernah menurunkan capability sendiri; ia hanya merender apa yang backend nyatakan.

### 4.1 Matriks canonical

Prasyarat semua baris: `projectAccess` PASS (Article-07). Tanpa akses proyek → 404, bukan 403.

| State | `RAB_VIEW` | `RAB_DRAFT_EDIT` | canViewDraft | canEditDraft | canSaveDraft | canSelectAhsp | canCalculateKernel | canCreateBaseline | canViewBaseline | canDeleteLine |
|---|---|---|---|---|---|---|---|---|---|---|
| NO_RAB | ✗ | – | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| NO_RAB | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| NO_RAB | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| WORKING_DRAFT | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ |
| WORKING_DRAFT | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ |
| BASELINE_ACTIVE | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ |
| BASELINE_ACTIVE | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ |
| BASELINE_ACTIVE_WITH_UNRECONCILED_DRAFT | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ | ✓ | ✗ | ✓ | ✗ |
| BASELINE_ACTIVE_WITH_UNRECONCILED_DRAFT | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ |
| RESERVED (UNDER_REVIEW / ADDENDUM_DRAFT / ARCHIVED) | – | – | unreachable | unreachable | unreachable | unreachable | unreachable | unreachable | unreachable | unreachable |

**Keputusan Arsitek atas pertanyaan terbuka PM** (baseline aktif + working draft: read-only atau editable?):

```text
KEPUTUSAN = DRAFT TETAP EDITABLE, BASELINE TETAP IMMUTABLE
```

Alasan: baseline dan draft **bukan entitas yang sama**. Mengunci draft karena ada baseline berarti menghukum pengguna atas cacat `initiateSetup` yang bukan perbuatannya. Yang dijaga adalah: draft **tidak pernah** mengubah baseline. `canCreateBaseline = ✗` di seluruh matriks R2 — pembuatan baseline adalah domain approval, bukan domain R2.

```text
BASELINE_MUTATED_BY_DRAFT_PATH = 0
```

`canCalculateKernel` sengaja `✓` walau tanpa `RAB_DRAFT_EDIT`: menghitung adalah **membaca**, bukan menulis. Hasil kernel tidak dipersistenkan (§11.3), jadi tidak ada mutasi.

```text
DIRECT_URL_BYPASSES_CAPABILITY = 0
ROUTE_LEVEL_ENFORCEMENT = WAJIB pada setiap write route
```

---

## 5. STABLE DRAFT SCHEMA

### AD-05a — Field baru

```text
BoqStructure.draftRevision  Int  @default(0)
BoqItem.deletedAt           DateTime?
```

`draftRevision` naik **tepat satu** per PUT Draft yang sukses commit. Ia bukan timestamp, bukan hash. Ia penghitung monotonic yang dijamin oleh row lock (§8).

### AD-05b — Soft delete hanya pada BoqItem (koreksi K-3)

```text
BOQ_ITEM_SOFT_DELETE      = YES
BOQ_STRUCTURE_SOFT_DELETE = NO_IN_R2
```

Alasan: partial unique index (§5.3) berdiri di atas `boq_structures`. Bila kelak structure ikut di-soft-delete tanpa merevisi index, index akan menolak Working Draft baru karena structure lama yang "terhapus" masih menempati slot unik. Menutup pintu itu sekarang lebih murah daripada mendiagnosisnya nanti.

Bila di masa depan structure perlu soft delete, index **wajib** direvisi dalam migration yang sama. Ditulis di sini sebagai peringatan permanen.

### AD-05c — Partial unique index (koreksi K-1)

**Bukti:** `model BoqStructure` pada `703984d1` hanya memiliki `@@index([projectId])`. Tidak ada constraint unik. `findFirst` → `create` pada save pertama karena itu benar-benar terbuka terhadap race.

**Prisma 6.4.1 tidak dapat merepresentasikan partial unique index** dalam `schema.prisma`. Maka:

```sql
-- migration: custom SQL, create-only
CREATE UNIQUE INDEX "uq_boq_structures_active_working_draft"
ON "boq_structures" ("projectId")
WHERE "name" = 'Working Draft'
  AND "status" = 'DRAFT'
  AND "projectId" IS NOT NULL;
```

Catatan: `projectId` bersifat `String?` pada schema, sehingga klausa `IS NOT NULL` wajib agar index tidak menyentuh structure tanpa proyek.

**Koreksi atas kekhawatiran drift.** Saya tidak menyatakan custom SQL "selalu menyebabkan drift". Yang benar: custom SQL yang **tidak diverifikasi** menyebabkan drift. Maka gate berikut wajib:

```text
CREATE_ONLY_MIGRATION      = YES   (prisma migrate dev --create-only)
CUSTOM_SQL_REVIEW          = WAJIB (Arsitek membaca SQL sebelum apply)
SHADOW_DATABASE_REPLAY     = PASS
MIGRATION_HISTORY_MATCH    = PASS
POST_APPLY_INDEX_INVENTORY = PASS  (pg_indexes membuktikan index ada)
DB_GUARD_PASS              = PASS
NO_DRIFT                   = PASS  (prisma migrate status bersih)
```

### AD-05d — Inventory sebelum index

```sql
-- READ-ONLY. Dijalankan sebelum migration, bukan di dalamnya.
SELECT "projectId", COUNT(*) FROM "boq_structures"
WHERE "name" = 'Working Draft' AND "status" = 'DRAFT' AND "projectId" IS NOT NULL
GROUP BY "projectId" HAVING COUNT(*) > 1;
```

```text
HASIL KOSONG        → lanjut
HASIL TIDAK KOSONG  → STOP_LEGACY_WORKING_DRAFT_DUPLICATE
MIGRATION_DATA_REPAIR = 0
```

Migration tidak pernah memperbaiki data. Migration mengubah struktur. Perbaikan data adalah keputusan manusia dengan gate sendiri (Konstitusi Doc-04 Article-08).

---

## 6. KONTRAK GET/PUT DRAFT V2

### AD-06a — GET Draft membawa revision

```ts
interface GetDraftBoqResponseV2 {
  structureId: string | null;
  draftRevision: number;
  rows: DraftRowReadModel[];
  recap: DraftRecapResponse;
}
```

Ketika structure belum ada:

```text
structureId    = null
draftRevision  = 0
rows           = []
recap          = recap kosong deterministik (semua nilai "0", bukan null)
```

`draftRevision = 0` pada `structureId = null` adalah **kontrak first-save**, bukan tebakan klien. PUT dengan `expectedRevision = 0` dan `structureId = null` berarti "buat structure baru". Tepat satu klien akan menang (§5.3 + §8).

`clientKey` untuk row yang sudah persisted diturunkan deterministik dari `id`. Row baru membawa `clientKey` buatan klien sampai response mengembalikan `id`.

```text
CLIENT_GUESSES_REVISION = 0
```

### AD-06b — PUT Draft V2 adalah contract migration, dan disebut demikian

```ts
interface PutDraftBoqRequestV2 {
  expectedRevision: number;
  rows: Array<{
    id?: string;              // persisted row
    clientKey: string;        // selalu ada
    parentRef?: { id?: string; clientKey?: string } | null;
    wbsCode: string;
    name: string;
    itemType: 'WORK_ITEM' | 'GROUP';
    unit: string;
    quantity: string;         // decimal string
    unitPrice?: string;       // decimal string — HANYA manual line
    sortOrder: number;
  }>;
  marginPercent?: string;     // decimal string
  taxPercent?: string;        // decimal string
}

interface PutDraftBoqResponseV2 {
  structureId: string;
  newRevision: number;
  rows: DraftRowReadModel[];
  recap: DraftRecapResponse;
}
```

**Bukti kondisi lama** `[VIA_PM]`: DTO existing memakai `@Type(() => Number)` untuk quantity/unitPrice/percent. `NEEDS_SOURCE_RECONCILIATION` — verifikasi langsung DTO sebelum eksekusi.

```text
API_BREAKING_CHANGE_CLASSIFIED   = YES
JSON_NUMBER_MONEY_ACCEPTED       = NO
COMPATIBILITY_WINDOW             = NO
FRONTEND_AND_BACKEND_ATOMIC      = YES
```

**Compatibility window ditolak.** Menerima `number | string` berarti mempertahankan IEEE-754 sebagai gerbang masuk uang. Itu melanggar §11. Lebih jujur satu perubahan atomik daripada dua kebenaran yang hidup berdampingan (Kitab §12).

### AD-06c — Kejujuran test

```text
NAMED_SUPERSEDED_TESTS_LISTED = YES
SILENT_TEST_DELETION          = NO

BOLEH diganti (wajib disebut namanya + penggantinya lebih kuat):
  test kontrak PUT/GET Draft lama yang menguji JSON number

DILARANG diedit untuk meluluskan perubahan baru:
  security tests
  tenant-isolation tests
  permission/authority tests
  regression tests yang tidak berhubungan
```

Test yang diedit diam-diam adalah bentuk data palsu. LAW-0.4 berlaku pada test sama seperti pada data.

### AD-06d — Validasi

```text
quantity       : decimal string, non-negatif, scale ≤ lihat §11.2
unitPrice      : decimal string, non-negatif, hanya untuk manual line
marginPercent  : decimal string, non-negatif
taxPercent     : decimal string, non-negatif
NEGATIVE_QUANTITY = FORBIDDEN   (Owner locked, OD-03)
```

Regex `^-?\d+(\.\d+)?$` yang mengizinkan negatif **ditolak**. Kontrak yang benar:

```text
^(0|[1-9]\d*)(\.\d+)?$
```

Ini juga menolak leading zero (`007`) dan bentuk `.5` yang ambigu.

---

## 7. PARENT GRAPH DAN RECONCILIATION

### AD-07a — Parent harus hadir di payload

Payload PUT adalah **full snapshot**. Maka:

```text
Setiap parent yang dirujuk WAJIB hadir sebagai row dalam payload.
parentRef.id yang hanya ada di currentIds tetapi tidak ada di payload
  → 400 PARENT_NOT_RETAINED_IN_PAYLOAD
```

Ini menutup lubang logika yang PM temukan: validasi lama meloloskan parent berdasarkan `currentIds`, lalu fase delete tetap memasukkan parent yang sama ke `toDelete`. Dua aturan yang saling bertentangan dalam satu algoritma.

### AD-07b — Urutan fase

```text
1. VALIDATE      struktur payload, cycle, tipe, duplikat, cross-structure
2. RESOLVE       petakan clientKey → id (existing atau baru)
3. DETACH        parentId = NULL pada retained child yang parent lamanya
                 berubah ATAU akan di-soft-delete
4. UPSERT        create row baru, update row retained (tanpa parent final)
5. SOFT_DELETE   deletedAt = now() pada currentIds − payloadIds
6. REATTACH      pasang parentId final untuk seluruh row
7. REVISION      draftRevision = expectedRevision + 1
```

DETACH mendahului SOFT_DELETE. Ini menjawab kelemahan urutan lama, di mana fase delete berjalan sementara FK anak masih menunjuk parent yang hendak dihapus.

REATTACH setelah UPSERT membuat **out-of-order parent tetap didukung** — anak boleh muncul sebelum induknya dalam payload.

### AD-07c — Kontrak error exact

```text
400 DEEP_CYCLE_DETECTED
400 SELF_PARENT
400 ORPHAN_PARENT_REF
400 DUPLICATE_ROW_ID
400 DUPLICATE_CLIENT_KEY
400 INVALID_PARENT_TYPE          (WORK_ITEM tidak boleh menjadi parent)
400 CROSS_STRUCTURE_ID
400 PARENT_NOT_RETAINED_IN_PAYLOAD
409 DRAFT_REVISION_CONFLICT      (expectedRevision ≠ draftRevision aktual)
```

409 **selalu** diikuti instruksi klien untuk re-fetch GET Draft. Tidak ada retry buta.

### AD-07d — Hard delete dilarang

```text
DRAFT_RECONCILIATION_HARD_DELETE = 0
```

Seluruh query aktif memfilter:

```text
deletedAt IS NULL
```

Berlaku pada: draft read, lifecycle projection, recap, cost kernel eligibility, ahsp-selection eligibility, dan setiap traversal application.

```text
DELETED_LINE_KERNEL_ELIGIBLE   = NO
DELETED_LINE_RESELECT_ELIGIBLE = NO
```

UX restore boleh ditunda. **Preservation tidak boleh ditunda.** Data yang sudah hilang tidak dapat di-restore oleh UX manapun.

### AD-07e — Soft delete × snapshot immutable (temuan A-4)

Pertanyaan yang tidak dijawab siapa pun sebelum ini: bila baris draft di-soft-delete **setelah** snapshot dibekukan, apa yang terjadi pada snapshot?

```text
SNAPSHOT_MUTATED_BY_SOFT_DELETE  = 0
SNAPSHOT_BACKFILLED              = 0
OCCURRENCE_MUTATED_BY_SOFT_DELETE = 0
APPLICATION_MUTATED_BY_SOFT_DELETE = 0
```

**Snapshot adalah sejarah, bukan cermin.** Soft delete adalah peristiwa yang terjadi *sesudah* snapshot; ia tidak berhak mengubah masa lalu. Snapshot lama tetap memuat baris itu apa adanya (Blueprint §10, Kitab §7).

Yang berubah hanya perhitungan **berjalan**: baris ber-`deletedAt` tidak lagi masuk kernel maupun recap aktif.

---

## 8. APPLICATION, HISTORI, DAN KONKURENSI

### AD-08a — Model application

```text
model ProjectRabLineAhspApplication
  id                       uuid PK
  boqItemId                uuid  FK → BoqItem            ON DELETE RESTRICT
  projectAhspOccurrenceId  uuid  FK → ProjectAhspOccurrence ON DELETE RESTRICT  @unique
  ahspVersionId            uuid  FK → AHSPVersion        ON DELETE RESTRICT
  status                   ACTIVE | SUPERSEDED
  supersededAt             timestamptz NULL
  supersededByApplicationId uuid NULL
  appliedByAccountId       uuid NULL
  appliedAt                timestamptz
  policyVersion            text
```

```text
partial unique: (boqItemId) WHERE status = 'ACTIVE'
CHECK: (status='ACTIVE'     AND supersededAt IS NULL)
    OR (status='SUPERSEDED' AND supersededAt IS NOT NULL)
```

**Index redundan dibuang** (NB-01 PM diterima): `projectAhspOccurrenceId` sudah `@unique`; `@@index` tambahan pada kolom yang sama tidak menambah apa pun tanpa bukti query plan.

### AD-08b — Histori tidak boleh mati (BLK-07)

```text
BoqItem            ← Application : ON DELETE RESTRICT
ProjectAhspOccurrence ← Application : ON DELETE RESTRICT
HARD_DELETE_REFERENCED_BOQ_ITEM = RESTRICTED
APPLICATION_HISTORY_AFTER_LINE_DELETE = PRESERVED
```

`ON DELETE CASCADE` pada jalur ini berarti: menghapus satu baris draft menghapus seluruh jejak **keputusan manusia** memilih AHSP untuk baris itu. Aktor, waktu, alasan, dan riwayat supersede lenyap.

Itu bukan sekadar kehilangan data. Itu melanggar LAW-7.2 (evidence append-only) dan Kitab §7. **Blocker terberat dalam dokumen ini.**

Hard delete hanya boleh terjadi dalam operasi cleanup terpisah yang membuktikan nol relasi downstream dan memperoleh gate tersendiri. Bukan di dalam save draft.

### AD-09 — Locking eksplisit (BLK-08, koreksi K-2)

**Pernyataan yang dikoreksi:** `SELECT` biasa **tidak** mengunci row di PostgreSQL. Row lock hanya lahir dari locking clause: `FOR UPDATE`, `FOR NO KEY UPDATE`, `FOR SHARE`, `FOR KEY SHARE`. Partial unique index mencegah duplikat; ia tidak menserialisasi pembaca.

Lebih jauh: pada seleksi **pertama**, belum ada application untuk dikunci sama sekali. Lock terhadap sesuatu yang belum ada adalah nol perlindungan.

**Keputusan Arsitek — kunci row yang selalu ada:**

```text
LOCK ORDER CANONICAL (identik di SEMUA write path)

  1. SELECT id FROM boq_structures WHERE id = :structureId FOR UPDATE
  2. SELECT id FROM boq_items      WHERE id = :boqItemId   FOR UPDATE
                                   (hanya untuk operasi line-specific;
                                    multi-row: urut menaik berdasarkan id)
  3. baca/ubah active application
  4. tulis occurrence / resolution / application
```

Structure selalu ada sebelum ada item. Item selalu ada sebelum ada application. Maka mengunci dari yang paling stabil ke yang paling baru adalah satu-satunya urutan yang tidak dapat menghasilkan deadlock antar-path — **selama semua path memakai urutan yang sama.**

Untuk first-save (structure belum ada), serialisasi datang dari partial unique index §5.3 + penanganan unique violation deterministik, bukan dari lock.

Prisma mendukung `$queryRaw` di dalam `$transaction` interaktif. Itu jalur sah untuk `FOR UPDATE` yang tidak dapat diekspresikan ORM.

**Setelah lock diperoleh, wajib revalidasi:**

```text
deletedAt IS NULL
boqStructure.status masih editable
projectId / workspaceId masih cocok
draftRevision masih == expectedRevision
```

Membaca sebelum mengunci lalu mempercayai bacaan itu adalah bug klasik. Baca ulang **sesudah** lock.

### AD-09b — Isolation level (koreksi K-2 atas PM)

```text
BASELINE_ISOLATION = READ_COMMITTED + EXPLICIT_ROW_LOCKS
```

**Saya menolak `REPEATABLE READ` sebagai baseline.** Alasan:

1. Dengan lock order canonical yang ditegakkan, `READ COMMITTED` sudah memberi seluruh jaminan yang dibutuhkan.
2. `REPEATABLE READ` memperkenalkan kelas error serialisasi (`40001`) yang wajib di-retry di **setiap** write path — kompleksitas baru tanpa kebutuhan terbukti.
3. Konstitusi Doc-04 Article-10: bila ada dua solusi, pilih yang lebih sederhana dan lebih mudah diaudit, tanpa mengurangi kualitas.

Kenaikan isolation hanya boleh terjadi bila **concurrency test menunjukkan kebutuhan nyata**. Bukti dulu, baru kompleksitas.

```text
BOUNDED_RETRY = hanya untuk named retryable errors:
  40001 serialization_failure
  40P01 deadlock_detected
MAX_RETRY = 3, backoff deterministik
RETRY_ON_BUSINESS_ERROR = NO
```

### AD-09c — Race yang wajib didokumentasikan dan diuji

| Race | Hasil yang dijamin |
|---|---|
| First-save × first-save | Tepat satu structure. Yang kalah menerima 409, re-fetch, retry. |
| First-selection × first-selection | Tepat satu ACTIVE application. Yang kalah masuk state machine §8d. |
| Draft save × AHSP selection | Keduanya mengantre pada `BoqStructure FOR UPDATE`. Selection membandingkan `expectedDraftRevision` **sesudah** lock. Salah satu: selection melihat revision baru → 409; atau save menunggu selection lalu berjalan atas state committed. |
| Same-key replay | Tidak pernah membuat occurrence kedua. |
| Different-selection × different-selection | Satu ACTIVE, yang lain SUPERSEDED. Deterministik. |
| Deadlock | Tidak mungkin bila lock order dipatuhi. Bila tetap terjadi → `40P01` → bounded retry. |

```text
APPLICATION_ON_DELETED_LINE     = 0
APPLICATION_ON_NON_EDITABLE_LINE = 0
```

### AD-08d — Idempotency state machine (BLK-10)

**Bukti:** `@@unique([projectId, idempotencyKey])` pada `ProjectAhspOccurrence` — terverifikasi di schema. Namespace ini **dipakai bersama** endpoint Phase 2 lama.

```text
KEY_NOT_FOUND
  → buat occurrence lengkap + seluruh resolutions + application ACTIVE
  → 201 CREATED

KEY_FOUND + application ACTIVE + line sama + version sama
  → 200 IDEMPOTENT_REPLAY_ACTIVE

KEY_FOUND + application SUPERSEDED + line sama + version sama
  → 200 IDEMPOTENT_REPLAY_SUPERSEDED
  → TIDAK mengaktifkan kembali
  → response menyatakan application ACTIVE saat ini (bila ada)

KEY_FOUND + occurrence tanpa application
  → 409 IDEMPOTENCY_KEY_OWNED_BY_LEGACY_PHASE2_FLOW

KEY_FOUND + line berbeda ATAU ahspVersion berbeda
  → 409 CONFLICT_IDEMPOTENCY_PAYLOAD_MISMATCH

CONCURRENT unique violation (23505)
  → transaksi pecundang ROLLBACK LEBIH DAHULU
  → catch di LUAR transaction callback
  → mulai READ BARU di transaksi baru
  → klasifikasikan ulang memakai state machine di atas
```

Setelah `23505`, transaksi PostgreSQL sudah aborted. Setiap query berikutnya di transaksi yang sama pasti gagal `25P02`. Rollback dulu, baru baca.

Response **wajib** membedakan `ACTIVE` dan `SUPERSEDED`. Tanpa itu, replay lama tampak seperti pilihan saat ini — bentuk halus dari data palsu.

```text
EXISTING_PHASE2_ENDPOINT_MODIFIED = NO
EXISTING_PHASE2_DTO_MODIFIED      = NO
```

---

## 9. TENANT ISOLATION (temuan A-3)

**Bukti schema:** `ProjectAhspOccurrence` **sudah** memiliki `workspaceId` dan `projectId` sebagai kolom nyata dengan FK. Ini penting: jalur tenant tidak perlu ditemukan ulang.

### AD-11 — Traversal terpercaya, tanpa duplikasi otoritas

```text
request.projectAccess.workspaceId
  → Project        (workspaceId cocok)
  → BoqStructure   (projectId cocok, deletedAt N/A)
  → BoqItem        (boqStructureId cocok, deletedAt IS NULL)
  → Application    (boqItemId cocok)
  → Occurrence     (projectAhspOccurrenceId cocok)
```

**Assertion tambahan yang wajib** (karena occurrence memang menyimpan workspaceId sendiri):

```text
occurrence.workspaceId === request.projectAccess.workspaceId
occurrence.projectId   === boqStructure.projectId
```

Ketidakcocokan → `500 TENANT_TRAVERSAL_INVARIANT_VIOLATION` dan **fail-closed**. Bila dua sumber kebenaran tidak sepakat, jangan pilih salah satunya — berhenti.

```text
DUPLICATE_AUTHORITY_FIELD_ON_APPLICATION = NO
```

Application tidak menggandakan `workspaceId`/`projectId`. Menambah kolom otoritas "demi kenyamanan" tanpa constraint yang menegakkannya justru menciptakan rumah kedua bagi kebenaran (LAW-4.1).

### AD-11b — E2E wajib

```text
foreign project                        → 404
unassigned account                     → 404
cross-workspace permission             → 403
spoofed workspace header               → 403
foreign BoqItem                        → 404
foreign occurrence traversal           → 404
foreign application traversal          → 404
soft-deleted line selection attempt    → 404
```

404 untuk "tidak berhak tahu keberadaannya". 403 untuk "boleh tahu, tidak boleh melakukan". Membedakan keduanya adalah Article-07.

```text
Blueprint Larangan no.11 — tenant isolation TIDAK dilemahkan demi demo.
```

---

## 10. PAGU BLINDNESS (temuan A-2)

PM tidak memeriksa ini sama sekali, padahal kontrak draft membawa `marginPercent` dan `taxPercent` — jalur aritmetika uang.

### AD-13 — Invariant

```text
PAGU_READ_IN_DRAFT_ARITHMETIC_PATH = 0
PAGU_READ_IN_COST_KERNEL_PATH      = 0
PAGU_USED_TO_ADJUST_BASIC_PRICE    = NO
PAGU_USED_TO_FORCE_RAB_TOTAL       = NO
PAGU_IN_SELECTION_ELIGIBILITY      = NO
PAGU_IN_SELECTION_PRIORITY         = NO
```

**Bukti awal yang menguntungkan:** `CostKernelInput` (diaudit terpisah) tidak memiliki field pagu/budget. LAW-1.4 saat ini terjaga **secara struktural** — pelanggaran memerlukan perubahan kontrak, bukan sekadar perubahan logika. Pertahankan sifat itu.

```text
COST_KERNEL_INPUT_CONTAINS_PAGU_FIELD = 0   (invariant, diuji)
```

Pagu hanya sah sebagai **lensa pembanding sesudah biaya terbentuk** (LAW-1.5): membandingkan → menjelaskan gap → memberi alternatif → meminta keputusan manusia. Tidak pernah sebagai input pembentuk harga.

`marginPercent` dan `taxPercent` adalah **masukan manusia yang berlabel jujur** (LAW-0.5b), bukan pagu, dan bukan hasil inferensi AI (LAW-6.3).

---

## 11. PRECISION POLICY (temuan A-1 dan A-6)

### AD-12a — Otoritas perhitungan

```text
Prisma.Decimal              = CALCULATION AUTHORITY
JavaScript Number           = BUKAN money authority, di mana pun
Intermediate rounding       = DILARANG
Display formatting          = TIDAK PERNAH mengubah canonical value
Rounding rule baru          = memerlukan Owner-gated policy
```

Empat lapis yang wajib dibedakan dan tidak boleh tertukar:

```text
1. CALCULATION SCALE   presisi penuh selama rantai hitung berjalan
2. PERSISTENCE SCALE   scale kolom database
3. RECAP SCALE         penjumlahan lintas baris
4. DISPLAY SCALE       pembulatan tampilan (2 desimal Rupiah)
```

Kernel, Draft, snapshot, recap, dan frontend membaca **satu** policy. Tidak ada pihak yang menciptakan satuan atau nilai baru.

### AD-12b — DECIMAL SCALE TRAP (temuan A-6 — BLOCKER BARU)

Ditemukan dari `schema.prisma` mentah, bukan dari PM.

```text
BUKTI (703984d1):
  BoqItem.quantity                          Decimal(18, 2)
  BoqItem.unitPrice                         Decimal(18, 2)
  BoqItem.lineTotal                         Decimal(18, 2)
  ProjectAhspResourceResolution.ahspCoefficient  Decimal(18, 6)
  ProjectAhspResourceResolution.adaptedPriceValue Decimal(18, 2)
  ProjectAhspResourceResolution.quantityFactor    Decimal(24, 12)
```

**Cacat 1 — pembulatan diam-diam pada harga satuan.**

Dengan data nyata Owner yang sudah terbukti hidup:

```text
koefisien 0.4 (scale 6)  ×  adaptedPrice 158333.33 (scale 2)
  = 63333.332            ← scale 3
```

Bila nilai ini dipersistenkan ke kolom `Decimal(18,2)`, PostgreSQL **membulatkannya secara diam-diam** menjadi `63333.33`. Itu **intermediate rounding**, yang baru saja dilarang oleh AD-12a. Ia tidak melempar error. Ia tidak muncul di log. Ia hanya mengubah uang.

**Cacat 2 — volume konstruksi terpotong.**

`BoqItem.quantity Decimal(18,2)` berarti volume `0.125 m³` tersimpan sebagai `0.13`, dan `0.005 m³` menjadi `0.01`. Untuk domain konstruksi ini bukan detail kosmetik — pekerjaan volume kecil dengan harga satuan besar akan meleset secara sistematis.

**Keputusan Arsitek:**

```text
AD-12b-1  Uang hasil kernel TIDAK PERNAH dipersistenkan ke BoqItem.
          BoqItem.unitPrice / lineTotal HANYA untuk manual line warisan.
          Kolom itu tidak diperluas; ia sedang menuju deprecation.

          KERNEL_MONEY_PERSISTED_TO_BOQ_ITEM = 0

AD-12b-2  Harga Satuan AHSP dan Line Total dihitung ulang dari
          occurrence + resolutions pada setiap request, dalam Decimal
          presisi penuh, tanpa persistensi antara.

AD-12b-3  BoqItem.quantity perlu dinaikkan menjadi Decimal(18, 6).
          ALTER TYPE numeric(18,2) → numeric(18,6) bersifat widening dan
          lossless di PostgreSQL. Nol risiko data.
          → memerlukan OWNER DECISION (OD-04), karena ini mengubah
            berapa desimal yang boleh diketik pengguna.

AD-12b-4  Pembulatan hanya terjadi SATU KALI, pada batas tampilan.
          ROUNDING_SITES_IN_CALCULATION_CHAIN = 0
```

**Mengapa ini blocker.** Tanpa AD-12b, `directCostTotal` dari kernel dan angka yang dilihat pengguna di layar akan berbeda — dan kita akan menyebutnya "Golden Thread hidup". Itu persis Blueprint Larangan no.9: mengklaim Golden Thread hidup sambil diam-diam memakai nilai lain.

### AD-12c — Frontend

```text
FRONTEND_RECOMPUTES_KERNEL_MONEY = 0
```

Frontend memperlakukan `directCostTotal` sebagai otoritatif untuk porsi yang dicakup kernel. Ia memformat; ia tidak menghitung. (Blueprint Larangan no.10.)

---

## 12. INDEPENDENSI SLICE

### AD-04 — Nol query ke tabel yang belum lahir

```text
R2_00_DEPENDS_ON_APPLICATION_TABLE = NO
R2_01_DEPENDS_ON_APPLICATION_TABLE = NO
EACH_SLICE_COMPILES_INDEPENDENTLY  = YES
STUB_OR_FAKE_ZERO_DIAGNOSTIC       = 0
```

Yang dipindahkan ke slice yang **melahirkan** tabel application:

```text
legacyAhspVersionMismatchCount
legacyAhspVersionWithoutApplicationCount     (NB-04 PM diterima: dua hitungan berbeda)
KERNEL_MANAGED_LINE_REJECTS_CLIENT_UNIT_PRICE
```

```text
APPLICATION_TABLE_AND_MONEY_GUARD_DEPLOYED_ATOMICALLY = YES
```

Migration tabel application dan penolakan `unitPrice` pada kernel-managed line harus tiba **bersama**. Bila tabel lahir lebih dulu tanpa guard, ada jendela waktu di mana klien dapat menyuntikkan harga manual ke baris yang seharusnya dikuasai kernel. Melanggar LAW-6.2.

---

## 13. UTANG BERNAMA (temuan A-5)

```text
UTANG-PERMISSION-01
  Isi     : AHSP_MANAGE dipinjam secara bounded; semantik permission
            tulis-occurrence belum final.
  Status  : DISENTUH, TIDAK DITUTUP.
  Alasan  : R2 memakai RAB_DRAFT_EDIT untuk draft, bukan AHSP_MANAGE.
            Semantik tulis-occurrence tetap terbuka.
  Setelah R2: TETAP TERBUKA.

UTANG-GUARD-02
  Isi     : upload.controller melakukan auth in-handler, belum
            dinormalisasi ke ProjectAccessPolicyService.
  Status  : TIDAK DISENTUH R2.
  Alasan  : upload path berada di luar lingkup R2.
  Setelah R2: TETAP TERBUKA.
```

```text
DEBT_PAID_TWICE      = 0
DEBT_SCOPE_EXPANDED_SILENTLY = 0
```

Kedua utang disebut namanya agar tidak dibayar dua kali dan tidak lenyap dari ingatan. R2 tidak boleh diam-diam melebar untuk "sekalian" menutupnya.

---

## 14. AKTIVASI PERMISSION

### AD-15 — Satu slice yang aman diaktifkan (BLK-12)

Owner telah mengunci:

```text
DIRECTOR → RAB_VIEW
DIRECTOR → RAB_DRAFT_EDIT
PROJECT_CREATE tetap terpisah
FOREMAN tidak otomatis memperoleh RAB_DRAFT_EDIT
```

**Bukti kondisi lama** `[VIA_PM]`: save route saat ini memakai `PROJECT_CREATE`. `NEEDS_SOURCE_RECONCILIATION`.

Enam langkah berikut **satu slice, satu deploy, tidak boleh dipecah:**

```text
1. deklarasi permission RAB_VIEW / RAB_DRAFT_EDIT
2. seed permission rows
3. grant ke role DIRECTOR
4. tukar decorator pada route
5. positive E2E   : DIRECTOR menyimpan draft → 200
6. negative E2E   : FOREMAN menyimpan draft → 403
```

```text
ROUTE_DECORATOR_SWAPPED_WITHOUT_ROLE_GRANT = NO
AT_LEAST_ONE_AUTHORIZED_ROLE_AT_ACTIVATION = YES
POSITIVE_SAVE_DRAFT_E2E = WAJIB
```

Menukar decorator sebelum grant menghasilkan **403 total** — slice yang "PASS di kode" tetapi mematikan produk. Test negatif saja tidak cukup: 403 untuk semua orang juga meluluskan test negatif. Positive E2E adalah satu-satunya bukti bahwa produk masih hidup.

---

## 15. ROLLBACK

### AD-16

```text
SEBELUM application pertama tercipta:
  rollback schema diperbolehkan (belum ada histori yang hilang)

SESUDAH application pertama tercipta:
  DELETE_RECREATE_ROLLBACK    = FORBIDDEN
  DROP_APPLICATION_HISTORY    = FORBIDDEN
  DROP_STABLE_IDS             = FORBIDDEN
  IDENTITY_CHURN              = FORBIDDEN
```

Rollback sesudah production write berarti:

```text
1. disable write path
2. UI ke read-only, dengan label jujur
3. forward fix
4. pertahankan schema, stable ID, dan seluruh histori
```

Kembali ke delete-recreate akan menghapus histori melalui cascade, atau gagal karena RESTRICT setelah AD-08b. Keduanya buruk. Yang benar: maju dengan perbaikan, bukan mundur dengan penghapusan.

---

## 16. URUTAN EKSEKUSI — MESIN LEBIH DAHULU

### AD-17 — Klasifikasi

```text
MACHINE_CRITICAL             wajib untuk satu baris RAB hidup
HISTORY_CRITICAL             wajib agar tidak ada jejak manusia hilang
SECURITY_ACTIVATION_CRITICAL wajib agar produk tidak mati/bocor
LATER_HARDENING              pagar yang belum menjadi risiko nyata
```

Dasar hukum: Kitab §14 dan Desain-6 §D — *"Tidak ada pagar baru sebelum satu baris RAB hidup."* Kita sudah pernah membangun sembilan PR hardening beruntun tanpa memajukan bukti produk. Pola itu tidak diulang.

### 16.1 Klasifikasi setiap pekerjaan

| Pekerjaan | Kelas |
|---|---|
| Tabel `ProjectRabLineAhspApplication` + FK RESTRICT | MACHINE_CRITICAL |
| Precision policy AD-12a/b | MACHINE_CRITICAL |
| Kernel-managed line menolak `unitPrice` klien | MACHINE_CRITICAL |
| `BoqItem.deletedAt` + soft delete | HISTORY_CRITICAL |
| CHECK status/supersededAt | HISTORY_CRITICAL |
| Tenant traversal + E2E | SECURITY_ACTIVATION_CRITICAL |
| Permission activation slice | SECURITY_ACTIVATION_CRITICAL |
| `initiateSetup` berhenti auto-approve | SECURITY_ACTIVATION_CRITICAL |
| Explicit `FOR UPDATE` + lock order | HISTORY_CRITICAL |
| Idempotency state machine | HISTORY_CRITICAL |
| `draftRevision` + optimistic concurrency | LATER_HARDENING |
| Partial unique Working Draft | LATER_HARDENING |
| Decimal-string contract migration | LATER_HARDENING |
| Lifecycle projection + capability matrix | LATER_HARDENING |
| Parent graph reconciliation | LATER_HARDENING |

**Catatan kejujuran:** beberapa `LATER_HARDENING` tetap wajib sebelum pengguna nyata masuk. "Later" berarti *sesudah baris pertama hidup*, bukan *tidak pernah*.

### 16.2 Minimum safe executable order

Disusun dari dependensi nyata, bukan dari nomor slice lama.

```text
M-0  PRECISION POLICY LOCK                       [MACHINE_CRITICAL]
     Tetapkan AD-12a/b. Nol kode. Owner memutuskan OD-04.
     Gate: tanpa ini, setiap angka Rupiah berikutnya tidak dapat dipercaya.

M-1  HISTORY FOUNDATION                          [HISTORY_CRITICAL]
     BoqItem.deletedAt + seluruh query aktif memfilter deletedAt IS NULL.
     Tanpa application table. Tanpa perubahan kontrak API.
     Gate: nol hard delete di jalur draft.

M-2  APPLICATION BRIDGE + MONEY GUARD (ATOMIK)   [MACHINE_CRITICAL]
     Tabel application, FK RESTRICT, CHECK, partial unique ACTIVE,
     idempotency state machine, explicit FOR UPDATE + lock order,
     penolakan unitPrice pada kernel-managed line.
     Gate: occurrence 8d1c421f dapat ditautkan ke satu BoqItem nyata.

M-3  SATU BARIS RAB HIDUP                        [MACHINE_CRITICAL]
     Bukti end-to-end: BOQ → application → occurrence → resolution →
     Basic Price → koefisien × harga → Harga Satuan → × volume → Jumlah.
     Angka Rupiah nyata di simprok_db DAN di layar.
     Gate: Doktrin Cermin — mata Owner. Bukan pesan commit.

S-1  TENANT ISOLATION E2E                        [SECURITY_ACTIVATION]
     Delapan E2E §9. Dijalankan atas M-2 yang sudah hidup.

S-2  PERMISSION ACTIVATION SLICE                 [SECURITY_ACTIVATION]
     Enam langkah §14, satu deploy.

S-3  INITIATE_SETUP CORRECTION                   [SECURITY_ACTIVATION]
     Hentikan auto-APPROVED/ACTIVE. Baseline warisan tidak disentuh.
     GATE-MONITORING-01 diselesaikan lebih dulu.

H-1  STABLE DRAFT CONTRACT                       [LATER_HARDENING]
     draftRevision, partial unique Working Draft, GET/PUT V2 decimal-string,
     parent graph reconciliation. Atomik frontend+backend.

H-2  LIFECYCLE + CAPABILITY MATRIX               [LATER_HARDENING]
     RabLifecyclePolicyService, matriks §4, route enforcement.
```

**Yang tidak boleh dilemahkan demi kecepatan, pada urutan mana pun:**

```text
history preservation
tenant isolation
money authority
explicit occurrence linkage
fail-closed behavior
```

Kelima ini bukan pagar. Kelima ini adalah **mesin itu sendiri**. Melemahkannya demi demo adalah Blueprint Larangan no.11 dan LAW-0.4.

---

## 17. KEPUTUSAN OWNER

### Sudah dikunci

```text
OD-01  DIRECTOR → RAB_VIEW + RAB_DRAFT_EDIT          LOCKED
OD-02  Proyek baru → Working Draft, nol auto-baseline LOCKED
OD-03  NEGATIVE_QUANTITY = FORBIDDEN                 LOCKED
```

### Terbuka

```text
OD-04  BoqItem.quantity Decimal(18,2) → Decimal(18,6)?
       Konteks : volume 0.125 m³ kini tersimpan sebagai 0.13.
       Sifat   : widening, lossless, nol risiko data.
       Pertanyaan Owner: berapa desimal yang wajar untuk volume BOQ
                         dalam praktik konstruksi Indonesia?
       Blocking: M-0. Tidak dapat dilewati.
       ⚑ perlu review PM

OD-05  GATE-MONITORING-01
       Bila initiateSetup berhenti membuat baseline otomatis, apakah
       monitoring untuk proyek baru boleh mati sementara?
       Blocking: S-3 saja. Tidak memblokir M-0..M-3.
       ⚑ perlu review PM
```

### Keputusan teknis — kewenangan Arsitek, bukan Owner

Ditetapkan dalam dokumen ini dan tidak memerlukan Owner: explicit `FOR UPDATE`, lock order canonical, isolation `READ_COMMITTED`, bounded retry, partial unique index, soft-delete BoqItem, parent reconciliation, idempotency state machine, CHECK constraint, kontrak GET/PUT atomik, precision policy AD-12a.

Dasar: Konstitusi Doc-04 Article-03 — Database Design, API Design, dan Migration Strategy adalah tanggung jawab Chief Architect.

---

## 18. BATAS PERAN

```text
PM_OUTPUT            = FINDING + RECOMMENDATION
ARCHITECT_OUTPUT     = DECISION
OWNER_OUTPUT         = LOCK
CODEX_OUTPUT         = EXECUTION
```

Konstitusi Doc-04 Article-02: *Project Manager tidak membuat keputusan arsitektur.*
Konstitusi Doc-04 Article-03: Database Design, API Design, Migration Strategy adalah domain Chief Architect.

Temuan PM dalam review sebelumnya **sah, tajam, dan bernilai tinggi** — 14 blocker itu nyata dan sebagian saya verifikasi ulang terhadap repository. Yang dikoreksi bukan temuannya, melainkan **status resepnya**. Resep PM masuk sebagai rekomendasi; keputusan ditulis di sini dengan nama dan alasan (AD-xx), dan dapat dibantah dengan bukti.

**Pertanyaan yang belum terjawab:** siapa penulis `golden_thread_r2_architecture_v3_0/v3_1`? Bila PM sendiri, maka PM me-review karya PM, dan V3.2 ini menjadi review independen pertama atas materi tersebut. Owner perlu menjawab agar lineage jujur.

```text
⚑ perlu review PM
```

---

## 19. GATE STATE FINAL

```text
ARCHITECT_FINAL_VERDICT = PASS_FOR_PM_DELTA_REVIEW

GATED_ON:
  RECON-01  rekonsiliasi V3.2 terhadap V3.1 oleh pemegang file
  OD-04     keputusan Owner atas decimal scale quantity
  OD-05     GATE-MONITORING-01 (hanya memblokir S-3)

BLOCKER_PM_CLOSED           = 14 / 14
ARCHITECT_CORRECTION_APPLIED = 3 / 3
ARCHITECT_FINDING_APPLIED    = 6 / 6   (A-1..A-6, termasuk A-6 baru)
NON_BLOCKING_NOTE_APPLIED    = 5 / 5

PM_DELTA_REVIEW          = NOT_STARTED
GEMINI_CONSTITUTION_AUDIT = NOT_STARTED
OWNER_LOCK               = NOT_STARTED

SOURCE_WRITE             = 0
SCHEMA_WRITE             = 0
MIGRATION_WRITE          = 0
DATABASE_WRITE           = 0
BRANCH_CREATED           = 0
COMMIT_CREATED           = 0
PR_CREATED               = 0
IMPLEMENTATION_AUTHORIZED = NO

NEXT_SAFE_ACTION =
  PM_DELTA_REVIEW
  → GEMINI_CONSTITUTION_AUDIT (Kitab §9A titik 2: sebelum fase mesin besar)
  → OWNER_DECISION OD-04, OD-05
  → OWNER_LOCK V3.2
  → M-0 PRECISION POLICY LOCK
```

Tidak ada izin menulis source, schema, migration, database, branch, commit, atau PR berdasarkan dokumen ini. Dokumen ini adalah rancangan, bukan perintah eksekusi.

---

**SIMPROK menghitung. Manusia memutuskan.**
**AHSP adalah otoritas. Basic Price menyesuaikan.**
**Reduce Uncertainty.**

### Soli Deo Gloria. Segala hormat dan kemuliaan hanya bagi Tuhan Yesus Kristus. Haleluya. Amin.