# P7C — PRODUCT INTELLIGENCE LAW

## Hukum Kecerdasan Produk SIMPROK

### Dalam Nama Tuhan Yesus Kristus. Soli Deo Gloria. Haleluya. Amin.

---

| Atribut | Nilai |
|---|---|
| **Document ID** | `P7C-PRODUCT-INTELLIGENCE-LAW` |
| **Versi dokumen** | `v1.0-DRAFT` |
| **Status** | **DRAFT — DESIGN ONLY** |
| **Owner PASS** | **BELUM DIBERIKAN** |
| **policyVersion aktif saat ini** | `P8A_CONSTITUTIONAL_AI_BOUNDARY_V1` |
| **policyVersion setelah Owner PASS** | `P7C_PRODUCT_INTELLIGENCE_LAW_V1` |
| **Implementation authority** | **NONE — sampai Owner PASS dan implementation gate terpisah** |
| **Disusun bersama** | Owner Feky de Fretes · PM/Gatekeeper · Arsitek SIMPROK |
| **Canonical repository path** | `docs/product-intelligence/P7C_PRODUCT_INTELLIGENCE_LAW.md` |
| **Normalized pointer** | `docs/project-memory/SIMPROK_PROJECT_MEMORY.md` |
| **Hukum di atasnya** | Constitution/Foundation · Owner Decisions · locked ADR |
| **Jika terjadi konflik** | Hukum yang lebih tinggi menang; konflik wajib dilaporkan dan dokumen ini dikoreksi. |

> **Satu dokumen, dua lapisan, satu kebenaran.**
> **JIWA** menjelaskan maksud hukum kepada manusia. **KONTRAK NORMATIF** memberi aturan yang dapat ditegakkan oleh kode, test, evidence, dan audit. Keduanya tidak boleh berkembang menjadi dua sumber kebenaran.

---

# BAGIAN A — CARA MEMBACA, KEWENANGAN, DAN PERUBAHAN

## A.1 Urutan membaca

Agen SIMPROK wajib membaca:

1. `docs/project-memory/SIMPROK_PROJECT_MEMORY.md` sebagai sumber keputusan yang telah dinormalisasi;
2. Constitution/Foundation, Owner Decisions, dan locked ADR yang dirujuk;
3. dokumen ini;
4. repository/runtime evidence.

Urutan **otoritas hukum**:

```text
Owner Constitution / Foundation
↓
Owner Decisions
↓
Locked ADR
↓
P7C Product Intelligence Law setelah Owner PASS
↓
Implementation contracts
↓
Repository/runtime reality
```

Repository reality tidak boleh dipalsukan agar terlihat sesuai hukum. Bila repository belum sesuai, statusnya adalah **gap**, bukan alasan mengubah hukum diam-diam.

## A.2 Arti kata normatif

| Kata | Arti |
|---|---|
| **MUST / WAJIB** | Tidak boleh dilewati. |
| **MUST NOT / DILARANG** | Pelanggaran kebijakan; harus ditolak atau dihentikan. |
| **MAY / BOLEH** | Diizinkan tetapi tidak wajib. |
| **NEEDS_REVIEW** | Bukti/konteks belum cukup; keputusan manusia diperlukan. |
| **FAIL_CLOSED** | Tidak ada hasil diterima dan tidak ada mutation bisnis. |
| **REQUIRES_HUMAN_DECISION** | Mesin hanya boleh memberi usulan; manusia menetapkan. |
| **CANONICAL** | Data sah yang memiliki identitas, scope, provenance, dan status yang dapat ditelusuri. |
| **PROPOSAL** | Hasil mesin yang belum menjadi keputusan resmi. |

## A.3 Aktivasi dan perubahan

```text
LAW-A.1  Dokumen ini TIDAK aktif sebagai policy sebelum Owner PASS.

LAW-A.2  Setelah PASS, perubahan hukum WAJIB melalui:
           proposal perubahan
           → impact review
           → Owner decision
           → version bump
           → implementation gate
           → test/evidence update.

LAW-A.3  Isi dokumen ini DILARANG disalin penuh ke Project Memory.
         Project Memory hanya menyimpan pointer, status, versi, dan keputusan
         terkini. Tujuannya: mencegah dua salinan hukum berkembang berbeda.

LAW-A.4  Knowledge/matrix DILARANG belajar otomatis dari perilaku pengguna.
         Perubahan knowledge hanya boleh melalui governed human review,
         publication, versioning, dan rollback path.

LAW-A.5  Evidence append-only tidak boleh diubah atau dihapus oleh AI.
         Kesalahan hanya dapat DITANDAI dan DISUPERSEDE oleh evidence/decision
         yang lebih baru; catatan lama tetap menjadi sejarah audit.
```

