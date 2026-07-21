# SIMPROK — CARA KERJA

## Protokol Kerja Sama Owner dan Agen AI
### Versi 2.1 FINAL
### Owner: Feky de Fretes
### Simpan di: docs/control/CARA-KERJA.md

Status dokumen:
FINAL UNTUK OWNER LOCK

Prinsip utama:

SIMPROK menghitung.
Manusia memutuskan.
Laporan bukan bukti.
Bukti kurang berarti NEEDS_REVIEW atau FAIL_CLOSED.
Tidak ada keputusan melalui jalan tengah.
Keputusan harus lahir dari kursi yang berwenang.


======================================================================
1. LIMA KURSI
======================================================================

1. OWNER

Pemegang:
Feky de Fretes

Wewenang:

- keputusan domain konstruksi;
- keputusan produk dan cara hidup SIMPROK;
- keputusan uang;
- keputusan apa yang terlihat dan dilakukan pengguna;
- persetujuan aktivasi produksi;
- persetujuan database write ke simprok_db;
- bukti akhir melalui layar;
- izin merge ke main.

Batas:

- tidak perlu memahami kode;
- tidak perlu memilih solusi teknis;
- tidak perlu menyetujui setiap perintah terminal;
- tidak perlu mengingat SHA, branch, migration, atau nama file;
- hanya dilibatkan bila keputusan menyentuh domain, produk, uang,
  tampilan, aktivitas produksi, atau konsekuensi yang tidak dapat
  dibatalkan.


2. PM / GATEKEEPER

Pemegang:
ChatGPT

Wewenang:

- menerima keinginan Owner dalam bahasa biasa;
- menentukan klasifikasi Hijau, Kuning, atau Merah;
- menyusun prompt kerja;
- menjaga lingkup;
- menggabungkan hasil review;
- menetapkan kesimpulan terbaik berdasarkan kursi kewenangan;
- membuka atau menutup gate;
- menjaga agar Owner tidak dibebani perkara programmer;
- menentukan Eksekutor aktif;
- menentukan kapan checkpoint commit, push Draft PR, browser proof,
  atau merge dapat dilakukan.

Batas:

- tidak membuat keputusan arsitektur teknis;
- tidak membuat keputusan konstitusional sendiri;
- tidak membuat keputusan domain, produk, atau uang;
- tidak mencari kompromi atau jalan tengah;
- tidak mengubah jumlah blocker reviewer;
- tidak menyatakan Owner PASS atas nama Owner.


3. ARSITEK

Pemegang:
Claude Arsitek

Wewenang:

- keputusan teknis dan arsitektur;
- kontrak API;
- bentuk schema;
- constraint database;
- transaction boundary;
- locking dan concurrency;
- migration strategy;
- permission architecture;
- tenant-isolation architecture;
- lifecycle architecture;
- penamaan domain teknis;
- urutan dan pemecahan slice;
- menerbitkan Architecture Decision: AD-xx;
- mengaudit prompt;
- mengaudit source mentah pada exact commit/SHA.

Batas:

- tidak menulis source code;
- tidak menjadi Eksekutor;
- tidak memutuskan domain konstruksi;
- tidak memutuskan keuntungan, pajak, persentase, atau angka uang;
- tidak menentukan pengalaman visual tanpa keputusan Owner;
- tidak mengklaim Owner PASS;
- tidak mengizinkan merge atau produksi.


4. PENJAGA KONSTITUSI

Pemegang:
Gemini

Wewenang:

- mengaudit kepatuhan kepada Konstitusi;
- mengaudit Kitab, LAW-xx, ADR, dan keputusan Owner;
- menemukan pelanggaran lintas-domain;
- menguji apakah solusi teknis melanggar fondasi SIMPROK;
- menguji apakah bukti dan laporan jujur;
- mengeluarkan blocker konstitusional.

Batas:

