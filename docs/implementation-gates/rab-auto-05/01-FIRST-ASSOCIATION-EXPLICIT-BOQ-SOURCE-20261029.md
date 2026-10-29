# RAB-AUTO-05 ΓÇö First-time AHSP association from explicit, approved BOQ evidence
Date: 2026-10-29, Asia/Jayapura
Mandate: Activate native SIMPROK intelligence without name guessing, cloned engines, LLM money, or touching locked production truths.
Worktree: E:\SIMPROK-RAB-AUTO-05-EXPLICIT-AHSP-REF-WT-20261029
Baseline: GitHub main 28a0a44 (includes PR #223, #225 and #226). This backend seam is separate from Computer 2's RAB-AUTO-01 to 04 branch ac1ee87, currently unreachable/offline.

## Actual source gap found
Existing BOQ parser read only a WBS/item 'No/Kode' column and name, quantity and unit. BOQ WBS number '2.1' is NOT an AHSP code 'B.64'. BoqItem has no dedicated persisted AHSP reference; hence first-time autonomous linking based on these fields alone has no independent authority.
Owner-approved BOQ import already has SourceDocument checksum, import fingerprint and BoqBusinessUseEvent, which is human-approved provenance. REUSE those.

## Narrow source evidence addition
- Optional `BoqItem.sourceAhspCode` VARCHAR(128) migration. Historical rows NULL. No AHSP/BP tables altered. Migration file only, NOT run on permanent DB.
- BOQ XLSX reader accepts a DEDICATED header: 'Kode AHSP', 'AHSP Code', 'Referensi AHSP'. This is completely separate from No/Kode WBS.
- Retains unknown code as source fact; does not reject an unheard-of AHSP catalog identity. Rejects >128 character codes to avoid truncation. Absence stays NULL.
- Reader/semantic contracts incremented to BOQ_XLSX_INTAKE_ADAPTER_V3 / IMPORT_FIRST_01_V4 so pre-existing unapproved import-job interpretations are not falsely treated as the new schema.
- Existing approved `BoqImportService.approve` persists the exact code into the canonical BOQ item only for WORK_ITEM. Existing SourceDocument/BoqBusinessUseEvent approval remains single provenance authority.

## First-association backend path
- Guarded POST /projects/:projectId/ahsp-occurrences/boq-items/working-draft/auto-bind-explicit-references (trusted JWT project/workspace, authenticated actor, AHSP_VIEW AND RAB_DRAFT_EDIT).
- Processes up to 25 saved WORK_ITEM records per page, never writes when an existing AHSP link/price or calculation occurrence exists.
- Requires latest project BOQ business-use approval and unchanged BOQ row since that approval.
- Requires ONE (not zero or many) selected project reference region; no inferred location.
- Reuses existing ProjectAhspService.searchEligibleVersions (as-of, current version, ownership, classification and Unit Kernel recommendation). Fail closed when candidate universe truncated, zero or multiple exact matches, or category/unit unproven.
- The matcher is NOT rebuilt: this is a simple corroboration of the EXPLICIT source code and EXACT full work description against the returned canonical parent code and workType/methodName. NFC/whitespace/case only, no fuzzy specifications, measurements or punctuation rewriting.
- Existing ProjectAhspService.selectForBoqItem is the ONLY writer and re-proves locked project's source BOQ code, approved import freshness, single selected price region, current AHSP code + full label, current AHSP version eligibility, Unit Kernel/monetary identity, resource resolution and Basic Price. No new persistence engine.
- Uses stable sha256 idempotency key for first-reference decisions and optional source-code assertion in canonical payload hash.
- Every blocked item stays an honest exception; others continue. No RAB approval, lock, cost fabrication or LLM decision.

## Proof, caveats and next gate
- Targeted parser and new controller/service tests: **4 suites / 27 tests PASS**.
- Regression tests for existing BOQ business-use approval, AHSP eligibility/search, region, preference and selection: **6 suites / 105 PASS**.
- Combined scoped count: **132/132 PASS**. Prisma Client generated in isolated worktree, NestJS production backend build PASS.
- Native association transaction refusal tests include code changed after preflight, stale source approval, target manual price, ambiguous region and wrong canonical AHSP code/specification.
- New-code scoped lint PASS after final recheck. Existing canonical files retain pre-existing lint baseline; no broad formatting or kernel rewrite was introduced.
- NO permanent DB write, migration execution, main merge/push, runtime sync, authenticated browser E2E or F5 proof. No claim that any real BOQ is linked by this branch yet.
- Computer 2 currently OFFLINE. Existing RAB-AUTO-04 remains intact there; this is a distinct backend seam. After Computer 2 reconnects, selectively integrate the backend delta into its existing RAB branch, connect the RAB-level 'Lengkapi Otomatis' journey to the new guarded command, and repeat combined tests.
- Existing test project 'Uji Klasifikasi dan Konteks' has no persisted source AHSP-code evidence for 32 old rows, and three region selections. Thus the lawful expected outcome is STILL zero first-time auto-links there. A new Owner-approved BOQ with explicitly named AHSP references plus unambiguous region provides an eligible real-data test.
- No-code BOQs still need an independently canonical BOQΓåÆAHSP authority mechanism before any automatic first pairing. Do not misrepresent text overlap as proof.

VERDICT: FIRST-TIME GOVERNED SOURCE-REFERENCE PIPELINE BUILT IN ISOLATED SOURCE; FULL AUTOMATIC RAB LIVE E2E NOT YET PASS.