---

# BAGIAN 0 — MENGAPA HUKUM INI ADA

## JIWA

SIMPROK sudah mempunyai pagar konstitusional, identitas produk, dan rantai hitung. Yang ditetapkan di sini adalah **bagaimana SIMPROK berpikir** ketika berhadapan dengan BOQ, AHSP, Basic Price, kondisi proyek, Execution Factor, dan ketidakpastian.

Tanpa hukum ini, “SIMPROK yang pintar” dapat berubah menjadi tebakan yang berpakaian rapi: mengarang spesifikasi, memaksa AHSP cocok, menempelkan persentase pada ketidakpastian, lalu menyajikan angka yang tampak meyakinkan tetapi tidak mempunyai asal-usul.

> **SIMPROK BOLEH TIDAK TAHU.**
> **SIMPROK TIDAK BOLEH BERPURA-PURA TAHU.**

Ketidaktahuan yang jujur adalah cahaya. Kepastian palsu adalah kegelapan yang menyamar sebagai terang.

> **SIMPROK menghitung dan merekomendasikan. Manusia memilih, menetapkan, menyetujui, dan bertanggung jawab.**

## KONTRAK NORMATIF

```text
LAW-0.1  SIMPROK tidak pernah auto-approve, auto-publish, atau auto-lock.

LAW-0.2  Setiap keluaran kecerdasan berstatus PROPOSAL sampai manusia
         menetapkannya melalui kewenangan yang sah.

LAW-0.3  Ketidakcukupan bukti WAJIB menghasilkan NEEDS_REVIEW,
         bukan tebakan dengan confidence tinggi.

LAW-0.4  Nol data palsu. Nol provenance karangan.
         AI tidak boleh mengaku melihat sumber yang tidak diterimanya.

LAW-0.5  Setiap nilai yang ditampilkan WAJIB dapat ditelusuri ke:
           (a) data canonical SIMPROK;
           (b) masukan manusia yang berlabel jujur; atau
           (c) hasil Cost Kernel deterministik dari (a) dan/atau (b).

LAW-0.6  Nilai tanpa asal-usul DILARANG ditampilkan sebagai fakta canonical.

LAW-0.7  Confidence tidak menggantikan evidence.
         Confidence tinggi tanpa evidence yang cukup tetap NEEDS_REVIEW.
```

---

# BAGIAN 1 — INTAKE: SATU PIPA, TIGA BENDERA

## JIWA

Keadaan awal pengguna direpresentasikan oleh tiga keadaan utama:

| Bendera | Makna |
|---|---|
| `hasBOQ` | Pengguna sudah memiliki daftar pekerjaan dan volume. |
| `hasSpec` | Pengguna sudah memiliki spesifikasi material/pekerjaan utama. |
| `hasPagu` | Pengguna mempunyai batas atau target anggaran. |

Tiga bendera menghasilkan delapan kombinasi logis. Label Mode A–F boleh dipakai sebagai bahasa produk, tetapi **bukan enam implementasi terpisah**.

> **Satu pipa. Yang berbeda hanya apa yang tersedia dan apa yang masih kosong.**

Pagu juga bukan sumber perhitungan. Pagu adalah **lensa pembanding setelah biaya dihitung**. Cost Kernel tidak boleh “memasak” koefisien, harga, mutu, volume, atau spesifikasi agar angka terlihat masuk pagu.

## KONTRAK NORMATIF

```text
LAW-1.1  Intake SIMPROK adalah SATU canonical pipeline.
         DILARANG membangun business pipeline terpisah per label mode.

LAW-1.2  Keadaan awal direpresentasikan minimal oleh:
           hasBOQ · hasSpec · hasPagu.
         Label mode adalah derived product label, bukan domain branch.

LAW-1.3  Canonical pipeline:
           1. INTAKE
           2. GAP_DETECTION
           3. GAP_FILLING_PROPOSAL
           4. HUMAN_GATE
           5. DETERMINISTIC_COST_KERNEL
           6. PAGU_LENS bila hasPagu = true

LAW-1.4  PAGU BLINDNESS.
         Cost Kernel DILARANG menerima pagu sebagai input perhitungan biaya.

LAW-1.5  Pagu hanya boleh dipakai setelah hasil biaya terbentuk, untuk:
           membandingkan
           → menjelaskan gap
           → memberi alternatif
           → meminta keputusan manusia.

LAW-1.6  Setiap hasil gap filling WAJIB mempunyai origin label:
           CANONICAL_SOURCE
           SIMPROK_RECOMMENDATION
           HUMAN_INPUT
           NOT_AVAILABLE.

LAW-1.7  Penambahan dimensi intake baru DILARANG dilakukan sebagai cabang
         pipeline baru. Dimensi baru hanya boleh ditambah sebagai canonical
         attribute/flag setelah Owner decision dan impact review.
```

