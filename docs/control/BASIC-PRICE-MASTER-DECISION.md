# SIMPROK — BASIC PRICE MASTER DECISION

Dalam Nama Tuhan Yesus Kristus. Amin.

```text
DOCUMENT_ID=MASTER-DECISION-BASIC-PRICE-01
CHECKPOINT_ID=CKPT-BASIC-PRICE-MASTER-2026-07-31
MASTER_DECISION_VERSION=3.1
OWNER_ADDENDUM_VERSION=1.1
OWNER=FEKY_DE_FRETES
PRODUCT=SIMPROK

STATUS=DRAFT_FOR_BYTE_AUDIT_AND_MULTI_AI_AUDIT
OWNER_DECISIONS_2026_07_31=LOCKED
DOCUMENT_OWNER_LOCK=NO
ARCHITECT_VERDICT=NOT_READY_TO_LOCK
CODING_AUTHORIZATION=NO
PROMPT_EXECUTOR=NO
PR53_MERGE=NO
PR54_MERGE=NO
PR55_MERGE=NO
PR56_MERGE=NO
PRODUCTION_ACTIVATION=NO
```

## 0. Fungsi dan otoritas dokumen

Dokumen ini adalah sumber kendali bersama domain Basic Price agar Owner, PM,
Arsitek, Gemini, Meta IA, auditor lain, dan executor membaca hukum yang sama.
Dokumen ini belum merupakan izin coding atau merge. Keputusan eksplisit Owner
terbaru mengalahkan rumusan lama yang bertentangan.

Urutan otoritas:

1. keputusan eksplisit Owner terbaru;
2. `docs/control/ROADMAP.md` dan `docs/control/CARA-KERJA.md`;
3. dokumen ini untuk domain Basic Price;
4. bukti byte repository/GitHub;
5. laporan agen berstatus `PASS_REPORTED` sampai diaudit langsung.

Jika terjadi konflik, agen wajib `STOP/NEEDS_REVIEW`; jangan memilih sendiri.

## 1. Hukum induk

```text
MASTER_LAW=SIMPLE_TO_USE_STRICT_TO_TRUST
USER_EXPERIENCE=MUDAH_ENTENG_NYAMAN
SYSTEM_OUTPUT=TERPERCAYA_TERVERIFIKASI_DAPAT_DIAUDIT
SYSTEM_COMPLEXITY_MAY_NOT_BE_SHIFTED_TO_USER=YES
USER_SIMPLICITY_MAY_NOT_WEAKEN_DATA_INTEGRITY=YES
EXTERNAL_VARIATION=ACCEPTED_AS_INPUT
RAW_DATA=PRESERVED
SIMPROK_CANONICAL_AUTHORITY=FINAL
AUTOMATION_FIRST=LOCKED
HUMAN_BY_EXCEPTION=LOCKED
EXPLAINABLE_AUTOMATION=LOCKED
SIMPROK_MENGHITUNG_MANUSIA_MEMUTUSKAN=LOCKED
```

SIMPROK mengerjakan otomatis hal yang aman dan pasti. Manusia memutuskan
ketidakpastian nyata. Otomasi tidak boleh menghapus pilihan sah, mengarang
sumber, mengubah raw input, atau melakukan konversi tanpa rule yang dapat
diaudit.

## 2. Satu produk Basic Price

```text
ONE_SIMPROK_PRODUCT=YES
BASIC_PRICE_EDITION_OR_VARIANT=NO
ROLE_DEPENDENT_GENERAL_PRODUCT_EXPERIENCE=NO
```

Setiap `WorkspaceMembership ACTIVE` memperoleh pengalaman produk umum yang
sama melalui:

- `BASIC_PRICE_VIEW`;
- `BASIC_PRICE_IMPORT`;
- `BASIC_PRICE_RESOLVE`;
- `BASIC_PRICE_SUBMIT`.

Kemampuan internal tetap role-governed:

- `BASIC_PRICE_REVIEW_VIEW`;
- `BASIC_PRICE_VERIFY`;
- `BASIC_PRICE_PUBLISH`.