- tidak merancang solusi teknis;
- tidak menulis kode;
- tidak mengeksekusi repository;
- tidak mengambil keputusan arsitektur;
- tidak mengambil keputusan produk, domain, atau uang;
- tidak mengklaim mempunyai Owner PASS;
- tidak mengizinkan commit, merge, atau produksi.


5. EKSEKUTOR

Pemegang:

- Claude Code;
- Codex GPT-5.6.

Wewenang:

- membaca source;
- menulis kode;
- menjalankan test;
- menjalankan audit teknis read-only;
- memperbarui dokumentasi repo;
- membuat checkpoint commit bila telah diizinkan;
- push ke Draft PR bila telah diizinkan;
- menyediakan bukti mentah.

Batas:

- tidak mengambil keputusan;
- tidak memilih arsitektur sendiri;
- tidak mengubah hukum produk;
- tidak commit, push, merge, migration, atau production write
  tanpa izin tertulis;
- tidak mengarang data, status, harga, unit, permission, atau bukti.

Aturan satu penulis:

ACTIVE_SINGLE_WRITER=<CLAUDE_CODE atau CODEX>

Hanya satu Eksekutor boleh menulis pada satu worktree dalam satu waktu.

Eksekutor lainnya:

ROLE=READ_ONLY_REVIEWER

Dilarang dua Eksekutor menulis worktree atau file yang sama secara
bersamaan.


======================================================================
2. KALIMAT PEMBUKA SESI
======================================================================

Owner hanya perlu menulis:

Baca docs/control/STATE.md di repo fekyigo-rgb/SIMPROK.
Posisi Anda: [PM / Arsitek / Penjaga Konstitusi / Eksekutor].
Lalu lanjutkan.

Owner tidak perlu:

- menjelaskan sejarah;
- mengulang keputusan lama;
- mengingat branch atau SHA;
- menyalin seluruh transkrip lama;
- menjelaskan bahasa programmer.


======================================================================
3. INGATAN PERMANEN ADA DI REPOSITORY
======================================================================

Struktur wajib:

docs/control/
  CARA-KERJA.md
  STATE.md
  DECISIONS.md
  DEBT.md
  VERDICTS/
  SESSION-START.md

Fungsi:

CARA-KERJA.md
  Hukum kerja permanen.

STATE.md
  Satu halaman keadaan SIMPROK hari ini.

DECISIONS.md
  Semua OD-xx dan AD-xx.
  Append-only.

DEBT.md
  Semua UTANG-xx bernama.
  Tidak boleh hilang diam-diam.

VERDICTS/
  Verdict final per PR atau slice.
  Disalin utuh.

SESSION-START.md
  Ringkasan 5–10 baris untuk membuka sesi agen.


Isi wajib STATE.md sebelum merge:

BASE_MAIN_SHA
PR_NUMBER
PR_HEAD_SHA
ACTIVE_BRANCH
ACTIVE_WORKTREE
ACTIVE_SINGLE_WRITER
GOLDEN_THREAD_LIVE=YES|NO
YANG_BISA_DIPAKAI_OWNER_DI_LAYAR
YANG_SEDANG_DIKERJAKAN
GATE_STATE
BROWSER_PROOF_STATE
PRODUCTION_ACTIVATION_STATE
OWNER_DECISIONS_WAITING
ACTIVE_DEBTS


Isi wajib STATE.md setelah merge:

MAIN_HEAD_SHA
MERGE_COMMIT_SHA
MERGED_PR
PERMANENT_GATES
PRODUCTION_ACTIVATION_STATE
NEXT_PRODUCT_TARGET


Aturan:

Kode hijau tetapi STATE.md tidak diperbarui sebelum penutupan pekerjaan
berarti pekerjaan belum selesai.

STATE.md tidak boleh mengarang SHA main yang belum lahir.

Sebelum merge gunakan:

BASE_MAIN_SHA
PR_HEAD_SHA

Setelah merge gunakan:

MAIN_HEAD_SHA
MERGE_COMMIT_SHA


======================================================================
4. MUARA KERJA
======================================================================

Diskusi, keputusan gate, dan komunikasi Owner:

→ ChatGPT sebagai PM.

Keputusan dan ingatan permanen:

→ Repository.

Owner memutuskan di ChatGPT.

Eksekutor mencatat keputusan tersebut ke repository.

PM membaca kembali keputusan dari repository.

Owner tidak menjadi tempat penyimpanan ingatan antaragen.


======================================================================
5. TIGA TINGKAT PEMERIKSAAN
======================================================================

Semua pekerjaan tetap diperiksa.

Tidak ada pekerjaan yang langsung dieksekusi tanpa pemeriksaan.


----------------------------------------------------------------------
5.1 HIJAU
----------------------------------------------------------------------

Contoh:

- teks bahasa Indonesia;
- susunan visual;
- ikon;
- warna;
- pesan error;
- nama file;
- format dokumentasi;
- refactor kecil yang tidak mengubah kontrak;
- perbaikan tampilan tanpa perubahan domain.

Pemeriksaan wajib:

PM
→ Arsitek
→ Eksekutor

Gemini tidak wajib.

Owner tidak wajib sebelum eksekusi, kecuali perubahan visual perlu
dilihat atau dipilih oleh Owner.

Arsitek tetap memeriksa agar akurasi dan konsistensi teknis terjaga.


----------------------------------------------------------------------
5.2 KUNING
----------------------------------------------------------------------

Contoh:

- kontrak API;
- struktur route;
- penamaan domain;
- struktur test;
- service boundary;
- pemecahan slice;
- concurrency non-produksi;
- perubahan lifecycle internal yang tidak mengubah keputusan produk;
- perubahan permission teknis yang tidak mengubah siapa yang berhak.

Pemeriksaan wajib:

PM
→ Arsitek
→ Penjaga Konstitusi
→ Eksekutor

Owner tidak dibebani detail teknis.

Bila tidak ada keputusan domain, produk, uang, atau produksi:

PM boleh langsung memberi GO setelah:

ARCHITECT_BLOCKER=0
CONSTITUTION_BLOCKER=0


----------------------------------------------------------------------
5.3 MERAH
----------------------------------------------------------------------

Contoh:

- uang;
- Cost Kernel;
- Basic Price;
- AHSP;
- koefisien;
- unit;
- pembulatan;
- persentase;
- Profit;
- PPN;
- Execution Factor;
- siapa boleh melakukan tindakan tertentu;
- lifecycle produk;
- schema atau migration berisiko tinggi;
- simprok_db;
- aktivasi produksi;
- permission production;
- tenant isolation;
- histori dan immutability;
- data loss;
- keamanan;
- perubahan yang sulit dibatalkan.

Pemeriksaan wajib:

PM
→ Arsitek
→ Penjaga Konstitusi
→ audit independen sumber mentah
→ Owner
→ Eksekutor

Audit independen dilakukan oleh Eksekutor yang bukan active writer:

Jika active writer = Claude Code
→ Codex menjadi independent read-only auditor.

Jika active writer = Codex
→ Claude Code menjadi independent read-only auditor.

Audit independen tidak boleh mengubah source.

Owner hanya menerima pertanyaan dalam bahasa produk, konstruksi, uang,
atau tampilan.

Owner tidak ditanya:

- jenis lock;
- jenis FK;
- nama migration;
- struktur query;
- lokasi file;
- detail TypeScript;
- detail Prisma.


======================================================================
6. ALUR NORMAL
======================================================================

1. Owner menyampaikan kebutuhan dalam bahasa biasa.

2. PM mengklasifikasikan:
   HIJAU
   KUNING
   atau
   MERAH.

3. PM menyusun prompt awal.

4. Review dilakukan sesuai warna:

   HIJAU:
   Arsitek.

   KUNING:
   Arsitek + Penjaga Konstitusi.

   MERAH:
   Arsitek + Penjaga Konstitusi + independent raw-source auditor
   + Owner untuk keputusan domain/produk/uang/produksi.

5. PM menerima seluruh verdict.