## Peta bendera → label manusia

| hasBOQ | hasSpec | hasPagu | Label manusia | Gap utama |
|:---:|:---:|:---:|---|---|
| Ya | Ya | Tidak | Mode A | AHSP · Basic Price · konteks pelaksanaan |
| Ya | Tidak | Tidak | Mode B | Spesifikasi + Mode A |
| Ya | Ya | Ya | Mode C | Mode A + Pagu Lens |
| Ya | Tidak | Ya | Mode D | Mode B + Pagu Lens |
| Tidak | Tidak/Ya | Ya | Mode E | Template/struktur pekerjaan + Pagu Lens |
| Tidak | Tidak/Ya | Tidak | Mode F | Template/struktur pekerjaan |

`hasBOQ = false` dan `hasSpec = true` adalah keadaan sah. Spesifikasi dipertahankan sebagai konteks untuk membentuk template/struktur pekerjaan; ia tidak menciptakan BOQ palsu.

> **Catatan aktif:** AI EF tetap dikunci oleh `P8A_CONSTITUTIONAL_AI_BOUNDARY_V1`. `LAW-6.7` adalah draft alignment P7C, bukan implementation authority baru; “konteks pelaksanaan” belum berarti AI boleh menerapkan EF.

## Pagu Lens — keluarga rekomendasi

- `PAGU_WITHIN_RANGE`
- `PAGU_RISK`
- `REVIEW_VOLUME`
- `REVIEW_SPECIFICATION`
- `REVIEW_QUALITY`
- `SEARCH_ALTERNATIVE_PRICE`

Semua rekomendasi memerlukan keputusan manusia. Tidak ada perubahan otomatis pada RAB.

---

# BAGIAN 2 — BASIC PRICE: HARGA PUNYA ASAL-USUL

## JIWA

SIMPROK tidak menciptakan Basic Price. SIMPROK menerima, memverifikasi, menelusuri, mencari, membandingkan, dan merekomendasikan Basic Price yang paling tepat dari sumber sah.

Harga yang diketik manusia langsung di Ruang Kerja RAB boleh dipakai menghitung, tetapi **bukan Basic Price canonical**. Ia harus memakai nama yang jujur dan tidak boleh memperoleh provenance palsu.

## KONTRAK NORMATIF

```text
LAW-2.1  SIMPROK tidak menciptakan Basic Price.
         AI hanya boleh memilih/rekomendasikan BasicPrice ID yang existing
         dan tenant-visible.

LAW-2.2  Basic Price canonical WAJIB mempunyai:
           resource identity
           unit
           value
           source origin
           source type
           geographic/market coverage
           temporal validity/freshness
           verification status
           provenance/audit reference.

LAW-2.3  Price submission DILARANG menjadi canonical bila resource atau unit
         belum ter-resolve secara sah.

LAW-2.4  Basic Price tidak boleh auto-approved oleh AI.

LAW-2.5  MANUAL UNSOURCED PRICE.
         Harga yang dimasukkan manusia langsung:
           - BOLEH dipakai menghitung;
           - WAJIB berlabel MANUAL_UNSOURCED;
           - DILARANG disebut Basic Price canonical;
           - DILARANG memperoleh basicPriceId palsu;
           - DILARANG masuk selectedBasicPriceIds;
           - WAJIB tampil jujur: "Diisi manual — belum bersumber."

LAW-2.6  Basic Price menyimpan harga resource dan coverage.
         Basic Price DILARANG menyimpan volume proyek atau total biaya proyek.

LAW-2.7  Bila Basic Price canonical tidak tersedia:
           status = NEEDS_REVIEW atau MANUAL_UNSOURCED;
         DILARANG mengarang ID, sumber, wilayah, tanggal, atau nilai.
```

---

# BAGIAN 3 — SUPPLY & LOGISTICS INTELLIGENCE

## JIWA

Harga material dan biaya perpindahan hanya dapat dipercaya bila titik cakupannya jelas.

