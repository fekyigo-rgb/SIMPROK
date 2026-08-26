# SIMPROK MONITORING — OWNER AMENDMENT 001
## HALAMAN 2 — PROGRESS, VISUAL EVIDENCE, PERIOD LENS & DYNAMIC ANALYSIS

**Document ID:** SIMPROK-MONITORING-OWNER-AMENDMENT-001  
**Status:** OWNER PASS / LOCKED / CANONICAL AMENDMENT  
**Owner:** Feky de Fretes  
**PM / Gatekeeper:** ChatGPT  
**Date:** 2026-08-22  
**Repository:** fekyigo-rgb/SIMPROK  
**Canonical Path:** `docs/roadmap/SIMPROK-MONITORING-OWNER-AMENDMENT-001-HALAMAN-2.md`  
**Applies to:** Halaman 2 Monitoring and downstream Monitoring UX slices that consume the same canonical truth.  
**Does NOT reopen:** Halaman 1, MON-02A, MON-03, PR #88, or any previously locked healthy foundation.

---

## 0. OWNER LOCK DECLARATION

Halaman 1 Monitoring tetap:

- FINAL PASS;
- LOCKED;
- DO NOT REOPEN.

Amendment ini **tidak mengganti** roadmap kanonik `SIMPROK-MONITORING-GRADE-A-ROADMAP.md`.
Amendment ini adalah penyempurnaan resmi bernomor untuk pengalaman produk **Halaman 2 Monitoring** dan harus dibaca bersama Product Law Monitoring serta roadmap kanonik.

Perubahan pada keputusan di dokumen ini hanya boleh dilakukan melalui:

1. perintah eksplisit Owner; atau
2. Owner Amendment bernomor berikutnya; atau
3. bukti konkret regression/contradiction terhadap canonical truth yang memaksa STOP dan review.

Tidak boleh ada reinterpretasi diam-diam oleh executor atau AI lain.

---

## 1. TUJUAN UTAMA HALAMAN 2

Halaman 2 Monitoring harus menjawab dua kebutuhan manusia yang paling mendasar:

### A. Kondisi progress sekarang
Pengguna ingin segera mengetahui:

- proyek sudah sampai mana;
- realisasi aktual berapa;
- seharusnya sampai mana;
- deviasinya berapa;
- pekerjaan apa yang paling memengaruhi kondisi;
- apakah proyek berjalan, terlambat, atau perlu perhatian;
- bagaimana forecast berdasarkan fakta yang tersedia.

Hal ini harus dapat dibaca **global proyek** maupun **detail sampai struktur RAB/WBS yang relevan**.

### B. Kondisi visual lapangan
Pengguna, terutama yang tidak terbiasa membaca grafik/bobot, harus dapat memahami keadaan proyek melalui:

- foto;
- video bila tersedia;
- evidence visual;
- keterangan waktu;
- lokasi/zona;
- hubungan ke pekerjaan/RAB/WBS;
- provenance/capture context yang sah.

Visual bukan galeri dekoratif. Visual adalah **evidence yang mempunyai konteks**.

---

## 2. HIRARKI INFORMASI FINAL

Urutan pengalaman Halaman 2 dikunci sebagai:

> **LIHAT KONDISI → LIHAT BUKTI → PAHAMI ANGKA → PAHAMI PENYEBAB → AMBIL TINDAKAN**

Halaman 2 tidak boleh menjadi kumpulan semua laporan yang tampil serentak.

Tujuan UX:

- pengguna baru memahami kondisi proyek dalam puluhan detik;
- 1–2 jam pertama tidak membingungkan;
- power user/engineer tetap dapat membuka detail sangat dalam melalui progressive disclosure;
- rich inside, simple outside.

---

## 3. STRUKTUR DESKTOP FINAL

### 3.1 Bagian atas — Context Controller

Halaman harus selalu menjelaskan empat konteks berikut:

1. **Scope**
   - Seluruh Proyek; atau
   - item/kelompok RAB/WBS yang sedang dipilih.