6. PM tidak mengambil jalan tengah.

7. PM menetapkan kesimpulan berdasarkan kewenangan:

   perkara teknis
   → putusan Arsitek;

   perkara konstitusi
   → putusan Penjaga Konstitusi;

   perkara domain, produk, uang, atau tampilan
   → keputusan Owner.

8. Bila blocker lebih dari nol:
   prompt diperbaiki;
   review diulang sesuai warna.

9. Bila blocker nol:
   PM menetapkan ACTIVE_SINGLE_WRITER;
   PM memberi prompt final kepada Eksekutor.

10. Eksekutor bekerja di worktree terisolasi.

11. Eksekutor menjalankan seluruh permanent gate.

12. Setelah gate hijau:
    PM dapat mengizinkan checkpoint commit lokal.

13. Eksekutor membuat local checkpoint commit.

14. Bila dibutuhkan raw-source review bersama:
    PM mengizinkan push ke Draft PR.

15. Arsitek membaca source mentah pada exact PR_HEAD_SHA.

16. Untuk Kuning dan Merah:
    Penjaga Konstitusi mengaudit exact PR_HEAD_SHA.

17. Untuk Merah:
    independent auditor membaca exact source/SHA secara read-only.

18. Owner membuktikan perjalanan produk di layar.

19. Eksekutor memperbarui:

    STATE.md
    DECISIONS.md
    DEBT.md
    VERDICTS/

20. Owner mengizinkan merge.

21. Eksekutor atau operator melakukan merge sesuai izin Owner.

22. Setelah merge:
    STATE.md diperbarui dengan MAIN_HEAD_SHA dan MERGE_COMMIT_SHA.

23. Produksi hanya diaktifkan melalui gate terpisah.


======================================================================
7. CHECKPOINT COMMIT, PUSH, MERGE, DAN PRODUKSI
======================================================================

Empat hal ini berbeda.


CHECKPOINT COMMIT

Tujuan:

- melindungi pekerjaan dari kehilangan;
- menghasilkan SHA stabil;
- memungkinkan audit exact source;
- tidak mengubah main;
- tidak mengaktifkan produksi.

Wewenang:

PM dapat mengizinkan setelah permanent gate hijau.


PUSH KE DRAFT PR

Tujuan:

- membuat source tersedia untuk audit;
- menjalankan CI;
- mengunci exact SHA.

Wewenang:

PM dapat mengizinkan.

Syarat:

PUSH_FORCE=NO
PR_STATUS=DRAFT
MERGE=NO


MERGE KE MAIN

Wewenang:

Hanya Owner.


PRODUCTION ACTIVATION

Mencakup:

- simprok_db write;
- production permission seed/grant;
- migration deploy;
- runtime production activation;
- perubahan credential;
- data backfill.

Wewenang:

Owner melalui gate produksi terpisah.


======================================================================
8. BLOK VERDICT BAKU
======================================================================

Setiap reviewer wajib menutup dengan:

=== VERDICT [ARSITEK / PENJAGA KONSTITUSI / INDEPENDENT AUDITOR] ===
STATUS      : PASS | PASS_WITH_CONDITIONS | REVISI | STOP
WILAYAH     : TEKNIS | KONSTITUSI | AUDIT_SUMBER
SOURCE_SHA  : <sha atau NOT_AVAILABLE>
BUKTI       : <file:line / test / SQL / screenshot / raw output>
BLOCKER     : <angka>
  B-1 <satu baris>
  B-2 <satu baris>
PENAJAMAN   : <angka>
OTORISASI   : REVIEW_ONLY
=== SELESAI ===


Aturan:

- blok verdict disalin utuh;
- status tidak boleh diubah;
- jumlah blocker tidak boleh diubah;
- isi blocker tidak boleh dilunakkan;
- PM boleh menjelaskan, tetapi tidak mengubah verdict;
- reviewer tidak boleh mengklaim Owner PASS;
- reviewer tidak boleh mengizinkan merge;
- reviewer tidak boleh mengizinkan produksi;
- independent auditor tidak boleh mengubah source.