Review, verify, dan publication adalah back-office internal. Produk umum
tidak boleh menampilkan antrean review, antrean publikasi, permission code,
atau tombol Accept/Reject internal.

## 3. Private use dan usulan publik

```text
PRIVATE_USE=DEFAULT_RIGHT
PUBLIC_PROPOSAL=OPTIONAL_ADDITIONAL_ACTION
CURATION_REJECTION_REVOKES_PRIVATE_USE=NO
BASIC_PRICE_AND_AHSP_OWNERSHIP_PATTERN=CONSISTENT
```

Pola pengguna:

```text
Simpan & Gunakan
+
Usulkan juga ke SIMPROK
```

Status manusiawi hanya boleh diproyeksikan bila lifecycle runtime-nya benar:

- Tersimpan untuk Saya;
- Siap Digunakan;
- Diusulkan ke SIMPROK;
- Sedang Dikurasi;
- Perlu Dilengkapi;
- Diterima;
- Tidak Diterima;
- Telah Dipublikasikan.

```text
NEEDS_CORRECTION_RESUBMISSION_ENTRYPOINT=PENDING
NEEDS_CORRECTION_MAY_NOT_BE_PRESENTED_AS_LIVE_ACTION_UNTIL_RESUBMISSION_EXISTS=YES
```

## 4. Explorer Basic Price

Arah visual:

- putih dominan;
- biru lembut;
- aksen ungu halus;
- profesional Grade A;
- padat tetapi tidak sesak;
- desktop memakai compact rows/table;
- mobile memakai compact cards dengan information parity.

Filter utama:

1. cari nama/kode resource;
2. kategori;
3. wilayah;
4. keluarga sumber;
5. berlaku pada tanggal;
6. Filter Lanjutan.

Filter lanjutan:

- rentang tanggal;
- nama sumber/toko/supplier/instansi;
- satuan;
- freshness;
- origin spesifik;
- metode/jenis sumber;
- urutan;
- bersihkan filter.

Kolom daftar:

```text
Resource | Kategori | Satuan | Harga | Wilayah | Sumber | Status | Detail
```

Color Lock:

```text
RED=CRITICAL_DESTRUCTIVE_REJECTION_ONLY
REVALIDATION_BADGE_CRITICAL_RED=FORBIDDEN
```

## 5. Waktu, hasil eligible, dan pemilihan

```text
PRIMARY_TIME_FILTER=AS_OF_DATE
DEFAULT_AS_OF_DATE=TODAY
AS_OF_DATE_RESULT_MODE=SHOW_ALL_ELIGIBLE
SILENT_SINGLE_WINNER_SELECTION=FORBIDDEN
SIMPROK_RECOMMENDATION=OPTIONAL_AND_EXPLAINABLE
HUMAN_FINAL_AUTHORITY=YES
PROJECT_PRICE_SELECTION_POLICY=PENDING_ARCHITECTURE
SILENT_POLICY_SELECTION=FORBIDDEN
```

Semantik:

```text
effectiveDate <= selectedDate
AND
(validUntil IS NULL OR validUntil >= selectedDate)
```

Satu resource dapat memiliki banyak harga sah. Explorer tidak boleh
menyembunyikan alternatif. Cost Kernel baru bekerja deterministik setelah
pilihan manusia atau policy proyek yang telah didefinisikan, disetujui, dan
dapat diaudit tersedia.

## 6. Freshness, validity, dan connector health

```text
FRESHNESS_NOT_EQUAL_VERIFICATION
EXPIRED_NOT_EQUAL_INVALID
CONNECTOR_HEALTH_NOT_EQUAL_PRICE_FRESHNESS
```

Label:

- `CURRENT` → Terkini;
- `EXPIRING` → Perlu Diperbarui Segera;
- `EXPIRED` → Perlu Verifikasi Ulang.

Gangguan connector tidak otomatis membatalkan harga terakhir yang sah.

## 7. Histori dan immutability

