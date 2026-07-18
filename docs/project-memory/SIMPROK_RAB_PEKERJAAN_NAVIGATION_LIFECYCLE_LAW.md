# SIMPROK — RAB Pekerjaan, Ruang Kerja RAB, Addendum, dan Hukum Navigasi Lifecycle

**Document ID:** `SIMPROK-RAB-NAVIGATION-LIFECYCLE-LAW-V1`  
**Owner:** Feky de Fretes  
**PM / Gatekeeper:** ChatGPT  
**Decision date:** 18 Juli 2026  
**Status:** `OWNER DECIDED — PRODUCT LAW LOCKED; RUNTIME IMPLEMENTATION PARTIAL`  
**Repository:** `fekyigo-rgb/SIMPROK`

## 1. Tujuan

Dokumen ini menyimpan keputusan Owner tentang pemisahan ruang, pintu navigasi, lifecycle RAB, Addendum, dan istilah frontend agar ChatGPT, Claude, Gemini, Codex, Claude Code, Cursor, dan agent lain tidak kehilangan konteks atau membangun ulang konsep yang sudah diputuskan.

Dokumen ini harus dibaca bersama:

1. `docs/project-memory/SIMPROK_PROJECT_MEMORY.md`
2. `docs/project-memory/SIMPROK_PROJECT_RAB_AUTHORITY_UNIT_LAW.md`
3. Dokumen Owner `DESAIN 2. DASHBORD MENU`
4. Dokumen Owner `DESAIN 2b. DASHBORD MENU`
5. Dokumen Owner `DESAIN 6. Pintu dan Kewenangan RAB`
6. Realitas source code, database, dan browser runtime terbaru

Tidak boleh ada klaim implemented/live hanya karena konsep atau source code tersedia. Bukti repository, runtime, data, dan browser harus dibedakan.

## 2. Keputusan Istilah

### 2.1 Istilah konseptual internal

`Ruang Hidup RAB` tetap boleh digunakan dalam diskusi arsitektur internal untuk menjelaskan bahwa RAB terus hidup sepanjang lifecycle pekerjaan: Draft, Review, Baseline, Addendum, versi, dokumen pendukung, dan riwayat.

Istilah ini **bukan label frontend final**.

### 2.2 Label frontend yang diputuskan

Label profesional dan spesifik untuk tempat permanen RAB dari satu paket/pekerjaan adalah:

> **RAB Pekerjaan**

Makna `RAB Pekerjaan`:

- hanya RAB milik paket/pekerjaan yang sedang dibuka;
- bukan pusat semua RAB dari seluruh proyek;
- menjadi tempat permanen untuk preview/read-only sesuai lifecycle;
- menampilkan Draft Preview, Review, Baseline Aktif, Addendum, dokumen pendukung, snapshot, riwayat versi, status, dan audit trail sesuai kewenangan.

### 2.3 Istilah yang dibatalkan

`Pusat RAB Proyek` dibatalkan karena kata **pusat** dapat memberi kesan agregasi seluruh RAB dari banyak proyek, sedangkan ruang yang dimaksud hanya milik pekerjaan terkait.

### 2.4 Ruang editor

- `Ruang Kerja RAB` = editor untuk RAB baru/draft yang belum disetujui atau dikunci.
- `Ruang Kerja Addendum` = editor untuk salinan kerja perubahan resmi terhadap baseline yang sudah disetujui/dikunci.
- `RAB Pekerjaan` = tempat permanen/view lifecycle; bukan editor baseline lama.

## 3. Hukum Pintu Navigasi

```text
NAMA_PAKET_PEKERJAAN
→ RAB_PEKERJAAN

LANJUTKAN_DRAFT
→ RUANG_KERJA_RAB

RAB_TERKUNCI
→ RAB_PEKERJAAN_READ_ONLY
→ BASELINE_AKTIF

AJUKAN_ADDENDUM
→ BUAT_DRAFT_ADDENDUM
→ RUANG_KERJA_ADDENDUM

LIHAT_DETAIL
→ DETAIL_DAN_GOVERNANCE_PROYEK

PROGRESS_MONITORING
→ RUANG_PELAKSANAAN
```