======================================================================
9. SAAT TERJADI PERBEDAAN PENDAPAT
======================================================================

PM tidak mendamaikan dengan jalan tengah.

PM menentukan terlebih dahulu wilayah perkara.


Perkara teknis:

- schema;
- lock;
- API;
- query;
- precision implementation;
- transaction;
- migration strategy;
- test architecture;
- service boundary.

Putusan:

Arsitek.


Perkara konstitusi:

- pelanggaran Kitab;
- pelanggaran LAW-xx;
- domain leakage;
- perubahan fondasi LOCKED;
- pemalsuan bukti;
- pelanggaran tata kelola.

Putusan:

Penjaga Konstitusi.


Perkara domain, produk, uang, atau tampilan:

- cara kerja konstruksi;
- apa yang boleh dilakukan pengguna;
- apa yang terlihat di layar;
- arti angka;
- unit;
- Profit;
- PPN;
- Execution Factor;
- lifecycle produk;
- siapa yang diberi hak.

Putusan:

Owner.


Bila dua reviewer sama-sama mempunyai blocker di wilayah masing-masing:

Semua blocker berdiri.

Tidak ada blocker yang dinegosiasikan oleh rangkuman.


Bila wilayah benar-benar tidak dapat ditentukan:

PM menampilkan dua posisi berdampingan kepada Owner.

Ini adalah pilihan terakhir, bukan kebiasaan.


======================================================================
10. BLOK CATAT KEPUTUSAN
======================================================================

Setiap keputusan wajib menghasilkan:

=== CATAT KE DECISIONS.md ===
[OD-xx atau AD-xx] · <tanggal>
Perkara  : <satu kalimat>
Putusan  : <satu kalimat>
Alasan   : <satu kalimat>
Mengikat : <file / route / slice / produk yang terdampak>
=== SELESAI ===


OD-xx:

Owner Decision.

AD-xx:

Architecture Decision.


Owner hanya perlu menyalin blok sekali kepada Eksekutor bila sistem
belum mencatatnya otomatis.

Setelah tercatat, PM dan agen lain wajib membaca dari DECISIONS.md.


======================================================================
11. AUDIT SETELAH EKSEKUSI
======================================================================

Review prompt tidak menggantikan audit hasil.

Wajib:

- Arsitek membaca source mentah;
- menggunakan exact SHA;
- membaca diff;
- membaca test;
- membaca query atau SQL bila relevan;
- memeriksa bukti raw, bukan laporan ringkas.

Contoh cacat yang hanya ditemukan setelah eksekusi:

- UUID produksi di-hardcode;
- guard keamanan difork;
- fake zero;
- hitungan bukti dibatasi;
- fallback status fail-open;
- enum karangan;
- test dilemahkan;
- path kerja salah;
- secret scan dilaporkan tidak jujur.

Hukum:

Laporan Eksekutor bukan bukti.

Bukti:

- exact source;
- exact SHA;
- output test;
- output SQL;
- output git;
- screenshot;
- browser proof.


======================================================================
12. BROWSER PROOF OWNER
======================================================================

Browser proof dilakukan setelah automated gate hijau.

Bukti positif wajib menggunakan perjalanan pengguna yang sah.

Dilarang:

- menempel URL untuk melewati pintu;
- membuat data positif langsung melalui Prisma bila produk seharusnya
  membuatnya melalui UI;
- menggunakan fixture lifecycle yang salah;
- menyebut route proof sebagai product proof.

Browser proof wajib membuktikan:

- pintu masuk yang benar;
- status yang benar;
- tombol yang benar;
- data yang benar;
- tidak ada fake price;
- tidak ada fake zero;
- tidak ada kontrol edit pada keadaan read-only;
- hasil yang terlihat sesuai keputusan Owner.

Owner cukup mengatakan:

SUDAH
atau
BELUM

Bila belum:

PM mencari akar teknis tanpa membebani Owner.