2. **Periode**
   - Terkini;
   - Mingguan;
   - Bulanan.

3. **Basis Periode**
   - Kalender; atau
   - Siklus Pelaporan Proyek.

4. **Data sampai / As-of**
   - tanggal dan waktu aktual data terakhir yang menjadi dasar pembacaan.

Contoh:

> Scope: 3.2 Pondasi Footplat & Sloof  
> Periode: Mingguan  
> Basis: Siklus Pelaporan Proyek  
> Siklus 7 · 15–21 Mei 2026  
> Data sampai: 21 Mei 2026 · 17:00 WIB

Tidak boleh hanya menampilkan "Minggu 7" tanpa rentang tanggal.

### 3.2 Bagian kiri — RAB/WBS sebagai jangkar

Pada desktop, tabel/struktur RAB/WBS tetap menjadi jangkar orientasi utama.

Fungsi:

- menunjukkan posisi pengguna di struktur pekerjaan;
- memungkinkan global → kelompok → item drill-down;
- mempertahankan hubungan Monitoring dengan baseline/RAB canonical;
- tidak berubah menjadi RAB editor atau RAB kedua.

Tabel dapat berevolusi menurut periode aktif, tetapi struktur pekerjaannya tetap canonical.

### 3.3 Bagian kanan — satu Dynamic Content Area

Panel kanan tidak berisi banyak dashboard sekaligus.
Ia adalah **satu ruang pandang yang berevolusi**.

Lensa utama:

1. **Visual Lapangan** — default pada first-use;
2. **Analisis**;
3. **Jadwal**.

Network/CPM dapat hadir sebagai advanced view di dalam Jadwal bila capability dan data memang tersedia.

Tidak boleh membuat tujuh tombol besar setara untuk Visual, Kurva S, Batang, Lingkaran, Diagram Alir, Jadwal, dan Network.

---

## 4. KONDISI SEKARANG

Panel kanan harus mempunyai ringkasan singkat sebelum konten detail.

Minimal bila tersedia secara sah:

- Progress Aktual;
- Rencana s.d. cut-off/as-of;
- Deviasi;
- Status;
- waktu berlalu / konteks durasi yang relevan;
- Forecast selesai.

Setiap nilai harus jelas scope dan periodenya.

UNKNOWN, UNAVAILABLE, NOT_YET_RECORDED, dan `0` tidak boleh disamakan.

SIMPROK boleh menjelaskan fakta yang tersedia, tetapi tidak boleh mengarang kepastian.

---

## 5. VISUAL LAPANGAN — DEFAULT HUMAN LENS

Visual Lapangan menjadi lensa default pada first-use karena merupakan bahasa paling universal bagi Owner, kontraktor, konsultan, pengawas, dan pengguna nonteknis.

Evidence visual idealnya dapat terkait dengan:

> Project → RAB/WBS Item → lokasi/zona → waktu → progress/laporan sumber → actor/capture method → caption/keterangan

Foto/video **tidak wajib pada setiap pencatatan progress**.
Evidence visual dapat opsional dan hanya menjadi wajib bila hukum/prosedur proyek atau kondisi tertentu memang mensyaratkannya.

Visual yang tidak mempunyai context/provenance tidak boleh diperlakukan sebagai bukti setara dengan evidence governed.

---

## 6. ANALISIS — SATU RUMAH, BANYAK VIEW

Di dalam lensa **Analisis**, view dapat berevolusi antara:

- **Kurva S**;
- **Perbandingan** (diagram batang bila cocok);
- **Komposisi** (diagram lingkaran/donut hanya bila benar-benar membantu membaca komposisi).

Diagram batang dan diagram lingkaran bukan modul kebenaran terpisah.
Mereka hanyalah representasi visual dari canonical progress truth yang sama.

### 6.1 Kurva S

Menjawab:

> Seberapa besar bobot kumulatif yang direncanakan dibanding aktual terhadap waktu?

Planned curve tetap immutable terhadap keterlambatan.
Actual curve membaca realisasi sampai cut-off/as-of.

### 6.2 Perbandingan