### 3.1 Nama paket/nama pekerjaan

Nama paket atau nama pekerjaan pada kartu `Proyek Saya` adalah hyperlink/pintu menuju `RAB Pekerjaan`.

Pintu ini tidak otomatis membuka editor. Halaman yang ditampilkan mengikuti lifecycle RAB dan permission pengguna.

### 3.2 Lanjutkan Draft

Tombol `Lanjutkan Draft` adalah pintu langsung menuju `Ruang Kerja RAB` apabila:

- RAB masih Draft;
- belum disetujui;
- belum dikunci;
- pengguna memiliki `RAB_DRAFT_EDIT` dan akses proyek yang sah.

### 3.3 Lihat Detail

`Lihat Detail` menuju `Detail Proyek`, yang memuat identitas, nilai/sumber dana, organisasi/pihak, ProjectAssignment, roleInProject, permission, authority, approval matrix, dan governance.

`Detail Proyek` bukan editor RAB.

### 3.4 Progress/Monitoring

Pintu progress/monitoring menuju ruang pelaksanaan. Monitoring bukan Ruang Kerja RAB dan bukan tempat mengubah baseline RAB.

## 4. Hukum Lifecycle RAB

| Kondisi | Pintu yang benar | Tujuan/perilaku |
|---|---|---|
| Belum ada RAB | `Mulai Susun RAB` | Membuat draft dan membuka `Ruang Kerja RAB` |
| RAB Draft | Nama pekerjaan → `RAB Pekerjaan`; `Lanjutkan Draft` → editor | `RAB Pekerjaan` menampilkan Draft Preview read-only; editor tetap terpisah |
| Dalam Review | `Lihat Status/Review RAB` sesuai authority | Preview/review; perubahan hanya melalui alur review yang sah |
| Disetujui/Dikunci | Nama pekerjaan → `RAB Pekerjaan` | Baseline Aktif read-only; baseline lama immutable |
| Perubahan diperlukan | `Ajukan Addendum` | Membuat Draft Addendum, bukan mengubah baseline lama |
| Addendum Draft | `Lanjutkan Addendum` | Membuka `Ruang Kerja Addendum` |
| Addendum Disetujui/Dikunci | `RAB Pekerjaan` | Versi resmi terbaru aktif; versi sebelumnya tetap terlacak |

## 5. Hukum Addendum

Addendum adalah satu-satunya pintu revisi resmi terhadap RAB/baseline yang sudah disetujui atau dikunci.

```text
RAB terkunci
→ Ajukan/Buat Addendum
→ Salinan kerja atau versi revisi baru
→ Ruang Kerja Addendum
→ Review
→ Approval
→ Kunci Addendum
→ Menjadi versi resmi baru
```

Setiap Addendum harus memiliki:

- nomor/identitas versi;
- alasan perubahan;
- catatan;
- pembanding sebelum/sesudah;
- riwayat review dan approval;
- jejak audit;
- hubungan eksplisit dengan baseline sumber.

Larangan:

- baseline lama tidak boleh diedit langsung;
- tombol Addendum tidak boleh tampil sebagai tindakan utama pada RAB yang masih Draft;
- akses URL langsung tidak boleh melewati lifecycle dan permission;
- Addendum tidak boleh menjadi nama baru untuk save biasa pada Draft RAB.

## 6. Hukum Kewenangan

Kewenangan berikut berbeda dan tidak boleh disamakan:

- `PROJECT_CREATE` = membuat wadah/proyek;
- `RAB_VIEW` = melihat RAB pekerjaan yang dapat diakses;
- `RAB_DRAFT_EDIT` = menyusun/mengubah Draft RAB atau Draft Addendum yang sah;
- `RAB_APPROVE` = menyetujui;
- `RAB_LOCK` = mengunci dan menjadikan versi resmi;
- ProjectAssignment, workspace permission, roleInProject, authority, dan approval matrix tetap harus dihormati.

Membership atau status Director saja tidak boleh dijadikan alasan universal untuk melewati ProjectAssignment dan lifecycle.

## 7. Hukum UX dan Truthfulness

