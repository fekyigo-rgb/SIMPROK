# SIMPROK — STATE.md

Status: MUTABLE OPERATIONAL STATE — bukan hukum baru, bukan pengganti
`CARA-KERJA.md` atau `ROADMAP.md`. Halaman ini menjelaskan keadaan hari ini,
bukan aturan permanen. Diperbarui setiap ada perubahan gate, bukan dinarasikan.

AS_OF_DATE = 2026-07-21 (Asia/Jayapura)

## Field pra-merge (CARA-KERJA.md §3)

```
BASE_MAIN_SHA        = 478ce4f76960e4e557d7f32a15b20df3c7639905
PR_NUMBER             = 36
PR_HEAD_SHA           = PENDING_UNTIL_PUSH
                         (exact SHA hanya sah setelah push final; lihat
                         evidence SHA PR #36 di GitHub dan body PR #36 untuk
                         nilai eksak begitu tersedia — tidak dikarang di sini)
ACTIVE_BRANCH         = docs/canonical-agent-control-20260721
ACTIVE_WORKTREE       = C:\Users\asus\SIMPROK-WT-CONTROL-DOCS
ACTIVE_SINGLE_WRITER  = CLAUDE_CODE (slice RM00-PR36-CANONICAL-CONTROL-CLOSURE-02)
GOLDEN_THREAD_LIVE    = NO
                         Harga/line-total nyata (Golden Thread hidup) belum
                         boleh diklaim sebelum RM-02 sampai RM-05 selesai
                         (Import Basic Price, Import AHSP, dan slice terkait).
                         BOQ import saat ini menyimpan kuantitas/struktur;
                         harga sumber belum menjadi otoritas uang.
GATE_STATE            = HIJAU — docs-only, menunggu push final ke Draft PR #36
                         dan raw-source review Arsitek pada exact SHA.
BROWSER_PROOF_STATE   = NOT_APPLICABLE_DOCS_ONLY (slice ini tidak menyentuh
                         application code atau UI)
PRODUCTION_ACTIVATION_STATE = NO
OWNER_DECISIONS_WAITING     = MERGE_OR_REJECT_PR_36
ACTIVE_DEBTS                = lihat docs/control/DEBT.md — ringkasan OPEN:
                         UTANG-PLATFORM-03, UTANG-FAKE-ZERO-04,
                         UTANG-ACCESS-05, UTANG-LIFECYCLE-06,
                         UTANG-PERMISSION-08, UTANG-TSC-10 (NEEDS_REVIEW),
                         UTANG-AUTHZ-11, UTANG-E2E-CLEANUP-11 (NEEDS_REVIEW),
                         UTANG-PROOF-12, UTANG-READONLY-ACCT (NEEDS_REVIEW),
                         OD-04 DECIMAL PRECISION, IMPORT RETRY/IDEMPOTENCY GAP.
```

## Keadaan produk hari ini

```
CURRENT_PRODUCT_TARGET  = RM-00
CURRENT_GATE             = PR_36_EXACT_SHA_REVIEW_AND_OWNER_MERGE_PENDING
NEXT_PRODUCT_TARGET      = RM-01
```

## Realitas GitHub (evidence SHA per klaim)

- PR #21 — CLOSED tanpa merge.
  Evidence: `gh pr view 21` → `state=CLOSED`, `mergeCommit=null`,
  `mergedAt=null`, `closedAt=2026-07-21T02:34:06Z`.
- PR #35 — MERGED.
  Evidence: `gh pr view 35` → `mergeCommit.oid=095002bdebb77a8439015551ec853be5b91d50dc`,
  `mergedAt=2026-07-21T03:03:38Z`.
- PR #37 — MERGED.
  Evidence: `gh pr view 37` → `mergeCommit.oid=478ce4f76960e4e557d7f32a15b20df3c7639905`,
  `mergedAt=2026-07-21T07:09:21Z`.
- PR #36 — OPEN, Draft, sedang diproses slice ini.
  Evidence: `gh pr view 36` → `state=OPEN`, `isDraft=true`,
  `headRefOid=af6a2a6220227c5e1a0236d53c424261b6cceb83` (SHA sebelum slice ini).
- Open PR count = 1; satu-satunya open PR adalah #36.
  Evidence: `gh pr list --state open` → satu baris, nomor 36.
- Merge-base PR #36 dengan main = `095002bdebb77a8439015551ec853be5b91d50dc`
  (`git merge-base main origin/docs/canonical-agent-control-20260721`).
- Divergensi sebelum slice ini: branch ahead 4, behind main 5
  (`git rev-list --left-right --count main...origin/docs/canonical-agent-control-20260721`
  → `5 4`).

## C:\SIMPROK

```
C:\SIMPROK branch          = main
C:\SIMPROK HEAD             = 478ce4f76960e4e557d7f32a15b20df3c7639905
C:\SIMPROK tracked diff     = kosong
C:\SIMPROK staged diff      = kosong
Untracked path terlindungi = SIMPROK-ARTIFACTS/, backend/.claude/ (tidak disentuh)
```

## BOQ Import — realitas mesin vs aktivasi

- Kode BOQ import (preview/approve XLSX ke Working Draft) tersedia di `main`
  melalui PR #35 (merge `095002b...`) dan diperkuat oleh PR #37
  (`initiateSetup` draft-only, merge `478ce4f...`).
- Bukti/write terakhir tetap pada `simprok_test` (proof environment PR #35:
  `LOCAL_WORKTREE_SIMPROK_WT_IMPORTFIRST` + `simprok_test`; proof PR #37:
  database guard `simprok_test`). Tidak ada bukti browser atau write pada
  `simprok_db` dari kedua PR ini.
- BOQ import pada `simprok_db` **belum diaktifkan**. Audit read-only
  RM-01A (sesi yang sama, sebelum slice ini) menemukan permission
  `RAB_VIEW` dan `RAB_DRAFT_EDIT` — yang menjaga endpoint BOQ import —
  **ABSENT** dari tabel `permissions` di `simprok_db`, sehingga endpoint
  tersebut belum bisa dijalankan siapa pun sampai permission tersebut
  di-seed dan digrant (keputusan Owner terpisah, di luar slice ini).
- `SIMPROK_DB_WRITE_COUNT = 0` untuk pekerjaan RM-00/PR #36 ini. Slice ini
  tidak menyentuh `simprok_db` sama sekali (docs-only).

## Soli Deo Gloria. Haleluya. Amin.