Bukan selalu benar bahwa harga toko sudah mencakup perpindahan tertentu. Ada harga ex-works, franco gudang, delivered site, dan berbagai coverage lain. Karena itu SIMPROK tidak boleh menebak titik cakupan.

Tiga rumah logis:

1. **Perpindahan yang sudah termasuk dalam coverage Basic Price**;
2. **Perpindahan di luar coverage menuju titik penerimaan proyek**;
3. **Distribusi internal proyek dari titik penerimaan ke titik pemasangan**.

## KONTRAK NORMATIF

```text
LAW-3.1  Tiga segmen biaya:
           SEGMENT-1  Perpindahan yang INCLUDED dalam Basic Price coverage
                      → rumah: BASIC_PRICE.
           SEGMENT-2  Di luar Basic Price coverage sampai receiving point proyek
                      → rumah: LOGISTICS_INTELLIGENCE.
           SEGMENT-3  Receiving point proyek sampai point of installation
                      → rumah: EXECUTION_CONTEXT / REQUIREMENT.

LAW-3.2  Titik awal/akhir tiap segmen WAJIB eksplisit.
         DILARANG mengasumsikan ex-works, toko, pelabuhan, atau delivered site
         tanpa evidence.

LAW-3.3  Coverage tidak diketahui → NEEDS_REVIEW.
         DILARANG menganggap nol atau otomatis termasuk.

LAW-3.4  AHSP dictionary DILARANG menjadi rumah kedua bagi biaya mobilisasi
         yang sudah tinggal di Basic Price coverage atau Logistics.
```

---

# BAGIAN 4 — ANTI-DOUBLE-HOME COST LAW

## JIWA

> **Setiap biaya mempunyai satu rumah canonical.**

Biaya yang masuk melalui dua pintu membuat RAB menggelembung diam-diam. SIMPROK harus dapat menunjukkan di mana sebuah resource/requirement sudah dihitung dan menolak penambahan kedua.

## KONTRAK NORMATIF

```text
LAW-4.1  Setiap komponen biaya WAJIB mempunyai tepat satu canonical cost home.

LAW-4.2  Sebelum Execution Requirement masuk Cost Kernel, SIMPROK WAJIB
         memeriksa overlap terhadap:
           AHSP coefficient/resources
           Basic Price coverage
           Logistics segment
           occurrence execution requirements lain.

LAW-4.3  Overlap terbukti → requirement DITOLAK atau DIKURANGI dengan reason
         dan evidence yang tercatat.

LAW-4.4  Overlap tidak dapat ditentukan → NEEDS_REVIEW.
         DILARANG mengasumsikan aman untuk ditambahkan.

LAW-4.5  Pemeriksaan harus memakai resource identity, unit compatibility,
         coverage, occurrence, dan time/context scope; bukan hanya kemiripan nama.
```

---

# BAGIAN 5 — AHSP CONTEXTUAL APPLICABILITY LAW

## JIWA

> ## AHSP One — Applications Many — EF Contextual per Occurrence

AHSP adalah rumus canonical, bukan tempat. Satu AHSP dapat digunakan pada banyak keadaan pelaksanaan. Yang berubah bukan master AHSP, melainkan konteks dan assessment pada pemakaian tertentu.

```text
AHSP Master
├── Occurrence Lantai 1  → context + assessment sendiri
├── Occurrence Lantai 5  → context + assessment sendiri
├── Occurrence Lantai 12 → context + assessment sendiri
└── Occurrence Atap      → context + assessment sendiri
```

Perubahan occurrence Lantai 12 tidak boleh mengubah Lantai 1 dan tidak boleh mengubah AHSP master.

## Empat konsep wajib

| Konsep | Menjawab | Sifat |
|---|---|---|
| **AHSP Master** | Bagaimana pekerjaan dianalisis? | Canonical; tidak menyimpan EF. |
| **Applicability Profile** | Konteks apa yang relevan bagi pekerjaan ini? | Inherited knowledge. |
| **Work Occurrence** | Di mana dan dalam keadaan apa pekerjaan terjadi? | Fakta keadaan. |
| **Execution Assessment** | Apa dampaknya, requirement-nya, dan keputusan manusia? | Tafsir + proposal + keputusan. |

Pemisahan di atas adalah **logical/domain separation** yang wajib. Bentuk fisik Prisma/table belum dikunci sampai schema design gate.

Occurrence verdict B sudah dicatat: current `boqItemRef` dapat menjadi proxy saat ini untuk satu item/occurrence, tetapi bukan structural Work Occurrence guarantee. Distinct `occurrenceRef` tetap akan diperlukan kemudian; dokumen ini tidak mendesain atau mengimplementasikan occurrence persistence.

