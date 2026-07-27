# SIMPROK — STATE.md

Status: MUTABLE OPERATIONAL STATE.

AS_OF_DATE = 2026-07-22 (Asia/Tokyo)

MAIN_HEAD_SHA = 3f0b731777680559158436a664b9cb4ecda68837
MERGE_COMMIT_SHA = 3f0b731777680559158436a664b9cb4ecda68837
MERGED_PR = 38
CURRENT_PRODUCT_TARGET = RM-01
CURRENT_GATE = RM01B_SOURCE_PREP
NEXT_GATE = PHASE_1A_AUDIT_ROLE_DCL_AFTER_FULL_RED_GATE
ACTIVE_BRANCH = feat/rm-01b-source-prep
ACTIVE_WORKTREE = C:\Users\asus\SIMPROK-WT-RM01B-SOURCE
ACTIVE_SINGLE_WRITER = CODEX
PR_NUMBER = 39
PR_HEAD_SHA = SEE_GITHUB_PR_39_FINAL_HEAD
GOLDEN_THREAD_LIVE = NO
PRODUCTION_ACTIVATION_STATE = NO
SIMPROK_DB_CONNECTION_COUNT = 0
SIMPROK_DB_WRITE_COUNT = 0
BROWSER_PROOF_STATE = NOT_APPLICABLE_PHASE0_NO_UI_CHANGE

PR #38 merged at 2026-07-22T00:54:35Z from head
b171792d66edbbbbea2a8872389a3014f5a9bce6. Its merge is authority-code and
null-integrity source closure, not production permission activation. Open PR
count was zero at RM01B preflight.

RM01B PHASE-0 prepares dormant audit-role, fingerprint, and bounded permission
activation source. PHASE-1A through PHASE-4 are not authorized and there is no
automatic phase advance.

Production grants for RAB_VIEW and RAB_DRAFT_EDIT are not claimed active.
Owner browser proof remains a later, separate gate. See DEBT.md for exact
closure conditions.

## RM-02C1a schema foundation — 2026-07-27

