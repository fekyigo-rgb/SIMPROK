# SIMPROK — PR-REGISTER.md

Status: MUTABLE OPERATIONAL REGISTER.

Mencatat PR yang relevan dengan urutan produk aktif. Sumber: GitHub
`fekyigo-rgb/SIMPROK` via `gh pr view`, dibaca 2026-07-21.

## PR #21
- TYPE: (tidak diverifikasi ulang isinya pada slice ini — hanya status closure)
- STATE: CLOSED
- MERGED: TIDAK
- HEAD_SHA / MERGE_SHA: N/A (`mergeCommit=null`)
- CLOSED_AT: 2026-07-21T02:34:06Z
- PRODUCTION_ACTIVATION: TIDAK BERLAKU (tidak pernah merge)
- SOURCE: `gh pr view 21 --json state,closed,mergeCommit,mergedAt,closedAt`

## PR #35
- TITLE: (lihat body — implements OD-IMPORT-01, BOQ XLSX bounded import)
- TYPE: feature — Import BOQ ke Working Draft
- STATE: MERGED
- MERGE_SHA: `095002bdebb77a8439015551ec853be5b91d50dc`
- MERGED_AT: 2026-07-21T03:03:38Z
- ROADMAP_ITEM: RM-00
- PRODUCTION_ACTIVATION: NO (per body PR — `PRODUCTION_LIVE: NO`,
  `SIMPROK_DB_WRITE_COUNT: 0`, proof environment `simprok_test`)
- OWNER_BROWSER_PROOF_POSITIVE: PASS (per body)
- OWNER_BROWSER_PROOF_NEGATIVE: NOT_STARTED (per body)
- DEBT RECORDED: UTANG-PLATFORM-03, UTANG-FAKE-ZERO-04, UTANG-ACCESS-05,
  IMPORT RETRY/IDEMPOTENCY GAP (lihat DEBT.md)
- SOURCE: `gh pr view 35 --json state,closed,mergeCommit,mergedAt` + body PR #35

## PR #36 (slice ini)
- TITLE: docs(control): add canonical roadmap and multi-agent work method
- TYPE: docs-only — canonical control closure
- STATE: OPEN, DRAFT
- BASE_BRANCH: main
- HEAD_BRANCH: docs/canonical-agent-control-20260721
- HEAD_SHA_SEBELUM_SLICE_INI: `af6a2a6220227c5e1a0236d53c424261b6cceb83`
- HEAD_SHA_SETELAH_SLICE_INI: lihat `docs/control/STATE.md` (`PENDING_UNTIL_PUSH`
  saat berkas ini ditulis; nilai eksak final ada pada PR #36 di GitHub
  setelah push)
- MERGE_SHA: BELUM ADA — MERGE=NO pada slice ini
- ROADMAP_ITEM: RM-00
- PRODUCTION_ACTIVATION: NO
- SIMPROK_DB_WRITE: NO (0 write sepanjang slice ini)
- SOURCE: `gh pr view 36 --json state,isDraft,headRefOid,baseRefName,mergeable`

## PR #37
- TITLE: fix(project): keep initiate setup draft-only (UTANG-AUTOBASELINE-13)
- TYPE: fix — collision/auto-baseline correction
- STATE: MERGED
- MERGE_SHA: `478ce4f76960e4e557d7f32a15b20df3c7639905`
- MERGED_AT: 2026-07-21T07:09:21Z
- ROADMAP_ITEM: RM-01 (perbaikan isolasi, bukan pembukaan RM-01 penuh)
- BASE_SHA (per body PR): `095002bdebb77a8439015551ec853be5b91d50dc`
- REMOTE_HEAD (per body PR sebelum merge): `e6165a587dc6a514dd596f939073b2a6ccb4d28b`
- PRODUCTION_ACTIVATION: NO (per body — `MERGE=NO` dinyatakan dalam body
  sebelum merge terjadi; `ACTIVATION=NO`, `SIMPROK_DB_WRITE=NO`)
- DEBT CLOSED: UTANG-AUTOBASELINE-13 → CLOSED_BY_PR_37 (lihat DEBT.md)
- SOURCE: `gh pr view 37 --json state,closed,mergeCommit,mergedAt` + body PR #37

## Soli Deo Gloria. Haleluya. Amin.
