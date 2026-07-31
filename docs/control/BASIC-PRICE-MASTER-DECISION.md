# SIMPROK — BASIC PRICE MASTER DECISION

Dalam Nama Tuhan Yesus Kristus. Amin.

```text
DOCUMENT_ID=MASTER-DECISION-BASIC-PRICE-01
CHECKPOINT_ID=CKPT-BASIC-PRICE-MASTER-2026-07-31
MASTER_DECISION_VERSION=3.1
OWNER=FEKY_DE_FRETES
PRODUCT=SIMPROK

STATUS=DRAFT_FOR_OWNER_DECISION_AND_MULTI_AI_AUDIT
OWNER_LOCK=NO
CODING_AUTHORIZATION=NO
PR56_MERGE=NO
PRODUCTION_ACTIVATION=NO
PROMPT_EXECUTOR=NO
```

## 0. Fungsi dokumen

Dokumen ini adalah salinan kendali bersama agar Owner, PM, Arsitek, Gemini,
Meta IA, auditor lain, dan executor membaca baseline Basic Price yang sama.
Dokumen ini **belum Owner-Locked**. Ia merekam Master Decision 3.1, status
implementasi yang dilaporkan, serta temuan audit Arsitek 31 Juli 2026 yang
masih membutuhkan keputusan Owner.

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
sama:

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

Status manusiawi yang dapat diproyeksikan hanya bila lifecycle runtime-nya
benar-benar tersedia:

- Tersimpan untuk Saya;
- Siap Digunakan;
- Diusulkan ke SIMPROK;
- Sedang Dikurasi;
- Perlu Dilengkapi;
- Diterima;
- Tidak Diterima;
- Telah Dipublikasikan.

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
```

Semantik:

```text
effectiveDate <= selectedDate
AND
(validUntil IS NULL OR validUntil >= selectedDate)
```

```text
AS_OF_DATE_RESULT_MODE=SHOW_ALL_ELIGIBLE
SILENT_SINGLE_WINNER_SELECTION=FORBIDDEN
SIMPROK_RECOMMENDATION=OPTIONAL_AND_EXPLAINABLE
HUMAN_FINAL_AUTHORITY=YES
```

Satu resource dapat memiliki banyak harga sah. Explorer tidak boleh
menyembunyikan alternatif. Cost Kernel baru bekerja deterministik setelah
pilihan manusia atau kontrak pemilihan yang telah disahkan Owner tersedia.

## 6. Freshness dan validitas

```text
FRESHNESS_NOT_EQUAL_VERIFICATION
EXPIRED_NOT_EQUAL_INVALID
```

Label:

- `CURRENT` → Terkini;
- `EXPIRING` → Perlu Diperbarui Segera;
- `EXPIRED` → Perlu Verifikasi Ulang.

Connector health, freshness, verification, dan publication adalah sumbu yang
berbeda.

## 7. Histori dan immutability

```text
PUBLISHED_BASIC_PRICE_VALUE_UPDATE=FORBIDDEN
PRICE_CHANGE=NEW_BASIC_PRICE_RECORD
OLD_RECORD=RETAINED
HARD_DELETE_HISTORY=FORBIDDEN
CONNECTED_SOURCE_UPDATE=NEW_EFFECTIVE_RECORD
PREVIOUS_RECORD_VALID_UNTIL=CLOSED
```

Saat dipakai oleh AHSP/RAB, snapshot minimal mempertahankan:

- Basic Price record id;
- nilai;
- satuan jual;
- effective date;
- source version;
- coverage;
- region;
- conversion rule id dan version;
- waktu dan aktor pemilihan.

Feed baru tidak boleh mengubah RAB lama.

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

Pengguna memeriksa exception, bukan semua baris.

Batch pengguna dimiliki akun pengunggah. Anggota lain dalam workspace yang
sama tidak otomatis dapat membaca atau mengubah batch tersebut. Mismatch
account/workspace harus fail-closed tanpa enumeration signal.

## 9. Resource kanonik

```text
MANY_EXTERNAL_NAMES
→ ONE_CANONICAL_RESOURCE
→ MANY_VALID_PRICES
```

```text
USER_CANONICAL_RESOURCE_CODE_INPUT=NOT_REQUIRED
USER_SOURCE_CODE=OPTIONAL_PROVENANCE_ALIAS
INTERNAL_RESOURCE_ID=UUID
CANONICAL_HUMAN_CODE=SYSTEM_CURATED
```

Resource deduplication tidak boleh menggabungkan banyak harga menjadi satu.
Raw input tidak boleh ditimpa diam-diam oleh hasil kurasi.

## 10. Unit Kernel

```text
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