```text
BASIC_PRICE_VALUE_UPDATE=FORBIDDEN_WHEN_PUBLISHED_OR_REFERENCED
PRICE_CHANGE=NEW_BASIC_PRICE_RECORD
CORRECTION=NEW_RECORD_OR_EVENT
OLD_RECORD=RETAINED
HARD_DELETE_HISTORY=FORBIDDEN
CONNECTED_SOURCE_UPDATE=NEW_EFFECTIVE_RECORD
PREVIOUS_RECORD_VALID_UNTIL=CLOSED
EXISTING_SNAPSHOT=RETAINED
```

Larangan mutasi berlaku bukan hanya setelah `PUBLISHED`, tetapi juga sejak
record telah dirujuk atau dipakai oleh AHSP/RAB. Feed baru tidak boleh
mengubah RAB lama.

Snapshot minimum ketika harga dipakai:

- Basic Price record id;
- nilai exact;
- selling unit;
- effective date;
- source id/version;
- coverage;
- region;
- conversion rule id/version;
- waktu dan aktor pemilihan.

## 8. Impor dan Cocokkan Data Impor

Dua ruang:

1. **Impor Basic Price** — XLSX/CSV, input manual, sumber, kanal, tanggal,
   wilayah, preview.
2. **Cocokkan Data Impor** — hasil auto-match, baris ambigu, Resource
   SIMPROK, satuan, spesifikasi kurang, dan baris tidak digunakan.

```text
IMPORT_INFORMATION_ARCHITECTURE=OWNER_APPROVED_IN_PRINCIPLE
IMPORT_AUTOMATION_MODEL=OWNER_APPROVED
IMPORT_FINAL_PIXEL_LEVEL_VISUAL=OWNER_APPROVAL_PENDING
IMPORT_UI_CODING=HOLD
```

Pengguna memeriksa exception, bukan semua baris. Batch pengguna dimiliki akun
pengunggah. Anggota lain dalam workspace yang sama tidak otomatis dapat
membaca atau mengubah batch tersebut. Mismatch account/workspace harus
fail-closed tanpa enumeration signal.

## 9. Resource dan Unit Kernel

```text
MANY_EXTERNAL_NAMES
→ ONE_CANONICAL_RESOURCE
→ MANY_VALID_PRICES

USER_CANONICAL_RESOURCE_CODE_INPUT=NOT_REQUIRED
USER_SOURCE_CODE=OPTIONAL_PROVENANCE_ALIAS
INTERNAL_RESOURCE_ID=UUID
CANONICAL_HUMAN_CODE=SYSTEM_CURATED

RAW_UNIT_VALUE=PRESERVED_EXACTLY
NORMALIZED_UNIT=ADDITIONAL
CANONICAL_UNIT=ADDITIONAL_RESOLUTION
RAW_UNIT_MUTATION=FORBIDDEN
```

Pipeline normalisasi terkontrol:

```text
RAW
→ Unicode NFKC
→ trim
→ controlled case-fold
→ controlled whitespace normalization
→ controlled punctuation normalization
→ exact active-alias lookup
→ ambiguity check
→ canonical resolution
```

Normalisasi agresif dilarang:

```text
m ≠ m²
m² ≠ m³
OH ≠ OJ
OJ ≠ OB
Jam belum tentu Jam Alat
Zak belum tentu mempunyai berat sama
```

Alias faktor satu berbeda dari konversi. Konversi hanya boleh memakai rule
aman, evidence, versi, dan spesifikasi yang memadai. Harga asli tetap
disimpan; konversi dilakukan saat konsumsi.

Status jujur:

```text
UNIT_KERNEL_SCHEMA_FOUNDATION=PASS_REPORTED
UNIT_KERNEL_RUNTIME_DICTIONARY_COVERAGE=NOT_PROVED
UNIT_KERNEL_BYTE_AUDIT=PENDING
```

## 10. Empat sumbu sumber

```text
SOURCE_TYPE ≠ SOURCE_ORIGIN ≠ INGESTION_CHANNEL ≠ SYNC_MODE
```

Source Type:

- `VENDOR_QUOTE`;
- `MARKET_SURVEY`;
- `REGULATION`;
- `SYSTEM_ESTIMATE`.

