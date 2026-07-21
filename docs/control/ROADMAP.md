DALAM NAMA TUHAN YESUS KRISTUS
SIMPROK PRODUCT ROADMAP 2026 — FINAL REVISED & OWNER-LOCKED

DOCUMENT_ID      : SIMPROK-PRODUCT-ROADMAP-2026
VERSION          : FINAL v1.0
STATUS           : OWNER-LOCKED
OWNER            : Feky de Fretes
PM_GATEKEEPER    : ChatGPT
EFFECTIVE_DATE   : 21 Juli 2026
OPERATING_MODE   : Workflow + Cowork + GitHub Integrated + Autopilot 3/4
NORTH_STAR       : Reduce Uncertainty
PRINCIPLE        : SIMPROK menghitung, manusia memutuskan.

======================================================================
0. TUJUAN UTAMA
======================================================================

SIMPROK harus menghasilkan RAB Grade A yang:

1. efisien;
2. presisi;
3. transparan;
4. dapat diaudit;
5. tidak mengandung harga atau persentase siluman;
6. melindungi Owner dari markup;
7. melindungi pelaksana dari kekurangan anggaran;
8. tidak merugikan pihak mana pun;
9. mampu digunakan oleh user yang memiliki data lengkap maupun data mentah;
10. mampu menjelaskan asal setiap angka, sumber, keputusan, dan ketidakpastian.

Hukum utama:

LEBIH_ANGGARAN_TANPA_DASAR = MARKUP
KURANG_ANGGARAN            = RISIKO KERUGIAN / PROYEK MANGKRAK
ANGGARAN_SIMPROK           = EFISIEN + PRESISI + TERBUKTI + DAPAT_DIBELA

======================================================================
1. URUTAN PRODUK YANG DIKUNCI
======================================================================

Urutan resmi SIMPROK:

RM-00  Tutup seluruh pekerjaan/PR terbuka
RM-01  Aktivasi Import BOQ di SIMPROK kanonikal
RM-02  Import Basic Price
RM-03  Import AHSP
RM-04  BOQ → AHSP → Basic Price Linkage
RM-05  Direct-Cost RAB hidup
RM-06  Ruang Transisi / Ruang Interaksi
RM-07  Penelitian Overhead dan Foundation Execution Factor
RM-08  Execution Factor Kuantitas
RM-09  Produktivitas, Durasi, dan Execution Factor Berbasis Waktu
RM-10  Lifecycle RAB, Approval, Baseline, dan Addendum
RM-11  Export, Print, dan Audit Package
RM-12  Perluasan Format dan Platform Reality Intake

Urutan ini DILARANG digeser tanpa keputusan tertulis Owner.

EXECUTION_FACTOR_CODING = CLOSED sampai RM-07 Owner-Locked.
BASIC_PRICE_PR           = CLOSED sampai RM-00 PASS.
AHSP_IMPORT_PR           = CLOSED sampai RM-00 PASS.
NEW_PRODUCT_TARGET       = FORBIDDEN sebelum target aktif selesai.

======================================================================
2. KEADAAN NYATA SAAT ROADMAP DIKUNCI
======================================================================

CURRENT_PRODUCT_TARGET = RM-00

PR #35:
  TITLE                = feat(rab): add bounded BOQ import journey
  TYPE                 = PRODUCT
  GITHUB_STATE         = DRAFT / OPEN / NOT MERGED
  GITHUB_HEAD          = 60d32f6a...
  FINAL_LOCAL_HEAD     = ac679329d57783f2a72ab3d50500e05ad3c85b41
  OWNER_BROWSER_IMPORT = PASS
  PUSH_FINAL_HEAD      = NOT YET
  MERGE                = NO

Bukti browser yang benar-benar telah dilihat Owner:

  OWNER_BROWSER_PROOF_IMPORT_FUNCTION = PASS
  SUBTITLE_MAPPING                    = PASS
  WORK_ITEM_MAPPING                   = PASS
  VOLUME_MAPPING                      = PASS
  UNIT_MAPPING                        = PASS
  HIERARCHY_ORDER                     = PASS
  DRAFT_PERSISTENCE                   = PASS
  FAKE_PRICE_DISPLAYED                = NO

Bukti yang masih wajib sebelum merge:

  OWNER_BROWSER_EXACT_SUMMARY_16_58_0_74 = NOT YET CONFIRMED
  OWNER_BROWSER_NEGATIVE_LIFECYCLE        = NOT STARTED