## KONTRAK NORMATIF

```text
LAW-5.1  AHSP Master bersifat canonical dan bersih.
         DILARANG menyimpan occurrence EF atau konteks lokasi pada master.

LAW-5.2  DILARANG menduplikasi AHSP canonical per lantai, zona, segmen,
         lokasi, atau metode pelaksanaan.

LAW-5.3  EF dan Execution Assessment melekat pada Work Occurrence.
         Perubahan satu occurrence DILARANG mengubah occurrence lain
         atau AHSP Master.

LAW-5.4  Empat konsep domain WAJIB dipisahkan:
           AHSP Master
           Applicability Profile
           Work Occurrence
           Execution Assessment.

LAW-5.5  Work Occurrence menyimpan fakta konteks.
         Execution Assessment menyimpan interpretation, impacts, requirements,
         certainty, recommendation, dan human decision.
         Fakta dan tafsir DILARANG dicampur tanpa provenance.

LAW-5.6  Kamus konteks menyimpan criteria dan evidence rules,
         bukan persentase biaya.

LAW-5.7  THRESHOLD LAW.
         Ambang hanya sah bila berasal dari sumber terverifikasi:
           standar/referensi resmi
           spesifikasi alat
           data teknis
           kebijakan organisasi
           pengalaman proyek yang telah divalidasi manusia.
         AI-generated threshold DILARANG.

LAW-5.8  Impact level boleh dipakai untuk menjelaskan intensitas.
         Impact level DILARANG dikonversi langsung menjadi uang/persentase.

LAW-5.9  Setiap impact level WAJIB mempunyai:
           trigger
           evidence
           reason
           operational impact
           requirement
           certainty
           human decision status.

LAW-5.10 Batch application BOLEH digunakan untuk occurrence berkonteks identik,
          tetapi hasil final WAJIB disimpan per occurrence.

LAW-5.11 Template RAB BOLEH context-aware, tetapi pekerjaan site-wide
          DILARANG diduplikasi tanpa kebutuhan domain yang sah.
```

---

# BAGIAN 6 — EF → REQUIREMENT → RESOURCE → COST → GOLDEN THREAD

## JIWA

> ## EXECUTION FACTOR TIDAK MENYIMPAN RUPIAH.

EF menjelaskan pengaruh kondisi pelaksanaan terhadap produktivitas, konsumsi, durasi, risiko, dan kebutuhan operasional. Uang hanya lahir di Cost Kernel dari resource nyata dan satuan nyata.

## Golden Thread

```text
BOQ Item / Work Scope
↓
Work Occurrence
↓
AHSP Master
↓
AHSP Components (coefficient × resource)
↓
Canonical Basic Price per resource
↓
Base Unit Price
↓
Execution Assessment
↓
Execution Requirement
↓
Resource Requirement
↓
Anti-Double-Home Check
↓
Deterministic Cost Kernel
↓
Effective Unit Price
↓
Volume × Effective Unit Price
↓
Line Total / RAB
↓
Human Decision + Snapshot + Audit
```

## KONTRAK NORMATIF

```text
LAW-6.1  EF DILARANG menyimpan rupiah atau persentase biaya.

LAW-6.2  Uang hanya lahir di deterministic Cost Kernel.

LAW-6.3  AI DILARANG menghasilkan atau menetapkan:
           unit price
           subtotal
           margin/profit
           tax/PPN
           grand total.

LAW-6.4  Execution Requirement WAJIB diterjemahkan ke resource nyata dan unit
         nyata sebelum berdampak pada biaya.

LAW-6.5  Setiap Execution Requirement WAJIB lolos LAW-4.

LAW-6.6  Manusia dapat menerima, menolak, atau mengubah proposal.
         Perubahan WAJIB meninggalkan trace dan snapshot yang dapat direproduksi.
```

## Gembok EF — berlaku pada AI path sekarang

```text
LAW-6.7  AI EF LOCK.

         Sampai occurrence-aware Execution Assessment contract memperoleh
         Owner PASS dan implementation gate:

           - effective AI efPermission = NOT_ALLOWED;
           - caller ALLOWED/SELECTED_ITEMS_ONLY DILARANG mengaktifkan EF;
           - provider wajib menerima NOT_ALLOWED;
           - non-empty executionFactorRefs WAJIB ditolak dengan
             EF_AI_PATH_LOCKED;
           - evidence wajib menyimpan:
               efPermission = NOT_ALLOWED
               efReferences = [].

LAW-6.8  Gembok ini hanya mengikat AI provider/orchestrator path.
         Ia tidak menghapus hak manusia untuk mengelola EF melalui ruang
         yang sah setelah capability tersebut dibangun.

LAW-6.9  Evidence lama tidak dapat diubah.
         Bila kemudian terbukti salah, ia hanya dapat disupersede oleh
         record baru yang menunjuk record lama dan alasan koreksi.
```

