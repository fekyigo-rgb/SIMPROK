# SIMPROK RAB-AUTO-06 — Unified Computer 2 integration checkpoint
Date: 2026-10-29 Asia/Jayapura
Owner mandate: activate/connect proven existing intelligence; preserve AHSP/Basic Price parallel work and permanent runtime.

## Protected baseline and provenance
- Computer 2 original RAB-AUTO-01..04 branch at ac1ee87 was CLEAN and was not modified.
- A NEW isolated worktree was created: D:\SIMPROK\WORKTREES\SIMPROK-RAB-AUTO-06-20261029, branch feat/rab-auto-06-unified-main-20261029.
- Rebased 12 prior RAB commits successfully onto GitHub main e4dbcbe (which already includes PR #223/#225/#226 and later concurrent main changes). No conflicts during rebase.
- Computer 1 source RAB-AUTO-05 commit d6e55ec, diff strictly from THAT commit's parent, contains only RAB files and migration (not unrelated Basic Price changes). SHA256 of transferred patch verified: 7F9A249AAE1D4052658D739C4E541B6700DBFE5203B0EDCEA461B3B379E564F8.
- Applied non-overlapping patch files; two shared ProjectAhspService/Module files reconciled surgically to preserve both original RAB-AUTO-04 reuse and new RAB-AUTO-05 first-source proof; no replacement/rebuild of existing AHSP kernels.
- No permanent runtime/database or parallel AHSP/BP worktrees were modified. No GitHub push/merge or schema migration executed on live DB.

## Unified actual product code path
1. BOQ XLSX: a DEDICATED optional 'Kode AHSP'/'AHSP Code'/'Referensi AHSP' column is persisted as BoqItem.sourceAhspCode after approved BOQ import. Never reinterpret WBS 'No/Kode' or vague prose as AHSP authority; legacy rows are NULL.
2. One RAB-level UI action 'Lengkapi Otomatis' first calls POST working-draft/auto-bind-explicit-references for approved source facts. It requires one selected project region, exact AHSP code + full specification, active eligible version, classification/Unit Kernel recommendation. The original ProjectAhspService transaction RE-CHECKS approved source, unchanged target, code, full label, current version, region and resources/Basic Price.
3. UI then calls POST working-draft/auto-reuse-proven for exact same-WBS same-spec same-unit, same-region original human-governed decisions. Auto-derived decisions never become a new trust root.
4. If first-time or reuse links were actually established, UI calls existing RAB-level auto-price-ready. The official Cost Kernel and RabKernelPersistenceService write only CALCULATED rows, preserving manual money and already frozen persisted calculations.
5. Missing reference/ambiguous region/mismatched spec/unproven resource/wrong unit/newly invalid context are honest exceptions. The UI never claims each BOQ row is priced just because an AHSP candidate exists; progress is bounded to 20 pages x 25 BOQ rows.

## Local verification evidence
- After integration at Computer 2, focused BACKEND Jest: 15 suites / 104 tests PASS (RAB 02-05, Cost Kernel caller, AHSP eligibility/search/region, Import One-Truth PR223, BOQ approved source).
- Focused FRONTEND node:test: **66/66 PASS**, including 3 additional source-level contract checks for route order, pricing gate, and no guessed AHSP selection. These contract checks do NOT replace authenticated browser E2E.
- Frontend production build: PASS.
- Backend NestJS build initially found a TypeScript refinement issue only in RAB-AUTO-02 readiness recommendation projection; fixed with strict object/field guards, without changing ranking. Backend production build rerun **PASS** and 3 affected Jest suites / 24 tests **PASS**.
- New backend scoped ESLint PASS; frontend RAB workspace lint 9 legacy errors / 2 warnings remains exactly equal to pre-patch, no regression. git diff --check PASS.
- Prisma Client was generated from the unified schema in THIS isolated worktree; Prisma validate **PASS** with a dummy connection string (no DB connection). New nullable sourceAhspCode migration was NOT run on permanent DB.
- No authenticated browser, isolated-PostgreSQL first-time bind/price/F5 proof or Quality Gate exact combined branch PASS yet. DO NOT call this permanent runtime E2E PASS.
- The 32-item older project 'Uji Klasifikasi dan Konteks' still has no historically approved explicit sourceAHSP codes and a nonunique set of region selections; expected first-time auto result there remains HOLD, not fabricated.

## Release gate
Before promotion, need approved fixture BOQ with explicit AHSP code, one canonical selected price region, eligible AHSP formula, trusted Basic Price, then isolated DB import→approve→AHSP bind→Cost Kernel→persist→GET after reload/F5; verify countercases and exact-head CI. Owner approval required for merge and permanent DB migration/runtime sync.

VERDICT: CODE INTEGRATION AND LOCAL TESTS PROVEN; LIVE END-TO-END GOLDEN THREAD STILL HOLD.