Dapat menampilkan, sesuai konteks:

- planned vs actual periode;
- planned vs actual cumulative;
- deviasi antar pekerjaan;
- ranking contributor keterlambatan;
- bentuk perbandingan lain yang sah.

### 6.3 Komposisi

Hanya digunakan ketika data benar-benar berbentuk bagian-dari-keseluruhan dan jumlah kategori masih mudah dibaca.

Diagram lingkaran **tidak wajib** dan tidak boleh dipakai sebagai ornamen dashboard.

---

## 7. JADWAL ≠ KURVA S

Keduanya wajib dipahami sebagai capability berbeda.

### Jadwal
Menjawab:

> Pekerjaan apa dilakukan, kapan mulai, berapa lama, kapan selesai, dan apa dependensinya?

Representasi dapat berupa Gantt/timeline/milestone/dependency sesuai capability yang tersedia.

### Kurva S
Menjawab:

> Berapa akumulasi progress/bobot planned dibanding actual terhadap waktu?

Tidak boleh mencampur kedua makna tersebut menjadi satu engine truth.

Network/critical path merupakan advanced schedule analysis, bukan pengganti Kurva S.

---

## 8. PERIOD LENS — TERKINI, MINGGUAN, BULANAN

Pelaporan Mingguan dan Bulanan **tidak menjadi pintu/modul terpisah di bagian bawah Halaman 2**.

Mereka adalah **cara membaca tabel Monitoring dan panel kanan pada periode yang dipilih**.

Prinsip:

> **Satu proyek. Satu struktur RAB. Satu progress truth. Banyak jendela waktu.**

### 8.1 Terkini

Membaca kondisi terbaru berdasarkan current valid/effective facts sampai As-of.

### 8.2 Mingguan

Dapat dibaca dengan dua basis:

- **Minggu Kalender**; atau
- **Siklus Pelaporan Proyek**.

Rentang tanggal wajib terlihat.

### 8.3 Bulanan

Dapat dibaca dengan dua basis:

- **Bulan Kalender**; atau
- **Siklus Pelaporan Proyek**.

Siklus Pelaporan Proyek dapat mengikuti cut-off/reporting cycle kontraktual/organisasi/proyek yang sah dan tidak harus sama dengan bulan kalender.

SIMPROK tidak boleh menebak reporting cycle jika belum ditetapkan.

---

## 9. SATU PERIODE AKTIF MENGENDALIKAN SELURUH HALAMAN

Ketika pengguna memilih satu periode, konteks tersebut harus mengendalikan secara konsisten:

- tabel RAB/WBS Monitoring;
- kondisi/ringkasan;
- evidence visual;
- Kurva S;
- Perbandingan;
- Komposisi bila relevan;
- Jadwal/as-of marker;
- Network/CPM bila tersedia;
- Ringkasan/Insight SIMPROK.

Komponen tidak boleh mempunyai filter waktu yang saling bertentangan tanpa alasan yang jelas.

---

## 10. EVOLUSI TABEL RAB/WBS MENURUT PERIODE

Tabel Monitoring bukan laporan statis.
Ia berevolusi sesuai periode aktif.

Contoh view **Terkini**:

- Bobot Item;
- Rencana s.d. Hari Ini;
- Aktual s.d. Hari Ini;
- Deviasi;
- Status.

Contoh view **Mingguan**:

- Bobot Item;
- Rencana periode minggu terpilih;
- Realisasi periode minggu terpilih;
- Kumulatif s.d. minggu tersebut;
- Deviasi;
- Status.

Contoh view **Bulanan**:

- Bobot Item;
- Rencana bulan/siklus terpilih;
- Realisasi bulan/siklus terpilih;
- Kumulatif s.d. periode tersebut;
- Deviasi;
- Status.

Exact column contract tetap harus mengikuti data yang benar-benar tersedia dan hasil audit current architecture; jangan mengarang field hanya agar tabel terlihat lengkap.

---

## 11. LAPORAN HARIAN

Laporan Harian tetap dapat menjadi pintu operasional karena fungsinya berbeda.

