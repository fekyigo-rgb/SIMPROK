# SIMPROK — Hukum Ruang Transisi, Ruang Interaksi, Sintesis RAB, BOQ Enrichment, dan Ketidakpastian

**Document ID:** `SIMPROK-RAB-TRANSITION-INTERACTION-SYNTHESIS-LAW-V1`  
**Owner:** Feky de Fretes  
**PM / Gatekeeper:** ChatGPT  
**Decision date:** 18 Juli 2026  
**Status:** `OWNER DECIDED — PRODUCT LAW LOCKED; DETAIL TAXONOMY AND RUNTIME IMPLEMENTATION PARTIAL`  
**Repository:** `fekyigo-rgb/SIMPROK`

---

## 1. Tujuan

Dokumen ini mengunci hasil diskusi Owner tentang:

- fungsi `Persiapan RAB / Ruang Transisi RAB`;
- fungsi `Ruang Interaksi SIMPROK`;
- hukum masuk ke `Ruang Kerja RAB`;
- perbedaan perjalanan pengguna yang belum memiliki BOQ dan yang sudah memiliki BOQ;
- perbedaan Template Synthesis, BOQ Enrichment, dan Scoped Recalculation;
- hubungan AHSP, Basic Price, spesifikasi, asumsi metode, Metode Pelaksanaan, dan keputusan manusia;
- cara SIMPROK menghitung RAB secara lengkap tanpa menyembunyikan ketidakpastian;
- bagian yang telah dikunci, bagian yang masih harus dirancang, dan realitas runtime yang belum hidup.

Dokumen ini dibuat agar ChatGPT, Codex, Claude, Claude Code, Gemini, Cursor, Antigravity, dan agent berikutnya tidak mengulang diskusi yang sama, tidak membongkar keputusan lama, dan tidak membuat implementasi yang saling bertentangan.

---

## 2. Dokumen yang Harus Dibaca Bersama

Dokumen ini bukan pengganti hukum SIMPROK yang sudah ada. Ia adalah penajaman dan kelanjutan.

Wajib dibaca bersama:

1. `docs/project-memory/SIMPROK_PROJECT_MEMORY.md`
2. `docs/project-memory/SIMPROK_RAB_PEKERJAAN_NAVIGATION_LIFECYCLE_LAW.md`
3. `docs/project-memory/SIMPROK_PROJECT_RAB_AUTHORITY_UNIT_LAW.md`
4. `docs/project-memory/SIMPROK_BASIC_PRICE_AHSP_IMPLEMENTATION_BLUEPRINT.md`
5. `docs/project-memory/SIMPROK_BASIC_PRICE_AHSP_IMPLEMENTATION_BLUEPRINT_OWNER_LOCK.md`
6. `docs/product-intelligence/P7C_PRODUCT_INTELLIGENCE_LAW.md`
7. realitas source code, database, runtime, dan browser terbaru.

Bila terdapat konflik:

```text
OWNER LOCK TERBARU
→ lebih tinggi daripada ringkasan agent

REPOSITORY REALITY
→ menentukan apa yang benar-benar implemented/live

DESIGN LOCK
≠ SOURCE MERGED
≠ PROCESS LIVE
≠ USER JOURNEY LIVE
≠ PRODUCTION DATA LIVE
```

---

## 3. DNA dan Prinsip Dasar yang Mengikat

```text
DNA_SIMPROK=REDUCE_UNCERTAINTY

SIMPROK_MENGHITUNG
→ MANUSIA_MEMUTUSKAN

SIMPROK_MEREKOMENDASIKAN
→ MANUSIA_MENETAPKAN

SIMPROK_MENYEDIAKAN
→ MANUSIA_MENENTUKAN
```

Maknanya:

1. SIMPROK tidak boleh sekadar menunggu semua data sempurna lalu baru bekerja.
2. SIMPROK tidak boleh mengarang kepastian ketika data belum cukup.
3. SIMPROK harus menyediakan hasil terbaik berdasarkan basis yang dapat ditelusuri.
4. Ketidakpastian harus ditampilkan, dijelaskan, dan dikurangi secara bertahap.
5. Pengguna harus dipermudah, bukan dipaksa mengisi formulir panjang sebelum dapat bekerja.
6. Kecerdasan SIMPROK harus kaya di dalam, tetapi pengalaman pengguna sederhana, tenang, dan profesional di luar.

---

## 4. Kedudukan Empat Ruang Utama

### 4.1 Persiapan RAB / Ruang Transisi RAB

Ruang Transisi adalah tempat pengguna mulai memberikan konteks awal sebelum atau sambil menuju Ruang Kerja RAB.

Fungsinya:

- menampung Data Utama dan Data Opsional;
- menanyakan apakah pengguna sudah mempunyai BOQ;
- menampung konteks awal melalui Ruang Interaksi;
- menentukan perjalanan awal yang tepat;
- menyiagakan mesin SIMPROK;
- bukan pagar yang menahan pengguna masuk ke Ruang Kerja RAB.

### 4.2 Ruang Interaksi SIMPROK

Ruang Interaksi adalah lapisan klarifikasi kontekstual dan opsional.

Fungsinya:

- menggali maksud pekerjaan;
- memperjelas informasi ambigu;
- meningkatkan kualitas rekomendasi AHSP;
- meningkatkan ketepatan Basic Price;
- membantu menyusun spesifikasi;
- membantu memahami kebutuhan material, tenaga, dan alat;
- membantu menghasilkan draft Metode Pelaksanaan setelah konteks dan AHSP semakin jelas;
- mengubah jawaban bermakna menjadi fakta atau keputusan terstruktur.

