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

## RM-02C2 Catalog Search Draft PR — pending publication

- TITLE: feat(rm02c2): add secure catalog search for Basic Price review
- STATE: LOCAL_CANDIDATE_AWAITING_DRAFT_PR
- HEAD_BRANCH: feat/rm02c2-catalog-search-human-selection
- BASE_SHA: 40ff50dfb92dd80bdab6ae2f4db7720524a877ca
- ROADMAP_ITEM: RM-02C2
- PRODUCTION_PERMISSION_ACTIVATION: NO
- SIMPROK_DB_CONNECTION_COUNT: 0
- SIMPROK_DB_WRITE_COUNT: 0
- MERGE: NO — Owner-only decision

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

## RM-02C1a Resource Identity Schema Foundation Draft PR

- TITLE: feat(rm02c1a): establish resource identity and provenance schema
- TYPE: schema/migration foundation — no bootstrap, no endpoint, no UI
- STATE: DRAFT (will be updated with exact PR number/HEAD_SHA after push)
- BASE_BRANCH: main
- BASE_SHA: 80223a5dd5256921bf7dd237afff51c30b583ded
- HEAD_BRANCH: feat/rm02c1a-resource-identity-schema-foundation
- ROADMAP_ITEM: RM-02C1a
- PRODUCTION_ACTIVATION: NO
- SIMPROK_DB_CONNECTION_COUNT: 0
- SIMPROK_DB_WRITE_COUNT: 0
- MERGE: NO — Owner-only decision, per CARA-KERJA.md
- DEBT RECORDED: UTANG-RESOURCE-CODE-EMPTY-STRING-GUARD,
  UTANG-PROJECT-AHSP-FK-NAME-DRIFT (see DEBT.md)
- COWORK REVIEW: 3/3 independent read-only reviewers (schema/domain,
  migration/rollback, test/tenancy) — all PASS_WITH_CONDITIONS, zero
  BLOCKING findings; all non-blocking findings addressed in the diff except
  the two named debts above (deliberately deferred, not silently dropped).
- LOCAL GATES: backend build PASS; backend unit tests 478/478 PASS; official
  safe E2E 306/306 PASS (residual PASS); frontend build PASS; frontend
  tests 46/46 PASS.
- RM02C1B_BOOTSTRAP: LOCKED (unchanged by this PR)

## RM-02C1a docs clarification Draft PR (#48)

- TITLE: docs(rm02c1a): clarify composite-FK feasibility statement
- TYPE: docs-only correction to 00-RM02C1A-SCHEMA-CONTRACT.md §3
- STATE: MERGED (mergedAt 2026-07-27T04:40:38Z, merge commit
  ca74ebf0cfd67dbdeff68a5dca28b525bd4f1ead)
- PR_NUMBER: 48
- BASE_SHA: 85249f19c05ece02fc2db02652b6c42e1923dd7e
- HEAD_SHA: 9470f8a56bee78f5fefb2108251f1e5d43aead15
- ROADMAP_ITEM: RM-02C1a
- PRODUCTION_ACTIVATION: NO
- MERGE: Owner-executed (merge authority is Owner-only per CARA-KERJA.md;
  this executor pushed/opened/updated metadata only, never merged)

## RM-02C1b Reviewed Resource Catalog Bootstrap Draft PR

- TITLE: feat(rm02c1b): bootstrap reviewed Workspace-A resource catalog
- TYPE: application logic (CLI bootstrap) — no schema change, no endpoint,
  no UI
- STATE: DRAFT (will be updated with exact PR number/HEAD_SHA after push)
- BASE_BRANCH: main
- BASE_SHA: ca74ebf0cfd67dbdeff68a5dca28b525bd4f1ead
- HEAD_BRANCH: feat/rm02c1b-reviewed-resource-bootstrap
- ROADMAP_ITEM: RM-02C1b
- PRODUCTION_ACTIVATION: NO
- SIMPROK_DB_CONNECTION_COUNT: 0
- SIMPROK_DB_WRITE_COUNT: 0
- MERGE: NO — Owner-only decision, per CARA-KERJA.md
- DEBT RECORDED: RM02C1C_MISSING_UNIT_HUMAN_DISPOSITION (see DEBT.md) —
  rows 39/104 blocked, zero writes, deferred to a named future slice
- LOCAL GATES: backend build PASS; backend unit tests 500/500 PASS
  (478 pre-existing + 22 new); disposable-instance proof against the real
  271-row inventory 27/27 PASS (267 canonical identities, 269 provenance
  rows, 2 blocked, exact match to contract); official safe E2E 317/317 PASS
  (306 pre-existing + 11 new, residual PASS); frontend build PASS; frontend
  tests 46/46 PASS.