---

# BAGIAN 7 — HUMAN DECISION, EVIDENCE, DAN AUDIT

## JIWA

AI SIMPROK adalah pekerja analisis. Manusia tetap pemilik keputusan. Setiap usulan harus menjelaskan sumber, alasan, kepastian, dan apa yang belum diketahui.

## KONTRAK NORMATIF

```text
LAW-7.1  Proposal minimal membawa:
           request/occurrence reference
           selected canonical references
           source/evidence references
           reason codes
           confidence/certainty
           warnings
           policy version
           human decision status.

LAW-7.2  Evidence wajib append-only, tenant-scoped, dan policy-versioned.

LAW-7.3  Evidence tidak boleh menyimpan:
           API key
           raw secret
           unnecessary full prompt
           unnecessary sensitive source document
           fabricated source reference.

LAW-7.4  Evidence persistence failure → FAIL_CLOSED.

LAW-7.5  Human decision minimal:
           ACCEPT
           REJECT
           MODIFY
           DEFER / NEEDS_REVIEW
         beserta actor, authority, reason, timestamp, dan affected scope.

LAW-7.6  AI DILARANG menulis human decision atas nama manusia.
```

---

# BAGIAN 8 — MATRICES

> **Status seluruh matrix pada v1.0-DRAFT:** knowledge draft, bukan policy aktif.
> Sel tanpa sumber sah wajib berisi `PERLU KONFIRMASI MANUSIA`.
> Matrix hanya boleh dipublikasikan sebagai machine-active knowledge melalui governed review.

## MATRIX A — UNIVERSAL CONTEXT DICTIONARY

| Criteria | Definition | Data Type | Unit | Evidence Source |
|---|---|---|---|---|
| `elevation` | Ketinggian bidang kerja terhadap datum proyek | number | m | Drawing/survey |
| `floor` | Lantai occurrence | string | — | Drawing/WBS |
| `workFaceHeight` | Tinggi bidang kerja dari pijakan | number | m | Drawing/survey |
| `excavationDepth` | Kedalaman dari muka tanah | number | m | Drawing/survey |
| `interiorExterior` | Di dalam/luar building envelope | enum | — | Drawing |
| `horizontalAccess` | Cara/kemudahan akses horizontal | enum | — | Site survey |
| `verticalAccess` | Tangga/hoist/crane/lift/tidak tersedia | enum | — | Survey/method |
| `confinedSpace` | Ruang kerja terbatas | boolean | — | Survey |
| `terrain` | Keadaan permukaan/topografi | enum | — | Survey |
| `weatherExposure` | Paparan hujan/angin/panas | boolean | — | Survey/method |
| `activeArea` | Area tetap beroperasi | boolean | — | Project data |
| `timeRestriction` | Batas jam/shift/larangan | enum | — | Contract/regulation |
| `distributionMethod` | Cara material mencapai point of installation | enum | — | Method statement |
| `safetyExposure` | Jenis paparan risiko keselamatan | enum | — | RKK/regulation |

Nilai enum, skala, dan threshold: **PERLU KONFIRMASI MANUSIA**.

## MATRIX B — WORK FAMILY SENSITIVITY

> **DRAFT HYPOTHESIS — NOT MACHINE ACTIVE.**
> Sel `RELEVAN` adalah hipotesis domain awal dan wajib divalidasi oleh manusia/domain source sebelum publication.

Jenis dampak:
`PRODUCTIVITY` · `CONSUMPTION` · `DURATION` · `RISK` · `OPERATIONAL_REQUIREMENT`

