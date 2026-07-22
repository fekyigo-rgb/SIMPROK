# SIMPROK — STATE.md

Status: MUTABLE OPERATIONAL STATE — bukan hukum baru, bukan pengganti
`CARA-KERJA.md` atau `ROADMAP.md`. Halaman ini menjelaskan keadaan hari ini,
bukan aturan permanen. Diperbarui setiap ada perubahan gate, bukan dinarasikan.

AS_OF_DATE = 2026-07-21 (Asia/Jayapura)

## Field pra-merge (CARA-KERJA.md §3)

```
BASE_MAIN_SHA        = 18c4a1fd1cd951e7e0facc2c9ea8313a7d4372c3
PR_NUMBER             = PENDING_UNTIL_PUSH (lihat PR body untuk nomor eksak
                         setelah Draft PR dibuka)
PR_HEAD_SHA           = PENDING_UNTIL_PUSH (exact SHA hanya sah setelah push
                         final; tidak dikarang di sini — lihat PR body/GitHub
                         untuk nilai eksak begitu tersedia)
ACTIVE_BRANCH         = feat/rm-01-boq-authority-code
ACTIVE_WORKTREE       = C:\Users\asus\SIMPROK-WT-RM01-CODE
ACTIVE_SINGLE_WRITER  = CLAUDE_CODE (slice RM-01a-CODE)
GOLDEN_THREAD_LIVE    = NO
                         Harga/line-total nyata (Golden Thread hidup) belum
                         boleh diklaim sebelum RM-02 sampai RM-05 selesai.
                         Slice ini memperkuat null-integrity (harga belum
                         diisi tetap null, tidak pernah dikarang jadi Rp0)
                         tetapi tidak mengaktifkan sumber harga baru.
GATE_STATE            = KUNING/MERAH (CLASSIFICATION=RED per kontrak
                         RM-01a-CODE) — code readiness selesai, seluruh
                         permanent gate lokal hijau, menunggu push final ke
                         Draft PR dan Panel Merah §10.8 lengkap (Arsitek,
                         Gemini, Codex independent audit, Owner browser
                         proof, Owner merge decision).
BROWSER_PROOF_STATE   = WAITING — executor tidak mengklaim
                         OWNER_BROWSER_PASS; hanya Owner yang dapat
                         menyatakan PASS pada exact SHA.
PRODUCTION_ACTIVATION_STATE = NO
OWNER_DECISIONS_WAITING     = MERGE_OR_REJECT setelah Panel Merah lengkap;
                         keputusan aktivasi produksi (`simprok_db` seed
                         RAB_VIEW/RAB_DRAFT_EDIT) tetap terpisah di gate
                         RM-01b-PRODUCTION-ACTIVATION.
ACTIVE_DEBTS                = lihat docs/control/DEBT.md — ringkasan:
                         UTANG-PLATFORM-03 (OPEN), UTANG-FAKE-ZERO-04 (OPEN),
                         UTANG-ACCESS-05 (OPEN), UTANG-LIFECYCLE-06 (OPEN),
                         UTANG-PERMISSION-08 (STILL_OPEN — kode aktivasi
                         siap, simprok_db belum tersentuh),
                         UTANG-TSC-10 (NEEDS_REVIEW), UTANG-AUTHZ-11
                         (CODE_READY_AWAITING_EXACT_SHA_REVIEW — bukan
                         CLOSED), UTANG-E2E-CLEANUP-11 (NEEDS_REVIEW),
                         UTANG-PROOF-12 (OPEN), UTANG-READONLY-ACCT
                         (NEEDS_REVIEW), OD-04 DECIMAL PRECISION (OPEN),
                         IMPORT RETRY/IDEMPOTENCY GAP (KNOWN_GAP).
                         UTANG-AUTOBASELINE-13 tetap CLOSED_BY_PR_37 —
                         slice ini membuktikan `initiateSetup()` tidak
                         berubah sama sekali (nol diff pada method itu).
```

## Keadaan produk hari ini

```
CURRENT_PRODUCT_TARGET  = RM-01
CURRENT_GATE             = RM01a_CODE_READY_AWAITING_RED_PANEL_EXACT_SHA_REVIEW
NEXT_PRODUCT_TARGET      = RM-01b-PRODUCTION-ACTIVATION (setelah Panel Merah
                         PASS dan Owner merge decision)
```

## Realitas GitHub (evidence per klaim, slice RM-01a-CODE)

- origin/main sebelum slice ini = `18c4a1fd1cd951e7e0facc2c9ea8313a7d4372c3`
  (`git fetch origin --prune` + `git rev-parse origin/main`).
- Open PR count sebelum slice ini = 0 (`gh pr list --state open`).
- PR #36 (RM-00) — MERGED, merge commit
  `18c4a1fd1cd951e7e0facc2c9ea8313a7d4372c3` (`gh pr view 36`).
- Worktree terisolasi: `C:\Users\asus\SIMPROK-WT-RM01-CODE`, branch baru
  `feat/rm-01-boq-authority-code`, dibuat langsung dari `origin/main` exact
  (`git worktree add ... -b feat/rm-01-boq-authority-code origin/main`).
- `C:\SIMPROK` tidak disentuh sepanjang slice ini — tetap `main` @
  `478ce4f76960e4e557d7f32a15b20df3c7639905` (SHA lama, sebelum PR #36
  merge tersinkron ke situ; worktree RM-01a-CODE ini yang membawa origin
  terbaru, bukan `C:\SIMPROK`), tracked/staged diff kosong, dua untracked
  path terlindungi (`SIMPROK-ARTIFACTS/`, `backend/.claude/`) tidak
  tersentuh.

## RM-01a-CODE — apa yang berubah (ringkas; lihat PR body untuk exact files)

- Backend: resolver permission kanonikal baru
  (`WorkspacePermissionResolverService`), dipakai bersama oleh
  `PermissionsGuard` dan endpoint baru `GET /auth/capabilities`. Tiga
  route authority-matrix diperbaiki: `POST .../initiate` →
  `RAB_DRAFT_EDIT`; `GET .../boq` dan `GET .../boq/draft` → `RAB_VIEW`.
  Null-integrity: `saveDraftBoq`/`getDraftBoq` tidak lagi mengubah
  `unitPrice` yang belum diisi menjadi `0`; recap RabDocument tidak
  dipersist selagi `pricingStatus=INCOMPLETE`.
- Frontend: `AuthContext` fail-closed capability state
  (`permissionState`, `hasPermission`); `PermissionRoute` menggantikan
  `RoleRoute` literal HANYA pada jalur RM-01 (`/project/new`,
  RAB door, RAB workspace); rekap biaya menampilkan "—"/"Belum dihitung"
  alih-alih Rp0 palsu selama ada item belum berharga.
- Aktivasi produksi: planner PLAN/APPLY sempit (RAB_VIEW+RAB_DRAFT_EDIT,
  satu workspace, role DIRECTOR eksplisit, additive-only), diuji hanya
  terhadap `simprok_test`. Tidak dijalankan terhadap `simprok_db`.
- `SIMPROK_DB_CONNECTION_COUNT=0`, `SIMPROK_DB_WRITE_COUNT=0` untuk
  seluruh slice ini.
- `MERGE=NO` — Draft PR adalah permukaan audit exact-SHA, bukan aktivasi.

## Soli Deo Gloria. Haleluya. Amin.