Ruang Interaksi bukan chatbot kosmetik, bukan syarat masuk, dan bukan pengganti form atau keputusan formal.

### 4.3 Ruang Kerja RAB

Ruang Kerja RAB adalah tempat bekerja dan mengedit Draft RAB.

Pengguna harus dapat masuk walaupun Data Utama belum lengkap atau masih kosong.

Di dalamnya pengguna dapat:

- menyusun secara manual;
- menerima Template RAB dari SIMPROK;
- mengimpor BOQ;
- meninjau preview BOQ;
- memilih atau menerima rekomendasi AHSP;
- melengkapi volume;
- memilih mode SIMPROK atau manual;
- menjalankan kalkulasi ulang secara terarah;
- berinteraksi dengan SIMPROK pada konteks item tertentu;
- menyimpan Draft;
- mempersiapkan review, approval, dan lock sesuai lifecycle dan kewenangan.

### 4.4 RAB Pekerjaan

`RAB Pekerjaan` tetap merupakan rumah permanen lifecycle untuk pekerjaan terkait, sesuai hukum navigasi yang sudah dikunci.

Ruang ini tidak digantikan oleh dokumen ini.

---

## 5. Hukum Masuk ke Ruang Kerja RAB

### 5.1 Keputusan Owner

> **Data Utama tidak boleh menjadi kunci/blokir untuk menahan pengguna masuk ke Ruang Kerja RAB.**

Perilaku wajib:

```text
DATA_KOSONG
→ BOLEH_MASUK_RUANG_KERJA_RAB

DATA_SEBAGIAN
→ BOLEH_MASUK_RUANG_KERJA_RAB
→ ENGINE_SIAGA

DATA_CUKUP
ATAU USER_MENERIMA_ASUMSI_SIMPROK
→ READY_TO_SYNTHESIZE_OR_PROCESS
```

### 5.2 Istilah frontend

Untuk tahap awal, label `Wajib diisi` tidak boleh memberi kesan bahwa seluruh field adalah pagar masuk.

Label yang disarankan:

> **Konteks Utama Pekerjaan — dapat dilengkapi kapan saja**

atau label profesional lain yang memiliki makna sama.

Tanda bintang, bila tetap digunakan, harus memiliki arti berbasis tahap, bukan larangan universal.

### 5.3 Progressive Requirement

Data menjadi wajib sesuai konsekuensi prosesnya:

| Tahap | Hukum kebutuhan data |
|---|---|
| Masuk Ruang Kerja RAB | Tidak boleh diblokir oleh kelengkapan Data Utama |
| Menyalakan engine siaga | Minimal satu informasi bermakna cukup untuk memulai pemahaman awal |
| Meminta Template Synthesis | Konteks minimum cukup atau pengguna menyetujui asumsi SIMPROK |
| Menghitung jumlah item | Volume dibutuhkan; bila belum ada, template dan Harga Satuan tetap dapat tersedia |
| Menentukan harga kontekstual | Lokasi, tahun harga, dan sumber dibutuhkan atau harus memakai basis sementara bertanda |
| Review | Semua ketidakpastian dan basis nilai harus terlihat |
| Approval/Lock | Ketidakpastian kritis harus diselesaikan atau diterima oleh manusia berwenang |

---

## 6. Engine Readiness — Siaga Tidak Sama dengan Mengarang Hasil

Keputusan Owner bahwa pengisian data membuat mesin aktif harus diterjemahkan dengan aman:

```text
BELUM_ADA_DATA
→ ENGINE_IDLE_BUT_WORKSPACE_AVAILABLE

ADA_INFORMASI_BERMAKNA
→ ENGINE_STANDBY

KONTEKS_MINIMUM_CUKUP
→ ENGINE_READY

USER_MEMILIH_GUNAKAN_ASUMSI_SIMPROK
→ ENGINE_READY_WITH_DISCLOSED_ASSUMPTIONS
```

Satu kolom terisi tidak otomatis memberikan izin kepada SIMPROK untuk mengarang RAB final.

Satu kolom terisi berarti:

- engine mulai membaca;
- klasifikasi awal dapat dimulai;
- kandidat template dapat disiapkan;
- Ruang Interaksi dapat mengajukan klarifikasi yang relevan;
- sistem dapat menunjukkan apa yang masih kurang;
- pengguna tetap dapat masuk dan bekerja.

---

## 7. Pertanyaan Awal yang Wajib Ada: Status BOQ

Ruang Transisi harus membedakan perjalanan awal pengguna.

Contoh pilihan:

```text
BAGAIMANA_ANDA_INGIN_MEMULAI?

1. SAYA_BELUM_MEMPUNYAI_BOQ
2. SAYA_SUDAH_MEMPUNYAI_BOQ
3. BELUM_YAKIN_BANTU_SAYA_MENENTUKAN
```

Pilihan ini mengubah proses backend/orchestrator, bukan sekadar teks atau tampilan.

---

## 8. Jalur A — Pengguna Belum Mempunyai BOQ

### 8.1 Tujuan

SIMPROK membantu menghasilkan Template RAB yang lengkap secara struktur dan kecerdasan, bukan sekadar tabel kosong.

### 8.2 Alur utama

