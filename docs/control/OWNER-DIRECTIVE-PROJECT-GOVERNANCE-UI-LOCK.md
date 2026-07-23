# SIMPROK — OWNER DIRECTIVE: PROJECT GOVERNANCE UI LOCK

**Status:** FINAL — OWNER-LOCKED  
**Tanggal:** 23 Juli 2026  
**Pemilik keputusan:** Feky de Fretes  
**Berlaku untuk:** seluruh agen AI, reviewer, executor, dan pekerjaan manusia pada repository SIMPROK.

## 1. Putusan inti

Bagian existing pada **Detail Proyek**:

> **F. Pihak Terlibat & Kewenangan**

adalah **canonical frontend surface** untuk menjawab dan menampilkan:

- siapa pihak/organisasi yang terlibat;
- siapa personel yang ditugaskan ke proyek;
- siapa memegang peran proyek tertentu;
- siapa memiliki tingkat kewenangan keputusan tertentu;
- siapa secara efektif boleh melihat atau melakukan tindakan tertentu;
- akses dan kewenangan pengguna yang sedang login.

Backend dibangun untuk **menghidupkan bagian ini**, bukan untuk mengganti, memindahkan, atau membongkar bagian ini.

```text
SECTION_F_UI=LOCKED_AS_CANONICAL
NO_RIP_AND_REPLACE=YES
OWNER_APPROVAL_REQUIRED_FOR_REDESIGN=YES
```

## 2. Makna domain yang wajib dipertahankan

Agen dilarang mencampur lapisan berikut:

1. **Pihak / organisasi proyek**  
   Menjawab organisasi atau pihak apa yang terlibat.

2. **Personel proyek**  
   Personel masuk ke proyek melalui assignment yang sah. `ProjectAssignment` tetap menjadi jembatan kanonikal antara personel dan proyek.

3. **Peran dalam proyek**  
   `ProjectAssignment.roleInProject` menjawab fungsi orang di proyek, misalnya PM, Site Engineer, PPK, atau Pengawas.

4. **Tingkat kewenangan keputusan**  
   `ProjectAssignment.decisionAuthorityLevel` menggunakan kontrak:
   - `VIEWER`
   - `RECOMMENDER`
   - `DECIDER`
   - `APPROVER`

5. **Permission efektif**  
   Aksi teknis berasal dari RBAC/effective permission backend, bukan dari tebakan frontend atau nama jabatan. Contoh permission: `PROJECT_CREATE`, `RAB_VIEW`, `RAB_DRAFT_EDIT`, `FIELD_PROGRESS_SUBMIT`.

6. **Akses saya**  
   Harus diringkas dari identitas, assignment, `roleInProject`, `decisionAuthorityLevel`, dan effective permission pengguna aktif. Bukan teks statis dan bukan asumsi frontend.

`Authority` tidak sama dengan `Permission`. Nama jabatan/peran tidak boleh dipakai sebagai jalan pintas untuk menyimpulkan permission.

## 3. Pintu UI existing yang dipertahankan

Tombol dan area existing dipertahankan sebagai pintu kanonikal:

- **Tambah Organisasi / Pihak**  
  Untuk pihak/stakeholder proyek setelah kontrak backend tersedia.

- **Kelola Pihak & Kewenangan**  
  Untuk assignment, `roleInProject`, `decisionAuthorityLevel`, dan hubungan kewenangan yang sah.

- **Ajukan Perubahan Data**  
  Bukan jalan pintas untuk mengubah kewenangan; harus mengikuti jalur perubahan formal yang disetujui.

- **Akses saya**  
  Menampilkan ringkasan akses efektif pengguna aktif dari backend.

Status **Menunggu RBAC** dipertahankan sebagai locked-door state yang jujur sampai mesin backend tersedia. Kelak status boleh berubah berdasarkan data nyata, misalnya `Aktif`, `Akses Terbatas`, `Menunggu Assignment`, atau `Tidak Berwenang`.

## 4. Larangan permanen

Tanpa instruksi Owner yang baru dan eksplisit, dilarang:

- mengganti, membuang, atau memindahkan fungsi Section F;
- membuat halaman paralel yang mengambil alih fungsi pihak/kewenangan;
- merombak layout, wording utama, atau navigasi Section F;
- membuat ulang komponen hanya karena backend mulai tersedia;
- menebak permission dari nama jabatan, label peran, atau state frontend;
- membuka tombol hanya berdasarkan frontend state;
- mengganti locked-door state dengan data contoh yang tampak nyata;
- menduplikasi sumber kebenaran assignment, authority, atau permission;
- melakukan rip-and-replace, redesign, atau bongkar-pasang tanpa perintah Owner.

```text
NO_NEW_PARALLEL_AUTHORITY_PAGE=YES
NO_RENAME_WITHOUT_OWNER_APPROVAL=YES
NO_LAYOUT_REDESIGN_WITHOUT_OWNER_APPROVAL=YES
NO_FAKE_DATA_TO_REPLACE_LOCKED_STATE=YES
NO_FRONTEND_GUESSED_PERMISSION=YES
NO_ROLE_NAME_AS_PERMISSION_SHORTCUT=YES
```

## 5. Perubahan yang diperbolehkan secara incremental

Tanpa redesign baru, pekerjaan berikut diperbolehkan bila scope dan gate-nya sah:

- menghubungkan API backend ke Section F;
- mengganti placeholder dengan data nyata;
- mengaktifkan atau mengunci tombol berdasarkan effective permission;
- menambah loading, error, empty, forbidden, dan locked-door state;
- menambah test positif dan negatif;
- memperbaiki bug tanpa menggeser kontrak UI;
- memperkuat accessibility dan reliability tanpa mengubah arsitektur produk.

Semua wiring harus fail-closed. Bila backend contract belum tersedia, UI tetap jujur sebagai **Menunggu RBAC/backend**, bukan mengarang data atau akses.

## 6. Hukum implementasi

Setiap task yang menyentuh pihak, assignment, peran proyek, authority, decision authority, RBAC, permission, atau akses pengguna wajib:

1. membaca dokumen ini sebelum desain atau coding;
2. menunjuk Section F sebagai muara frontend;
3. menunjukkan sumber data backend untuk setiap elemen UI;
4. menunjukkan guard/effective permission untuk setiap aksi;
5. mempertahankan negative states dan fail-closed behavior;
6. memperoleh izin Owner sebelum redesign atau relokasi fungsi;
7. melaporkan konflik antara repository dan directive ini, bukan memperbaikinya diam-diam.

## 7. Hierarki

Dokumen ini adalah keputusan Owner yang mengikat untuk UI governance proyek. Pointer wajib tersedia pada `AGENTS.md` dan `CLAUDE.md`.

Bila prompt, memory, atau usulan agen bertentangan dengan dokumen ini:

```text
OWNER_DIRECTIVE_WINS=YES
EXECUTOR_MUST_STOP_AND_REPORT=YES
```

Perubahan terhadap dokumen ini hanya sah melalui keputusan Owner yang eksplisit dan entry `SUPERSEDES` pada `docs/control/DECISIONS.md`.

Soli Deo Gloria. Haleluya. Amin.