NEEDS_REVIEW: the section above (`AS_OF_DATE = 2026-07-22`, `CURRENT_PRODUCT_TARGET
= RM-01`) was not updated across the RM-02B/RM-02C0 work that has since
merged to `main` (PR #35 through PR #46, confirmed via `git log`). This
executor did not reconstruct that missing history — doing so is out of this
slice's bounded scope — and instead reports the gap plainly rather than
silently overwriting or guessing at it.

What is independently verified for this slice, by this executor, right now:

```
BASE_MAIN_SHA = 80223a5dd5256921bf7dd237afff51c30b583ded
CURRENT_PRODUCT_TARGET (this slice) = RM-02C1a
ACTIVE_BRANCH = feat/rm02c1a-resource-identity-schema-foundation
ACTIVE_WORKTREE = C:\Users\asus\SIMPROK-WT-RM02C1A
ACTIVE_SINGLE_WRITER = CLAUDE_CODE
GOLDEN_THREAD_LIVE = NO (unchanged — no product journey touched)
YANG_SEDANG_DIKERJAKAN = Resource identity & provenance schema foundation
  (ResourceCatalog.code nullable, ResourceSourceIdentity model, two Postgres
  tenancy triggers, manual partial unique index, sourceSha256 CHECK
  constraint). See docs/implementation-gates/rm02c1a-schema-foundation/.
GATE_STATE = LOCAL_GATES_PASS_AWAITING_DRAFT_PR_AND_CI
BROWSER_PROOF_STATE = NOT_APPLICABLE (schema-only slice, no endpoint, no UI)
PRODUCTION_ACTIVATION_STATE = NO
SIMPROK_DB_CONNECTION_COUNT = 0
SIMPROK_DB_WRITE_COUNT = 0
OWNER_DECISIONS_WAITING = Draft PR merge decision (Owner-only, per
  CARA-KERJA.md); RM-02C1b bootstrap remains LOCKED pending separate
  authorization.
ACTIVE_DEBTS = see DEBT.md additions dated 2026-07-27
```

RM-02C1b (271-resource bootstrap) remains explicitly LOCKED by this slice's
own governing prompt and is not authorized to begin from this entry alone.

## RM-02C1b reviewed resource catalog bootstrap — 2026-07-27

RM-02C1a (schema foundation) and its follow-up docs clarification both
merged to `main` in the interim (PR #47 at `85249f1`, PR #48 at `ca74ebf`),
explicitly authorizing this slice to begin from `ca74ebf`.

```
BASE_MAIN_SHA = ca74ebf0cfd67dbdeff68a5dca28b525bd4f1ead
CURRENT_PRODUCT_TARGET (this slice) = RM-02C1b
ACTIVE_BRANCH = feat/rm02c1b-reviewed-resource-bootstrap
ACTIVE_WORKTREE = C:\Users\asus\SIMPROK-WT-RM02C1B
ACTIVE_SINGLE_WRITER = CLAUDE_CODE
GOLDEN_THREAD_LIVE = NO (unchanged — no product journey touched, no endpoint,
  no UI)
YANG_SEDANG_DIKERJAKAN = Reviewed, deterministic, transactional bootstrap of
  Workspace-A's ResourceCatalog + ResourceSourceIdentity from the locked
  RM-02C0 canonical inventory (267 canonical identities, 269 provenance
  rows, 2 blocked rows deferred to RM-02C1c). See
  docs/implementation-gates/rm02c1b-reviewed-bootstrap/.
GATE_STATE = LOCAL_GATES_PASS_AWAITING_DRAFT_PR_AND_CI
BROWSER_PROOF_STATE = NOT_APPLICABLE (CLI-only slice, no endpoint, no UI)
PRODUCTION_ACTIVATION_STATE = NO
SIMPROK_DB_CONNECTION_COUNT = 0
SIMPROK_DB_WRITE_COUNT = 0
OWNER_DECISIONS_WAITING = Draft PR merge decision (Owner-only, per
  CARA-KERJA.md); RM-02C1c (missing-unit human disposition for rows 39/104)
  remains a separate, un-started follow-up.
ACTIVE_DEBTS = see DEBT.md additions dated 2026-07-27 (RM-02C1b section)
```

## RM-02C1c missing-unit human disposition — 2026-07-27

RM-02C1b merged to `main` in the interim (PR #49 at `eeb99e5`), explicitly
authorizing this slice to begin from `eeb99e5`.

```
BASE_MAIN_SHA = eeb99e59863f4b37dd691dcec5406203e429cafe
CURRENT_PRODUCT_TARGET (this slice) = RM-02C1c
ACTIVE_BRANCH = feat/rm02c1c-missing-unit-human-disposition
ACTIVE_WORKTREE = C:\Users\asus\SIMPROK-WT-RM02C1C
ACTIVE_SINGLE_WRITER = CLAUDE_CODE
GOLDEN_THREAD_LIVE = NO (unchanged — no product journey touched, no endpoint,
  no UI)
YANG_SEDANG_DIKERJAKAN = Closes exactly the two RM-02C1b blocked rows (39
  Kawat BRC, 104 Kerikil) via an explicit Owner acceptance-only unit
  decision (Buah / M3, simprok_test-scoped, not a global standard). See
  docs/implementation-gates/rm02c1c-missing-unit-disposition/.
GATE_STATE = LOCAL_GATES_PASS_AWAITING_DRAFT_PR_AND_CI
BROWSER_PROOF_STATE = NOT_APPLICABLE (CLI-only slice, no endpoint, no UI)
PRODUCTION_ACTIVATION_STATE = NO
SIMPROK_DB_CONNECTION_COUNT = 0
SIMPROK_DB_WRITE_COUNT = 0
OWNER_DECISIONS_WAITING = Draft PR merge decision (Owner-only, per
  CARA-KERJA.md)
ACTIVE_DEBTS = see DEBT.md — this slice closes RM02C1C_MISSING_UNIT_HUMAN_DISPOSITION
  only once the persistent simprok_test apply succeeds and is proven idempotent
```

Soli Deo Gloria. Haleluya. Amin.