```text
BELUM_PUNYA_BOQ
→ DATA_UTAMA_OPSIONAL_DAN_INTERAKSI
→ LANJUT_KE_RUANG_KERJA_RAB
→ TEMPLATE_SYNTHESIS
→ RAB_DRAFT_READY_OR_NEEDS_REVIEW
```

### 8.3 Hasil Template Synthesis

Berdasarkan informasi yang tersedia, Template RAB dapat berisi:

- WBS/struktur pekerjaan;
- kelompok/subjudul;
- item pekerjaan;
- satuan;
- kandidat atau rekomendasi AHSP;
- Harga Satuan berdasarkan basis terbaik yang tersedia;
- resource tenaga, material, dan alat;
- tanda ketidakpastian;
- catatan asumsi;
- volume kosong untuk dilengkapi pengguna;
- rekomendasi volume hanya bila ada basis yang sah.

### 8.4 Bila konteks cukup

Template dapat disusun otomatis saat pengguna melanjutkan ke Ruang Kerja RAB.

### 8.5 Bila konteks belum cukup

Pengguna tetap masuk ke Ruang Kerja RAB dan diberi pilihan:

```text
[SUSUN_DENGAN_REKOMENDASI_SIMPROK]
[TAMBAHKAN_INFORMASI]
[MULAI_MANUAL]
```

Tidak boleh ada dead end.

### 8.6 Volume

Bila volume belum tersedia:

- SIMPROK tetap dapat menghasilkan struktur, AHSP, Harga Satuan, resource, dan status;
- `Jumlah = Volume × Harga Satuan` belum dapat lengkap sampai volume tersedia;
- ketiadaan volume harus ditampilkan jujur;
- SIMPROK tidak boleh mengarang volume tanpa basis.

---

## 9. Jalur B — Pengguna Sudah Mempunyai BOQ

### 9.1 Hukum utama

Ketika pengguna menyatakan sudah mempunyai BOQ, masuk ke Ruang Kerja RAB **tidak boleh langsung memicu Template Synthesis**.

State awal:

```text
HAS_EXISTING_BOQ
→ BOQ_WAITING_FOR_INPUT
```

### 9.2 Alur utama

```text
SUDAH_PUNYA_BOQ
→ MASUK_RUANG_KERJA_RAB
→ INPUT_OR_IMPORT_BOQ
→ PREVIEW_BOQ_ASLI
→ USER_MEMERIKSA
→ USER_MENEKAN_SETUJUI_DAN_PROSES
→ BOQ_ENRICHMENT
→ RAB_DRAFT_READY_OR_NEEDS_REVIEW
```

### 9.3 Sebelum persetujuan

SIMPROK boleh:

- membaca file;
- membuat preview;
- menunjukkan error parsing;
- menampilkan normalisasi yang akan dilakukan;
- meminta koreksi struktur.

SIMPROK tidak boleh diam-diam menafsirkan dan mengubah BOQ menjadi RAB sebelum pengguna menyetujui preview.

### 9.4 Setelah persetujuan

BOQ Enrichment dapat:

- mempertahankan BOQ asli sebagai sumber;
- mengklasifikasikan setiap item;
- menormalisasi satuan;
- memahami domain dan jenis pekerjaan;
- menemukan kandidat AHSP;
- merekomendasikan AHSP;
- menghubungkan Basic Price;
- menghitung Harga Satuan dan Jumlah;
- menunjukkan resource;
- memberi tanda pada bagian ambigu;
- membuat daftar keputusan yang perlu diperiksa.

---

## 10. Tiga Proses Mesin yang Berbeda

Satu fungsi besar bernama `render` dilarang menjadi implementasi universal.

### 10.1 Template Synthesis

Untuk pengguna yang belum mempunyai BOQ.

```text
PROJECT_CONTEXT
→ TEMPLATE_RAB
```

Label pengguna yang disarankan:

> **Susun Template RAB dengan SIMPROK**

### 10.2 BOQ Enrichment

Untuk pengguna yang telah mempunyai BOQ.

```text
USER_BOQ_APPROVED
→ ENRICHED_RAB
```

Label pengguna yang disarankan:

> **Setujui & Proses BOQ dengan SIMPROK**

### 10.3 Scoped Recalculation

Untuk perubahan setelah RAB terbentuk.

Pemicu dapat berupa:

- perubahan volume;
- perubahan AHSP;
- perubahan Basic Price;
- perubahan spesifikasi;
- perubahan Execution Factor;
- item baru;
- perubahan konteks yang berdampak pada kalkulasi.

Scope yang diperbolehkan:

```text
SELURUH_RAB
BAGIAN_PEKERJAAN
ITEM_TERPILIH
ITEM_BARU
```

Label pengguna yang disarankan:

- `Hitung Ulang Seluruh RAB`;
- `Proses Bagian Ini`;
- `Hitung Item Terpilih`;
- `Hitung Item Baru dengan SIMPROK`.

Scoped Recalculation harus lebih diutamakan daripada memproses ulang seluruh RAB tanpa kebutuhan.

---

## 11. Mode SIMPROK dan Mode Manual

SIMPROK tidak boleh memaksa semua item dihitung melalui mesin.

Setiap item dapat memiliki sumber nilai yang jelas:

```text
SIMPROK_CALCULATED
MANUAL
IMPORTED
USER_CONFIRMED
```

### 11.1 Mode SIMPROK