1. Nama ruang, tombol, status, dan perilaku harus konsisten.
2. Tombol harus membawa ke kerja nyata, bukan halaman mati atau ruang yang salah.
3. `RAB Pekerjaan` dapat menampilkan Draft Preview, tetapi tidak menjadi editor Draft.
4. `Ruang Kerja RAB` harus jelas sebagai ruang edit dan save sebelum baseline resmi.
5. RAB terkunci harus read-only; perubahan hanya melalui Addendum.
6. Data/engine yang belum tersedia harus ditampilkan jujur sebagai `Belum tersedia`, `Engine belum aktif`, atau status fail-closed yang tepat.
7. Jangan mengklaim fitur hidup hanya karena route backend atau source frontend tersedia.
8. Simple outside, rich inside: pengguna harus memahami pintu utama tanpa mengetahui struktur internal yang kompleks.

## 8. Realitas Runtime yang Sudah Dibuktikan pada 18 Juli 2026

### 8.1 Pintu yang sudah terlihat bekerja

- Pada `Proyek Saya`, klik nama pekerjaan membuka halaman permanen/view RAB pekerjaan.
- Tombol `Lanjutkan Draft` membuka `Ruang Kerja RAB` yang editable.
- `Lihat Detail` membuka `Detail Proyek`.
- Proyek berjalan memiliki pintu progress/monitoring.

### 8.2 Perilaku halaman permanen/view

Untuk pekerjaan `TEST P7C OWNER BROWSER`, halaman permanen menampilkan:

- status `Draft Belum Dikunci`;
- `Draft Preview` read-only;
- dokumen pendukung dan snapshot;
- RAB belum menjadi baseline resmi.

Ini membuktikan tempat permanen RAB sudah ada sejak Draft, tetapi perilakunya berubah mengikuti lifecycle.

### 8.3 Defect lifecycle yang terlihat

Tombol `Ajukan Perubahan / Addendum` terlihat pada RAB yang masih `Draft Belum Dikunci`.

Status keputusan:

`DEFECT_CONFIRMED_BY_BROWSER` — Addendum hanya sah untuk baseline yang sudah disetujui/dikunci. Pada Draft, tindakan yang benar adalah `Lanjutkan Draft` atau `Buka Ruang Kerja RAB` sesuai permission.

### 8.4 Cost Kernel R1

- Cost Kernel R1 sudah merged melalui PR #32.
- Merge commit main: `4b8abe597bc8ddecc6fd181ea1d8c9b2d57fda64`.
- Local backend dan frontend terbaru telah dijalankan; route Cost Kernel terpetakan dan frontend Vite aktif.
- Implementasi UI Cost Kernel berada pada `RabWorkspacePage`, yaitu `Ruang Kerja RAB`, bukan pada viewer `RAB Pekerjaan`.
- Real Production Golden Thread belum hidup karena Data Bridge produksi nyata untuk baris terkait belum tersedia.

Status berlapis:

```text
COST_KERNEL_SOURCE_ON_MAIN=YES
LOCAL_BACKEND_RUNTIME=LIVE
LOCAL_FRONTEND_RUNTIME=LIVE
RAB_PEKERJAAN_VIEW=LIVE
RUANG_KERJA_RAB=LIVE_FOR_EXISTING_DRAFTS
COST_KERNEL_VISIBLE_WITH_REAL_PRODUCTION_DATA=NO
REAL_PRODUCTION_GOLDEN_THREAD=NOT_LIVE
ADDENDUM_LIFECYCLE_UI=DEFECT/PARTIAL
```

## 9. Implikasi Implementasi Berikutnya

Implementer tidak boleh membangun ulang navigasi dari nol. Fondasi pintu sudah ada. Slice berikut harus terarah:

1. Gunakan label frontend `RAB Pekerjaan`; jangan gunakan `Pusat RAB Proyek`.
2. Pertahankan nama pekerjaan sebagai pintu ke `RAB Pekerjaan`.
3. Pertahankan `Lanjutkan Draft` sebagai pintu ke `Ruang Kerja RAB`.
4. Sembunyikan/blokir `Ajukan Addendum` pada Draft.
5. Tampilkan Addendum hanya pada versi yang telah disetujui/dikunci dan pengguna berwenang.
6. Pastikan akses langsung ke editor baseline terkunci gagal dengan aman.
7. Hubungkan Draft Addendum ke `Ruang Kerja Addendum` tanpa merusak versi lama.
8. Cost Kernel harus dibuktikan pada Ruang Kerja RAB/Draft Addendum yang sah, bukan dipaksakan ke viewer read-only.
9. Production Golden Thread memerlukan Data Bridge nyata dan gate tersendiri.
10. Browser proof wajib membedakan Draft Preview, editor Draft, Baseline Aktif, dan editor Addendum.