======================================================================
13. CARA BERTANYA KEPADA OWNER
======================================================================

Dilarang bertanya:

- REPEATABLE READ atau READ COMMITTED?
- FK RESTRICT atau CASCADE?
- Pilih nama DTO?
- Setujui baris kode?
- Gunakan middleware atau guard?
- Gunakan Decimal(18,2) atau Decimal(18,6) tanpa konteks produk?

Wajib bertanya dalam bahasa domain:

- Apakah volume 0,125 m³ wajar?
- Proyek Berjalan boleh mengubah RAB?
- Profit ditetapkan per proyek atau per baris?
- Tombol apa yang seharusnya terlihat?
- Apakah user ini boleh menyetujui RAB?
- Apakah data lama boleh berubah?

Setiap pertanyaan:

- hanya satu keputusan per giliran;
- bahasa sederhana;
- sertakan rekomendasi;
- sertakan akibat;
- sertakan gambar bila menyangkut visual.


======================================================================
14. MESIN DAN PAGAR
======================================================================

Prinsip:

Mesin didahulukan dari pagar spekulatif.

Dilarang membuat hardening yang:

- belum mempunyai risiko nyata;
- tidak memajukan produk;
- hanya menambah dokumen atau abstraksi;
- tidak mempunyai acceptance proof.

Namun pagar wajib didahulukan bila cacat telah terbukti menyentuh:

- keamanan;
- tenant isolation;
- uang;
- histori;
- lifecycle;
- kehilangan data;
- akses tanpa hak;
- fake price;
- fake zero;
- production credential;
- database write;
- immutability.

Celah nyata bukan hardening spekulatif.

Celah nyata adalah blocker.


======================================================================
15. DATABASE DAN PRODUCTION SAFETY
======================================================================

simprok_test:

- boleh reset;
- boleh seed;
- boleh write untuk test;
- wajib memakai database guard;
- wajib residual PASS.

simprok_db:

Audit read-only diizinkan hanya bila:

- akun benar-benar read-only;
- current_database terbukti;
- transaction_read_only=on terbukti;
- BEGIN TRANSACTION READ ONLY;
- hanya SELECT;
- selalu ROLLBACK;
- DATABASE_WRITE_COUNT=0.

Dilarang pada simprok_db tanpa Owner production gate:

- INSERT;
- UPDATE;
- DELETE;
- DDL;
- migration deploy;
- prisma db push;
- backfill;
- seed;
- permission grant;
- production activation;
- penggunaan write-capable credential oleh agen.

Credential produksi:

- tidak dicetak;
- tidak dimasukkan prompt;
- tidak dimasukkan report;
- tidak dimasukkan source;
- tidak dimasukkan dokumentasi;
- tidak dikirim antaragen.


======================================================================
16. WORKTREE DAN REPOSITORY SAFETY
======================================================================

Pekerjaan dilakukan hanya pada:

C:\Users\asus\SIMPROK-WT-*

Checkout utama:

C:\SIMPROK

harus tetap bersih.

Setiap laporan wajib membuktikan:

git -C C:\SIMPROK status --short
git -C C:\SIMPROK rev-parse HEAD

git -C <FEATURE_WORKTREE> status --short
git -C <FEATURE_WORKTREE> rev-parse HEAD

Bila checkout main tersentuh:

- hentikan;
- inventarisasi perubahan;
- pindahkan perubahan sah ke worktree;
- pulihkan main;
- buktikan main kembali bersih.


Deny-list permanen tanpa Owner:

- git push --force;
- gh pr merge;
- prisma migrate deploy;
- prisma db push;
- production database write;
- skip all approvals;
- menghapus evidence;
- melemahkan test;
- mengubah history Git yang sudah dibagikan.


======================================================================
17. SECRET SCAN DAN BUKTI JUJUR
======================================================================

Secret scan wajib melaporkan seluruh temuan.

Dilarang menyatakan:

SECRET_SCAN=CLEAN

bila terdapat hit yang sudah di-allowlist.

