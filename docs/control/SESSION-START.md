# SIMPROK — SESSION-START.md

Status: MUTABLE OPERATIONAL POINTER. Baca ini di awal setiap sesi agen.

1. Baca `AGENTS.md` pada root repository.
2. Baca utuh `docs/control/CARA-KERJA.md` dan
   `docs/control/ROADMAP.md`.
3. Baca bagian paling akhir `docs/control/STATE.md`; bagian terbaru
   mengungguli pointer operasional lama.
4. Baca `docs/control/DECISIONS.md`, `docs/control/DEBT.md`, dan
   `docs/control/PR-REGISTER.md`.
5. Untuk Basic Price, baca utuh
   `docs/control/BASIC-PRICE-MASTER-DECISION.md`, dimulai dari
   Current Status Addendum paling atas.
6. Untuk Gate 2A, baca
   `docs/control/AD-PR57-INTEGRATION-AND-MIGRATION-SEPARATION-01.md`.
7. Verifikasi branch, HEAD, worktree, PR, dan database target sebelum
   bertindak.
8. Jangan mengubah kode, schema, migration, database, atau produksi
   tanpa otorisasi Owner yang spesifik terhadap gerbang tersebut.

```text
SESSION_POINTER_VERSION=PR58_PR59_CLOSEOUT_2026_08_01
AS_OF_DATE=2026-08-01

PR59_BASE_MAIN_SHA=8aba41208229d3901693238747c5fa2e06ebb614
CURRENT_PRODUCT_TARGET=RM-02
CURRENT_CONTROL_GATE=PR59_CANONICAL_DOCUMENTATION_CLOSEOUT

CURRENT_DOCS_REVIEW_PR=59
CURRENT_DOCS_HEAD=SEE_GITHUB_PR_59_CURRENT_HEAD
PR59_STATE=SEE_GITHUB_CURRENT_STATE

GATE2A_STATUS=IMPLEMENTED_VERIFIED_AND_MERGED
MIGRATION_EXECUTION_GATE=CLOSED
PRODUCTION_ACTIVATION_GATE=CLOSED
SIMPROK_DB_WRITE=NO

CURRENT_SINGLE_WRITER=OWNER_VIA_POWERSHELL
NEXT_ACTION=VERIFY_PR59_CURRENT_STATE_THEN_OWNER_SELECTS_NEXT_PRODUCT_SLICE
```

Bila bukti, status, atau konflik dokumen belum jelas: laporkan
`NEEDS_REVIEW` atau `FAIL_CLOSED`. Jangan mengarang.

Soli Deo Gloria. Haleluya. Amin.