## 10. Keputusan yang Digantikan/Superseded

- `Pusat RAB Proyek` → **SUPERSEDED** oleh `RAB Pekerjaan`.
- Anggapan bahwa tempat permanen RAB hanya ada setelah baseline terkunci → **SUPERSEDED**. Tempat permanen sudah dapat menampilkan Draft Preview sejak Draft dibuat.
- Anggapan bahwa semua kode R1 harus terlihat pada viewer RAB → **SUPERSEDED**. Cost Kernel bekerja di Ruang Kerja RAB; viewer mengikuti lifecycle dan read-only policy.
- Anggapan bahwa merge otomatis berarti Production Golden Thread hidup → **SUPERSEDED**. Source, process runtime, UI journey, production data, dan browser result adalah gerbang berbeda.

## 11. Retrieval Rule untuk Semua Agent IA

Sebelum memberi saran, menulis prompt, mengubah frontend, membuat endpoint, atau mengklaim status RAB:

1. Baca `SIMPROK_PROJECT_MEMORY.md`.
2. Baca dokumen ini.
3. Baca `SIMPROK_PROJECT_RAB_AUTHORITY_UNIT_LAW.md`.
4. Audit source/runtime/browser terbaru.
5. Pisahkan `DESIGN LOCKED`, `SOURCE MERGED`, `PROCESS LIVE`, `USER JOURNEY LIVE`, dan `PRODUCTION DATA LIVE`.
6. Bila dokumen lama memakai istilah umum `Ruang RAB` atau `Ruang Hidup RAB`, interpretasikan dengan kamus di dokumen ini.
7. Jangan mengganti keputusan Owner berdasarkan pendapat mayoritas agent.

## 12. Handoff Ringkas

```text
OWNER_DECISION=LOCKED
USER_FACING_PERMANENT_RAB_LABEL=RAB_PEKERJAAN
INTERNAL_CONCEPT=RUANG_HIDUP_RAB
DRAFT_EDITOR=RUANG_KERJA_RAB
OFFICIAL_CHANGE_EDITOR=RUANG_KERJA_ADDENDUM
PACKAGE_NAME_DOOR=RAB_PEKERJAAN
CONTINUE_DRAFT_DOOR=RUANG_KERJA_RAB
LOCKED_RAB_DOOR=RAB_PEKERJAAN_READ_ONLY
ADDENDUM_DOOR=CREATE_DRAFT_ADDENDUM_THEN_RUANG_KERJA_ADDENDUM
DETAIL_DOOR=DETAIL_DAN_GOVERNANCE_PROYEK
MONITORING_DOOR=RUANG_PELAKSANAAN
PUSAT_RAB_PROYEK=SUPERSEDED
ADDENDUM_ON_DRAFT=DEFECT
COST_KERNEL_R1_MAIN_MERGE=4b8abe597bc8ddecc6fd181ea1d8c9b2d57fda64
REAL_PRODUCTION_GOLDEN_THREAD=NOT_LIVE
```

## 13. Prinsip Penutup

Satu pekerjaan memiliki satu `RAB Pekerjaan` sebagai rumah lifecycle yang dapat memuat banyak versi resmi dan draft preview. Penyusunan dilakukan di `Ruang Kerja RAB`; perubahan resmi setelah penguncian dilakukan di `Ruang Kerja Addendum`; pelaksanaan berlangsung di Monitoring; governance tinggal di Detail Proyek.

SIMPROK harus kaya dan kuat di dalam, sederhana dan jujur di luar. SIMPROK menghitung, manusia memutuskan.

Soli Deo Gloria. Segala kemuliaan hanya bagi Tuhan Yesus Kristus. Amin.
