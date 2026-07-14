# SIMPROK BASIC PRICE–AHSP IMPLEMENTATION BLUEPRINT — OWNER LOCK RECORD

**Canonical blueprint:** `docs/project-memory/SIMPROK_BASIC_PRICE_AHSP_IMPLEMENTATION_BLUEPRINT.md`  
**Blueprint version:** `v1.0`  
**Owner:** Feky de Fretes  
**Owner decision date:** 14 Juli 2026  
**Decision:** `PASS`  
**Effective status:** `OWNER PASS — FOUNDATION LOCKED`

## 1. Lock Effect

The Owner has approved the complete Basic Price–AHSP Implementation Blueprint v1.0.

This lock record supersedes the earlier draft-status wording in the blueprint header. The canonical blueprint content remains the source of truth; this file records its approval state and does not duplicate the blueprint.

The following directions are now locked unless explicitly marked `OPEN DECISION` inside the blueprint:

- Basic Price records market facts and must not warn merely because a nominal value is high or low.
- Public Basic Price identity is origin-first: Harga Pemerintah, Harga Toko/Supplier, or Harga Lapangan.
- SIMPROK automatically selects Basic Price inside the project AHSP occurrence.
- The user may inspect the reason, compare alternatives, and replace SIMPROK’s selection.
- Resource-level price selection and override belong inside the project AHSP occurrence/snapshot, not the RAB row.
- Master AHSP remains authoritative and unchanged.
- Basic Price adapts one-way to the AHSP-required unit through deterministic, evidence-backed conversion.
- Old snapshots are never backfilled.
- RAB consumes the resulting AHSP unit price and calculates volume × AHSP unit price.
- The first proof must be bounded and must not begin with a universal unit engine.

## 2. Implementation Authority

Owner PASS locks the product and architecture foundation. It does **not** authorize unbounded implementation.

Every production slice still requires a separate bounded Owner/PM implementation gate with explicit scope, forbidden scope, tests, database safety, and final verdict.

## 3. Retrieval Order

All implementers and reviewers must read in this order:

1. `docs/project-memory/SIMPROK_PROJECT_MEMORY.md`
2. this Owner Lock Record
3. `docs/project-memory/SIMPROK_BASIC_PRICE_AHSP_IMPLEMENTATION_BLUEPRINT.md`
4. locked Foundation / ADR documents
5. repository and runtime evidence

## 4. Revision Law

The blueprint may only be revised by an explicit Owner `REVISE` decision. A later revision must preserve history and mark superseded decisions rather than silently rewriting them.

**SIMPROK menghitung. Manusia memutuskan.**  
**AHSP adalah otoritas. Basic Price menyesuaikan.**  
**Reduce Uncertainty.**