- RM02C1C_MISSING_UNIT_DISPOSITION: LOCKED (not started by this PR)
- NOTE (2026-07-27): merged as PR #49, mergedAt 2026-07-27T06:47:53Z, merge
  commit eeb99e59863f4b37dd691dcec5406203e429cafe.

## RM-02C1c Missing-Unit Human Disposition Draft PR

- TITLE: feat(rm02c1c): resolve two reviewed missing-unit resources
- TYPE: application logic (CLI, two-row acceptance-only disposition) — no
  schema change, no endpoint, no UI
- STATE: DRAFT (will be updated with exact PR number/HEAD_SHA after push)
- BASE_BRANCH: main
- BASE_SHA: eeb99e59863f4b37dd691dcec5406203e429cafe
- HEAD_BRANCH: feat/rm02c1c-missing-unit-human-disposition
- ROADMAP_ITEM: RM-02C1c
- PRODUCTION_ACTIVATION: NO
- SIMPROK_DB_CONNECTION_COUNT: 0
- SIMPROK_DB_WRITE_COUNT: 0
- MERGE: NO — Owner-only decision, per CARA-KERJA.md
- OWNER_DECISION: row 39 Kawat BRC -> Buah; row 104 Kerikil -> M3.
  ACCEPTANCE-ONLY, simprok_test-scoped, not a global/production unit
  standard (see DEBT.md and
  docs/implementation-gates/rm02c1c-missing-unit-disposition/).
- DOES NOT MODIFY: RM-02C1b's 267 canonical identities or 269 provenance
  rows.
- LOCAL GATES: backend build PASS; backend unit tests 515/515 PASS
  (500 pre-existing + 15 new); disposable-instance proof against the real
  committed inventory 20/20 PASS; official safe E2E PASS (residual PASS;
  one unrelated pre-existing environment timeout flake in
  basic-price.e2e-spec.ts on the first run, confirmed unrelated to this
  diff and clean on immediate re-run); frontend build PASS; frontend tests
  46/46 PASS.

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

## RM-02C3 Acceptance Permission Draft PR

- TITLE: feat(rm02c3): activate Basic Price browser acceptance permissions
- STATE: DRAFT TO BE CREATED
- HEAD_BRANCH: feat/rm02c3-acceptance-permission
- BASE_SHA: 83f1dcbcfa4e21ac2c2d67e4a6bdde4975d27c24
- ROADMAP_ITEM: RM-02C3
- TARGET_DATABASE: simprok_test
- PERMISSION_ALLOWLIST: BASIC_PRICE_IMPORT, BASIC_PRICE_REVIEW_VIEW
- PRODUCTION_ACTIVATION: NO
- SIMPROK_DB_CONNECTION_COUNT: 0
- SIMPROK_DB_WRITE_COUNT: 0
- OWNER_BROWSER_PROOF: NOT_STARTED
- MERGE: NO — Owner-only decision

## Soli Deo Gloria. Haleluya. Amin.

## RM-02 stack integration and canonical closeout — 2026-08-01

```text
REGISTER_ENTRY_ID=PR-REGISTER-RM02-PR58-PR59-2026-08-01
PRODUCT_CODE_ANCHOR=30132237de782d06043cdca3cfbc064781e8042a
INTEGRATION_HEAD=37cdf762202b9f140f520591566db2f4223138c3

PR58_STATE=MERGED
PR58_MERGE_METHOD=MERGE_COMMIT
PR58_MERGE_COMMIT=8aba41208229d3901693238747c5fa2e06ebb614

PR53_TO_PR57_INTEGRATED_BY_PR58=YES
SEQUENTIAL_STACKED_MERGE_PERFORMED=NO

PR59_STATE_AT_REGISTER_WRITE=OPEN_DRAFT
PR59_HEAD_REF=docs/pr58-canonical-closeout-20260801
PR59_FINAL_CHANGED_DOCUMENT_COUNT=5
PR59_MERGE_AT_REGISTER_WRITE=NO

MIGRATION_EXECUTION=NO
PRODUCTION_ACTIVATION=NO
SIMPROK_DB_WRITE=NO
```

- PR #53 through PR #57 are contained in `main` through PR #58.
- PR #54 through PR #57 were closed after integration; their product
  work was not rejected.
- PR #59 is the bounded documentation-closeout review container.
- PR #59 does not authorize migration or production activation.

Soli Deo Gloria.