## 11. Empat sumbu sumber

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

## 12. Evidence dan provenance

Evidence mengikuti kombinasi sumber dan kanal. Harga publik tanpa sumber
yang dapat ditelusuri dilarang.

```text
PUBLIC_PRICE_WITHOUT_TRACEABLE_SOURCE=FORBIDDEN
FAKE_SOURCE_NAME=FORBIDDEN
NULL_SOURCE_PUBLICATION=FAIL_CLOSED
PUBLIC_ELIGIBILITY=status:PUBLISHED + verificationStatus:PUBLISHED
```

Harga private tidak boleh bocor ke workspace lain.

## 13. Wilayah

```text
USER_REGION_CODE_INPUT=NOT_REQUIRED
REGION_SELECTION=HUMAN_NAME_AND_HIERARCHY
CANONICAL_REGION_CODE=AUTO_RESOLVED
RAW_LOCATION_TEXT=PRESERVED
```

Arah authority:

- Kemendagri untuk wilayah administratif;
- BPS untuk namespace/klasifikasi statistik.

Masih pending: kedalaman hierarchy, versioning, pemekaran, histori, dan
geospatial boundary reference. Ketidakpastian satu wilayah tidak boleh
menolak seluruh batch.

## 14. Detail Basic Price

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

- histori harga;
- harga sumber lain yang berwenang terlihat;
- wilayah;
- periode;
- coverage;
- conversion explanation;
- rekomendasi SIMPROK;
- alternatif sah tetap terlihat.

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

## 15. Realtime dan connector

```text
REALTIME_IS_MEASURABLE_NOT_MARKETING
AUTO_INGEST ≠ AUTO_VERIFY ≠ AUTO_PUBLISH
CONNECTOR_HEALTH ≠ PRICE_FRESHNESS
```

Trust tier konseptual:

- `OFFICIAL_GOVERNMENT_CONNECTOR`;
- `VERIFIED_PARTNER_CONNECTOR`;
- `APPROVED_WEBSITE_CONNECTOR`;
- `UNVERIFIED_EXTERNAL_SOURCE`;
- `MANUAL_SOURCE`.

Website/aplikasi memerlukan izin dan kontrak yang sah. Unauthorized scraping
dilarang. Feed toko tidak boleh otomatis dipromosikan menjadi harga nasional.
Harga lapangan tidak boleh auto-publish.

Identitas event eksternal minimal:

- externalSourceId;
- externalRecordId;
- externalVersion;
- sourceUpdatedAt;
- observedAt;
- ingestedAt;
- sourceTimezone;
- payloadFingerprint;
- connectorVersion.

```text
SAME_EXTERNAL_RECORD_AND_VERSION=NO_DUPLICATE
REPLAYED_WEBHOOK=IDEMPOTENT
OUT_OF_ORDER_EVENT=MUST_NOT_OVERWRITE_NEWER_HISTORY
OLD_RECORD=RETAINED
NEW_CORRECTION_EVENT=CREATED
LAST_KNOWN_GOOD_RETAINED
SILENT_FALLBACK=FORBIDDEN
ZERO_PRICE_FALLBACK=FORBIDDEN
```

