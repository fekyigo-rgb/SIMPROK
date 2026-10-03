# SIMPROK — BASIC PRICE UPDATE & REVISION OWNER LOCK

Dalam Nama Tuhan Yesus Kristus. Amin.

```text
DOCUMENT_ID=BP-UPDATE-REVISION-OWNER-LOCK-2026-08-22
OWNER=FEKY_DE_FRETES
PRODUCT=SIMPROK
DOMAIN=BASIC_PRICE
STATUS=OWNER_LOCKED
EFFECTIVE_AS_OF=2026-08-22
AUTHORITY=OWNER_EXPLICIT_DECISION
PURPOSE=SHARED_GOVERNANCE_FOR_ALL_AI_AGENTS_AND_IMPLEMENTERS
CODING_AUTHORIZATION=NO
MERGE_AUTHORIZATION=NO
RUNTIME_PROMOTION_AUTHORIZATION=NO
```

## 0. Fungsi dan otoritas

Dokumen ini mengunci hukum produk untuk **perubahan, pembaruan, koreksi, revisi, penggantian, dan penarikan Basic Price** setelah harga sudah tersimpan di akun/workspace pribadi atau telah dipublikasikan untuk penggunaan umum.

Dokumen ini wajib dibaca bersama `docs/control/BASIC-PRICE-MASTER-DECISION.md`.

Semua agen IA, PM/Gatekeeper, Chief Architect, auditor, executor, kurator, dan implementer wajib memperlakukan hukum di bawah sebagai **pagar keras**. Area yang sudah sehat tidak boleh dibongkar. Implementasi baru wajib mengikuti hukum ini dan tidak boleh mengarang lifecycle paralel.

Jika terdapat konflik dengan rumusan lama, keputusan eksplisit Owner terbaru di dokumen ini mengalahkan rumusan lama yang bertentangan untuk scope update/revision Basic Price.

---

## 1. Hukum induk — UPDATE BUKAN OVERWRITE

```text
BASIC_PRICE_UPDATE_NOT_EQUAL_OVERWRITE=LOCKED
NEW_PRICE_EQUALS_NEW_OBSERVATION_OR_REVISION=LOCKED
OLD_PRICE_HISTORY_MUST_REMAIN_TRACEABLE=LOCKED
RAW_SOURCE_HISTORY_MAY_NOT_BE_ERASED=LOCKED
PUBLISHED_VALUE_SILENT_OVERWRITE=FORBIDDEN
NO_HISTORY_OVERWRITE=LOCKED
DELETE_TO_HIDE_CORRECTION=FORBIDDEN
```

Basic Price yang sudah digunakan atau dipublikasikan **tidak boleh diedit dengan cara menimpa sejarahnya**.

Contoh:

- Harga lama Rp70.000 tidak diubah diam-diam menjadi Rp73.000.
- SIMPROK menyimpan observasi/revisi baru Rp73.000.
- Harga Rp70.000 tetap dapat ditelusuri sebagai histori.
- Projection current dapat menunjuk Rp73.000 sebagai harga terkini bila seluruh hukum eligibility/authority terpenuhi.

SIMPROK harus selalu mampu menjawab:

> harga ini berasal dari mana, kapan diamati, siapa yang memasukkan atau memperbaiki, mengapa berubah, dan harga mana yang digunakan pada keputusan/RAB saat itu.

---

## 2. Private Basic Price

```text
PRIVATE_BASIC_PRICE_UPDATABLE=YES
PRIVATE_UPDATE_CREATES_NEW_OBSERVATION_OR_REVISION=YES
PRIVATE_ORIGINAL_MUST_REMAIN_TRACEABLE=YES
PRIVATE_HISTORY_SILENT_MUTATION=FORBIDDEN
```

Pemilik/anggota workspace dengan authority yang sah boleh memperbarui Basic Price pribadi.

Perilaku yang diinginkan:

1. user memilih `Perbarui Harga` atau tindakan setara;
2. SIMPROK menampilkan harga lama sebagai referensi;
3. user mengisi hanya fakta yang berubah atau fakta baru;
4. SIMPROK membuat observasi/revisi baru;
5. record lama tetap sebagai histori;
6. projection dapat menandai record baru sebagai `Terkini` bila sah.

Update pribadi tidak boleh menghapus audit trail atau raw evidence lama.

