# SIMPROK — Hukum Ruang Transisi, Ruang Interaksi, Sintesis RAB, BOQ Enrichment, dan Ketidakpastian

**Document ID:** `SIMPROK-RAB-TRANSITION-INTERACTION-SYNTHESIS-LAW-V1.1`  
**Owner:** Feky de Fretes  
**PM / Gatekeeper:** ChatGPT  
**Decision date:** 18 Juli 2026  
**Harmonization date:** 18 Juli 2026  
**Status:** `OWNER DECIDED — PRODUCT LAW LOCKED; HARMONIZED; DETAIL ARCHITECTURE AND RUNTIME IMPLEMENTATION PARTIAL`  
**Repository:** `fekyigo-rgb/SIMPROK`

---

## 1. Tujuan dan Efek Hukum

Dokumen ini mengunci dan mempertajam keputusan Owner mengenai:

- `Persiapan RAB / Ruang Transisi RAB`;
- `Ruang Interaksi SIMPROK`;
- hukum masuk ke `Ruang Kerja RAB`;
- perbedaan perjalanan pengguna yang belum mempunyai BOQ dan yang sudah mempunyai BOQ;
- `Template Synthesis`, `BOQ Enrichment`, dan `Scoped Recalculation`;
- hubungan AHSP, Basic Price, spesifikasi, asumsi metode, Metode Pelaksanaan, dan keputusan manusia;
- cara menghitung Draft RAB secara jujur tanpa menyembunyikan ketidakpastian;
- batas antara perhitungan, verifikasi, review, approval, dan lock.

Dokumen ini dibuat agar ChatGPT, Codex, Claude, Claude Code, Gemini, Cursor, Antigravity, dan agent berikutnya tidak mengulang diskusi yang sama, tidak membongkar hukum lama, dan tidak membuat implementasi yang saling bertentangan.

### 1.1 Non-supersession law

Dokumen ini **tidak mengganti hukum lama yang telah dikunci**. Ia:

```text
MELURUSKAN YANG BENGKOK
→ tanpa menghapus sejarah

MEMPERTEBAL CAHAYA
→ tanpa membuat sumber kebenaran kedua

MEMPERTAJAM KONTRAK
→ tanpa membongkar fondasi
```

Keputusan lama hanya dianggap digantikan bila dokumen ini menyebutnya secara eksplisit dalam **Supersession Register**. Selain itu, seluruh hukum lama tetap berlaku.

### 1.2 Perubahan hukum

Perubahan berikutnya terhadap dokumen ini wajib melalui:

```text
proposal perubahan
→ impact review lintas hukum
→ Owner decision
→ version bump
→ implementation gate
→ test/evidence update
```

Agent dilarang menyunting makna hukum secara diam-diam melalui prompt, source code, atau ringkasan baru.

---

## 2. Kepemilikan Normatif dan Batas Anti-Tumpang-Tindih

Setiap bidang mempunyai tepat satu rumah hukum utama.

| Bidang | Rumah hukum utama | Kedudukan dokumen ini |
|---|---|---|
| Project, Workspace, assignment, permission, authority | `SIMPROK_PROJECT_RAB_AUTHORITY_UNIT_LAW.md` | Tidak mendefinisikan ulang permission atau authority |
| Nama ruang, pintu navigasi, Draft/Baseline/Addendum | `SIMPROK_RAB_PEKERJAAN_NAVIGATION_LIFECYCLE_LAW.md` | Hanya menjelaskan perilaku transisi menuju workspace |
| Basic Price, AHSP occurrence, selection, conversion, snapshot | Blueprint BP–AHSP + Owner Lock | Tidak menciptakan rumah harga atau occurrence kedua |
| Unit compatibility dan conversion | `SIMPROK_PROJECT_RAB_AUTHORITY_UNIT_LAW.md` + Unit Kernel gates | Tidak menciptakan unit engine baru |
| Product Intelligence umum | `P7C_PRODUCT_INTELLIGENCE_LAW.md` | P7C masih DRAFT; dokumen ini mengunci keputusan Owner pada scope transisi/interaksi |
| Ruang Transisi, Ruang Interaksi, dua perjalanan BOQ, proses mesin, uncertainty UX | **Dokumen ini** | Rumah normatif utama |
| Status implemented/live | Repository, database, runtime, dan browser evidence | Hukum tidak boleh dipakai untuk memalsukan realitas |

### 2.1 Aturan pembacaan

Wajib dibaca bersama:

1. `docs/project-memory/SIMPROK_PROJECT_MEMORY.md`
2. `docs/project-memory/SIMPROK_RAB_PEKERJAAN_NAVIGATION_LIFECYCLE_LAW.md`
3. `docs/project-memory/SIMPROK_PROJECT_RAB_AUTHORITY_UNIT_LAW.md`
4. `docs/project-memory/SIMPROK_BASIC_PRICE_AHSP_IMPLEMENTATION_BLUEPRINT_OWNER_LOCK.md`
5. `docs/project-memory/SIMPROK_BASIC_PRICE_AHSP_IMPLEMENTATION_BLUEPRINT.md`
6. dokumen ini
7. `docs/product-intelligence/P7C_PRODUCT_INTELLIGENCE_LAW.md`
8. repository/runtime/browser evidence terbaru.

### 2.2 Precedence

```text
OWNER CONSTITUTION / FOUNDATION
↓
OWNER-LOCKED DOMAIN LAWS
↓
OWNER-LOCKED DOCUMENT INI PADA SCOPE-NYA
↓
LOCKED IMPLEMENTATION GATES
↓
DRAFT DESIGN DOCUMENTS
↓
IMPLEMENTATION CONTRACTS
↓
REPOSITORY / RUNTIME REALITY UNTUK STATUS
```