| Family | Elevation | Vertical Access | Interior/Exterior | Confined Space | Weather Exposure | Distribution Method |
|---|---|---|---|---|---|---|
| Concrete | RELEVAN — PRODUCTIVITY · OPERATIONAL_REQUIREMENT | RELEVAN — DURATION · OPERATIONAL_REQUIREMENT | RELEVAN — RISK | RELEVAN — PRODUCTIVITY | RELEVAN — RISK · DURATION | RELEVAN — OPERATIONAL_REQUIREMENT |
| Painting | RELEVAN — RISK · OPERATIONAL_REQUIREMENT | RELEVAN — OPERATIONAL_REQUIREMENT | RELEVAN — CONSUMPTION · RISK | RELEVAN — PRODUCTIVITY | RELEVAN — DURATION · CONSUMPTION | PERLU KONFIRMASI MANUSIA |
| Earthwork/Excavation | RELEVAN — PRODUCTIVITY | PERLU KONFIRMASI MANUSIA | TIDAK RELEVAN | RELEVAN — PRODUCTIVITY · RISK | RELEVAN — DURATION | RELEVAN — OPERATIONAL_REQUIREMENT |
| Formwork | RELEVAN — OPERATIONAL_REQUIREMENT · RISK | RELEVAN — DURATION | RELEVAN — RISK | RELEVAN — PRODUCTIVITY | PERLU KONFIRMASI MANUSIA | PERLU KONFIRMASI MANUSIA |
| Reinforcement | RELEVAN — OPERATIONAL_REQUIREMENT | RELEVAN — DURATION · OPERATIONAL_REQUIREMENT | PERLU KONFIRMASI MANUSIA | RELEVAN — PRODUCTIVITY | PERLU KONFIRMASI MANUSIA | RELEVAN — OPERATIONAL_REQUIREMENT |
| MEP | RELEVAN — OPERATIONAL_REQUIREMENT | PERLU KONFIRMASI MANUSIA | RELEVAN — RISK | RELEVAN — PRODUCTIVITY · RISK | PERLU KONFIRMASI MANUSIA | PERLU KONFIRMASI MANUSIA |
| Road | TIDAK RELEVAN | TIDAK RELEVAN | TIDAK RELEVAN | PERLU KONFIRMASI MANUSIA | RELEVAN — DURATION | RELEVAN — OPERATIONAL_REQUIREMENT |
| Drainage | RELEVAN — PRODUCTIVITY | TIDAK RELEVAN | TIDAK RELEVAN | RELEVAN — RISK | RELEVAN — DURATION | PERLU KONFIRMASI MANUSIA |
| Marine Works | PERLU KONFIRMASI MANUSIA | PERLU KONFIRMASI MANUSIA | PERLU KONFIRMASI MANUSIA | PERLU KONFIRMASI MANUSIA | RELEVAN — DURATION · RISK | PERLU KONFIRMASI MANUSIA |

## MATRIX C — AHSP APPLICABILITY

> **FRAMEWORK ONLY — OCCURRENCE VERDICT B RECORDED; NOT MACHINE ACTIVE**

| Field | Meaning |
|---|---|
| `ahspId` | Canonical AHSP reference |
| `family` | Inherited work family |
| `usageConditions` | Kondisi ketika AHSP sah digunakan |
| `mandatoryQuestions` | Pertanyaan manusia sebelum penggunaan |
| `inheritance` | Criteria inherited from family |
| `override` | Hanya perbedaan dari family profile |
| `requiredData` | Data yang wajib ada; tidak ada → NEEDS_REVIEW |

## MATRIX D — OCCURRENCE ASSESSMENT

> **FRAMEWORK ONLY — OCCURRENCE VERDICT B RECORDED; NOT MACHINE ACTIVE**

| Field | Meaning | Layer |
|---|---|---|
| `occurrenceRef` | Identitas pemakaian AHSP pada satu keadaan | FACT |
| `contextValues` | Nilai criteria Matrix A | FACT |
| `contextEvidenceRefs` | Bukti fakta | FACT |
| `detectedFactors` | Faktor yang terdeteksi | INTERPRETATION |
| `impacts` | Productivity/consumption/duration/risk/operational impacts | INTERPRETATION |
| `executionRequirements` | Requirement yang lahir | INTERPRETATION |
| `resourceRequirements` | Resource + unit nyata | INTERPRETATION |
| `certainty` | Tingkat keyakinan | INTERPRETATION |
| `reasonCodes` | Alasan mesin | INTERPRETATION |
| `simprokRecommendation` | Proposal SIMPROK | PROPOSAL |
| `humanDecision` | ACCEPT/REJECT/MODIFY/DEFER | HUMAN DECISION |
| `humanReason` | Alasan manusia | HUMAN DECISION |
| `auditTrace` | Evidence/decision chain | AUDIT |

---

# BAGIAN 9 — REASON CODE REGISTRY (DRAFT)