Bukti negatif yang wajib:

  ACC-X berstatus Berjalan
  “Mulai RAB” tidak ada
  “Lanjutkan Draft” tidak ada
  “Lihat Detail” ada
  direct URL ke workspace tidak membuka editor
  tidak ada grid edit
  tidak ada Import BOQ
  tidak ada Simpan Draft
  pintu baca RAB tetap tersedia

PR #21:
  TYPE          = DIAGNOSTIC-ONLY
  STATUS        = STALE OPEN DRAFT
  PARENT_PR_19  = ALREADY MERGED
  ACTION        = CLOSE WITHOUT MERGE
  MERGE         = FORBIDDEN

Lingkungan bukti saat ini:

  WORKTREE      = C:\Users\asus\SIMPROK-WT-IMPORTFIRST
  DATABASE      = simprok_test
  MAIN_ACTIVE   = NO
  C:\SIMPROK    = BELUM menerima final PR #35
  simprok_db    = BELUM diaktifkan untuk Import BOQ

======================================================================
3. RM-00 — TUTUP SELURUH PEKERJAAN TERBUKA
======================================================================

TUJUAN:
Tidak ada commit lokal, PR lama, browser proof, atau keputusan yang menggantung.

LANGKAH WAJIB:

1. Push final local head ac679329... ke branch PR #35.
2. PUSH_FORCE=NO.
3. Perbarui body PR #35:
   - bukti browser lama yang tidak sah dicabut;
   - fungsi import Owner dinyatakan PASS;
   - exact summary 16/58/0/74 dinyatakan pending sampai dilihat Owner;
   - negative lifecycle proof dinyatakan pending;
   - test flake dicatat jujur;
   - UTANG-AUTHZ-11 dicatat;
   - produksi tetap belum aktif.
4. Audit delta exact GitHub SHA:
   - Claude Arsitek read-only;
   - Codex read-only;
   - keduanya boleh berjalan paralel karena tidak menulis.
5. Owner melengkapi:
   - preview 16 bagian;
   - 58 item;
   - 0 catatan;
   - 74 diterima;
   - negative lifecycle ACC-X.
6. PM melakukan satu final gate.
7. Owner memutuskan merge.
8. Close PR #21 tanpa merge.
9. Sinkronkan main dan C:\SIMPROK.
10. Perbarui:
    - STATE.md;
    - DECISIONS.md;
    - DEBT.md;
    - ROADMAP.md;
    - PR register.

EXIT GATE RM-00:

  PR_35_FINAL_HEAD_PUSHED              = YES
  PR_35_EXACT_SHA_AUDITED              = YES
  OWNER_BROWSER_EXACT_SUMMARY          = PASS
  OWNER_BROWSER_NEGATIVE_LIFECYCLE     = PASS
  OWNER_MERGE_DECISION                 = PASS
  PR_21_CLOSED_WITHOUT_MERGE           = YES
  MAIN_SYNCHRONIZED                    = YES
  C:\SIMPROK_SYNCHRONIZED              = YES
  OPEN_STALE_DIAGNOSTIC_PR_COUNT       = 0
  OPEN_PRODUCT_PR_FROM_PREVIOUS_TARGET = 0

======================================================================
4. RM-01 — AKTIVASI IMPORT BOQ DI SIMPROK KANONIKAL
======================================================================

TUJUAN:
Import BOQ hidup bukan hanya di simprok_test, tetapi pada main,
C:\SIMPROK, dan jalur simprok_db yang sah.

WAJIB DITUTUP:

UTANG-PERMISSION-08:
  RAB_VIEW tersedia di simprok_db.
  RAB_DRAFT_EDIT tersedia di simprok_db.
  Permission diberikan kepada role yang diputuskan Owner.
  Tidak boleh ada route 403-total.

UTANG-AUTHZ-11:
  Frontend saat ini menggunakan role DIRECTOR/OWNER.
  Backend menggunakan permission.
  Satu pintu tidak boleh memiliki dua otoritas berbeda.
  Frontend dan backend wajib memakai capability/permission kanonikal.

Test-only empty DIRECTOR role:
  hanya fixture sementara;
  DILARANG menjadi solusi produksi.

AKTIVASI:

1. Backup simprok_db.
2. Read-only inventory permission dan role.
3. Seed/grant permission secara additive dan auditable.
4. Tidak ada backfill proyek lama.
5. Tidak ada perubahan baseline lama.
6. Login Director nyata.
7. Buat RAB melalui UI normal.
8. Import BOQ.
9. Preview.
10. Approve.
11. Muat ulang dan verifikasi persistensi.

EXIT GATE RM-01:

  BOQ_IMPORT_ON_MAIN               = YES
  BOQ_IMPORT_ON_C:\SIMPROK         = YES
  BOQ_IMPORT_ON_SIMPROK_DB         = YES
  DIRECTOR_CAN_CREATE_RAB          = YES
  DIRECTOR_CAN_VIEW_RAB            = YES
  DIRECTOR_CAN_EDIT_DRAFT          = YES
  FRONTEND_BACKEND_AUTHORITY_MATCH = YES
  PRODUCTION_BACKFILL_COUNT        = 0
  OWNER_BROWSER_CANONICAL          = PASS

======================================================================
5. RM-02 — IMPORT BASIC PRICE
======================================================================

TUJUAN:
Basic Price nyata dapat masuk, dilacak, diverifikasi, dan digunakan.

IDENTITAS KANONIKAL:

  Resource
  Location
  Date
  Source

WAJIB:

1. Preview sebelum write.
2. Provenance lengkap.
3. Source document.
4. Source page/cell bila tersedia.
5. Price coverage:
   - EX_SOURCE;
   - DELIVERED_TO_PROJECT;
   - bongkar-muat termasuk/tidak;
   - perlu konfirmasi;
   - referensi wilayah terdekat.
6. Verification status.
7. Workspace isolation.
8. Human approval.
9. Import history.
10. Unit normalization.
11. AI dilarang mengarang harga.
12. Duplicate/collision detection.
13. Exact decimal string.
14. No JavaScript floating-point authority.

OD-04 PRECISION POLICY wajib Owner-Locked sebelum RM-02 selesai.

Precision policy harus menentukan:

  skala volume BOQ;
  skala koefisien AHSP;
  skala Basic Price;
  skala resource component;
  skala Harga Satuan;
  skala line total;
  titik pembulatan;
  mode pembulatan;
  canonical value;
  display value;
  audit value.

EXIT GATE RM-02:

  BASIC_PRICE_IMPORT        = LIVE
  PRECISION_POLICY          = OWNER_LOCKED
  OD_04                     = CLOSED
  PROVENANCE_COMPLETE       = YES
  FAKE_PRICE_COUNT          = 0
  SILENT_ROUNDING_COUNT     = 0
  TENANT_ISOLATION          = PASS
  IMPORT_HISTORY            = PASS

======================================================================
6. RM-03 — IMPORT AHSP
======================================================================

TUJUAN:
AHSP sah pemerintah/lembaga masuk sebagai formula metode kerja,
tanpa membawa overhead dan profit.

AHSP IMPORT WAJIB:

1. Source/provenance lengkap.
2. Regulation name.
3. Regulation number.
4. Regulation year.
5. Effective date.
6. Source document.
7. Source page/cell.
8. Sector/field.
9. Output unit wajib.
10. Seluruh resource wajib lengkap.
11. Koefisien exact decimal.
12. Unit setiap resource wajib.
13. Version immutable.
14. Preview sebelum write.
15. Human approval.
16. Source parity check.
17. Resource yang hilang, seperti Mandor, wajib terdeteksi.
18. AHSP tidak boleh dinyatakan lengkap bila source parity gagal.
19. Overhead/Biaya Umum tidak diimpor ke AHSP.
20. Profit tidak diimpor ke AHSP.
21. Pajak tidak diimpor ke AHSP.

Regulasi dan aturan overhead harus direkam,
tetapi tidak otomatis diterapkan sebagai uang SIMPROK.

WAJIB DIVERIFIKASI MELALUI OVERHEAD-RESEARCH-01:

  nilai/rentang overhead yang berlaku;
  hubungan overhead dan profit;
  work type yang dikecualikan;
  aturan mobilisasi/demobilisasi;
  perbedaan versi regulasi;
  project overhead vs corporate overhead.