Harga supplier/toko perlu membawa selling unit, package, minimum order,
quantity tier, stock, service region, transport/loading/unloading/delivery,
tax, dan validity. `PRICE_AVAILABILITY ≠ STOCK_AVAILABILITY`.

## 16. Keamanan connector

```text
CONNECTOR_SCHEMA_VERSIONED=YES
UNKNOWN_PAYLOAD_VERSION=FAIL_CLOSED
SILENT_FIELD_REINTERPRETATION=FORBIDDEN
CONNECTOR_CREDENTIAL_IN_REPOSITORY=FORBIDDEN
SECRET_LOGGING=FORBIDDEN
LEAST_PRIVILEGE=MANDATORY
TLS=MANDATORY
SIGNED_WEBHOOK_OR_EQUIVALENT_AUTH=MANDATORY
CONNECTOR_ACTION_AUDITED=YES
```

## 17. Harga internasional

Belum final. International price membutuhkan currency, exchange-rate source
+ timestamp, incoterms, customs/import duties, tax, shipping basis, country
of origin, delivery location, dan timezone.

```text
SILENT_CURRENCY_CONVERSION=FORBIDDEN
EXCHANGE_RATE_MUST_BE_SNAPSHOTTED
INTERNATIONAL_PRICE_PUBLICATION=HOLD
```

## 18. Presisi uang

```text
MONEY_STORAGE=DECIMAL
API_MONEY_VALUE=DECIMAL_STRING
JAVASCRIPT_NUMBER_FOR_MONEY=FORBIDDEN
PARSE_FLOAT_FOR_MONEY=FORBIDDEN
UNARY_PLUS_FOR_MONEY=FORBIDDEN
TO_FIXED_VIA_FLOAT_FOR_MONEY=FORBIDDEN
```

Kebijakan lengkap tidak boleh disalin sebagian. Dokumen implementasi wajib
merujuk langsung ke OD-04 setelah byte dan status Owner Lock-nya diverifikasi.

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

Setiap law id wajib dipetakan ke TEST, DB_CONSTRAINT, STATIC_AUDIT,
RUNTIME_GUARD, atau REVIEW_ONLY dalam Enforcement Traceability Matrix.

## 20. Status repo yang dilaporkan

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

## 21. Pending register Master Decision 3.1

```text
ASSOCIATION_FINAL_SOURCE_FAMILY=PENDING
CANONICAL_RESOURCE_CODE_STANDARD=PENDING
REGION_HIERARCHY_AND_VERSIONING=PENDING
PUBLIC_PROVENANCE_DETAILED_MATRIX=PENDING
INGESTION_CHANNEL_PERSISTENCE=PENDING_SCHEMA_AUDIT
CONNECTOR_PERSISTENCE_SCHEMA=PENDING_BYTE_AUDIT
CONNECTOR_CREDENTIAL_PLATFORM=PENDING_ARCHITECTURE
SOURCE_SPECIFIC_AUTO_PUBLISH_POLICY=PENDING
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
PUBLISHED_VALUE_ALL_WRITE_PATH_ENFORCEMENT=PENDING
```

## 22. Verdict Arsitek 31 Juli 2026

```text
ARCHITECT_VERDICT=NOT_READY_TO_LOCK
CODING_AUTHORIZATION=NO
CLAIMS_386_724_86_AND_UNIT_KERNEL=PASS_REPORTED
```

Temuan Arsitek:

1. urutan §26 tidak menyebut RM-02 exit gate, satu harga nyata, atau satu
   baris RAB hidup;
2. auto-verify/auto-publish connector bertabrakan dengan verifier berbeda
   dari publisher yang hidup pada PR #55;
3. immutability baru disebut untuk PUBLISHED, sedangkan private price dapat
   dipakai RAB;
4. presisi uang mengutip OD-04 sebagian;
5. status “Perlu Dilengkapi” belum mempunyai jalur resubmission hidup;
6. “policy proyek” sebagai pemilih harga belum didefinisikan;
7. Unit Kernel schema vs roadmap perlu dibedakan antara foundation dan
   runtime dictionary;