Repository reality menentukan apa yang hidup, tetapi tidak boleh dipakai untuk mengubah hukum diam-diam. Ketidaksesuaian adalah **gap**, bukan alasan mengarang kesesuaian.

### 2.3 Repetition law

Ringkasan hukum lain di dokumen ini bersifat **context pointer**, bukan sumber normatif kedua. Bila ringkasan berbeda dengan rumah hukum utamanya, rumah hukum utama menang dan konflik wajib dilaporkan.

---

## 3. DNA dan Prinsip Dasar

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

1. SIMPROK tidak menunggu semua data sempurna untuk mulai membantu.
2. SIMPROK tidak mengarang fakta, sumber, harga, volume, atau kepastian.
3. SIMPROK menyediakan hasil terbaik berdasarkan basis yang dapat ditelusuri.
4. Ketidakpastian harus terlihat, dijelaskan, dan dikurangi bertahap.
5. Pengguna dipermudah, bukan dipaksa menyelesaikan formulir panjang sebelum bekerja.
6. Kecerdasan kaya di dalam; pengalaman sederhana, tenang, dan profesional di luar.
7. Semua rekomendasi penting tetap merupakan proposal sampai manusia berwenang menetapkan.

---

## 4. Kedudukan Ruang

### 4.1 Persiapan RAB / Ruang Transisi RAB

Ruang Transisi adalah tempat pengguna memberikan konteks awal sebelum atau sambil menuju Ruang Kerja RAB.

Fungsi:

- menampung Data Utama dan Data Opsional;
- mengetahui apakah pengguna sudah mempunyai BOQ;
- menerima konteks awal melalui Ruang Interaksi;
- menentukan pengalaman awal yang sesuai;
- menyiagakan mesin SIMPROK;
- bukan pagar yang menahan pengguna masuk ke Ruang Kerja RAB.

### 4.2 Ruang Interaksi SIMPROK

Ruang Interaksi adalah lapisan klarifikasi kontekstual dan opsional untuk:

- menggali maksud pekerjaan;
- memperjelas informasi ambigu;
- meningkatkan kualitas rekomendasi AHSP;
- meningkatkan ketepatan pemilihan Basic Price yang sudah mempunyai basis sah;
- membantu menyusun dan menyempurnakan spesifikasi;
- memahami kebutuhan material, tenaga, alat, akses, dan logistik;
- membantu menghasilkan draft Metode Pelaksanaan setelah konteks dan AHSP semakin jelas;
- mengubah jawaban bermakna menjadi fakta atau keputusan terstruktur.

Ruang Interaksi bukan chatbot kosmetik, bukan syarat masuk, bukan satu-satunya cara bekerja, dan bukan pengganti keputusan formal.

### 4.3 Ruang Kerja RAB

Ruang Kerja RAB adalah editor Draft RAB. Pengguna dapat masuk walaupun Data Utama masih kosong atau belum lengkap, selama gerbang keamanan dan kewenangan sah terpenuhi.

Di dalamnya pengguna dapat:

- menyusun manual;
- menerima Template RAB;
- mengimpor BOQ;
- meninjau preview;
- memilih atau menerima rekomendasi AHSP;
- melengkapi volume;
- memakai mode SIMPROK atau manual;
- menghitung ulang secara terarah;
- menggunakan Ruang Interaksi pada konteks tertentu;
- menyimpan Draft;
- mempersiapkan review, approval, dan lock sesuai hukum lifecycle/authority.

### 4.4 RAB Pekerjaan

`RAB Pekerjaan` tetap merupakan rumah permanen lifecycle satu pekerjaan sesuai hukum navigasi. Dokumen ini tidak mengubah nama, pintu, lifecycle, atau Addendum law tersebut.

---

## 5. Hukum Masuk ke Ruang Kerja RAB

### 5.1 Data Utama bukan pagar

> **Data Utama tidak boleh menjadi blokir universal yang menahan pengguna masuk ke Ruang Kerja RAB.**

```text
DATA_KOSONG
→ BOLEH_MASUK_RUANG_KERJA_RAB

DATA_SEBAGIAN
→ BOLEH_MASUK_RUANG_KERJA_RAB
→ ENGINE_SIAGA

DATA_CUKUP
ATAU USER_MENERIMA_ASUMSI_YANG_DITAMPILKAN
→ ENGINE_READY
```

### 5.2 Gerbang yang tetap sah

Keputusan ini tidak menghapus gerbang keamanan atau integritas sistem. Yang tetap dapat menjadi gate:

- autentikasi;
- workspace aktif;
- ProjectAssignment;
- permission/authority;
- lifecycle Draft yang editable;
- validasi teknis request;
- identitas internal Draft/Project yang dibutuhkan sistem.

Bila product form kosong, implementasi boleh membuat identitas provisional yang jujur atau membuka workspace sebelum persistence final. Implementasi dilarang menurunkan keamanan hanya demi entry tanpa data.

### 5.3 Istilah frontend

Label `Wajib diisi` tidak boleh memberi kesan semua field adalah pagar masuk.

Label arah yang disarankan:

> **Konteks Utama Pekerjaan — dapat dilengkapi kapan saja**

Tanda bintang, bila digunakan, harus menjelaskan kewajiban pada tahap tertentu, bukan larangan universal.

### 5.4 Progressive requirement

| Tahap | Kebutuhan data |
|---|---|
| Masuk Ruang Kerja RAB | Tidak diblokir oleh kelengkapan Data Utama |
| Engine siaga | Minimal satu informasi bermakna |
| Template Synthesis | Konteks minimum atau persetujuan memakai asumsi yang ditampilkan |
| Harga Satuan AHSP | Semua resource wajib computationally resolved dengan nilai terlacak |
| Jumlah item | Volume tersedia |
| Harga kontekstual | Lokasi/waktu/coverage tersedia atau basis referensi jujur dipilih |
| Review | Seluruh sumber, asumsi, dan ketidakpastian terlihat |
| Approval/Lock | Ketidakpastian kritis diselesaikan atau diterima manusia berwenang |