Source Origin:

- `GOVERNMENT`;
- `SUPPLIER`;
- `STORE`;
- `DISTRIBUTOR`;
- `FIELD_REPORT`;
- `COMMUNITY_REPORT`.

Ingestion Channel:

- `MANUAL_FILE_UPLOAD`;
- `MANUAL_ENTRY`;
- `API_CONNECTOR`;
- `WEBSITE_SYNC`;
- `DIRECT_SUPPLIER_FEED`;
- `FIELD_MOBILE_ENTRY`;
- `SYSTEM_GENERATED`.

Sync Mode:

- `EVENT_PUSH`;
- `SCHEDULED_PULL`;
- `ON_DEMAND_PULL`;
- `FILE_DROP_SYNC`;
- `MANUAL_REFRESH`;
- `MANUAL_UPLOAD`.

Source bukan reporter. `SYSTEM_ESTIMATE` adalah keluaran mesin SIMPROK,
bukan pilihan manual bebas.

Keluarga sumber saat ini:

- GOVERNMENT → Harga Pemerintah;
- SUPPLIER/STORE/DISTRIBUTOR → Harga Toko/Supplier;
- FIELD_REPORT/COMMUNITY_REPORT → Harga Lapangan.

Association disetujui dalam prinsip tetapi keluarga final dan schema-nya
masih pending.

## 11. Evidence, provenance, dan wilayah

```text
PUBLIC_PRICE_WITHOUT_TRACEABLE_SOURCE=FORBIDDEN
FAKE_SOURCE_NAME=FORBIDDEN
NULL_SOURCE_PUBLICATION=FAIL_CLOSED
PUBLIC_ELIGIBILITY=status:PUBLISHED + verificationStatus:PUBLISHED
USER_REGION_CODE_INPUT=NOT_REQUIRED
REGION_SELECTION=HUMAN_NAME_AND_HIERARCHY
CANONICAL_REGION_CODE=AUTO_RESOLVED
RAW_LOCATION_TEXT=PRESERVED
```

Evidence mengikuti kombinasi sumber dan kanal. Harga private tidak boleh
bocor ke workspace lain.

Arah authority wilayah:

- Kemendagri untuk wilayah administratif;
- BPS untuk namespace/klasifikasi statistik.

Masih pending: kedalaman hierarchy, versioning, pemekaran, histori, dan
geospatial boundary reference.

## 12. Detail Basic Price

Route konseptual:

```text
/basic-price/:basicPriceId
```

Detail membahas satu record harga dalam konteks resource.

### Tab 1 — Ringkasan

- resource;
- kategori;
- spesifikasi;
- harga dan satuan asli;
- hasil konversi sah yang diberi label derived;
- wilayah;
- periode;
- freshness;
- scope;
- coverage.

### Tab 2 — Sumber & Bukti

- keluarga sumber;
- origin;
- source type;
- ingestion channel;
- nama instansi/vendor;
- dokumen/feed;
- tanggal sinkronisasi/survei;
- evidence aman;
- pertanggungjawaban.

### Tab 3 — Riwayat & Pembanding

Pembanding dibatasi pada:

```text
GLOBAL_PUBLISHED
+ CURRENT_WORKSPACE_AUTHORIZED
+ CURRENT_ACCOUNT_PRIVATE
```

```text
CROSS_WORKSPACE_PRIVATE_COMPARISON=FORBIDDEN
```

Detail publik tidak menampilkan UUID mentah, enum mentah, permission code,
route internal, tombol Accept/Reject, data pribadi sensitif, exact GPS,
storage path, atau hash teknis tanpa penjelasan.

```text
DETAIL_CONTRACT=DEFINED
DETAIL_PROJECTION_API=NOT_IMPLEMENTED
DETAIL_PAGE_UI=NOT_DESIGNED
DETAIL_OWNER_VISUAL_APPROVAL=PENDING
DETAIL_MOCKUP_REQUIRED_BEFORE_CODING
```

## 13. Owner Decision Addendum v1.0 — jalur publikasi dan connector