Laporan Harian adalah salah satu sumber/capture reality yang dapat memuat sesuai capability dan authority:

- kegiatan;
- quantity/progress;
- tenaga;
- alat;
- cuaca;
- kendala;
- evidence;
- catatan lapangan.

Sedangkan:

- Mingguan = agregasi/view periodik dari canonical truth;
- Bulanan = agregasi/view periodik dari canonical truth.

Tidak boleh membuat weekly engine dan monthly engine yang menjadi sumber kebenaran paralel.

---

## 12. FOCUS VIEW / FULL CANVAS

Default desktop mempertahankan RAB/WBS di kiri.

Visual, Analisis, atau Jadwal boleh dibuka ke Focus View/full canvas ketika pengguna membutuhkan ruang lebih besar.

Focus View:

- bukan route truth baru;
- bukan engine baru;
- hanya perubahan presentasi;
- harus kembali ke context yang sama tanpa kehilangan scope/periode aktif.

---

## 13. MOBILE / RESPONSIVE LAW

Stable-left-anchor berlaku terutama untuk desktop/tablet yang cukup lebar.

Pada mobile:

- jangan memaksakan dua panel sempit;
- gunakan progressive drill-down / stacked view;
- scope dan periode harus tetap terlihat;
- business facts tidak boleh hilang demi estetika;
- user tetap dapat kembali dari detail ke struktur pekerjaan dengan mudah.

Desktop dan mobile membaca canonical truth yang sama.

---

## 14. SIMPROK INSIGHT / CERITA PROYEK

SIMPROK boleh memberikan penjelasan singkat atas fakta yang tersedia, misalnya:

- progress berada di bawah rencana;
- kelompok pekerjaan tertentu menjadi contributor deviasi;
- evidence terakhir berasal dari tanggal tertentu;
- forecast berubah karena data aktual yang masuk.

Insight:

- harus dapat ditelusuri ke data;
- harus menyebut uncertainty bila ada;
- bukan approval;
- bukan perubahan baseline;
- bukan instruksi kontraktual otomatis.

---

## 15. BASELINE / ACTUAL / FORECAST / SIMULATION / RECOVERY

Lima lapisan tetap terpisah:

1. Baseline = rencana resmi/effective;
2. Actual = kenyataan yang governed;
3. Forecast = proyeksi;
4. Simulation = skenario hipotetis;
5. Recovery = corrective planning governed.

Monitoring tidak boleh:

- menggeser baseline otomatis;
- menutupi deviasi dengan redistribusi planned weight;
- menyebut forecast sebagai plan;
- memperlakukan simulation draft sebagai keputusan resmi;
- melakukan Recovery approval otomatis.

Manusia berwenang tetap memutuskan perubahan formal.

---

## 16. REUSE LAW / NO DUPLICATE TRUTH

Halaman 2 wajib reuse canonical capability yang sudah ada dan sehat, termasuk sejauh terbukti relevan:

- Project identity;
- Project access/assignment;
- RAB/WBS structure;
- effective baseline;
- actual/progress;
- evidence;
- audit;
- project timezone/history;
- permission/authority;
- correction lineage.

Dilarang membuat:

- Monitoring Engine v2;
- duplicate project source;
- duplicate actual engine;
- duplicate progress truth;
- weekly progress truth engine;
- monthly progress truth engine;
- persistence paralel hanya untuk melayani visualisasi.

Formula kerja:

> **CURRENT REALITY → PROVE → PRESERVE → REUSE → MINIMUM SAFE DELTA**

---

## 17. APA YANG TIDAK BOLEH MEMADATI HALAMAN 2

Jangan menampilkan semua capability sekaligus hanya karena tersedia.

Tidak perlu menjadi kartu/pintu besar independen pada permukaan utama:

- Laporan Mingguan;
- Laporan Bulanan;
- Diagram Batang;
- Diagram Lingkaran;
- Network Planning bila masih dapat menjadi advanced view Jadwal;
- detail audit mentah;
- detail engine internal;
- price detail/RAB pricing detail;
- semua evidence sekaligus;
- semua exception sekaligus.