---

## 3. Public / SIMPROK Catalog Basic Price

```text
PUBLIC_BASIC_PRICE_DIRECT_OVERWRITE=FORBIDDEN
PUBLIC_REVISION_REQUIRES_GOVERNED_ADMIN_OR_CURATOR_AUTHORITY=YES
PUBLIC_REVISION_REQUIRES_AUDIT=YES
PUBLIC_REVISION_REQUIRES_REASON=YES
PUBLIC_REVISION_REQUIRES_EVIDENCE_WHERE_APPLICABLE=YES
PUBLIC_CURRENT_TRUTH_MAY_ADVANCE_WITHOUT_ERASING_HISTORY=YES
```

Harga yang sudah dipublikasikan untuk umum **tidak boleh diedit langsung secara destruktif**, termasuk oleh Super Admin SIMPROK.

Admin/Kurator SIMPROK harus memperbarui public truth melalui jalur governed revision/update.

Minimal reason family yang harus dapat dibedakan secara audit:

- harga baru / survei terbaru;
- koreksi kesalahan data;
- sumber menerbitkan revisi;
- penarikan / penghentian penggunaan;
- alasan lain hanya jika kemudian disahkan oleh hukum produk.

Perubahan harga, resource identity, unit, wilayah, sumber/provenance, atau fakta penting lain harus tetap dapat ditelusuri ke nilai sebelumnya.

---

## 4. Proposal pengguna ke SIMPROK tidak mengalihkan kepemilikan private original

```text
PRIVATE_ORIGINAL_AND_PUBLIC_CURATED_RECORD_ARE_DISTINCT=LOCKED
PUBLIC_CURATION_MAY_NOT_SILENTLY_MUTATE_USER_PRIVATE_ORIGINAL=LOCKED
CURATION_REJECTION_DELETES_PRIVATE_ORIGINAL=NO
PUBLIC_REVISION_BACKPROPAGATES_TO_PRIVATE_ORIGINAL=NO
```

Jika user menyimpan harga untuk dirinya lalu memilih `Usulkan ke SIMPROK`:

- private workspace observation tetap milik workspace asal;
- proses kurasi/publication menghasilkan curated/public truth tersendiri;
- penolakan kurasi tidak menghapus private observation;
- perbaikan versi publik tidak boleh diam-diam mengubah private original;
- hubungan provenance antara private proposal dan public curated result boleh disimpan untuk traceability, tetapi bukan overwrite.

---

## 5. Koreksi kesalahan serius

```text
CORRECTION_MUST_BE_TRACEABLE=YES
CORRECTED_RECORD_MAY_BE_REMOVED_FROM_CURRENT_SELECTION_WITHOUT_DELETING_HISTORY=YES
AUDIT_WHO_WHEN_WHY_REQUIRED=YES
```

Jika harga publik ternyata salah, SIMPROK tidak boleh menghapus kesalahan seolah tidak pernah terjadi.

Perilaku yang diinginkan:

- record salah dapat diberi status/projection seperti `Dikoreksi`, `Digantikan`, atau `Ditarik` sesuai lifecycle yang kemudian diratifikasi;
- record koreksi baru menjadi current truth bila sah;
- histori record salah tetap tersedia untuk audit;
- audit minimal harus menjawab siapa, kapan, apa yang berubah, alasan, dan evidence/provenance yang mendukung.

---

## 6. Status pengguna harus sederhana

Internal lifecycle boleh kaya, tetapi permukaan user harus sederhana dan manusiawi.

Target projection dapat menggunakan konsep seperti:

- `Terkini`;
- `Perlu verifikasi ulang`;
- `Digantikan`;
- `Ditarik`.

Nama final status mengikuti lifecycle nyata yang tersedia. UI tidak boleh memproyeksikan status yang belum benar-benar hidup di backend.

```text
RICH_INSIDE_SIMPLE_OUTSIDE=LOCKED
INTERNAL_ENUM_LEAK_TO_USER=FORBIDDEN
```

---

## 7. Siapa yang boleh memperbarui

```text
PRIVATE_UPDATE=WORKSPACE_AUTHORITY_GOVERNED
PUBLIC_UPDATE=SIMPROK_ADMIN_OR_CURATOR_AUTHORITY_GOVERNED
PUBLICATION_OR_PUBLIC_REVISION_HUMAN_AUTHORITY_REQUIRED=YES
```