8. pembanding berisiko membocorkan harga lintas workspace;
9. enforcement belum mempunyai traceability matrix per law.

## 23. Disposisi PM atas temuan Arsitek

```text
FINDING_1=ACCEPTED_OWNER_DECISION_REQUIRED
FINDING_2=ACCEPTED_GOVERNANCE_AMENDMENT_REQUIRED
FINDING_3=ACCEPTED
FINDING_4=ACCEPTED_REFERENCE_OD04_DO_NOT_DUPLICATE
FINDING_5=ACCEPTED
FINDING_6=ACCEPTED_REMOVE_FROM_CURRENT_LOCK
FINDING_7=SHARPENED_FOUNDATION_REPORTED_RUNTIME_NOT_PROVED
FINDING_8=ACCEPTED
FINDING_9=ACCEPTED
```

### 23.1 Exit gate RM-02

Tidak boleh dianggap dicabut karena tidak disebut. Owner harus memutuskan
secara eksplisit apakah urutannya:

- mempertahankan gate dan membuktikan satu harga nyata + satu baris RAB
  sebelum pengerasan lanjutan; atau
- mengamandemen urutan secara tertulis.

### 23.2 Connector auto-publish

Current runtime law tetap:

```text
AUTO_PUBLISH=FORBIDDEN
VERIFIER_MUST_DIFFER_FROM_PUBLISHER=YES
```

Approved connector policy adalah capability masa depan dan tidak menjadi
izin auto-publish sekarang. Solusi final harus mendefinisikan dua-person
connector governance, system-policy identity, per-record provenance, audit,
revocation, dan rollback sebelum mengubah hukum aktif.

### 23.3 Immutability sejak dipakai

Arah koreksi:

```text
BASIC_PRICE_VALUE_UPDATE=FORBIDDEN_WHEN_PUBLISHED_OR_REFERENCED
CORRECTION=NEW_RECORD
EXISTING_SNAPSHOT=RETAINED
```

### 23.4 Status Perlu Dilengkapi

Status tersebut tidak boleh ditampilkan sebagai aksi hidup sampai endpoint
correction/resubmission dan transisi kembali ke review tersedia serta diuji.

### 23.5 Policy proyek

Dihapus dari current locked flow. Keputusan otomatis berbasis policy menjadi
kontrak masa depan:

```text
PROJECT_PRICE_SELECTION_POLICY=PENDING_ARCHITECTURE
SILENT_POLICY_SELECTION=FORBIDDEN
```

### 23.6 Scope pembanding

```text
COMPARABLE_SCOPE=
  GLOBAL_PUBLISHED
  + CURRENT_WORKSPACE_AUTHORIZED
  + CURRENT_ACCOUNT_PRIVATE
CROSS_WORKSPACE_PRIVATE_COMPARISON=FORBIDDEN
```

### 23.7 Enforcement traceability

Master Decision belum boleh dikunci sampai setiap law id memiliki status
`IMPLEMENTED | PARTIAL | ABSENT | CONTRADICTS`, enforcement, bukti, dan debt.

## 24. Urutan kerja sementara

```text
NEXT=OWNER_DECISION_ON_BLOCKERS_1_TO_5
DETAIL_PAGE_MOCKUP=QUEUED_NOT_CANCELLED
PUBLISH_ONE_REAL_PRICE=PROPOSED_BY_ARCHITECT_NOT_AUTHORIZED
CODING_AUTHORIZATION=NO
PR56_MERGE=NO
PRODUCTION_ACTIVATION=NO
```

Tidak ada agen atau executor yang boleh:

- membuat prompt coding;
- mengubah schema/migration;
- merge PR #56;
- mengaktifkan production;
- menerbitkan harga nyata;
- menganggap Master Decision sudah locked;

sebelum Owner memberi keputusan eksplisit.

## 25. Kontrak audit semua agen

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

Soli Deo Gloria. Haleluya. Amin.
