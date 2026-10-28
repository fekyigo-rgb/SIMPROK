# RAB-AUTO-01 / PERMANENT AHSP — Root Cause Closure
Date: 2026-10-28, Asia/Jayapura
Source: actual backend permanent runtime `C:\Users\asus\SIMPROK-RUNTIME\ops-runners\SHARED-HELPERS\START-BACKEND-RUNTIME.sh`; loads `secrets/backend.runtime.env` (contents NOT printed or copied).
Target database: `127.0.0.1:55432/simprok_db`.
Queries: BEGIN READ ONLY, SET LOCAL statement_timeout, SELECT only, ROLLBACK. Zero mutations.

## Evidence chain
1. Owner browser: authenticated `GET /ahsp` HTTP 200 with literal JSON `[]`; cache disabled.
2. `AhspService.list` filters parent AHSP `deletedAt: null` and workspace visibility `workspaceId = trusted workspace OR null` (shared).
3. PERMANENT DB: `ahsps` **79 total, 79 soft-deleted, zero nondeleted**; all 79 belong to workspace of project `f344e9b9-941e-4125-878e-d25adee2ebdf` ("Uji Klasifikasi dan Konteks"); NO shared/global or other-workspace AHSP parent rows in this database.
4. Deletion audit: 79 `AHSPDeleted` actions, one deleting actor ID (identity not disclosed); all AHSP retain metadata/relations, not physical row loss.
5. Recorded reasons by count: `salah` 62; `belum lengka dan salah` 10; `tidak sesuai` 3; `Salah Input` 2; `Tidak jadi` 1; `salah input` 1. Dates: 71 deleted in a ~3-minute window on **12 Oct 2026** local; eight earlier.
6. Remaining history: **84 AHSP versions**, **1,125 AHSP resource lines**, one COMPLETED AHSP import job, three project AHSP occurrences; retained does not imply selectable or correct.

## Exact RAB pilot evidence — BOQ 2.1
- Project Working Draft: 36 rows / 32 WORK_ITEM / zero AHSP-linked lines.
- Target persisted row: `Saluran U Pracetak Tipe DS 10A (140 cm x 140 cm dengan tutup)`, quantity `1.000000` unit `m`, no working occurrence, no unit price, no server price origin.
- Another row shares that description but uses quantity `1.500000` unit `m1`; DO NOT conflate with target or silently normalize units.
- Historical parent AHSP `B.64`: exact work/spec label DS 10A, 140 × 140 cm **dengan tutup**; DRAFT v1; output unit `m`, 9 AHSP component rows, soft-deleted 2026-10-12 ~14:27 local, audit reason `salah`.
- Historical AHSP `B.63`: DS 10, **without equivalent 'dengan tutup'** spec, DRAFT v1, 8 components, also deleted reason `salah`. NOT a lawful automatic replacement.
- All 79 parent AHSP are deleted; none can qualify under current `buildEligibleAhspVersionWhere` due to the `deletedAt: null` predicate, irrespective of text or version completeness.

## Technical verdict and non-duplication
- **ROOT CAUSE OF /ahsp=[]: PROVEN** — soft-delete state of all AHSP parent rows in current permanent DB, not HTTP cache, not invalid frontend JSON shape, not server outage.
- **NOT A DATA LOSS CLAIM** — 79 parents/versions/resources still physically exist and audit records persist.
- **NOT AN AUTHORIZATION TO UNDELETE** — deletion reason records flag incorrect/incomplete inputs; never bulk-restore B.64 or the other 78 based on name.
- **RAB AUTO E2E HOLD** until genuinely valid AHSP is reviewed and made usable by the dedicated AHSP product stream under lawful governance. Do not silently re-import or rebuild matching engines.
- Basic Price applicability **cannot yet be judged for BOQ 2.1**, because no lawful AHSP occurrence exists; no price may be invented.
- RAB-only change: second **unfiltered** first-page GET of existing AHSP eligible search after a filtered zero-hit; only proven zero eligible returns user notice `Belum ada AHSP yang dapat digunakan`; no new route/DB write/new matcher.

## Proof / gates
- Frontend scoped tests after final RAB exception change: 59/59 PASS; production frontend build PASS.
- No main merge, push, permanent runtime sync or database mutation.
- Next independent runtime proof must first establish lawful AHSP B.64 equivalence/spec/formula and ready BP price eligibility, then BOQ→Occurrence→Kernel→persisted RAB result/F5.
- New successful **unfiltered** eligible search and new code browser display are NOT yet authenticated E2E proven, because changes remain in the isolated branch.

CLOSED: explanation of AHSP empty list.
HOLD: restoration of intentionally deleted data and full RAB-AUTO-01 computation.