Untuk private Basic Price:

- hanya actor dengan permission/authority workspace yang sah.

Untuk public SIMPROK Basic Price:

- hanya Admin/Kurator SIMPROK dengan permission khusus yang sah;
- bila hukum publication/revision mensyaratkan separation of duties, orang yang mengajukan revisi dan orang yang menyetujui publikasi revisi dapat berbeda;
- satu admin tidak boleh memperoleh kemampuan silent overwrite karena convenience.

Permission dan role final harus menggunakan RBAC/authority foundation existing. Jangan membuat authorization silo khusus Basic Price revision bila authority existing dapat dipakai.

---

## 8. Live supplier / system integration

```text
LIVE_FEED_UPDATE_CREATES_NEW_OBSERVATION=YES
LIVE_FEED_HISTORY_OVERWRITE=FORBIDDEN
SUPPLIER_PAYLOAD_HISTORY_MUST_REMAIN_TRACEABLE=YES
ADMIN_MANUAL_PRICE_OVERWRITE_FOR_LIVE_FEED=NORMAL_PATH_FORBIDDEN
```

Supplier/toko/pemasok yang terhubung system-to-system dan mengirim harga baru harus menghasilkan **observasi baru**, bukan UPDATE-in-place atas observasi historis.

Jika feed menghasilkan data salah:

- perbaiki status/quality/correction layer atau integrasi sumber sesuai hukum yang sah;
- jangan diam-diam mengubah payload historis supplier.

Supplier manual quotation/upload tetap diperlakukan sebagai snapshot/observation sesuai hukum Basic Price; ia bukan otomatis live feed hanya karena source family-nya supplier.

---

## 9. Time truth tetap terpisah

```text
SYSTEM_INGESTION_TIME_NOT_EQUAL_SOURCE_OBSERVATION_TIME=LOCKED
SOURCE_EFFECTIVE_DATE_NOT_EQUAL_REVIEW_DATE=LOCKED
REVIEW_DATE_NOT_EQUAL_HARD_EXPIRY=LOCKED
VALID_UNTIL_ONLY_FOR_TRUE_HARD_VALIDITY=LOCKED
```

Revision/update harus mempertahankan perbedaan:

- kapan data masuk SIMPROK;
- kapan harga diamati / periode sumber;
- kapan sumber menyatakan mulai berlaku, bila ada;
- kapan perlu verifikasi ulang (`reviewDate`, soft);
- kapan benar-benar tidak berlaku (`validUntil`, hard), bila source-stated.

Update tidak boleh memalsukan chronology agar record baru terlihat lebih segar.

---

## 10. Current projection tidak boleh menghancurkan histori

```text
CURRENT_PRICE_IS_A_PROJECTION_OVER_HISTORY=LOCKED
CURRENT_SELECTION_MUST_BE_EXPLAINABLE=YES
HISTORICAL_RECORDS_REMAIN_QUERYABLE=YES
```

Istilah `Terkini` berarti projection yang menunjukkan observasi/revisi yang saat itu paling relevan/eligible menurut hukum yang sah.

`Terkini` tidak berarti record lama dihapus.

Bila beberapa harga sah masih eligible pada tanggal/wilayah/source yang sama, hukum Basic Price Master tetap berlaku: SIMPROK tidak boleh mengarang silent winner tanpa policy yang sah dan explainable.

---

## 11. Admin SIMPROK — ruang operasional yang wajib tersedia

```text
ADMIN_BASIC_PRICE_REVISION_CAPABILITY=REQUIRED_FUTURE_PRODUCT_SLICE
ADMIN_REVISION_ROOM_MUST_REUSE_EXISTING_BASIC_PRICE_AUTHORITIES=YES
ADMIN_REVISION_ROOM_MAY_NOT_CREATE_PARALLEL_BASIC_PRICE_STORE=YES
```

SIMPROK harus menyediakan ruang operasional bagi Admin/Kurator untuk:

- melihat detail current + history;
- melihat provenance/evidence;
- membuat revisi/update;
- memberi alasan;
- mengoreksi fakta bila authority mengizinkan;
- mengajukan/menyetujui revisi publik sesuai governance;
- menarik current public use bila diperlukan tanpa menghapus histori.