EXIT GATE RM-03:

  AHSP_IMPORT                       = LIVE
  OUTPUT_UNIT_MISSING_COUNT         = 0
  INCOMPLETE_RESOURCE_SET_COUNT     = 0
  SOURCE_PARITY_UNPROVEN_COUNT      = 0
  IMPORTED_OVERHEAD_COUNT           = 0
  IMPORTED_PROFIT_COUNT             = 0
  REGULATION_VERSION_RECORDED       = YES
  OVERHEAD_RULE_SOURCE_RECORDED     = YES
  OVERHEAD_EXEMPTIONS_RECORDED      = YES
  IMMUTABILITY                      = PASS

======================================================================
7. RM-04 — BOQ → AHSP → BASIC PRICE LINKAGE
======================================================================

TUJUAN:
Setiap item pekerjaan memiliki occurrence nyata dan dapat dihitung.

RANTAI:

  BoqItem
  → AHSP Application
  → ProjectAhspOccurrence
  → AHSP Resource Resolution
  → Basic Price
  → Cost Kernel
  → Line Total

HUKUM:

1. Satu occurrence per baris/kejadian pekerjaan.
2. AHSP sama pada dua zona tetap dua occurrence.
3. AHSP master tidak dicemari kondisi proyek.
4. Unit compatibility wajib.
5. Exact decimal wajib.
6. Fail-closed.
7. Tidak boleh menebak linkage.
8. Tidak boleh menampilkan partial AHSP sebagai lengkap.
9. Semua mandatory resource harus resolved.
10. Ownership dan workspace harus benar.
11. OD-04 precision sudah harus locked.

ENTRY GATE RM-04:

  RM_02 = PASS
  RM_03 = PASS
  OD_04 = OWNER_LOCKED

EXIT GATE RM-04:

  DIRECT_COST_CHAIN_LIVE          = YES
  MULTILINE_RAB_CALCULATION       = PASS
  MISSING_RESOURCE_FAIL_CLOSED    = PASS
  UNIT_MISMATCH_FAIL_CLOSED       = PASS
  PARTIAL_AHSP_SHOWN_COMPLETE     = NO
  CROSS_TENANT_LINK_COUNT         = 0

======================================================================
8. RM-05 — DIRECT-COST RAB HIDUP
======================================================================

TUJUAN:
RAB berangka untuk biaya langsung hidup secara nyata.

TAMPILAN:

  Total / Biaya Langsung
  Profit manual
  PPN/Pajak
  Grand Total

HUKUM:

1. Profit tidak berada dalam AHSP.
2. Profit diisi manual user.
3. PPN sesuai negara/ketentuan.
4. Tidak ada overhead generik.
5. Tidak ada fake zero.
6. Tidak ada harga karangan.
7. Backend adalah money authority.
8. Frontend tidak menghitung ulang nilai canonical.
9. Status harus jujur.

STATUS PADA TAHAP INI:

  DIRECT_COST_COMPLETE              = YES
  EXECUTION_FACTOR_NOT_EVALUATED    = YES
  FULL_PROJECT_COST                 = NO

EXIT GATE RM-05:

  TOTAL_DIRECT_COST_LIVE     = YES
  PROFIT_MANUAL_LIVE         = YES
  PPN_LIVE                   = YES
  GRAND_TOTAL_LIVE           = YES
  FAKE_ZERO_MONEY_COUNT      = 0
  FAKE_PRICE_COUNT           = 0
  FULL_PROJECT_COST_CLAIMED  = NO

======================================================================
9. RM-06 — RUANG TRANSISI / RUANG INTERAKSI
======================================================================

TUJUAN:
User dapat mulai menyusun RAB walaupun belum mempunyai BOQ,
spesifikasi, metode, gambar lengkap, atau pagu.

ENAM MODE INTAKE:

A. BOQ + spesifikasi
B. BOQ tanpa spesifikasi
C. BOQ + spesifikasi + pagu
D. BOQ + pagu
E. Tanpa BOQ + pagu
F. Tanpa BOQ dan tanpa pagu

RUANG INTERAKSI HARUS:

1. membaca data yang tersedia;
2. mengidentifikasi data yang belum tersedia;
3. bertanya secara bertahap;
4. menggunakan bahasa manusia;
5. tidak memaksa istilah teknis;
6. membentuk Project Context;
7. membentuk kandidat WBS/BOQ;
8. membantu melahirkan metode;
9. membantu melahirkan spesifikasi;
10. mendeteksi Execution Factor Signal;
11. meminta evidence;
12. mencatat uncertainty;
13. mencatat siapa yang memutuskan;
14. tidak mengarang harga;
15. tidak mengarang fakta teknis.