Gunakan progressive disclosure.

---

## 18. ACCEPTANCE CRITERIA — SUPER GRADE-A HALAMAN 2

Halaman 2 hanya boleh disebut Grade-A apabila terbukti:

### Clarity
- pengguna baru dapat menjawab "proyek sekarang bagaimana?" dalam puluhan detik;
- scope aktif jelas;
- periode aktif jelas;
- rentang tanggal jelas;
- As-of/data cut-off jelas.

### Truth
- satu angka mempunyai satu canonical source;
- weekly/monthly/current view konsisten terhadap source yang sama;
- `0`, UNKNOWN, UNAVAILABLE, NOT_YET_RECORDED dibedakan;
- baseline tidak berubah akibat Monitoring.

### Evidence
- visual yang diperlakukan sebagai evidence mempunyai context/provenance yang memadai;
- selected period memfilter evidence secara konsisten;
- evidence dapat ditelusuri ke pekerjaan yang relevan bila hubungan memang tersedia.

### Period Integrity
- Calendar period dan Project Reporting Cycle mempunyai semantik berbeda dan jelas;
- rentang tanggal selalu terlihat;
- no silent boundary shift;
- timezone project dihormati.

### UX
- default surface tidak ramai;
- Visual Lapangan mudah dipahami pengguna nonteknis;
- engineer dapat drill down ke Analisis/Jadwal;
- Focus View tidak menghilangkan context;
- mobile tidak memaksa desktop split layout.

### Security / Governance
- project/tenant access tetap canonical;
- unauthorized read/write tetap ditolak;
- Recovery/official decision mengikuti authority;
- Monitoring read behavior tidak membuka mutation liar.

### Engineering
- reuse existing healthy architecture;
- no parallel truth engine;
- minimum coherent delta;
- focused tests + regression sesuai risiko;
- runtime/browser proof;
- negative proof terhadap mutation/tenant leakage sesuai scope.

---

## 19. FINAL LOCKED INFORMATION HIERARCHY

```text
HALAMAN 2 MONITORING
│
├── Context Controller
│   ├── Scope
│   ├── Periode: Terkini / Mingguan / Bulanan
│   ├── Basis: Kalender / Siklus Pelaporan Proyek
│   └── Data sampai / As-of
│
├── Kondisi Sekarang
│   ├── Actual
│   ├── Planned-to-date
│   ├── Deviasi
│   ├── Status
│   └── Forecast
│
├── KIRI — RAB/WBS Monitoring
│   └── berevolusi sesuai periode aktif
│
└── KANAN — Dynamic Content Area
    ├── Visual Lapangan [default first-use]
    ├── Analisis
    │   ├── Kurva S
    │   ├── Perbandingan
    │   └── Komposisi [hanya bila relevan]
    └── Jadwal
        └── Network/CPM [advanced bila tersedia]

Supporting operational doors
├── Laporan Harian
├── SMKK [sesuai capability]
├── Logistik [sesuai capability]
└── Cashflow [opsional / hanya jika sah]
```

---

## 20. FINAL DECLARATION

Arah produk Halaman 2 dikunci sebagai:

> **Satu tabel pekerjaan.  
> Satu periode aktif.  
> Satu area pandang yang berevolusi.  
> Satu sumber kebenaran.**

Dan:

> **Monitoring harus dapat dipahami terlebih dahulu dengan mata, kemudian dibuktikan dengan angka, dan akhirnya ditelusuri sampai sumber buktinya.**

Halaman 2 harus tetap cukup sederhana bagi Owner/nonteknis, cukup dalam bagi konsultan/kontraktor/engineer, dan cukup governed untuk project controls profesional.

**Status: OWNER PASS / LOCKED / CANONICAL AMENDMENT.**

**Forward only. Preserve healthy work. Reuse before rebuild.**

Soli Deo Gloria.  
Segala kemuliaan hanya bagi Tuhan Yesus Kristus. Amin.