**Namun slice ini tidak otomatis menjadi bagian dari pekerjaan Import Basic Price yang sedang berjalan.** Implementasinya memerlukan prompt/gate terpisah setelah Import closure yang sedang berjalan selesai, kecuali Owner memberi perintah lain.

---

## 12. Import yang dibangun sekarang wajib future-safe

```text
CURRENT_IMPORT_IMPLEMENTATION_MUST_NOT_BLOCK_FUTURE_REVISION=YES
CURRENT_IMPORT_MUST_PRESERVE_SOURCE_AND_AUDIT_IDENTITY=YES
CURRENT_IMPORT_MAY_NOT_ASSUME_ONE_PRICE_RECORD_FOREVER=YES
```

Semua pekerjaan Import Basic Price saat ini wajib menghasilkan data yang kelak dapat direvisi tanpa destructive overwrite.

Jangan membuat shortcut yang mengunci model menjadi:

> satu Resource + satu Region = satu harga mutable selamanya.

Basic Price adalah knowledge/observation history, bukan cell spreadsheet tunggal.

---

## 13. Anti-bongkar-pasang

```text
HEALTHY_EXISTING_ARCHITECTURE_REOPEN=FORBIDDEN_WITHOUT_CONCRETE_CONTRARY_EVIDENCE
PASS_THEN_LOCK=MANDATORY
FAIL_THEN_REPAIR_MINIMUM_SEAM=MANDATORY
HYPOTHETICAL_RISK_IS_NOT_REDESIGN_AUTHORITY=LOCKED
```

Dokumen ini **bukan izin** untuk membangun ulang Basic Price, Resource Identity, Unit Kernel, Region, Import, Explorer, AHSP, RAB, atau Cost Kernel.

Saat implementation gate revision/update dibuka nanti:

1. audit existing schema/service/lifecycle lebih dulu;
2. reuse authority yang sudah ada;
3. hanya tambah seam yang benar-benar terbukti hilang;
4. jangan membangun parallel store/path/lifecycle;
5. test current architecture first;
6. PASS → LOCK;
7. FAIL → repair minimum seam → retest.

---

## 14. Required truth lines untuk semua agent IA

Semua agent yang bekerja pada Basic Price revision/update harus membawa hukum berikut sebagai non-negotiable:

```text
BASIC_PRICE_UPDATE_NOT_EQUAL_OVERWRITE=LOCKED
NEW_PRICE_EQUALS_NEW_OBSERVATION_OR_REVISION=LOCKED
OLD_PRICE_HISTORY_MUST_REMAIN_TRACEABLE=LOCKED
PUBLIC_BASIC_PRICE_DIRECT_OVERWRITE=FORBIDDEN
PRIVATE_ORIGINAL_AND_PUBLIC_CURATED_RECORD_ARE_DISTINCT=LOCKED
PUBLIC_CURATION_MAY_NOT_SILENTLY_MUTATE_USER_PRIVATE_ORIGINAL=LOCKED
LIVE_FEED_UPDATE_CREATES_NEW_OBSERVATION=LOCKED
CURRENT_PRICE_IS_A_PROJECTION_OVER_HISTORY=LOCKED
ADMIN_BASIC_PRICE_REVISION_CAPABILITY=REQUIRED
CURRENT_IMPORT_IMPLEMENTATION_MUST_NOT_BLOCK_FUTURE_REVISION=LOCKED
RICH_INSIDE_SIMPLE_OUTSIDE=LOCKED
```

Jika executor/architect menemukan existing schema yang tampaknya bertentangan dengan hukum ini:

> jangan bongkar langsung;
> tunjukkan exact evidence;
> PM/Gatekeeper + Owner adjudicate;
> repair minimum seam only after authorization.

---

## 15. Owner lock

Dalam Nama Tuhan Yesus Kristus, hukum di dokumen ini dikunci sebagai **Owner Product Law** untuk Basic Price update/revision.

```text
OWNER_LOCK=YES
AI_AGENT_SHARED_REFERENCE=YES
IMPLEMENTATION_NOW=NO_UNLESS_SEPARATELY_AUTHORIZED
MERGE_NOW=NO
CANONICAL_RUNTIME_CHANGE=NO
```

Soli Deo Gloria.
Haleluya.
Amin.