Keputusan Owner: aturan dua manusia adalah kontrol internal manajemen SIMPROK,
bukan pekerjaan yang dibebankan kepada pengguna publik.

### 13.1 Jalur manual dan usulan pengguna

```text
MANUAL_AND_USER_PROPOSAL_PATH=HUMAN_CURATED
VERIFIER=HUMAN_A
PUBLISHER=HUMAN_B
VERIFIER_MUST_DIFFER_FROM_PUBLISHER=YES
AUTO_VERIFY=NO
AUTO_PUBLISH=NO
```

### 13.2 Jalur connector resmi/partner terverifikasi

```text
APPROVED_CONNECTOR_PATH=POLICY_GOVERNED_AUTOMATION
PER_RECORD_TWO_HUMAN_APPROVAL=NO
AUTO_INGEST=ALLOWED_BY_APPROVED_CONNECTOR_POLICY
AUTO_VERIFY=ALLOWED_BY_APPROVED_CONNECTOR_POLICY
AUTO_PUBLISH=ALLOWED_BY_APPROVED_CONNECTOR_POLICY
```

Connector dan policy wajib disetujui secara internal oleh dua manusia
berwenang yang berbeda sebelum otomasi diaktifkan.

```text
CONNECTOR_POLICY_APPROVER_A=HUMAN
CONNECTOR_POLICY_APPROVER_B=HUMAN
APPROVER_A_MUST_DIFFER_FROM_APPROVER_B=YES
PER_RECORD_ACTOR=SYSTEM_POLICY
POLICY_ID_REQUIRED=YES
POLICY_VERSION_REQUIRED=YES
CONNECTOR_ID_REQUIRED=YES
```

Setiap record otomatis wajib menyimpan minimal:

- connector identity dan trust tier;
- policy id dan version;
- external source/record/version;
- sourceUpdatedAt, observedAt, ingestedAt, sourceTimezone;
- payloadFingerprint;
- connectorVersion;
- publicationActorType=`SYSTEM_POLICY`;
- publicationReason.

### 13.3 Revocation dan histori

```text
POLICY_REVOCATION_STOPS_FUTURE_AUTOMATION=YES
FUTURE_AUTO_PUBLICATION=STOP_IMMEDIATELY
HARD_DELETE_HISTORY=FORBIDDEN
CORRECTION_CREATES_NEW_RECORD_OR_EVENT=YES
EXISTING_RAB_SNAPSHOT_MAY_NOT_CHANGE=YES
OFFICIAL_CONNECTOR_NOT_EQUAL_NATIONAL_SCOPE=YES
STORE_CONNECTOR_NOT_EQUAL_NATIONAL_PRICE=YES
```

### 13.4 Enforcement Addendum v1.0

```text
MANUAL_TWO_HUMAN_SEPARATION=RUNTIME_GUARD + NEGATIVE_E2E
CONNECTOR_POLICY_DUAL_APPROVAL=RUNTIME_POLICY_GUARD + AUDIT_TEST
SYSTEM_POLICY_RECORD_PROVENANCE=DB_CONSTRAINT_OR_FAIL_CLOSED_SERVICE + PROJECTION_TEST
POLICY_REVOCATION=RUNTIME_GUARD + REVOCATION_INTEGRATION_TEST
CONNECTOR_HISTORY_IMMUTABILITY=INTEGRATION_TEST + STATIC_MUTATION_AUDIT
CONNECTOR_IMPLEMENTATION=NOT_ON_CRITICAL_PATH
```

## 14. Owner Decision Addendum v1.1 — proof ref, database, dan pemisahan gate

### 14.1 Ref pembuktian

Owner memilih Opsi A karena paling cepat, aman, akurat, benar, dan minim
bongkar-pasang.