```text
AHSP
→ BASIC_PRICE
→ UNIT_RESOLUTION
→ EXECUTION_FACTOR_BILA_ADA
→ COST_KERNEL
→ HARGA_SATUAN
→ JUMLAH
```

### 11.2 Mode manual

Pengguna dapat mengisi nilai secara manual sesuai kewenangan.

Wajib diberi label jujur:

> **Harga Manual — tidak dihitung oleh Cost Kernel SIMPROK**

### 11.3 Larangan dua sumber kebenaran

- nilai manual tidak boleh diam-diam menimpa nilai SIMPROK;
- nilai SIMPROK tidak boleh diam-diam menimpa nilai manual;
- perubahan mode harus eksplisit dan tercatat;
- recap harus mengetahui sumber setiap angka.

---

## 12. Ruang Interaksi — Opsional, Kontekstual, dan Produktif

### 12.1 Tidak wajib

```text
RUANG_INTERAKSI=OPSIONAL

TIDAK_BERINTERAKSI
→ RAB_DRAFT_TETAP_DAPAT_DIHASILKAN

SEMAKIN_AKTIF_BERINTERAKSI
→ PEMAHAMAN_DAN_KETEPATAN_MENINGKAT
```

### 12.2 Nada komunikasi

Pertanyaan SIMPROK harus:

- sopan;
- tenang;
- lemah lembut;
- tidak menginterogasi;
- tidak mendesak;
- menjelaskan alasan bertanya;
- menjelaskan dampaknya;
- menawarkan rekomendasi awal;
- selalu menyediakan pilihan `Bahas nanti` bila tidak kritis untuk tindakan saat itu.

Contoh pola:

> “Saya menemukan bagian yang mungkin perlu diperjelas agar hasilnya semakin sesuai dengan maksud Bapak. Untuk pekerjaan ini saya sementara menggunakan pilihan A karena paling sesuai dengan informasi yang tersedia. Apakah pilihan tersebut ingin digunakan, dilihat alternatifnya, atau dibahas nanti?”

### 12.3 Pertanyaan harus bernilai

SIMPROK hanya bertanya bila jawaban dapat:

- mengubah kandidat AHSP;
- mengubah spesifikasi;
- mengubah Basic Price;
- mengubah kebutuhan material, tenaga, atau alat;
- mengubah asumsi penerapan formula;
- mengubah Execution Factor;
- mengurangi risiko;
- meningkatkan kepastian;
- memengaruhi kelayakan approval/lock.

### 12.4 Konteks pertanyaan

Setiap pertanyaan harus terikat pada satu atau lebih konteks:

- project;
- WBS;
- BOQ item;
- AHSP candidate/application;
- AHSP resource;
- Basic Price;
- spesifikasi;
- kondisi lapangan;
- dokumen Metode Pelaksanaan;
- ketidakpastian tertentu.

Pengguna tidak boleh dipaksa menjelaskan ulang konteks yang sudah diketahui sistem.

### 12.5 Jawaban harus menjadi data terstruktur

Jawaban bermakna tidak boleh berhenti sebagai teks chat.

Contoh:

```text
DECISION_TYPE=CONCRETE_SUPPLY_METHOD
VALUE=READY_MIX
SOURCE=USER_CONFIRMED
APPLIES_TO=BOQ_ITEM_ID
DECIDED_BY=ACCOUNT_ID
DECIDED_AT=TIMESTAMP
```

atau:

```text
FACT_TYPE=PROJECT_ACCESS_CONDITION
VALUE=NARROW_ACCESS
SOURCE=USER_INTERACTION
APPLIES_TO=PROJECT_ID
```

Teks percakapan dapat disimpan sebagai audit/evidence, tetapi mesin harus menggunakan fakta/keputusan terstruktur.

### 12.6 Larangan

Ruang Interaksi tidak boleh:

- mengulang pertanyaan yang sudah dijawab;
- bertanya tentang fakta yang sudah dapat dibaca;
- memaksa semua pertanyaan selesai sebelum pengguna bekerja;
- mengubah keputusan tanpa persetujuan;
- menyembunyikan asumsi;
- menghasilkan percakapan panjang tanpa perubahan state/data;
- menghentikan RAB hanya karena data opsional belum tersedia;
- menjadi satu-satunya cara mengoperasikan SIMPROK.

---

## 13. Hukum Perhitungan Lengkap dan Ketidakpastian

### 13.1 Koreksi terhadap pernyataan lama

Pernyataan berikut dinyatakan `SUPERSEDED`:

> “AHSP boleh dipilih sebelum seluruh resource resolved, tetapi belum boleh dihitung.”

Kalimat tersebut terlalu mudah dimaknai bahwa SIMPROK berhenti menghitung ketika ada ketidakpastian.

### 13.2 Hukum baru

> **SIMPROK harus menghasilkan RAB Draft secara lengkap berdasarkan basis terbaik yang tersedia dan dapat ditelusuri. Ketidakpastian tidak boleh disembunyikan, tetapi tidak selalu menghentikan perhitungan.**

### 13.3 Tidak boleh menghitung sebagian lalu menyebutnya lengkap

Dilarang:

- menghilangkan resource wajib yang belum pasti;
- memberi harga nol agar kalkulasi lolos;
- hanya menjumlahkan resource yang tersedia lalu menyebutnya Harga Satuan lengkap;
- memilih angka tanpa sumber atau alasan;
- menyembunyikan status referensi/asumsi;
- menganggap angka sementara sebagai angka terverifikasi.