DATA MENTAH YANG DAPAT MENJADI AWAL:

  lokasi;
  jenis bangunan;
  jumlah lantai;
  luas/perkiraan kapasitas;
  darat/sungai/laut/rawa/pantai/tebing;
  ada/tidak ada jalan;
  lebar/kondisi jalan;
  jarak angkut;
  titik bongkar;
  musim;
  lingkungan aktif;
  jam kerja;
  keselamatan;
  target waktu;
  pagu;
  foto;
  koordinat.

STATUS EF DI RUANG INTERAKSI:

  EF_SIGNAL
  EF_CANDIDATE
  EF_NEEDS_EVIDENCE
  EF_CONFIRMED
  EF_DISABLED_BY_USER

Pada RM-06, discovery EF boleh hidup,
tetapi kalkulasi biaya EF masih ditutup.

EXIT GATE RM-06:

  USER_WITH_RAW_DATA_CAN_CREATE_RAB = YES
  PROGRESSIVE_INTERVIEW             = LIVE
  TEMPLATE_SYNTHESIS                = LIVE
  BOQ_ENRICHMENT                    = LIVE
  EF_SIGNAL_DISCOVERY               = LIVE
  EF_COST_CALCULATION               = NO
  GENERAL_PUBLIC_RAB_READINESS      = YES

Sebelum RM-06:

  TARGET_USER =
  user yang sudah memiliki BOQ atau data teknis cukup;
  estimator;
  internal pilot;
  controlled deployment.

======================================================================
10. RM-07 — PENELITIAN OVERHEAD DAN FOUNDATION EF
======================================================================

TUJUAN:
Mendefinisikan EF secara benar sebelum coding.

EF DISCOVERY dimulai pada Ruang Transisi/Ruang Interaksi,
sebelum RAB final dan sebelum pelaksanaan proyek.

EF BUKAN:

  overhead persen;
  harga;
  resource;
  Basic Price;
  profit;
  pajak;
  margin.

EF ADALAH:

  model kondisi pelaksanaan yang menggantikan metode overhead generik
  dengan rantai kebutuhan nyata yang dapat dihitung dan diaudit.

RANTAI:

  WORK
  → EXECUTION FACTOR
  → EXECUTION REQUIREMENT
  → RESOURCE REQUIREMENT
  → PRODUCTIVITY
  → DURATION
  → RESOURCE CONSUMPTION
  → COST ENGINE
  → PROJECT COST

MODE AKTIVASI:

  OFF
  PROJECT_WIDE
  SELECTIVE

SCOPE:

  PROJECT
  ZONE
  PACKAGE/WBS
  OCCURRENCE

INHERITANCE:

  Project Default
  → Zone/Package Override
  → Occurrence Override

Scope paling spesifik menang.

RULE ENGINE:

  SIMPROK mendeteksi, bertanya, menyarankan, menjelaskan.
  Manusia mengonfirmasi, menolak, menambah, atau mengubah dengan alasan.

PROVENANCE WAJIB:

  fakta;
  kategori;
  nilai terukur;
  sumber;
  tanggal;
  bukti;
  entered by;
  confirmed by;
  confidence;
  reason.

OVERHEAD-RESEARCH-01 WAJIB MENJAWAB:

1. mengapa overhead/biaya umum ada;
2. sejarah pengaturannya;
3. regulasi terkini;
4. nilai maksimum/lazim;
5. hubungan overhead dan profit;
6. project overhead vs corporate overhead;
7. SMKK dan biaya wajib;
8. perlakuan dalam AHSP/HPS/kontrak/audit;
9. komponen yang dapat diurai melalui EF;
10. komponen yang memerlukan rumah lain.

DELIVERABLES RM-07:

  OVERHEAD-RESEARCH-01
  EF-INTERACTION-INTAKE-01
  EXECUTION-FACTOR-FOUNDATION-001 v1.1
  EXECUTION-REQUIREMENT-FOUNDATION-002
  EF-COLLISION-LAW-003
  EF-SHARED-REQUIREMENT-LAW-004

EXECUTION-FACTOR-FOUNDATION-001 v1.0 tetap disimpan sebagai histori.
v1.1 harus menyatakan SUPERSEDES v1.0.

HUKUM ANTI-GANDA:

Setiap requirement diperiksa terhadap:

  BOQ
  AHSP
  Basic Price delivery scope
  Mobilization
  Existing requirement
  Project cost lain

STATUS:

  NEW_REQUIREMENT
  ALREADY_COVERED_BY_BOQ
  ALREADY_COVERED_BY_AHSP
  ALREADY_COVERED_BY_PRICE_SCOPE
  SHARED_REQUIREMENT_ALREADY_EXISTS
  REQUIRES_CONFIRMATION
  NOT_APPLICABLE

SHARED REQUIREMENT:

  PROJECT_SHARED
  ZONE_SHARED
  PACKAGE_SHARED
  OCCURRENCE_SPECIFIC

EXIT GATE RM-07:

  OVERHEAD_RESEARCH                  = PASS
  EF_INTERACTION_INTAKE              = OWNER_LOCKED
  EF_FOUNDATION_V1_1                 = OWNER_LOCKED
  EXECUTION_REQUIREMENT_FOUNDATION   = OWNER_LOCKED
  COLLISION_LAW                      = OWNER_LOCKED
  SHARED_REQUIREMENT_LAW             = OWNER_LOCKED
  EF_IMPLEMENTATION_AUTHORIZED       = NO

Coding EF baru boleh dibuka melalui Owner decision terpisah.

======================================================================
11. RM-08 — EXECUTION FACTOR KUANTITAS
======================================================================

TUJUAN:
Menghitung requirement yang belum membutuhkan jadwal lengkap.

CONTOH:

  Temporary Road      = meter
  Barricade           = meter
  Safety Sign         = unit
  Temporary Platform  = m²
  Temporary Access    = meter
  Pump                = unit
  Lifeline            = meter
  Safety Net          = m²

WAJIB:

  OFF / PROJECT_WIDE / SELECTIVE
  provenance
  evidence
  human confirmation
  collision detection
  shared pool
  quantity driver
  unit
  resource mapping
  Basic Price
  contextual-cost layer

TAMPILAN BIAYA:

A. Biaya Langsung AHSP
B. Biaya Pelaksanaan Kontekstual
C. Biaya Proyek Sebelum Profit
D. Profit
E. PPN/Pajak
F. Grand Total

Execution Cost Ratio hanya OUTPUT informasi,
bukan input persentase.

EXIT GATE RM-08:

  EF_QUANTITY_LIVE              = YES
  DOUBLE_COST_COUNT             = 0
  SHARED_REQUIREMENT_DUPLICATE  = 0
  UNPROVEN_REQUIREMENT_COST     = 0

======================================================================
12. RM-09 — PRODUKTIVITAS, DURASI, DAN EF BERBASIS WAKTU
======================================================================

TUJUAN:
Menghitung requirement yang bergantung pada produktivitas dan durasi.

FORMULA KONSEPTUAL:

  Duration = Volume ÷ Productivity

CONTOH:

  Safety Officer × bulan
  Flagman × hari
  Dewatering Pump × hari
  Temporary Power × bulan
  Temporary Lighting × malam
  Monitoring × periode
  Security Personnel × bulan

WAJIB:

  productivity baseline;
  EF impact evidence;
  duration;
  calendar;
  work-hour constraints;
  weather/season constraints;
  quantity/time consumption;
  resource price;
  human confirmation.

EXIT GATE RM-09:

  PRODUCTIVITY_ENGINE       = LIVE
  DURATION_ENGINE           = LIVE
  EF_DURATION               = LIVE
  EXECUTION_FACTOR_COMPLETE = AVAILABLE
  FULL_PROJECT_COST_STATUS  = AVAILABLE

FULL_PROJECT_COST hanya boleh dinyatakan bila:

  EF_COMPLETE
  atau
  EF_DISABLED_BY_USER secara sadar dan tercatat.

======================================================================
13. RM-10 — LIFECYCLE RAB
======================================================================

RANTAI:

  Draft
  → Review
  → Approved
  → Locked Baseline
  → Addendum Draft
  → Addendum Review
  → Addendum Approved

WAJIB:

  immutable history;
  no direct edit after baseline;
  read-only RAB door;
  approval authority;
  snapshot;
  audit trail;
  no auto-approve;
  no fake baseline;
  no production backfill;
  direct URL fail-closed;
  browser lifecycle proof.