```text
PROOF_EXECUTION_OPTION=OPTION_A
PROOF_NATURE=ACCEPTANCE_EXPERIMENT
PROOF_REF=PR56_EXACT_HEAD
PROOF_SHA=092544f6a0982200366a8551593dafd3864a5317
MERGE_REQUIRED_BEFORE_PROOF=NO
PR53_MERGE=NO
PR54_MERGE=NO
PR55_MERGE=NO
PR56_MERGE=NO
PROOF_DOES_NOT_IMPLY_MERGE_APPROVAL=YES
PROOF_DOES_NOT_IMPLY_RELEASE=YES
PROOF_DOES_NOT_IMPLY_PRODUCTION_ACTIVATION=YES
```

### 14.2 Controlled acceptance substrate

```text
CONTROLLED_ACCEPTANCE_SUBSTRATE=simprok_e2e
PROOF_DATA_MODEL=DETERMINISTIC_EPHEMERAL_FIXTURE
FIXTURE_CREATION=TEST_SETUP
FIXTURE_CLEANUP=TEST_TEARDOWN
PERSISTENT_MANUAL_BOOTSTRAP=FORBIDDEN
THIRD_DATABASE=NO
SIMPROK_TEST_AS_GOLDEN_THREAD_PROOF_HOME=NO
SIMPROK_DB_WRITE=NO
RESIDUAL_CHECK=MANDATORY
```

Keputusan ini belum mengizinkan penulisan fixture atau test baru. Byte audit
read-only harus menentukan apakah fixture/test yang ada cukup atau ada gap
nyata.

### 14.3 Dua gate yang berbeda

```text
GATE_1=RM02_BASIC_PRICE_EXIT_GATE
GATE_2=BASIC_PRICE_TO_RAB_GOLDEN_THREAD_PROOF_GATE
RM02_BASIC_PRICE_EXIT_GATE_NOT_EQUAL_GOLDEN_THREAD_PROOF_GATE=YES
ACCEPTANCE_PROOF_DOES_NOT_CLOSE_RM02_EXIT_GATE=YES
ACCEPTANCE_PROOF_DOES_NOT_AUTHORIZE_PRODUCTION=YES
```

`RM02_BASIC_PRICE_EXIT_GATE` mencakup delapan kriteria Basic Price, termasuk
import live/production-readiness, provenance, fake price zero, dan tenant
isolation. Gate ini tidak dapat ditutup hanya oleh acceptance proof.

`BASIC_PRICE_TO_RAB_GOLDEN_THREAD_PROOF_GATE` mencakup:

```text
one traceable Basic Price
→ selected for project/AHSP
→ consumed by one RAB line
→ exact price/source/conversion snapshot
→ reproducible calculation
```

Gate Golden Thread merentang RM-02 sampai RM-05.

### 14.4 Enforcement Addendum v1.1

```text
PROOF_EXACT_REF=STATIC_SHA_ASSERTION + GIT_AUDIT
NO_MERGE_BEFORE_PROOF=PR_STATE_CHECK
DATABASE_TARGET=E2E_DATABASE_GUARD
FIXTURE_EPHEMERALITY=SETUP_TEARDOWN_TEST + RESIDUAL_CHECK
SIMPROK_DB_WRITE_ZERO=DATABASE_ROLE_GUARD + CONNECTION_AUDIT
GATE_NAME_SEPARATION=DOC_STATIC_AUDIT
ACCEPTANCE_NOT_EQUAL_GATE_CLOSURE=GATE_REPORT_ASSERTION
NEW_CODE_BEFORE_BYTE_AUDIT=FORBIDDEN_BY_REVIEW_GATE
```

## 15. Presisi uang dan OD-04

Dokumen ini tidak menduplikasi sebagian hukum uang.

```text
OD04_FULL_REFERENCE_REQUIRED=YES
PARTIAL_OD04_RESTATEMENT=FORBIDDEN
OD04_BYTE_AND_OWNER_LOCK_STATUS=PENDING_VERIFICATION
```

Implementasi wajib merujuk OD-04 secara utuh, termasuk skala storage,
perhitungan, titik pembulatan, dan mode pembulatan yang benar setelah byte
serta status lock diverifikasi.

## 16. Status repo yang dilaporkan

Sampai byte audit independen dilakukan, berikut berstatus `PASS_REPORTED`:

```text
FINAL_REPORTED_SHA=092544f6a0982200366a8551593dafd3864a5317
PR56=OPEN_DRAFT
BACKEND_UNIT=724/724_PASS_REPORTED
FRONTEND_UNIT=86/86_PASS_REPORTED
SAFE_E2E=386/386_PASS_REPORTED
SAFE_E2E_RESIDUAL=PASS_REPORTED
UNIT_KERNEL_SCHEMA_FOUNDATION=PASS_REPORTED
```

Tidak boleh diubah menjadi `PASS_BYTE_AUDITED` tanpa pembacaan repository
langsung.

## 17. Prediksi gap — bukan bukti byte

```text
GOLDEN_THREAD_STEPS_1_TO_4=LIKELY_AVAILABLE_NOT_YET_BYTE_VERIFIED
GOLDEN_THREAD_STEP_5_PLUS=LIKELY_GAP_NOT_YET_BYTE_VERIFIED
ADAPTED_PRICE_VALUE_STATUS=PENDING_BYTE_AUDIT
RAB_COST_SNAPSHOT_STATUS=PENDING_BYTE_AUDIT
UTANG_SNAPSHOT_02=OPEN_REPORTED
```

Prediksi tidak boleh menjadi dasar prompt implementasi.

## 18. Pending register

```text
ASSOCIATION_FINAL_SOURCE_FAMILY=PENDING
CANONICAL_RESOURCE_CODE_STANDARD=PENDING
REGION_HIERARCHY_AND_VERSIONING=PENDING
PUBLIC_PROVENANCE_DETAILED_MATRIX=PENDING
INGESTION_CHANNEL_PERSISTENCE=PENDING_SCHEMA_AUDIT
CONNECTOR_PERSISTENCE_SCHEMA=PENDING_BYTE_AUDIT
CONNECTOR_CREDENTIAL_PLATFORM=PENDING_ARCHITECTURE
SOURCE_SPECIFIC_AUTO_PUBLISH_POLICY=PENDING_DETAILED_MATRIX
INTERNATIONAL_PRICE_CONTRACT=PENDING
IMPORT_FINAL_VISUAL=PENDING_OWNER_APPROVAL
DETAIL_FINAL_VISUAL=PENDING_OWNER_APPROVAL
PRIVATE_PRICE_OWNER_AND_VISIBILITY=PENDING
ORIGINAL_SELLING_UNIT_AND_PACKAGE=PENDING_SCHEMA_AUDIT
COVERAGE_GRANULARITY=PENDING_SCHEMA_AUDIT
DETAIL_PUBLIC_PROJECTION=PENDING
FRESHNESS_DERIVATION_ENGINE=PENDING
SYSTEM_ESTIMATE_DEFAULT_AUDIT=PENDING
PROJECT_SNAPSHOT_FIELD_COMPLETENESS=PENDING
PUBLISHED_OR_REFERENCED_VALUE_ALL_WRITE_PATH_ENFORCEMENT=PENDING
NEEDS_CORRECTION_RESUBMISSION_ENTRYPOINT=PENDING
PROJECT_PRICE_SELECTION_POLICY=PENDING_ARCHITECTURE
UNIT_KERNEL_BYTE_AUDIT=PENDING
ENFORCEMENT_TRACEABILITY_MATRIX=PENDING
```

## 19. Enforcement dan no-patchwork

```text
EVERY_CANONICAL_LAW_MUST_DECLARE_ENFORCEMENT
REVIEW_ONLY=ENFORCEMENT_DEBT
NO_PATCHWORK=YES
NO_DUPLICATED_CANONICAL_RULES=YES
NO_FRONTEND_CANONICAL_DICTIONARY=YES
NO_FAKE_PROVENANCE=YES
NO_SILENT_CONVERSION=YES
NO_HISTORY_OVERWRITE=YES
NO_PARALLEL_BASIC_PRICE_PRODUCT=YES
```

Setiap law id wajib dipetakan ke:

- `IMPLEMENTED | PARTIAL | ABSENT | CONTRADICTS`;
- `TEST | DB_CONSTRAINT | STATIC_AUDIT | RUNTIME_GUARD | REVIEW_ONLY`;
- exact file/line atau runtime evidence;
- debt dan STOP condition.