---

## 6. Satu Canonical Pipeline, Dua Perjalanan Pengguna

Dua perjalanan BOQ **bukan dua business pipeline terpisah**.

Keduanya hidup dalam satu canonical pipeline:

```text
INTAKE
→ GAP_DETECTION
→ GAP_FILLING_PROPOSAL
→ HUMAN_GATE
→ DETERMINISTIC_RESOLUTION_AND_COST_KERNEL
→ REVIEW / PAGU_LENS BILA ADA
```

Perbedaannya hanya pada input awal dan tahap orchestration:

```text
TANPA_BOQ
→ TEMPLATE_SYNTHESIS
→ CONVERGE_KE_CANONICAL_RAB_PIPELINE

DENGAN_BOQ
→ IMPORT_PREVIEW_APPROVAL
→ BOQ_ENRICHMENT
→ CONVERGE_KE_CANONICAL_RAB_PIPELINE
```

Dilarang membangun domain model, Cost Kernel, pricing engine, atau lifecycle terpisah untuk masing-masing perjalanan.

---

## 7. Engine Readiness

```text
BELUM_ADA_DATA
→ ENGINE_IDLE_BUT_WORKSPACE_AVAILABLE

ADA_INFORMASI_BERMAKNA
→ ENGINE_STANDBY

KONTEKS_MINIMUM_CUKUP
→ ENGINE_READY

USER_MEMILIH_GUNAKAN_ASUMSI_YANG_DITAMPILKAN
→ ENGINE_READY_WITH_DISCLOSED_ASSUMPTIONS
```

Satu kolom terisi berarti mesin mulai membaca, bukan izin mengarang RAB final.

Engine standby boleh:

- memulai klasifikasi awal;
- menyiapkan kandidat template;
- menemukan gap;
- menyiapkan pertanyaan relevan;
- menunjukkan informasi yang masih kurang;
- membiarkan pengguna bekerja manual.

---

## 8. Pertanyaan Awal: Status BOQ

Ruang Transisi harus menyediakan pilihan bermakna:

```text
BAGAIMANA_ANDA_INGIN_MEMULAI?

1. SAYA_BELUM_MEMPUNYAI_BOQ
2. SAYA_SUDAH_MEMPUNYAI_BOQ
3. BELUM_YAKIN_BANTU_SAYA_MENENTUKAN
```

Pilihan ini mengubah orchestration state, bukan membuat pricing/lifecycle pipeline baru.

---

## 9. Jalur A — Belum Mempunyai BOQ

### 9.1 Alur

```text
BELUM_PUNYA_BOQ
→ DATA_UTAMA_OPSIONAL_DAN_INTERAKSI
→ LANJUT_KE_RUANG_KERJA_RAB
→ TEMPLATE_SYNTHESIS
→ CANONICAL_RAB_PIPELINE
→ RAB_DRAFT_READY_OR_NEEDS_REVIEW
```

### 9.2 Template Synthesis

Template dapat menyediakan:

- WBS/struktur pekerjaan;
- kelompok/subjudul;
- item pekerjaan;
- satuan;
- kandidat atau rekomendasi AHSP;
- Harga Satuan bila seluruh resource mempunyai nilai terlacak dan lolos technical gates;
- resource tenaga, material, dan alat;
- tanda ketidakpastian;
- catatan asumsi;
- volume kosong untuk dilengkapi pengguna;
- rekomendasi volume hanya bila ada basis sah.

### 9.3 Konteks belum cukup

Pengguna tetap masuk dan mendapat pilihan:

```text
[SUSUN_DENGAN_REKOMENDASI_SIMPROK]
[TAMBAHKAN_INFORMASI]
[MULAI_MANUAL]
```

Tidak boleh ada dead end.

### 9.4 Volume

Bila volume belum tersedia:

- struktur, kandidat AHSP, resource, dan status tetap dapat tersedia;
- Harga Satuan hanya tersedia bila technical/pricing gates lengkap;
- Jumlah item belum tersedia;
- total proyek belum boleh disebut lengkap;
- volume tidak boleh dikarang tanpa basis.

---

## 10. Jalur B — Sudah Mempunyai BOQ

### 10.1 Alur

```text
SUDAH_PUNYA_BOQ
→ MASUK_RUANG_KERJA_RAB
→ BOQ_WAITING_FOR_INPUT
→ INPUT_OR_IMPORT_BOQ
→ PREVIEW_BOQ_ASLI
→ USER_MEMERIKSA
→ USER_MENEKAN_SETUJUI_DAN_PROSES
→ BOQ_ENRICHMENT
→ CANONICAL_RAB_PIPELINE
→ RAB_DRAFT_READY_OR_NEEDS_REVIEW
```

### 10.2 Sebelum persetujuan preview

SIMPROK boleh:

- membaca file;
- menampilkan preview;
- menunjukkan error parsing;
- menunjukkan normalisasi yang diusulkan;
- meminta koreksi struktur.

SIMPROK tidak boleh mengubah BOQ menjadi RAB atau menetapkan interpretasi final sebelum pengguna menyetujui preview.

### 10.3 Setelah persetujuan

BOQ Enrichment dapat:

- mempertahankan BOQ asli sebagai evidence;
- mengklasifikasikan item;
- menormalisasi satuan;
- memahami domain dan jenis pekerjaan;
- menemukan kandidat AHSP;
- merekomendasikan AHSP;
- menjalankan Basic Price resolution di dalam project AHSP occurrence;
- menghitung melalui Cost Kernel;
- menunjukkan resource;
- memberi tanda ambiguitas;
- membuat daftar keputusan yang perlu diperiksa.

---

## 11. Tiga Proses Mesin

Satu fungsi universal `render` dilarang.

### 11.1 Template Synthesis

```text
PROJECT_CONTEXT
→ TEMPLATE_RAB_PROPOSAL
```

Untuk pengguna tanpa BOQ.

Label arah:

> **Susun Template RAB dengan SIMPROK**

### 11.2 BOQ Enrichment

```text
USER_APPROVED_BOQ
→ ENRICHED_RAB_PROPOSAL
```

Untuk BOQ milik pengguna.

Label arah:

> **Setujui & Proses BOQ dengan SIMPROK**

### 11.3 Scoped Recalculation

Pemicu:

- perubahan volume;
- perubahan AHSP;
- perubahan Basic Price selection/override;
- perubahan spesifikasi;
- Execution Factor bila scope tersebut telah dibuka melalui gate tersendiri;
- item baru;
- perubahan konteks yang memengaruhi kalkulasi.

Scope:

```text
SELURUH_RAB
BAGIAN_PEKERJAAN
ITEM_TERPILIH
ITEM_BARU
```

Scoped recalculation diprioritaskan daripada memproses ulang seluruh RAB tanpa kebutuhan.

### 11.4 Batas EF

Penyebutan EF dalam dokumen ini tidak membuka AI EF path atau mengubah EF lock. EF hanya dapat dipakai setelah gate tersendiri yang sah; EF tetap tidak menyimpan rupiah dan biaya hanya lahir melalui requirement/resource/Cost Kernel.

---

## 12. Mode SIMPROK dan Mode Manual

Sumber nilai harus eksplisit, misalnya:

```text
SIMPROK_CALCULATED
MANUAL_UNSOURCED
IMPORTED_REFERENCE
USER_CONFIRMED_REFERENCE
```

### 12.1 Mode SIMPROK

```text
AHSP
→ RESOURCE_RESOLUTION
→ BASIC_PRICE_SELECTION
→ UNIT_ADAPTATION
→ EXECUTION_REQUIREMENT_BILA_SAH
→ COST_KERNEL
→ HARGA_SATUAN
→ JUMLAH
```

### 12.2 Mode manual

Nilai manual boleh dipakai sesuai kewenangan, tetapi:

- harus berlabel `MANUAL_UNSOURCED` bila tidak mempunyai sumber canonical;
- bukan Basic Price canonical;
- tidak boleh diberi `basicPriceId` palsu;
- tidak boleh masuk selected Basic Price snapshot seolah canonical;
- tidak boleh diberi badge `Dihitung SIMPROK`.

Label arah:

> **Harga Manual — belum bersumber dan tidak dihitung oleh Cost Kernel SIMPROK**

### 12.3 Larangan dua sumber kebenaran

- nilai manual tidak menimpa nilai SIMPROK diam-diam;
- nilai SIMPROK tidak menimpa nilai manual diam-diam;
- perubahan mode eksplisit dan diaudit;
- recap mengetahui sumber setiap angka;
- RAB tidak melakukan ulang Basic Price selection yang menjadi rumah project AHSP occurrence.

---

## 13. Ruang Interaksi

### 13.1 Opsional

```text
RUANG_INTERAKSI=OPSIONAL

TIDAK_BERINTERAKSI
→ USER_TETAP_DAPAT_BEKERJA
→ PROPOSAL_RAB_TETAP_DAPAT_DIBENTUK_SESUAI_BASIS

SEMAKIN_AKTIF_BERINTERAKSI
→ PEMAHAMAN_DAN_KETEPATAN_MENINGKAT
```

Keputusan kritis sebelum lock tetap harus diselesaikan atau diterima, tetapi penyelesaiannya dapat melalui form, pemilihan langsung, review, approval action, atau Ruang Interaksi. Percakapan bukan satu-satunya jalur.

### 13.2 Nada

Pertanyaan harus:

- sopan;
- tenang;
- lemah lembut;
- tidak menginterogasi;
- tidak mendesak;
- menjelaskan alasan dan dampak;
- menawarkan rekomendasi awal;
- menyediakan `Bahas nanti` bila tidak kritis saat itu.

### 13.3 Pertanyaan bernilai

SIMPROK hanya bertanya bila jawaban dapat mengubah atau memperjelas:

- kandidat AHSP;
- spesifikasi;
- pemilihan Basic Price existing;
- kebutuhan material, tenaga, atau alat;
- asumsi penerapan formula;
- Execution Factor bila dibuka;
- risiko;
- kepastian;
- baseline readiness.

### 13.4 Konteks

Pertanyaan terikat pada project, WBS, BOQ item, AHSP candidate/application, resource, Basic Price, spesifikasi, kondisi lapangan, metode, atau uncertainty tertentu.

Pengguna tidak boleh diminta menjelaskan ulang fakta yang sudah diketahui.

### 13.5 Jawaban menjadi data

Jawaban bermakna harus menjadi fakta/keputusan terstruktur, misalnya:

```text
DECISION_TYPE=CONCRETE_SUPPLY_METHOD
VALUE=READY_MIX
SOURCE=USER_CONFIRMED
APPLIES_TO=BOQ_ITEM_ID
DECIDED_BY=ACCOUNT_ID
DECIDED_AT=TIMESTAMP
```

Teks percakapan dapat disimpan sebagai evidence, tetapi mesin memakai data terstruktur.

### 13.6 Larangan

Ruang Interaksi tidak boleh:

- mengulang pertanyaan yang sudah dijawab;
- bertanya tentang fakta yang sudah dapat dibaca;
- memaksa semua pertanyaan selesai sebelum pengguna bekerja;
- mengubah keputusan tanpa persetujuan;
- menyembunyikan asumsi;
- menghasilkan percakapan panjang tanpa perubahan state/data;
- menghentikan pekerjaan hanya karena data opsional belum tersedia;
- menjadi satu-satunya cara mengoperasikan SIMPROK.

---

## 14. Perhitungan, Resolution, Verification, dan Ketidakpastian

### 14.1 Empat keadaan yang tidak boleh dicampur

```text
COMPUTATIONALLY_RESOLVED
≠ TRUST_VERIFIED
≠ CALCULATION_READY
≠ BASELINE_READY
```

- `COMPUTATIONALLY_RESOLVED`: resource identity, unit adaptation, dan nilai numerik tersedia secara deterministik.
- `TRUST_VERIFIED`: provenance/evidence telah memenuhi tingkat verifikasi tertentu.
- `CALCULATION_READY`: seluruh resource wajib computationally resolved dan exact completeness gate lulus.
- `BASELINE_READY`: uncertainty kritis telah diselesaikan atau diterima manusia berwenang.

Cost Kernel tetap fail-closed terhadap resource yang belum computationally resolved. Ketidakpastian verifikasi tidak boleh dipakai untuk melewati technical gate.

### 14.2 AI tidak menciptakan Basic Price atau angka

`SIMPROK_RECOMMENDATION` berarti rekomendasi terhadap:

- Basic Price existing dan tenant-visible;
- referensi harga yang benar-benar diterima sistem;
- pilihan manusia yang berlabel jujur;
- atau tindakan yang perlu dilakukan.

Ia **tidak** berarti AI boleh menciptakan harga, sumber, ID, tanggal, lokasi, coverage, atau provenance.

Jika tidak ada nilai numerik yang dapat dipertanggungjawabkan:

```text
RESOURCE_STATUS=BLOCKED_OR_NEEDS_REVIEW
COST_KERNEL=NOT_RUN_FOR_THAT_LINE
FAKE_ZERO=FORBIDDEN
INVENTED_PRICE=FORBIDDEN
```

### 14.3 Hukum perhitungan lengkap

> SIMPROK tidak boleh menghitung sebagian komponen AHSP lalu menyebutnya Harga Satuan lengkap.

Untuk baris yang diberi Harga Satuan SIMPROK:

```text
EXPECTED_AHSP_RESOURCE_SET
== RESOLVED_RESOURCE_SET
```

Semua resource wajib harus mempunyai coefficient, unit, nilai terlacak, conversion evidence bila diperlukan, dan status resolution yang sah.

### 14.4 Tiga dimensi kelengkapan

#### A. Structural completeness

Semua pekerjaan yang diketahui/diusulkan tercantum atau ditandai belum tersedia/needs review.

#### B. AHSP component completeness

Tidak ada resource wajib yang dihilangkan dari Harga Satuan.

#### C. Monetary completeness

- Harga Satuan hanya tersedia bila AHSP component completeness lulus.
- Jumlah item hanya tersedia bila volume ada.
- Total proyek hanya boleh disebut lengkap bila seluruh item yang termasuk scope memiliki volume dan nilai yang sah.
- Bila sebagian volume belum ada, hasil disebut `Draft/Provisional`, bukan total RAB lengkap.

### 14.5 Calculation Ready dan Baseline Ready

```text
CALCULATION_READY
→ semua resource wajib computationally resolved
→ exact resource-set completeness lulus
→ Harga Satuan dapat dihitung

BASELINE_READY
→ uncertainty kritis diselesaikan
ATAU diterima manusia berwenang
→ RAB dapat menuju approval/lock
```

### 14.6 Tingkat uncertainty

Arah UX:

```text
HIJAU
→ dihitung dan terverifikasi

KUNING
→ dihitung dengan referensi yang sah tetapi perlu pemeriksaan

MERAH
→ dihitung dengan basis terlacak, namun keputusan penting wajib diselesaikan/diterima sebelum lock

BLOKIR
→ tidak ada basis numerik/teknis yang dapat dipertanggungjawabkan; dilarang mengarang
```

Merah dapat memiliki harga karena input computationally resolved tetapi trust/decision belum final. Blokir tidak boleh memiliki Harga Satuan SIMPROK palsu.

### 14.7 Pengguna tidak menjawab

Jika pengguna tidak menjawab:

- gunakan rekomendasi existing yang paling dapat dijelaskan bila technical gates lengkap;
- beri status dan catatan;
- masukkan ke daftar pemeriksaan;
- jangan klaim `USER_CONFIRMED`;
- bila tidak ada nilai sah, blokir kalkulasi baris terkait secara jujur.

---

## 15. AHSP, Bidang, Spesifikasi, dan Metode

Bagian ini adalah penajaman pada scope pengalaman/intelligence. Identitas, occurrence, unit, Basic Price, dan Cost Kernel tetap dikontrol hukum utamanya.

### 15.1 Hukum lama tetap

- AHSP adalah formula/metode kerja berotoritas;
- AHSPVersion immutable;
- Basic Price menyesuaikan satu arah ke unit AHSP;
- selection/override hidup di project AHSP occurrence/snapshot;
- occurrence adalah snapshot kontekstual;
- RAB mengonsumsi hasil AHSP;
- Cost Kernel menghitung;
- baseline resmi immutable.

### 15.2 Bidang/domain

Bidang seperti Bina Marga, Cipta Karya, SDA, Umum, dan lainnya adalah konteks keterterapan, bukan satu-satunya identitas AHSP.

Dikunci:

1. Nama pekerjaan sama tidak otomatis berarti AHSP sama.
2. Total Harga Satuan sama tidak membuktikan AHSP identik.
3. Perbedaan formula, resource, coefficient, unit, output unit, standar, atau asumsi penerapan dapat berarti AHSP berbeda.
4. Satu AHSP yang benar-benar sama dan applicable boleh digunakan lintas bidang.
5. Jangan menduplikasi formula hanya karena bidang berbeda.
6. Jangan auto-match berdasarkan nama, mutu, bidang, atau total harga saja.
7. Satu paket dapat multidisiplin; bidang project tidak selalu sama dengan konteks semua item.

Exact Work Domain taxonomy dan schema belum dikunci.

### 15.3 Jenis pekerjaan

Jenis pekerjaan menjawab pekerjaan apa yang sebenarnya dianalisis. SIMPROK boleh mengklasifikasikan dan merekomendasikan; pengguna dapat mengoreksi ketika ambigu.

Exact Work Type taxonomy belum dikunci.

### 15.4 Spesifikasi

```text
SPEC_KNOWN
SPEC_PARTIAL
SPEC_NOT_PROVIDED
```

- spesifikasi yang ada menjadi constraint;
- spesifikasi yang belum ada tidak menjadi pagar entry;
- SIMPROK dapat menawarkan spesifikasi lazim sebagai proposal dan menjelaskan dampak;
- pilihan sementara diberi status;
- fakta spesifikasi dan dokumen Spesifikasi Teknis final tidak sama;
- dokumen final berkembang sepanjang keputusan proyek semakin jelas.

### 15.5 Metode

```text
AHSP_METHOD_ASSUMPTION
≠ FINAL_PROJECT_METHOD_STATEMENT
```

- AHSP master dapat menyimpan method/formula assumption sesuai blueprint;
- asumsi tersebut membantu menjelaskan keterterapan kandidat;
- dokumen Metode Pelaksanaan final tidak wajib ada sebelum memilih AHSP;
- metode final lahir dari BOQ, AHSP terpilih, spesifikasi, lokasi, resource, alat, EF yang sah, urutan kerja, dan keputusan manusia.

Tidak ada konflik: method pada AHSP menjelaskan formula; Metode Pelaksanaan final menjelaskan pelaksanaan project.

### 15.6 Output unit

`BoqItem.unit` harus kompatibel dengan `AHSPVersion.outputUnit` melalui Unit Kernel law. Resource unit dapat berbeda dari output unit. Unit mismatch fail-closed.

### 15.7 Standar/referensi/versi

AHSP harus memiliki provenance jujur: sumber, acuan, kode/tahun, version, ownership, review status, dan konteks berlaku. Referensi lama/nonpemerintah tidak otomatis dibuang, tetapi statusnya tidak boleh disembunyikan.

### 15.8 Keputusan manusia

Konfirmasi manusia dibutuhkan pada keputusan bermakna, misalnya klasifikasi ambigu, spesifikasi kritis, AHSP selection, Basic Price override, penerimaan asumsi, review, approval, dan lock. Pengguna tidak wajib mengonfirmasi setiap operasi teknis kecil.

---

## 16. State Machine Pengalaman

```text
PREPARATION_EMPTY
→ workspace dapat dibuka

PREPARATION_PARTIAL
→ engine siaga

NO_BOQ_READY_TO_SYNTHESIZE
→ template proposal dapat disusun

NO_BOQ_NEEDS_CONTEXT_OR_ASSUMPTION
→ tetap masuk; rekomendasi, tambah konteks, atau manual

HAS_BOQ_WAITING_FOR_INPUT
→ tidak ada auto-synthesis

BOQ_PREVIEW_WAITING_APPROVAL
→ belum diproses menjadi RAB

BOQ_APPROVED_FOR_ENRICHMENT
→ enrichment boleh berjalan

RAB_DRAFT_READY
→ Draft terbentuk dan editable

RAB_NEEDS_REVIEW
→ Draft memiliki calculation/proposal dengan uncertainty terlihat

BASELINE_READY
→ keputusan kritis selesai/diterima sesuai kewenangan
```

Nama enum final dapat berbeda; makna state tidak boleh dicampur.

---

## 17. Data dan Auditability

Lokasi, bidang, status BOQ, spesifikasi, konteks, dan keputusan tidak boleh selamanya hanya dirangkai menjadi `Project.description`.

Sistem harus dapat menjawab:

- siapa memberikan informasi;
- kapan;
- melalui form, import, atau Ruang Interaksi;
- berlaku pada project/bagian/item mana;
- apakah fakta, asumsi, rekomendasi, atau keputusan;
- apakah user-confirmed;
- dampaknya;
- versi kalkulasi mana yang memakainya.

SIMPROK tidak boleh diam-diam:

- mengganti BOQ asli;
- memilih AHSP final tanpa human gate yang disyaratkan;
- menerima asumsi atas nama pengguna;
- menimpa mode manual;
- menghilangkan uncertainty;
- mengubah angka tanpa trace.

---

## 18. Realitas Runtime — 18 Juli 2026

`frontend/src/pages/ProjectSetupPage.tsx` saat ini menunjukkan:

1. sembilan field dinamai `requiredPreparationFields`;
2. UI menampilkan `Wajib diisi`;
3. validasi menolak bila Nama Proyek, Kategori, atau Bidang tertentu belum tersedia;
4. `Kirim Konteks` hanya mengubah status lokal `Engine belum aktif`;
5. belum ada pilihan sudah/belum mempunyai BOQ;
6. tombol lanjut selalu membuat Draft Project dan menuju workspace;
7. belum ada Template Synthesis;
8. belum ada BOQ Enrichment;
9. banyak konteks dirangkai ke `Project.description`.

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