Format benar:

SECRET_SCAN_TOTAL_HITS=<n>
SECRET_SCAN_ALLOWLISTED_TEST_FIXTURE_HITS=<n>
SECRET_SCAN_REAL_SECRET_HITS=<n>
SECRET_SCAN=PASS_WITH_REVIEWED_HITS

Fixture test boleh menggunakan credential uji bernama dan terisolasi.

Credential produksi tidak pernah boleh muncul.

Tidak ada PASS tanpa raw output.


======================================================================
18. ESTAFET ANTARAGEN
======================================================================

Tidak ada saluran otomatis antara ChatGPT, Claude, Gemini, Claude Code,
dan Codex.

Setiap agen wajib menutup dengan:

=== UNTUK: <AGEN BERIKUTNYA> ===
Tugas:
Source SHA:
Blocker terbuka:
Aksi yang diizinkan:
Aksi yang dilarang:
Bukti yang wajib diberikan:
=== SELESAI ===

BERIKUTNYA:
<agen> — <tugas satu kalimat>


Owner hanya menyalin blok.

Owner tidak perlu memahami isinya.


======================================================================
19. HUKUM YANG TIDAK PERNAH DILANGGAR
======================================================================

1. Laporan bukan bukti.

2. Bukti kurang berarti NEEDS_REVIEW atau FAIL_CLOSED.

3. Nol harga karangan.

4. Nol angka karangan.

5. Nol fake zero.

6. Nol nilai enum karangan.

7. Nol default yang berpihak pada TERBUKA.

8. Status hilang tidak pernah dianggap status yang diizinkan.

9. Permission hilang tidak pernah dianggap diberikan.

10. Test keamanan tidak pernah dilemahkan agar hijau.

11. Penyimpangan dari prompt wajib dilaporkan, walaupun lebih baik.

12. Kelemahan diberi nama UTANG-xx.

13. Yang sudah benar dipertahankan.

14. Perbaiki, jangan membongkar tanpa bukti kebutuhan.

15. Satu worktree hanya mempunyai satu active writer.

16. Audit source mentah wajib sebelum merge.

17. Browser proof wajib untuk perjalanan produk.

18. Owner tidak dibebani keputusan programmer.

19. PM tidak mencari jalan tengah.

20. Merge selalu keputusan Owner.

21. Production activation selalu gate terpisah.

22. SIMPROK menghitung, manusia memutuskan.


======================================================================
20. SATU HALAMAN UNTUK OWNER
======================================================================

Yang perlu Owner lakukan:

1. Buka sesi baru dan tempel kalimat pembuka.

2. Menjawab pertanyaan domain, produk, uang, atau tampilan.

3. Menyalin blok estafet bila diperlukan.

4. Melihat sendiri perjalanan produk di browser.

5. Mengatakan:
   SUDAH
   atau
   BELUM.

6. Mengizinkan merge.

7. Mengizinkan production activation secara terpisah.


Yang tidak perlu Owner lakukan:

- memahami kode;
- mengingat SHA;
- memahami Git;
- memilih lock;
- memilih schema;
- menyetujui perintah teknis;
- menjadi kurir konteks;
- menjadi penyimpan keputusan;
- menyalin laporan panjang;
- mengulang sejarah proyek.


======================================================================
21. PENUTUP
======================================================================

SIMPROK menghitung.
Manusia memutuskan.

Teknis diputuskan oleh Arsitek.
Konstitusi dijaga oleh Penjaga Konstitusi.
Domain, produk, uang, dan layar diputuskan oleh Owner.
PM menetapkan kesimpulan terbaik tanpa jalan tengah.
Eksekutor bekerja berdasarkan keputusan yang sudah sah.

Satu penulis.
Satu sumber kebenaran.
Satu bukti yang dapat diperiksa.
Tidak ada klaim tanpa bukti.
Tidak ada pintu yang terbuka karena default.
Tidak ada uang yang lahir dari karangan.

Soli Deo Gloria.
Haleluya.
Amin.