EXIT GATE RM-10:

  DRAFT_EDIT_RULE        = PASS
  APPROVAL_RULE          = PASS
  BASELINE_IMMUTABILITY  = PASS
  ADDENDUM               = LIVE
  HISTORY_PRESERVED      = YES

======================================================================
14. RM-11 — EXPORT, PRINT, DAN AUDIT PACKAGE
======================================================================

OUTPUT:

  RAB
  BOQ
  AHSP breakdown
  Basic Price provenance
  Execution Factor evidence
  Execution Requirement
  Resource Requirement
  Direct Cost
  Contextual Execution Cost
  Profit
  PPN/Pajak
  Grand Total
  Approval history
  Baseline history
  Addendum history
  uncertainty register
  audit explanation.

EXIT GATE RM-11:

  PDF/PRINT              = LIVE
  EXCEL_EXPORT           = LIVE
  AUDIT_PACKAGE          = COMPLETE
  SOURCE_TRACEABILITY    = PASS

======================================================================
15. RM-12 — PERLUASAN FORMAT & PLATFORM REALITY INTAKE
======================================================================

TUJUAN:

1. mendukung banyak format BOQ;
2. mendukung banyak format Basic Price;
3. mendukung banyak format AHSP;
4. menutup temporary vertical-local intake;
5. memindahkan intake ke Platform Layer;
6. asynchronous queue/worker/staging;
7. large-file support;
8. preview pagination;
9. idempotent replay;
10. retry-safe;
11. import history;
12. document provenance;
13. shared Knowledge Object.

UTANG-PLATFORM-03 ditutup pada tahap ini.

EXIT GATE RM-12:

  PLATFORM_REALITY_INTAKE = LIVE
  LARGE_FILE_SAFE         = YES
  RETRY_IDEMPOTENT        = YES
  FORMAT_COMPATIBILITY    = EXPANDED
  UTANG_PLATFORM_03       = CLOSED

======================================================================
16. DEBT REGISTER RESMI
======================================================================

UTANG-PLATFORM-03
  Closure = RM-12

UTANG-FAKE-ZERO-04
  Closure = sebelum baseline/approval final

UTANG-ACCESS-05
  Closure = security slice sebelum produksi penuh

UTANG-LIFECYCLE-06
  Status  = implemented locally
  Closure = PR #35 merged + negative browser proof PASS

UTANG-PERMISSION-08
  Closure = RM-01

UTANG-TSC-10
  Closure = maintenance gate sebelum Grade A release

UTANG-AUTHZ-11
  Closure = RM-01

UTANG-E2E-CLEANUP-11
  Closure = test-infra stabilization
  Wajib sebelum safe E2E kembali dipakai sebagai bukti absolut

OD-04 DECIMAL PRECISION
  Closure = RM-02
  Entry blocker RM-04

IMPORT RETRY / IDEMPOTENCY GAP
  Closure = RM-12

UTANG-ORDER-09
  Status = CLOSED
  Closure evidence = pre-Multer lifecycle guard
  Dipindahkan ke Closed Debt Register
  Tidak boleh dihapus dari histori

Setiap debt yang ditutup:

  tidak dihapus;
  diberi CLOSED_BY;
  exact SHA;
  PR;
  tanggal;
  bukti.

======================================================================
17. HUKUM ANTI-PERGESERAN ROADMAP
======================================================================

1. Hanya ada satu CURRENT_PRODUCT_TARGET.

2. Setiap PR wajib menulis:
   ROADMAP_ITEM=RM-xx

3. PR tanpa ROADMAP_ITEM:
   DILARANG dibuka.

4. Tahap berikut tidak dimulai sebelum exit gate tahap aktif PASS.

5. Pengecualian paralel hanya:
   - read-only audit;
   - docs/research;
   - worktree terpisah;
   - database terpisah atau read-only;
   - port terpisah;
   - tidak menyentuh file eksklusif yang sama.

6. File eksklusif:
   schema.prisma
   migrations/
   seed-acceptance.ts
   permissions.ts
   project.module.ts
   shared lifecycle/authority source

   Hanya satu writer pada satu waktu.

7. Browser proof Owner adalah exclusive lock:
   - nol E2E reset;
   - nol seed;
   - nol database reset;
   - nol proses lain memakai simprok_test.

8. Setiap awal sesi PM wajib memeriksa:
   - main SHA;
   - open PR;
   - Draft PR;
   - stale PR;
   - active worktree;
   - active writer;
   - database;
   - port;
   - active debt;
   - current roadmap target.