Dokumen ini tidak mengklaim fitur tersebut hidup.

---

## 19. Owner-Locked Decisions

```text
LOCKED_01 DATA_UTAMA_TIDAK_MEMBLOKIR_ENTRY
LOCKED_02 SECURITY_AND_AUTHORITY_GATES_TETAP_BERLAKU
LOCKED_03 SATU_CANONICAL_PIPELINE_DENGAN_DUA_UX_JOURNEYS
LOCKED_04 RUANG_INTERAKSI_OPSIONAL_KONTEKSTUAL_PRODUKTIF
LOCKED_05 JAWABAN_BERMAKNA_MENJADI_DATA_ATAU_KEPUTUSAN
LOCKED_06 TANPA_BOQ_MEMAKAI_TEMPLATE_SYNTHESIS
LOCKED_07 DENGAN_BOQ_MENUNGGU_IMPORT_PREVIEW_APPROVAL
LOCKED_08 TEMPLATE_SYNTHESIS_BOQ_ENRICHMENT_SCOPED_RECALCULATION_DIPISAH
LOCKED_09 MODE_MANUAL_DAN_SIMPROK_JUJUR_DAN_TIDAK_SALING_MENIMPA
LOCKED_10 AI_TIDAK_MENCIPTAKAN_BASIC_PRICE_ATAU_ANGKA
LOCKED_11 COST_KERNEL_TETAP_FAIL_CLOSED_TERHADAP_INPUT_BELUM_RESOLVED
LOCKED_12 TIDAK_MENGHITUNG_SEBAGIAN_KOMPONEN_AHSP_LALU_MENYEBUT_LENGKAP
LOCKED_13 STRUCTURAL_AHSP_COMPONENT_DAN_MONETARY_COMPLETENESS_DIBEDAKAN
LOCKED_14 UNCERTAINTY_TERLACAK_DAPAT_HIDUP_DI_DRAFT
LOCKED_15 UNCERTAINTY_KRITIS_DISELESAIKAN_ATAU_DITERIMA_SEBELUM_LOCK
LOCKED_16 SPESIFIKASI_DAPAT_KNOWN_PARTIAL_NOT_PROVIDED
LOCKED_17 FINAL_METHOD_FOLLOWS_SELECTED_AHSP_AND_CLEARER_CONTEXT
LOCKED_18 AHSP_DAPAT_LINTAS_BIDANG_BILA_IDENTIK_DAN_APPLICABLE
LOCKED_19 NAMA_ATAU_TOTAL_SAMA_TIDAK_MEMBUKTIKAN_AHSP_IDENTIK
LOCKED_20 SIMPROK_MEREKOMENDASIKAN_MANUSIA_MENETAPKAN
LOCKED_21 HUKUM_LAMA_TETAP_BERLAKU_KECUALI_EXPLICITLY_SUPERSEDED
LOCKED_22 SATU_BIDANG_SATU_RUMAH_NORMATIF_ANTI_DUPLICATION
```

---

## 20. Detail yang Belum Dikunci

Tidak boleh diimplementasikan berdasarkan tebakan agent:

1. minimum context Template Synthesis per jenis proyek;
2. Katalog Ambiguitas final;
3. Work Domain taxonomy;
4. Work Type taxonomy;
5. schema structured facts/decisions;
6. API Ruang Interaksi;
7. confidence scoring;
8. enum backend final;
9. visual warna/icon final;
10. permission mapping per role;
11. AI orchestration teknis;
12. aturan rekomendasi/generasi volume;
13. performance/job limits;
14. approval policy menerima uncertainty merah;
15. exact EF integration;
16. exact identity/persistence model untuk interaction threads dan decisions.

```text
DIRECTION_LOCKED
DETAIL_ARCHITECTURE_REQUIRED
DO_NOT_GUESS
```

---

## 21. Katalog Ambiguitas — Agenda Lanjutan

Katalog final akan dibahas terpisah untuk:

- pemilihan AHSP;
- Spesifikasi Teknis;
- Basic Price;
- material;
- tenaga kerja;
- alat;
- logistik/akses;
- risiko/cuaca;
- Execution Factor;
- Metode Pelaksanaan.

Keluarga awal yang belum menjadi taxonomy final:

- scope/batas pekerjaan;
- jenis pekerjaan;
- bidang/keterterapan;
- mutu/spesifikasi;
- unit/output unit;
- asumsi formula AHSP;
- standard/reference/version;
- resource mapping;
- sumber/lokasi/tanggal/coverage harga;
- alat/produktivitas;
- akses/logistik;
- inclusions/exclusions;
- volume/pengukuran;
- kondisi lapangan.

Setiap ambiguity type nantinya wajib memiliki alasan deteksi, dampak, pertanyaan elegan, rekomendasi awal, opsi `Bahas nanti`, structured state, pengaruh kalkulasi, dan pengaruh baseline readiness.

---

## 22. Larangan

Dilarang:

1. menjadikan Data Utama pagar entry universal;
2. menghapus security/permission/lifecycle gates;
3. memaksa Ruang Interaksi;
4. menyimpan chat tanpa structured effect;
5. membuat dua canonical business pipelines berdasarkan status BOQ;
6. menjalankan Template Synthesis bagi BOQ existing sebelum persetujuan;
7. mengubah BOQ asli diam-diam;
8. membangun universal render function;
9. memproses seluruh RAB ketika hanya satu scope berubah tanpa alasan;
10. menciptakan Basic Price, angka, source, ID, atau provenance;
11. memberi fake zero;
12. menghitung sebagian komponen AHSP lalu menyebut Harga Satuan lengkap;
13. menyebut total proyek lengkap ketika volume/item belum lengkap;
14. menyamakan technical unresolved dengan sekadar belum verified;
15. meminta spesifikasi selalu tersedia;
16. meminta Metode Pelaksanaan final sebagai universal prerequisite;
17. menduplikasi AHSP hanya karena bidang berbeda;
18. menyamakan AHSP hanya karena nama/total sama;
19. membuka EF tanpa gate;
20. mengklaim engine hidup hanya karena UI tersedia;
21. mendefinisikan ulang navigasi, authority, unit, Basic Price, occurrence, atau lifecycle di luar rumah hukumnya;
22. membongkar locked law tanpa explicit Owner revision.

