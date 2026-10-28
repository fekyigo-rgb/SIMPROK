# RAB-AUTO-01 — Owner real UI observation (2026-10-28)

## Observation source
Screenshot provided by Owner of the logged-in RAB workspace UI:
`http://localhost:5173/project/f344e9b9-941e-4125-878e-d25adee2ebdf/rab/workspace`.
The screenshot alone does **not** establish DB readback, exact runtime Git revision, or catalog completeness.

## Selected and visible facts
- UI: "Rencana Anggaran Biaya", a draft workspace; draft status text: "Draft tersimpan di server".
- Selected item **1.1 Pekerjaan Pembersihan**, shown volume **1,00**, unit **Ls**, code AHSP "Belum terhubung".
- Its "Detail Analisa AHSP" shows **AHSP belum terhubung**, "Mesin / cara harga dibentuk: Belum tersambung", "Total Harga Satuan: Belum dihitung", and no composition until AHSP linked.
- All visible work-item rows have AHSP not linked, unit price and row amount "—". This is honest unpriced presentation rather than implied Rp0.
- Main action is **Pilih/Ganti AHSP** (human action) and **Hitung & Simpan Harga SIMPROK**. This does NOT establish silent AHSP selection.
- Displayed as-of price date: **10/28/2026**.
- Visible item **2.1 Saluran U Pracetak Tipe DS 10A (140 cm x 140 cm dengan tutup)** has volume **1,00**, output unit **m** and explicit product dimensions/specifications. Suggested scope-specific first pilot because the spec creates a hard constraint; not proof eligible AHSP exists.
- Visible units include `m`, `M`, and `Ls`; their canonical semantics and BOQ provenance require Unit Kernel proof, not case-guessing.
- All visible BOQ volumes display **1,00**. Whether they are genuine source quantities or import/default values is not provable from this screenshot. Preserve source; do not auto-recalculate volume.
- "Kunci RAB" is visible but the screenshot's unpriced rows **must not** be represented as ready for lock.

## Read-only live reachability
On connected DESKTOP-4FU9292, TCP listeners were observed at 5173 (frontend), 3000 (backend), and 55432 (PostgreSQL); HTTP HEAD to frontend and backend returned 200. **Availability is not proof of authenticated application data, database truth, or correct automatic pricing**.

## Gate selected for first real BOQ row
**Target**: BOQ 2.1 "Saluran U Pracetak Tipe DS 10A (140 cm x 140 cm dengan tutup)", quantity 1,00, unit m, project UUID above. Target name and quantity are OWNER-UI-OBSERVED, not source-DB verified.

1. Verify real persisted BOQ row ID, canonical unit, quantity, project classification, workspace and region/date, **read-only** in proper authority.
2. Ask existing AHSP eligibility + versioning + Unit Kernel for candidates; prove fit of the complete DS10A, 140cm x 140cm, with cover specification. Never choose "similar size" automatically.
3. Prove **global unique authoritative selection** or a valid prior approved exact decision, not only first-ranked or first-paginated candidate.
4. If unambiguous, reuse existing transaction-managed `selectForBoqItem`; for each canonical resource reuse existing identity/BP resolver and Cost Kernel. Validate date 2026-10-28, region and price eligibility; store trace.
5. If incomplete, emit a truthful exception on this line; do not manufacture Rp0; other lines unaffected.
6. Verify idempotency, persistence, authenticated browser F5, safe isolated DB, targeted regression and exact-head CI. No production mutations before Owner authorization.

## Explicit limitations and verdict
**UI-OBSERVATION COMPLETE; ONE REAL LINE AUTO-PRICE NOT PROVEN.**
No evidence that eligible AHSP/BP exists for the pilot. No selection or pricing attempted; no modification to project, db, runtime, or existing AHSP/BP worktrees.