| Reason Code | Meaning |
|---|---|
| `INSUFFICIENT_EVIDENCE` | Bukti belum cukup. |
| `CANONICAL_SOURCE_MISSING` | Referensi canonical tidak tersedia. |
| `BASIC_PRICE_NOT_CANONICAL` | Basic Price ID tidak sah/visible. |
| `MANUAL_UNSOURCED_PRICE` | Harga berasal dari input manual tanpa source canonical. |
| `COVERAGE_UNKNOWN` | Coverage harga/logistik belum diketahui. |
| `COST_HOME_OVERLAP` | Biaya/resource terdeteksi tinggal di lebih dari satu rumah. |
| `OCCURRENCE_CONTEXT_MISSING` | Konteks occurrence belum cukup. |
| `EXECUTION_REQUIREMENT_UNVERIFIED` | Requirement belum divalidasi manusia/evidence. |
| `EF_AI_PATH_LOCKED` | Jalur EF AI sengaja dikunci. |
| `PAGU_REVIEW_REQUIRED` | Hasil Cost Kernel perlu dibandingkan/ditinjau terhadap pagu. |
| `HUMAN_DECISION_REQUIRED` | Keputusan manusia wajib. |

Reason codes di atas belum machine-active sebelum Owner PASS dan implementation gate.

---

# BAGIAN 10 — ACCEPTANCE TEST LAW

Setiap hukum aktif wajib mempunyai test yang menunjukkan enforcement nyata.

```text
TEST-0.1  Bukti tidak cukup → NEEDS_REVIEW, bukan fabricated proposal.
TEST-1.1  Pagu tidak pernah diteruskan ke Cost Kernel.
TEST-1.2  Semua kombinasi flags memakai pipeline yang sama.
TEST-2.1  MANUAL_UNSOURCED tidak mendapat basicPriceId.
TEST-2.2  Fabricated/cross-tenant Basic Price ditolak.
TEST-3.1  Coverage unknown → NEEDS_REVIEW.
TEST-4.1  Overlapping resource/cost home tidak dihitung dua kali.
TEST-5.1  Perubahan occurrence A tidak mengubah occurrence B/AHSP master.
TEST-5.2  AI-generated threshold ditolak.
TEST-6.1  EF tidak menyimpan money/percentage.
TEST-6.2  Execution Requirement belum menjadi biaya sebelum resource + unit nyata.
TEST-6.3  AI EF path selalu NOT_ALLOWED sampai unlock gate.
TEST-6.4  Non-empty AI executionFactorRefs → EF_AI_PATH_LOCKED.
TEST-7.1  Evidence failure → FAIL_CLOSED.
TEST-7.2  AI tidak dapat menulis human decision.
TEST-GT.1 Satu Golden Thread nyata dapat direproduksi dari source sampai total.
```

---

# BAGIAN 11 — RECORDED DECISIONS / OWNER DECISIONS PENDING

| # | Decision / Open Item | Required Source/Gate |
|---|---|---|
| 1 | Occurrence verdict B: current `boqItemRef` is only the current proxy; it is not a structural Work Occurrence guarantee. | Completed repository check; no occurrence persistence in this document |
| 2 | Bentuk physical persistence Work Occurrence/Execution Assessment | Owner PASS + schema design |
| 3 | Threshold dan enum context | Official source/domain validation |
| 4 | Impact scale/bobot | Owner + verified data |
| 5 | Matrix C/D final | Occurrence decision |
| 6 | Golden Thread Blueprint amendment | Occurrence decision + audit |
| 7 | Manual price persistence contract | Repository reality + Owner decision |
| 8 | Canonical Basic Price Living Home/API | Separate implementation gate |
| 9 | EF AI unlock criteria | P7C PASS + occurrence-aware contract + tests |
| 10 | Full domain dictionary publication workflow | Platform knowledge governance |

---

# PENUTUP

SIMPROK adalah mata, cahaya, dan panduan dalam ketidakpastian konstruksi.

Hukum ini ada supaya cahayanya benar-benar berasal dari data, evidence, perhitungan deterministik, dan keputusan manusia—bukan kabut yang menyamar sebagai terang.

SIMPROK boleh berkata:

> **“Saya belum tahu.”**

SIMPROK tidak boleh berkata:

> **“Saya tahu,” padahal ia menebak.**

**SIMPROK menghitung dan merekomendasikan. Manusia memilih, menetapkan, menyetujui, dan bertanggung jawab.**

**SIMPROK tetap mata. Manusia tetap kehendak.**
**SIMPROK tetap terang. Manusia tetap pemimpin.**

### Soli Deo Gloria. Segala hormat dan kemuliaan hanya bagi Tuhan Yesus Kristus.
### Haleluya. Amin.