---

## 23. Supersession Register

Hanya pernyataan berikut yang dinyatakan digantikan:

### SUPERSEDED-01

Pernyataan percakapan:

> “AHSP boleh dipilih sebelum seluruh resource resolved, tetapi belum boleh dihitung.”

Diganti dengan:

> AHSP dapat direkomendasikan/dipilih sebagai proposal, tetapi Cost Kernel hanya menghitung bila seluruh resource wajib computationally resolved dan exact completeness gate lulus. Resource boleh belum mencapai trust verification tertinggi, tetapi harus mempunyai nilai dan provenance terlacak. AI dilarang mengarang harga. Ketidakpastian kritis tetap harus diselesaikan atau diterima sebelum lock.

Tidak ada locked AHSP, Basic Price, Unit, Cost Kernel, lifecycle, authority, atau baseline law lain yang digantikan oleh dokumen ini.

---

## 24. Retrieval Rule

Sebelum memberi rekomendasi, menulis prompt, merancang schema, mengubah frontend/backend, atau mengklaim status terkait Persiapan RAB, Ruang Interaksi, template, BOQ, AHSP, Basic Price, spesifikasi, metode, render, atau uncertainty:

1. baca `AGENTS.md`;
2. baca `docs/project-memory/README.md`;
3. baca `SIMPROK_PROJECT_MEMORY.md`;
4. baca hukum navigasi/lifecycle;
5. baca hukum authority/unit;
6. baca Owner Lock dan Blueprint BP–AHSP;
7. baca dokumen ini;
8. baca P7C sebagai DRAFT design reference;
9. audit repository/runtime/browser;
10. pisahkan FACT, OWNER LOCK, INFERENCE, RECOMMENDATION, dan RUNTIME REALITY;
11. bila ambigu, laporkan exact decision needed—jangan mengarang.

---

## 25. Handoff

```text
DOCUMENT_ID=SIMPROK-RAB-TRANSITION-INTERACTION-SYNTHESIS-LAW-V1.1
STATUS=OWNER_DECIDED_PRODUCT_LAW_LOCKED_HARMONIZED_RUNTIME_PARTIAL

NON_SUPERSESSION=YES
NORMATIVE_HOME_MATRIX=LOCKED
CANONICAL_PIPELINE_COUNT=1
UX_JOURNEY_COUNT=2

WORKSPACE_ENTRY_BLOCKED_BY_DATA=NO
SECURITY_AUTHORITY_GATES=YES
DATA_MAIN_ROLE=IMPROVE_CONTEXT_NOT_GATE_ENTRY
ENGINE_AFTER_MEANINGFUL_INPUT=STANDBY

RUANG_INTERAKSI=OPTIONAL_CONTEXTUAL_STRUCTURED
NO_BOQ_PATH=TEMPLATE_SYNTHESIS
HAS_BOQ_PATH=IMPORT_PREVIEW_APPROVE_THEN_BOQ_ENRICHMENT
POST_RAB_PROCESS=SCOPED_RECALCULATION

AI_CREATES_BASIC_PRICE=NO
COST_KERNEL_ACCEPTS_UNRESOLVED_RESOURCE=NO
PARTIAL_AHSP_COMPONENT_CALCULATION_AS_COMPLETE=FORBIDDEN

COMPLETENESS_DIMENSIONS=STRUCTURAL_AHSP_COMPONENT_MONETARY
UNCERTAINTY=VISIBLE_EXPLAINED_ACTIONABLE
CRITICAL_UNCERTAINTY_BEFORE_LOCK=RESOLVE_OR_AUTHORIZED_ACCEPTANCE

FINAL_METHOD_STATEMENT=DERIVED_AFTER_SELECTED_AHSP_AND_CLEARER_CONTEXT
SPECIFICATION_STATE=KNOWN_PARTIAL_OR_NOT_PROVIDED
AHSP_CROSS_DOMAIN_REUSE=ALLOWED_IF_IDENTICAL_AND_APPLICABLE
SAME_NAME_OR_TOTAL_PROVES_IDENTITY=NO

CURRENT_RUNTIME=HONEST_UI_SHELL_NOT_FULL_PRODUCT_ENGINE
DETAIL_ARCHITECTURE=REQUIRED
```

---

## 26. Prinsip Penutup

SIMPROK tidak menghalangi manusia untuk mulai bekerja. SIMPROK mulai memahami dari informasi sekecil apa pun, tetapi tidak mengarang. SIMPROK menyediakan proposal dan perhitungan terbaik dari data yang mempunyai identitas, unit, nilai, sumber, dan jejak yang sah. SIMPROK menunjukkan ketidakpastian, bertanya dengan lembut bila berguna, menghitung hanya ketika technical gates lengkap, dan menyerahkan keputusan bermakna kepada manusia.

**SIMPROK kaya dan kuat di dalam, sederhana dan jujur di luar.**  
**SIMPROK menghitung. Manusia memutuskan.**  
**Reduce Uncertainty.**

Soli Deo Gloria. Segala kemuliaan hanya bagi Tuhan Yesus Kristus. Haleluya. Amin.