### 13.4 Basis nilai yang dapat dipakai pada Draft

Setiap resource wajib harus mempunyai nilai yang memiliki basis dan jejak, misalnya:

- VERIFIED;
- USER_SELECTED;
- GOVERNMENT_REFERENCE;
- SUPPLIER_REFERENCE;
- FIELD_REPORTED;
- NEAREST_REGION_REFERENCE;
- SIMPROK_RECOMMENDED_ASSUMPTION;
- sumber sah lain yang dijelaskan.

Basis tersebut tidak semuanya memiliki tingkat kepastian yang sama.

### 13.5 Calculation Ready dan Baseline Ready

```text
CALCULATION_READY
→ seluruh resource wajib memiliki nilai berbasis dan dapat ditelusuri
→ RAB Draft dapat dihitung lengkap

BASELINE_READY
→ ketidakpastian kritis diselesaikan
ATAU
→ diterima secara eksplisit oleh manusia berwenang
→ RAB dapat diajukan untuk approval/lock
```

### 13.6 Tingkat tanda ketidakpastian

Konsep warna/status berikut dikunci sebagai arah UX; nama final dan desain visual dapat dipertajam kemudian:

```text
HIJAU
→ dihitung dan terverifikasi

KUNING
→ dihitung dengan referensi/asumsi wajar; perlu diperiksa

MERAH
→ dihitung, tetapi ada keputusan penting yang wajib diselesaikan atau diterima sebelum approval/lock

BLOKIR
→ tidak ada basis angka yang dapat dipertanggungjawabkan; SIMPROK dilarang mengarang
```

Merah tidak otomatis berarti tidak ada harga. Merah berarti ketidakpastian penting masih hidup.

Blokir adalah pilihan terakhir bila tidak ada basis yang sah sama sekali.

### 13.7 Pengguna tidak menjawab

```text
AMBIGUITAS_ADA
DAN USER_TIDAK_MENJAWAB
→ gunakan rekomendasi terbaik yang dapat dijelaskan
→ hitung lengkap bila seluruh resource mempunyai basis
→ beri status dan catatan
→ masukkan ke daftar pemeriksaan
→ jangan klaim user confirmed
```

---

## 14. AHSP — Penajaman Tanpa Membongkar Hukum Lama

Keputusan lama tetap berlaku:

- AHSP adalah formula/metode kerja berotoritas;
- AHSPVersion immutable;
- Basic Price menyesuaikan satuan yang diminta AHSP;
- occurrence adalah snapshot kontekstual setiap penerapan;
- SIMPROK merekomendasikan;
- manusia memilih/menetapkan;
- Cost Kernel menghitung;
- baseline resmi immutable.

Penajaman hari ini tidak membatalkan hukum tersebut.

### 14.1 Domain/bidang

Bidang seperti:

- Bina Marga;
- Cipta Karya;
- Sumber Daya Air;
- Umum;
- bidang lain;

adalah konteks keterterapan AHSP, bukan satu-satunya identitas AHSP.

Hukum:

1. Nama pekerjaan sama tidak otomatis berarti AHSP sama.
2. Total Harga Satuan sama tidak otomatis berarti AHSP identik.
3. Perbedaan formula, resource, coefficient, unit, output unit, standar, atau asumsi penerapan dapat berarti AHSP berbeda.
4. Satu AHSP yang benar-benar sama boleh berlaku untuk beberapa bidang.
5. Jangan menduplikasi formula hanya karena bidang berbeda.
6. Jangan auto-match berdasarkan nama, mutu, bidang, atau total harga saja.
7. Satu paket dapat multidisiplin; bidang utama project tidak selalu sama dengan konteks semua item.

Exact schema dan taxonomy domain masih harus melalui architecture gate tersendiri.

### 14.2 Jenis pekerjaan

Jenis pekerjaan menjawab pekerjaan apa yang sebenarnya dihitung.

SIMPROK boleh mengklasifikasikan dan merekomendasikan, tetapi bila ambigu pengguna dapat memilih atau mengoreksi.

Exact canonical Work Type taxonomy belum dikunci dalam dokumen ini.

### 14.3 Spesifikasi

Spesifikasi dapat berada dalam tiga keadaan:

```text
SPEC_KNOWN
SPEC_PARTIAL
SPEC_NOT_PROVIDED
```

Hukum:

- spesifikasi yang sudah tersedia menjadi constraint nyata;
- spesifikasi yang belum tersedia tidak boleh membuat pengguna dilarang masuk atau bekerja;
- SIMPROK dapat menawarkan spesifikasi lazim dan menjelaskan dampaknya;
- pilihan sementara harus diberi status;
- dokumen Spesifikasi Teknis final dapat terbentuk dan disempurnakan sepanjang proses;
- fakta spesifikasi dan dokumen Spesifikasi Teknis tidak boleh dianggap hal yang sama.

### 14.4 Metode

Harus dibedakan:

```text
AHSP_METHOD_ASSUMPTION
≠
FINAL_PROJECT_METHOD_STATEMENT
```

- AHSP dapat membawa asumsi formula/metode penerapan, misalnya manual/mekanis, ready-mix/site-mix, alat tertentu, atau kondisi normal.
- Asumsi tersebut dapat digunakan untuk menjelaskan kandidat AHSP.
- Dokumen Metode Pelaksanaan final tidak harus ada sebelum memilih AHSP.
- Metode Pelaksanaan final lahir setelah BOQ, AHSP terpilih, spesifikasi, kondisi lokasi, resource, alat, Execution Factor, urutan kerja, dan keputusan manusia semakin jelas.

