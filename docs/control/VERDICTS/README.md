# SIMPROK — VERDICTS/

Status: MUTABLE OPERATIONAL FOLDER (indeks). Setiap berkas verdict di
dalam folder ini adalah MUTABLE OPERATIONAL RECORD — catatan hasil review
pada exact SHA, bukan hukum baru.

Folder ini menyimpan verdict final per PR atau slice, disalin utuh dari
reviewer (CARA-KERJA.md §3, §8). Setiap verdict wajib memakai blok verdict
baku dari `docs/control/CARA-KERJA.md` §8:

```
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
```

Aturan (CARA-KERJA.md §8):

- blok verdict disalin utuh, tidak diringkas ulang menjadi status lain;
- STATUS dan jumlah BLOCKER tidak boleh diubah oleh siapa pun setelah ditulis;
- isi blocker tidak boleh dilunakkan;
- PM boleh menjelaskan verdict, tetapi tidak boleh mengubahnya;
- reviewer tidak boleh mengklaim Owner PASS, mengizinkan merge, atau
  mengizinkan aktivasi produksi lewat verdict — `OTORISASI` selalu
  `REVIEW_ONLY`.

Penamaan berkas yang disarankan: `PR-<nomor>-<exact-sha-pendek>.md` atau
`<ROADMAP_ITEM>-<exact-sha-pendek>.md`, satu berkas per verdict per SHA.

Folder ini kosong pada slice RM-00/PR #36 ini. Tidak ada verdict palsu
dibuat untuk pekerjaan lama yang belum benar-benar direview dengan blok
baku di atas.

Soli Deo Gloria. Haleluya. Amin.
