# SIMPROK — BP-AHSP-PHASE-2

## OCCURRENCE IDENTITY CONSTITUTIONAL CLARIFICATION

**Status:** `PM/GATEKEEPER BINDING CLARIFICATION — REQUIRED BEFORE COMMIT C`  
**Date:** 15 Juli 2026  
**Applies to:** `BP_AHSP_PHASE2_PROJECT_OCCURRENCE_PERSISTENCE.md` and `BP_AHSP_PHASE2_IMPLEMENTATION_PLAN.md`  
**Production executor:** `CODEX ONLY`

This clarification closes the constitutional concern raised during Architect review. It does not widen Phase 2 and does not authorize a canonical Work Occurrence or Execution Assessment model.

---

## 1. Repository Truth and Authority

The canonical repository currently records:

- `docs/product-intelligence/P7C_PRODUCT_INTELLIGENCE_LAW.md` as `v1.0-DRAFT`, `DRAFT — DESIGN ONLY`, with no Owner PASS and no implementation authority by itself;
- occurrence verdict B: current `boqItemRef` is only a proxy and is not a structural Work Occurrence guarantee;
- the physical persistence shape of a future structural Work Occurrence / Execution Assessment remains a separate Owner decision;
- the Owner-approved Basic Price–AHSP Blueprint places resource price selection inside a project AHSP occurrence;
- the separate bounded Phase 2 Owner/PM gate explicitly authorizes `ProjectAhspOccurrence` and `ProjectAhspResourceResolution` for deterministic Basic Price resolution persistence.

A cited `P7C v2` or `LAW-8.7` that is not present in the canonical repository cannot silently replace current repository law. The underlying safety concern is nevertheless accepted and enforced below.

---

## 2. Completed Lock-Check for This Bounded Slice

The bounded lock-check already established:

1. Draft `BoqItem` rows are unstable because draft BOQ persistence deletes and recreates them.
2. `boqItemRef` is not a structural Work Occurrence identity.
3. Resource-level Basic Price selection must not live on `BoqItem`, a RAB row, or master AHSP.
4. A distinct project-context container is required for one bounded application of an AHSP version.
5. The Owner/PM Phase 2 gate explicitly chose and locked the production names and schema contract:
   - `ProjectAhspOccurrence`
   - `ProjectAhspResourceResolution`

Therefore Phase 2 may create these two persistence entities only under the non-equivalence rules below.

---

## 3. Non-Equivalence Law

For Phase 2:

```text
ProjectAhspOccurrence != canonical WorkOccurrence
ProjectAhspOccurrence != ExecutionAssessment
idempotencyKey         != occurrenceKey
UUID primary key        != approved structural occurrence identity
```

`ProjectAhspOccurrence` is only a bounded technical/project-context container for one deterministic AHSP resource price-resolution attempt.

It does not define the final identity, lifecycle, semantics, or relationships of a future structural Work Occurrence.

---

## 4. Required Schema Boundary

Phase 2 may persist only the fields already authorized by the gate and final plan.

It must not add:

- `occurrenceKey`;
- `boqItemId`;
- WBS/work-scope structural identity;
- schedule/activity identity;
- location/work-face identity;
- Execution Assessment context;
- Execution Factor identity or references;
- human-decision lifecycle for a structural occurrence;
- a claim that this model is the final canonical Work Occurrence.

`idempotencyKey` exists only for client retry safety under `unique(projectId, idempotencyKey)`. It must never be described, exposed, or reused as a domain occurrence identity.

---

## 5. Migration Honesty

`additive migration` means existing rows are not destructively rewritten. It does not, by itself, prove that a new domain shape is correct.

The migration is authorized only because:

- the Owner/PM bounded gate explicitly chose the two Phase 2 entities;
- the entities are constrained to price-resolution persistence;
- the future structural Work Occurrence remains undecided and separate;
- Phase 2 contains no BOQ linkage, EF, Cost Kernel, snapshot, or RAB mutation.

The implementation report must state this limitation explicitly.

---

## 6. Future Compatibility Law

A future Owner decision may introduce a separate canonical Work Occurrence model or relationship.

Phase 2 must not prejudge whether the future model will:

- reference `ProjectAhspOccurrence`;
- supersede it;
- aggregate several project AHSP occurrences;
- remain a separate domain object.

No automatic migration, reinterpretation, or backfill is authorized now.

---

## 7. Stop Conditions

Stop before Commit C with:

```text
STOP_OCCURRENCE_IDENTITY_SCOPE
```

if implementation attempts to:

- introduce `occurrenceKey` or structural BOQ/WBS linkage;
- treat `idempotencyKey` as canonical identity;
- add Execution Assessment or EF fields;
- claim `ProjectAhspOccurrence` is the final Work Occurrence;
- widen the schema beyond the exact bounded gate.

---

## 8. Binding Verdict

```text
CLAUDE CONSTITUTIONAL CONCERN : ACCEPTED
STRUCTURAL WORK OCCURRENCE    : STILL PENDING SEPARATE OWNER DECISION
PHASE 2 PROJECT AHSP CONTAINER: AUTHORIZED BY EXISTING OWNER/PM GATE
COMMIT C                      : MAY PROCEED ONLY WITH THIS CLARIFICATION
```

Codex must read this document immediately after the final implementation plan and must reproduce the non-equivalence proof in its final report.

**SIMPROK menghitung. Manusia memutuskan.**  
**AHSP adalah otoritas. Basic Price menyesuaikan.**