Jadi SIMPROK tidak boleh meminta dokumen Metode Pelaksanaan final sebagai prasyarat universal untuk memilih AHSP.

### 14.5 Output unit

`BoqItem.unit` harus kompatibel dengan `AHSPVersion.outputUnit` melalui hukum Unit Kernel yang sudah ada.

Resource unit di dalam AHSP boleh berbeda dari output unit.

Unit mismatch yang nyata harus fail-closed; alias yang sah harus dinormalisasi.

### 14.6 Standar/referensi/versi

Setiap AHSP harus memiliki provenance yang jujur:

- sumber;
- dokumen acuan;
- kode/tahun;
- version;
- ownership;
- review status;
- konteks berlaku.

Referensi lama atau nonpemerintah tidak otomatis dibuang, tetapi status dan asal-usulnya tidak boleh disembunyikan.

### 14.7 Resource dan Basic Price

AHSP dapat ditemukan, direkomendasikan, atau dipilih sebelum semua harga berstatus VERIFIED.

Agar dapat dihitung lengkap, setiap resource wajib harus memiliki nilai berbasis dan dapat ditelusuri.

Status verifikasi harga memengaruhi tingkat kepastian dan kesiapan baseline, bukan izin untuk menghitung secara parsial.

### 14.8 Manusia mengonfirmasi keputusan bermakna

Konfirmasi manusia diperlukan pada titik yang memiliki konsekuensi, misalnya:

- klasifikasi pekerjaan ambigu;
- spesifikasi penting belum jelas;
- pemilihan AHSP;
- penerimaan/override Basic Price;
- penerimaan asumsi penting;
- review;
- approval/lock.

Pengguna tidak harus mengonfirmasi setiap operasi teknis kecil.

---

## 15. State Machine Pengalaman Pengguna

State yang dikunci sebagai bahasa produk/arsitektur:

```text
PREPARATION_EMPTY
→ ruang kerja dapat dibuka

PREPARATION_PARTIAL
→ engine siaga

NO_BOQ_READY_TO_SYNTHESIZE
→ template dapat disusun

NO_BOQ_NEEDS_CONTEXT_OR_ASSUMPTION
→ user tetap masuk; pilih rekomendasi, tambah konteks, atau manual

HAS_BOQ_WAITING_FOR_INPUT
→ tidak ada auto-synthesis

BOQ_PREVIEW_WAITING_APPROVAL
→ BOQ sudah dibaca; belum diproses menjadi RAB

BOQ_APPROVED_FOR_ENRICHMENT
→ engine boleh memperkaya dan menghitung

RAB_DRAFT_READY
→ RAB terbentuk dan dapat diedit

RAB_NEEDS_REVIEW
→ RAB dihitung lengkap; ada tanda ketidakpastian

BASELINE_READY
→ keputusan kritis diselesaikan/diterima sesuai kewenangan
```

Nama enum/backend final dapat berbeda, tetapi makna state tidak boleh hilang atau dicampur.

---

## 16. Hukum Data dan Auditability

### 16.1 Data terstruktur

Lokasi, bidang, status BOQ, spesifikasi, konteks, dan keputusan pengguna tidak boleh selamanya hanya dirangkai menjadi satu `Project.description`.

`description` dapat tetap menjadi narasi manusia, tetapi mesin membutuhkan data terstruktur.

### 16.2 Evidence dan keputusan

Sistem harus mampu menjawab:

- siapa memberikan informasi;
- kapan;
- melalui form, import, atau Ruang Interaksi;
- berlaku untuk project/bagian/item mana;
- apakah fakta, asumsi, rekomendasi, atau keputusan;
- apakah user confirmed;
- apa dampaknya;
- versi kalkulasi mana yang menggunakannya.

### 16.3 Tidak ada perubahan tersembunyi

SIMPROK tidak boleh diam-diam:

- mengganti BOQ asli;
- memilih AHSP final;
- mengubah mode manual;
- menerima asumsi atas nama pengguna;
- menimpa nilai;
- menghilangkan tanda ketidakpastian.

---

## 17. Realitas Runtime yang Dibuktikan pada 18 Juli 2026

Source `frontend/src/pages/ProjectSetupPage.tsx` saat ini menunjukkan:

1. daftar sembilan field diberi nama `requiredPreparationFields`;
2. UI menampilkan label `Wajib diisi`;
3. validasi tombol saat ini benar-benar menolak bila Nama Proyek kosong, Kategori belum dipilih, atau Bidang belum dipilih untuk kategori konstruksi;
4. `Kirim Konteks` hanya mengubah status lokal menjadi `Engine belum aktif`; konteks belum diproses;
5. belum ada pilihan sudah/belum mempunyai BOQ;
6. tombol `Lanjut ke Ruang Kerja RAB` selalu membuat Draft Project lalu menavigasi ke workspace;
7. belum ada Template Synthesis;
8. belum ada BOQ Enrichment;
9. sebagian besar konteks disusun menjadi teks `Project.description`, bukan data terstruktur.

Status:

```text
RUANG_TRANSISI_VISUAL=AVAILABLE
UNCONDITIONAL_WORKSPACE_ENTRY=NOT_IMPLEMENTED
BOQ_JOURNEY_SELECTOR=NOT_IMPLEMENTED
RUANG_INTERAKSI_ENGINE=NOT_IMPLEMENTED
TEMPLATE_SYNTHESIS=NOT_IMPLEMENTED
BOQ_ENRICHMENT=NOT_IMPLEMENTED
STRUCTURED_CONTEXT=INSUFFICIENT
CURRENT_RUNTIME=HONEST_UI_SHELL_NOT_FULL_PRODUCT_ENGINE
```

Dokumen ini tidak mengklaim fitur-fitur tersebut hidup.

---

## 18. Bagian yang Sudah Dikunci

```text
LOCKED_01
DATA_UTAMA_TIDAK_BOLEH_MEMBLOKIR_MASUK_RUANG_KERJA_RAB

LOCKED_02
RUANG_INTERAKSI_OPSIONAL_TETAPI_KONTEKSTUAL_DAN_PRODUKTIF

LOCKED_03
JAWABAN_BERMAKNA_HARUS_MENJADI_DATA_ATAU_KEPUTUSAN_TERSTRUKTUR

LOCKED_04
BELUM_PUNYA_BOQ_DAN_SUDAH_PUNYA_BOQ_ADALAH_DUA_PERJALANAN_BERBEDA

LOCKED_05
TANPA_BOQ_DAPAT_MEMICU_TEMPLATE_SYNTHESIS

LOCKED_06
DENGAN_BOQ_MENUNGGU_INPUT_PREVIEW_DAN_PERSETUJUAN_SEBELUM_ENRICHMENT

LOCKED_07
TEMPLATE_SYNTHESIS_BOQ_ENRICHMENT_DAN_SCOPED_RECALCULATION_TIDAK_BOLEH_DICAMPUR

LOCKED_08
MODE_MANUAL_DAN_MODE_SIMPROK_HARUS_JUJUR_DAN_TIDAK_SALING_MENIMPA

LOCKED_09
SIMPROK_TIDAK_BOLEH_MENGHITUNG_SEBAGIAN_LALU_MENYEBUTNYA_LENGKAP

LOCKED_10
RAB_DRAFT_DAPAT_DIHITUNG_DENGAN_BASIS_TERLACAK_DAN_TANDA_KETIDAKPASTIAN

LOCKED_11
KETIDAKPASTIAN_KRITIS_HARUS_DISELESAIKAN_ATAU_DITERIMA_SEBELUM_LOCK

LOCKED_12
METODE_PELAKSANAAN_FINAL_LAHIR_SETELAH_AHSP_DAN_KONTEKS_SEMAKIN_JELAS

LOCKED_13
SPESIFIKASI_DAPAT_SUDAH_ADA_SEBAGIAN_ATAU_BELUM_ADA

LOCKED_14
AHSP_DAPAT_BERLAKU_LINTAS_BIDANG_BILA_FORMULA_DAN_KETERTERAPANNYA_SAMA

LOCKED_15
NAMA_ATAU_TOTAL_HARGA_SAMA_TIDAK_MEMBUKTIKAN_AHSP_IDENTIK

LOCKED_16
SIMPROK_MEREKOMENDASIKAN_MANUSIA_MENETAPKAN
```

---

## 19. Bagian yang Belum Dikunci Secara Detail

Bagian berikut belum boleh diimplementasikan berdasarkan tebakan agent:

1. exact minimum context untuk Template Synthesis per jenis proyek;
2. Katalog Ambiguitas final;
3. taxonomy Work Domain final;
4. taxonomy Work Type final;
5. exact schema untuk structured project facts dan decisions;
6. exact API Ruang Interaksi;
7. exact confidence scoring;
8. nama enum/status backend final;
9. visual warna/icon final;
10. exact permission mapping per role;
11. model AI dan orchestration teknis final;
12. aturan generasi volume;
13. batas performa dan job processing;
14. exact approval policy untuk menerima ketidakpastian merah;
15. exact integrasi Execution Factor.

Status:

```text
DIRECTION_LOCKED
DETAIL_ARCHITECTURE_REQUIRED
DO_NOT_GUESS
```

---

## 20. Katalog Ambiguitas — Agenda Lanjutan

Owner dan PM akan membahas secara terpisah bagian yang selalu berpotensi ambigu dalam:

- pemilihan AHSP;
- penciptaan Spesifikasi Teknis;
- penentuan Basic Price;
- kebutuhan material;
- kebutuhan tenaga kerja;
- kebutuhan alat;
- logistik;
- kondisi akses;
- risiko/cuaca;
- Execution Factor;
- pembuatan Metode Pelaksanaan.

Keluarga awal yang dapat diaudit, tetapi belum merupakan taxonomy final:

- scope dan batas pekerjaan;
- jenis pekerjaan;
- bidang/keterterapan;
- mutu dan spesifikasi;
- unit/output unit;
- asumsi formula AHSP;
- standard/reference/version;
- resource mapping;
- sumber/lokasi/tanggal harga;
- alat dan produktivitas;
- akses/logistik;
- inclusions/exclusions;
- volume dan pengukuran;
- kondisi lapangan.

Setiap ambiguity type nantinya harus memiliki:

- alasan deteksi;
- dampak;
- pertanyaan elegan;
- rekomendasi awal;
- opsi `Bahas nanti`;
- state terstruktur;
- pengaruh terhadap kalkulasi;
- pengaruh terhadap baseline readiness.

---

## 21. Larangan untuk Agent dan Implementer

Dilarang:

1. mengembalikan Data Utama sebagai pagar masuk universal;
2. memaksa pengguna memakai Ruang Interaksi;
3. menjadikan chat sebagai teks yang tidak memengaruhi data;
4. menjalankan Template Synthesis bagi pengguna yang sudah mempunyai BOQ sebelum persetujuan;
5. mengubah BOQ asli diam-diam;
6. membangun satu universal render function untuk semua perjalanan;
7. memproses ulang seluruh RAB bila hanya satu item berubah tanpa alasan;
8. menyembunyikan sumber nilai/asumsi;
9. menghitung sebagian dan menyebut hasil lengkap;
10. mengisi nol untuk resource yang belum mempunyai basis;
11. menganggap spesifikasi selalu tersedia;
12. meminta Metode Pelaksanaan final sebagai prasyarat universal memilih AHSP;
13. menduplikasi AHSP hanya karena bidang berbeda;
14. menyamakan AHSP hanya karena nama atau total harga sama;
15. mengklaim engine hidup hanya karena UI tersedia;
16. membongkar hukum AHSP, Basic Price, Unit Kernel, Cost Kernel, lifecycle, atau baseline yang sudah dikunci.

---

## 22. Retrieval Rule untuk Semua Agent IA

Sebelum memberi rekomendasi, menulis prompt, merancang schema, mengubah frontend/backend, atau mengklaim status implementasi terkait Persiapan RAB, Ruang Interaksi, template, BOQ, AHSP, Basic Price, spesifikasi, Metode Pelaksanaan, render, atau ketidakpastian:

1. baca `AGENTS.md`;
2. baca `SIMPROK_PROJECT_MEMORY.md`;
3. baca `SIMPROK_RAB_PEKERJAAN_NAVIGATION_LIFECYCLE_LAW.md`;
4. baca dokumen ini;
5. baca `SIMPROK_PROJECT_RAB_AUTHORITY_UNIT_LAW.md`;
6. baca Basic Price–AHSP Blueprint dan Owner Lock;
7. audit repository/runtime/browser terbaru;
8. pisahkan FACT, OWNER LOCK, INFERENCE, RECOMMENDATION, dan RUNTIME REALITY;
9. jangan mengganti keputusan Owner berdasarkan mayoritas pendapat agent;
10. bila masih ambigu, laporkan ambiguity dan exact decision needed—jangan mengarang.

---

## 23. Handoff Ringkas

```text
DOCUMENT_ID=SIMPROK-RAB-TRANSITION-INTERACTION-SYNTHESIS-LAW-V1
STATUS=OWNER_DECIDED_PRODUCT_LAW_LOCKED_RUNTIME_PARTIAL

WORKSPACE_ENTRY_BLOCKED_BY_DATA=NO
DATA_MAIN_ROLE=IMPROVE_CONTEXT_NOT_GATE_ENTRY
ENGINE_AFTER_FIRST_MEANINGFUL_INPUT=STANDBY

RUANG_INTERAKSI=OPTIONAL_CONTEXTUAL_STRUCTURED

NO_BOQ_PATH=TEMPLATE_SYNTHESIS
HAS_BOQ_PATH=IMPORT_PREVIEW_APPROVE_THEN_BOQ_ENRICHMENT

POST_RAB_PROCESS=SCOPED_RECALCULATION
MANUAL_MODE=SUPPORTED_AND_LABELED

RAB_DRAFT_CALCULATION=COMPLETE_WITH_TRACEABLE_BASIS
PARTIAL_CALCULATION_PRESENTED_AS_COMPLETE=FORBIDDEN
UNCERTAINTY=VISIBLE_EXPLAINED_ACTIONABLE
CRITICAL_UNCERTAINTY_BEFORE_LOCK=RESOLVE_OR_AUTHORIZED_ACCEPTANCE

FINAL_METHOD_STATEMENT=DERIVED_AFTER_AHSP_AND_CONTEXT
SPECIFICATION=KNOWN_OR_PARTIAL_OR_NOT_PROVIDED
AHSP_CROSS_DOMAIN_REUSE=ALLOWED_IF_TRULY_APPLICABLE
SAME_NAME_OR_TOTAL=NOT_IDENTITY_PROOF

CURRENT_TRANSITION_UI=HONEST_SHELL
INTERACTION_ENGINE=NOT_LIVE
TEMPLATE_SYNTHESIS=NOT_LIVE
BOQ_ENRICHMENT=NOT_LIVE
PRODUCTION_GOLDEN_THREAD=NOT_LIVE
```

---

## 24. Prinsip Penutup

SIMPROK tidak boleh berkata:

> “Data belum lengkap, kerjakan semuanya sendiri.”

SIMPROK harus mampu berkata:

> “Ruang kerja sudah siap. Berikut hasil terbaik berdasarkan informasi yang tersedia. Bagian berikut masih memiliki ketidakpastian; saya dapat membantu memperjelasnya sekarang atau nanti. Semakin banyak konteks yang Bapak berikan, semakin tepat RAB, AHSP, harga, sumber daya, spesifikasi, dan Metode Pelaksanaan yang saya sediakan.”

SIMPROK harus mempermudah manusia tanpa menggantikan kewenangan manusia.

**SIMPROK menghitung. SIMPROK merekomendasikan. SIMPROK menyediakan. Manusia memutuskan, menetapkan, dan menentukan.**

Soli Deo Gloria. Segala kemuliaan hanya bagi Tuhan Yesus Kristus. Amin.