9. Setiap merge wajib memperbarui:
   STATE.md
   DECISIONS.md
   DEBT.md
   ROADMAP.md

10. Keputusan lama tidak dihapus.
    Keputusan baru harus menulis SUPERSEDES.
    Keputusan lama menulis SUPERSEDED_BY.

11. Tidak ada EF coding sebelum RM-07 Owner-Locked.

12. Tidak ada klaim Full Project Cost sebelum:
    EF_COMPLETE
    atau EF_DISABLED_BY_USER.

13. Tidak ada target baru menggantikan target aktif
    tanpa keputusan tertulis Owner.

14. Browser proof tidak boleh diganti oleh test.

15. Test hijau tidak boleh menggantikan pengalaman produk.

======================================================================
18. PEMBAGIAN EKSEKUTOR
======================================================================

EXECUTOR_TEAM:

  Claude Code
  Codex
  Owner melalui PowerShell untuk langkah lokal tertentu

REVIEWERS:

  Claude Arsitek
  Gemini Constitution Auditor
  Codex/Claude independent read-only audit sesuai tingkat risiko

HUKUM:

1. Jumlah executor tidak dibatasi satu.
2. Satu active writer per worktree.
3. Executor berbeda boleh bekerja paralel pada worktree berbeda.
4. Database dan port harus terpisah untuk write/test paralel.
5. Migration hanya satu writer.
6. Owner tidak menjadi kurir laporan antargen.
7. Semua laporan harus masuk GitHub/PR bila konektor memungkinkan.
8. Reviewer membaca exact SHA.
9. Reviewer tidak membuka scope baru.
10. Owner tetap final authority.

WARNA REVIEW:

HIJAU:
  tetap diperiksa Arsitek.

KUNING:
  Arsitek + Gemini.

MERAH:
  Arsitek + Gemini + Owner
  serta audit Codex/Claude read-only bila diperlukan.

======================================================================
19. LANGKAH BERIKUT YANG TIDAK BOLEH BERGESER
======================================================================

CURRENT_PRODUCT_TARGET = RM-00

NEXT ACTIONS:

1. Push ac679329d57783f2a72ab3d50500e05ad3c85b41
   ke feat/import-first-01-boq-working-draft.

2. PUSH_FORCE=NO.

3. Perbarui body PR #35 secara jujur.

4. Audit delta exact SHA:
   Claude Arsitek read-only.
   Codex read-only.

5. Owner melihat:
   16 bagian;
   58 item;
   0 catatan;
   74 diterima.

6. Owner menguji ACC-X negative lifecycle.

7. PM final gate satu kali.

8. Owner merge decision.

9. Close PR #21 tanpa merge.

10. Sinkronkan main dan C:\SIMPROK.

11. Mulai RM-01.

DILARANG sebelum RM-00 PASS:

  membuka PR Basic Price Import;
  membuka PR AHSP Import;
  membuka coding EF;
  membuka roadmap baru;
  mengganti sasaran;
  mengulang arsitektur PR #35;
  mengklaim produksi hidup.

TRACK YANG BOLEH PARALEL READ-ONLY:

  OVERHEAD-RESEARCH-01
  EF-INTERACTION-INTAKE-01

Syarat:
  tidak menulis source;
  tidak mengubah schema;
  tidak mengganggu PR #35;
  tidak mengaktifkan EF coding.

======================================================================
20. FINAL LOCK
======================================================================

ROADMAP_STATUS                  = FINAL_OWNER_LOCKED
CURRENT_PRODUCT_TARGET          = RM-00
NEXT_PRODUCT_TARGET             = RM-01
PR_35_MERGE                     = WAITING_FINAL_PUSH_AUDIT_BROWSER
PR_21                           = CLOSE_WITHOUT_MERGE
EF_DISCOVERY                    = RUANG_TRANSISI_RUANG_INTERAKSI
EF_CODING                       = CLOSED
OVERHEAD_RESEARCH               = REQUIRED
DIRECT_COST_FIRST               = LOCKED
FULL_PROJECT_COST_WITHOUT_EF    = FORBIDDEN
OWNER_FINAL_AUTHORITY           = YES
ROADMAP_SHIFT_WITHOUT_OWNER     = FORBIDDEN

SOLI DEO GLORIA.
HALLELUYA. AMIN.
