# RAB-AUTO-01 — Owner Screenshot Search Gate, 28 Oct 2026

## Observed screenshot only (no inferred network/DB facts)
- Owner selected BOQ **2.1 Saluran U Pracetak Tipe DS 10A (140 cm x 140 cm dengan tutup)**; visible quantity **1.00 m**, AHSP unlinked, unit price and line total missing.
- Existing drawer **Pilih AHSP dan Region Harga baru** open.
- Field **Pilih AHSP** visibly shows *placeholder* "Pilih atau ketik kode / nama AHSP..." (no evidence that **DS 10A** was actually typed).
- Existing runtime displays "Tidak ada AHSP yang cocok". This is an **overly definitive copy** for an empty or bounded search, not reliable evidence of full-catalog absence.
- Region query also blank; this is not evidence that a matching AHSP is unavailable.
- Screenshot is on existing runtime; local RAB-AUTO-01 branch improvements remain unpromoted.

## Read-only code facts
- `ProjectAhspService.searchEligibleVersions` searches existing AHSP parents by *substring of one of* code, workType or methodName, default q empty and a page of 25. It returns only AHSP versions eligible under `buildEligibleAhspVersionWhere`.
- Eligibility: AHSP version output unit present and at least one resource; as-of bounds; published catalog vs own unretired workspace-private, with tenancy constraints. This is an eligible-selection list, **not** the raw catalogue inventory or full semantic match to BOQ specifications.
- UI originally used misleading "Tidak ada AHSP yang cocok" whenever a ready search had zero results, even with a blank query. Local branch already changes this to search-scoped, honest copy.
- Branch auto-discovery now prefers explicit source code **DS 10A** over generic `Saluran U Pracetak`, only for candidate recall; it never autorizes linking.

## Evidence still missing / next human action
1. Owner enters **DS 10A** into the existing manual AHSP search input and allows it to finish (without selecting an option, setting region or committing).
2. Screenshot must show text **DS 10A** *inside the field* and either displayed candidate list or empty/search error status.
3. A positive candidate MUST be separately checked for **140 × 140 cm** and **with cover** and Unit Kernel compatibility. A zero result only proves no eligible substring hit for this search; never catalogue-wide absence.
4. Real production BOQ and pricing still pending authenticated DB/API readback; previous read-only Postgres attempt failed SQLSTATE **28P01**. Do not bypass credentials or mutate permanent data.

## Test and mutation verdict
- Targeted frontend: 57/57 PASS (including explicit-code discovery anchor).
- Frontend build: PASS.
- No main/runtime/DB update from this screenshot audit.
- REAL-BOQ-AUTO-SELECT: NOT PROVED. DO NOT MERGE OR AUTO-LINK YET.