Master Decision belum boleh Owner-Locked sampai Enforcement Traceability
Matrix tersedia.

## 20. Langkah berikutnya yang diizinkan

```text
NEXT=READ_ONLY_BYTE_AUDIT
TARGET_REF=092544f6a0982200366a8551593dafd3864a5317
MODE=READ_ONLY
DATABASE_WRITE=NO
CODING_AUTHORIZATION=NO
PROMPT_EXECUTOR=NO
MERGE=NO
DETAIL_PAGE_MOCKUP=QUEUED_NOT_CANCELLED
CONNECTOR_IMPLEMENTATION=NOT_ON_CRITICAL_PATH
```

Byte audit harus memetakan:

1. submit → review creation;
2. verify oleh human A;
3. publish oleh human B;
4. published record terlihat di Explorer;
5. Basic Price tersedia untuk AHSP/project resolution;
6. existing RAB cost calculation path;
7. exact snapshot fields yang sudah ada;
8. titik pertama rantai benar-benar patah;
9. Unit Kernel foundation vs runtime dictionary;
10. database lifecycle dan cleanup contract.

Tidak ada agen atau executor yang boleh:

- membuat prompt coding;
- menambah fixture/test;
- mengubah schema/migration;
- merge PR #53/#54/#55/#56;
- mengaktifkan production;
- menerbitkan harga produksi;
- menganggap acceptance proof menutup RM-02;
- menganggap Master Decision sudah locked;

sebelum byte audit selesai dan Owner memberi keputusan berikutnya.

## 21. Kontrak audit semua agen

Setiap review wajib memakai format:

```text
OWNER_LAW_CLAUSE:
EXACT_REPO_OR_SCHEMA_EVIDENCE:
STATUS=EXISTS | PARTIAL | ABSENT | CONTRADICTS
PRODUCT_TRUST_AND_SECURITY_IMPACT:
SCHEMA_OR_MIGRATION_IMPACT:
REQUIRED_ENFORCEMENT:
STOP_CONDITION:
VERDICT=PASS | REVISE | STOP
```

Dilarang:

```text
PROMPT_ONLY_AUDIT
ASSUMPTION_AS_EVIDENCE
FUTURE_CAPABILITY_AS_CURRENT_RUNTIME
SCHEMA_NAME_INVENTION_BEFORE_AUDIT
OWNER_LAW_REINTERPRETATION
```

## 22. Posisi akhir

```text
BLOCKER_1_RM02_GATE=CLOSED_BY_OWNER_GATE_SEPARATION
BLOCKER_2_CONNECTOR_GOVERNANCE=CLOSED_BY_OWNER_PATH_SPECIFIC_POLICY
BASIC_PRICE_IMMUTABLE_WHEN_REFERENCED=OPEN_ENFORCEMENT
OD04_FULL_REFERENCE_CORRECTION=OPEN_BYTE_VERIFICATION
CORRECTION_RESUBMISSION_ENTRYPOINT=OPEN
PROJECT_SELECTION_POLICY_DEFINITION=OPEN
UNIT_KERNEL_BYTE_AUDIT=OPEN
DETAIL_COMPARISON_VISIBILITY_BOUNDARY=CLOSED_BY_OWNER_LAW
ENFORCEMENT_TRACEABILITY_MATRIX=OPEN

MASTER_DECISION_VERSION=3.1
OWNER_ADDENDUM_VERSION=1.1
EXPLICIT_OWNER_DISCUSSION_COVERAGE=COMPLETE_AFTER_RT_ADDENDUM
UNIVERSAL_FUTURE_COMPLETENESS=NOT_CLAIMED
STATUS=DRAFT_FOR_BYTE_AUDIT_AND_MULTI_AI_AUDIT
CODING_AUTHORIZATION=NO
PR56_MERGE=NO
PRODUCTION_ACTIVATION=NO
NEXT=READ_ONLY_BYTE_AUDIT
```

Soli Deo Gloria. Haleluya. Amin.
