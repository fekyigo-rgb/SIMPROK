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

## PR #36
- TITLE: docs(control): add canonical roadmap and multi-agent work method
- TYPE: docs-only — canonical control closure
- STATE: MERGED
- MERGE_SHA: `18c4a1fd1cd951e7e0facc2c9ea8313a7d4372c3`
- ROADMAP_ITEM: RM-00
- PRODUCTION_ACTIVATION: NO
- SIMPROK_DB_WRITE: NO (0 write sepanjang slice PR #36)
- SOURCE: `gh pr view 36 --json state,isDraft,headRefOid,baseRefName,mergeable`,
  dikonfirmasi via `git log` main setelah fetch pada slice RM-01a-CODE
  (`18c4a1f Merge pull request #36 from fekyigo-rgb/docs/canonical-agent-control-20260721`).

## PR RM-01a-CODE (slice ini, nomor PR belum ada saat berkas ini ditulis)
- TITLE: fix(auth,project): RM-01a-CODE authority matrix, null-integrity,
  activation planner
- TYPE: code — permission resolver, frontend capability fail-closed,
  BOQ null-integrity, narrow activation planner (test-only)
- STATE: BELUM DIBUAT saat berkas ini ditulis — akan DRAFT setelah push
- BASE_BRANCH: main
- HEAD_BRANCH: feat/rm-01-boq-authority-code
- BASE_SHA: `18c4a1fd1cd951e7e0facc2c9ea8313a7d4372c3` (origin/main exact,
  diverifikasi sebelum edit)
- HEAD_SHA: PENDING_UNTIL_PUSH — lihat `docs/control/STATE.md` dan body PR
  untuk nilai eksak begitu tersedia; tidak dikarang di sini.
- MERGE_SHA: BELUM ADA — MERGE=NO pada slice ini
- ROADMAP_ITEM: RM-01
- EXECUTION_SPEC_ID: RM-01a-CODE
- PRODUCTION_ACTIVATION: NO
- SIMPROK_DB_CONNECTION_COUNT: 0
- SIMPROK_DB_WRITE_COUNT: 0
- DEBT: UTANG-AUTHZ-11 → CODE_READY_AWAITING_EXACT_SHA_REVIEW (bukan
  CLOSED); UTANG-PERMISSION-08 tetap STILL_OPEN; UTANG-AUTOBASELINE-13
  tetap CLOSED_BY_PR_37 (non-regression dibuktikan ulang).
- PANEL MERAH (CARA-KERJA.md §10.8) — status saat berkas ini ditulis:
  ARCHITECT_EXACT_SHA_REVIEW=WAITING,
  GEMINI_CONSTITUTION_EXACT_SHA_REVIEW=WAITING,
  INDEPENDENT_SECURITY_AUDIT=WAITING, OWNER_BROWSER_PROOF=WAITING,
  OWNER_MERGE_DECISION=WAITING.

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

## RM-01a-CODE final closure — PR #38

- STATE: MERGED
- HEAD_SHA: b171792d66edbbbbea2a8872389a3014f5a9bce6
- MERGE_SHA: 3f0b731777680559158436a664b9cb4ecda68837
- MERGED_AT: 2026-07-22T00:54:35Z
- ROADMAP_ITEM: RM-01
- AUTHORITY_CODE: MERGED
- FRONTEND_BACKEND_CAPABILITY_ALIGNMENT: MERGED
- NULL_UNIT_PRICE_INTEGRITY: MERGED
- PRODUCTION_ACTIVATION: NO

This closes the earlier temporary RM-01a-CODE register entry. Merge does not
activate production grants.

## RM01B SOURCE PREP Draft PR

- TITLE: chore(rm01): prepare source-controlled production activation
- STATE: DRAFT
- HEAD_BRANCH: feat/rm-01b-source-prep
- BASE_SHA: 3f0b731777680559158436a664b9cb4ecda68837
- PR_NUMBER: 39
- HEAD_SHA: SEE_GITHUB_PR_39_FINAL_HEAD
- ROADMAP_ITEM: RM-01
- CLASSIFICATION: RED
- PRODUCTION_ACTIVATION: NO
- SIMPROK_DB_CONNECTION_COUNT: 0
- SIMPROK_DB_WRITE_COUNT: 0
- MERGE: NO

## Soli Deo Gloria. Haleluya. Amin.
