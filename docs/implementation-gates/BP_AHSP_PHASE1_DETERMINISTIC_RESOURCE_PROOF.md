# SIMPROK — BP-AHSP-PHASE-1

## Deterministic Resource Price Resolution Proof

**Status:** `OWNER/PM IMPLEMENTATION GATE — GO`  
**Authorized by Owner:** 14 Juli 2026  
**Repository:** `fekyigo-rgb/SIMPROK`  
**Target branch:** `feat/bp-ahsp-phase1-deterministic-proof`

---

## 1. Required Re-anchor Order

Before changing code, read in this exact order:

1. `docs/project-memory/SIMPROK_PROJECT_MEMORY.md`
2. `docs/project-memory/SIMPROK_BASIC_PRICE_AHSP_IMPLEMENTATION_BLUEPRINT_OWNER_LOCK.md`
3. `docs/project-memory/SIMPROK_BASIC_PRICE_AHSP_IMPLEMENTATION_BLUEPRINT.md`
4. locked Foundation / ADR documents relevant to AHSP and Basic Price
5. repository and runtime evidence
6. this bounded implementation gate

Do not proceed unless:

- local branch is created from the current clean `origin/main`;
- `HEAD == origin/main` before branch creation;
- this gate file exists in the checked-out base;
- the exact base SHA is recorded in the implementation report.

PR #19 is closed and must not be touched.

---

## 2. Locked Laws

- **SIMPROK menghitung, manusia memutuskan.**
- **AHSP adalah otoritas. Basic Price menyesuaikan.**
- Basic Price records market facts; nominal price is not a trust score.
- No warning or rejection merely because a price is high or low.
- Resource-level Basic Price choice belongs inside the project AHSP occurrence, not the RAB row.
- Master AHSP must remain unchanged.
- Raw AHSP resource evidence must not be overwritten.
- Basic Price adapts one-way to the AHSP-required unit.
- Unsupported or ambiguous resolution must fail closed.
- The first proof must be bounded and must not create a universal unit engine.

---

## 3. Objective

Implement one reusable **pure backend resolution kernel** proving this exact deterministic chain:

```text
Project AHSP resource
  raw reference: Pekerja
  resource type: LABOR
  AHSP unit: OH
        ↓ exact normalized identity/type match
ResourceCatalog
  name: Pekerja
  type: LABOR
  baseUnit: Org/Hari
        ↓ one already-eligible Basic Price for that ResourceCatalog
Basic Price
        ↓ exact labor-day equivalence, factor 1
Resolved project AHSP resource with an explanation
```

This slice proves identity and unit equivalence only.

It does **not** persist an occurrence, create a snapshot, calculate resource cost, calculate AHSP unit price, or update RAB.

---

## 4. Architectural Boundary

Implement a pure deterministic kernel, preferably at:

```text
backend/src/ahsp/price-resolution/ahsp-resource-price-resolution.kernel.ts
```

Add its focused unit tests, preferably at:

```text
backend/src/ahsp/price-resolution/ahsp-resource-price-resolution.kernel.spec.ts
```

Keep the slice to these two files unless TypeScript compilation proves a minimal additional export file is strictly required.

Do not wire the kernel into a controller, module provider, database service, frontend, or RAB flow in this phase.

### Why a pure kernel

The following decisions remain open and must not be silently decided here:

- final `ACCEPT / VERIFIED / PUBLISHED` semantics;
- global versus workspace precedence;
- final persistence entity names;
- multi-candidate Basic Price ranking;
- expired automatic-use policy.

The kernel therefore receives **already tenant-visible and already eligible candidates** as input. It must not define publication or tenant eligibility.

---

## 5. Required Input Contract

The kernel input must carry stable references sufficient for a project-AHSP proof, conceptually:

```ts
{
  projectId: string;
  ahspVersionId: string;
  ahspResourceId: string;
  rawResourceRef: string;
  resourceType: string;
  ahspUnit: string;
  resourceCatalogCandidates: Array<{
    id: string;
    code: string;
    name: string;
    type: 'MATERIAL' | 'LABOR' | 'EQUIPMENT';
    baseUnit: string;
  }>;
  eligibleBasicPriceCandidates: Array<{
    id: string;
    resourceId: string;
    value: string;
    sourceOrigin: string;
  }>;
}
```

Exact TypeScript naming may differ, but the boundary must remain equivalent.

Use decimal strings for price values. Do not convert a price through a lossy JavaScript number.

---

## 6. Required Resolution Rules

### 6.1 Resource name

For this phase, normalization is limited to:

- trim;
- lowercase/case folding;
- collapse repeated whitespace.

Only exact normalized `Pekerja == Pekerja` is supported.

No fuzzy matching. No semantic similarity. No aliases beyond the exact normalized name.

### 6.2 Resource type

The AHSP resource and ResourceCatalog candidate must both be `LABOR`.

A type mismatch must not resolve.

### 6.3 Unit equivalence

Support only the bounded labor-day equivalence required by this proof:

```text
OH == Org/Hari == Orang/Hari == PERSON_DAY
```

Normalization may ignore case and surrounding whitespace.

Do not add material, equipment, package, weight, volume, or time conversions.

The output conversion factor for this exact equivalence is `1`.

### 6.4 Resource candidate cardinality

- zero exact ResourceCatalog candidates → `UNRESOLVED`;
- exactly one exact candidate → continue;
- more than one exact candidate → `NEEDS_REVIEW`.

Do not choose by order, code, workspace, or nominal price.

### 6.5 Basic Price candidate cardinality

Only candidates whose `resourceId` equals the resolved ResourceCatalog ID are relevant.

- zero matching already-eligible Basic Prices → `UNRESOLVED`;
- exactly one matching candidate → `RESOLVED`;
- more than one matching candidate → `NEEDS_REVIEW`.

Multi-price ranking belongs to a later phase. Do not select the cheapest, newest, highest, or first item.

### 6.6 Nominal neutrality

The nominal value must not affect identity resolution.

A high or low value must neither create a warning nor change the result.

---

## 7. Required Output Contract

For `RESOLVED`, return a structured result containing at minimum:

- projectId;
- ahspVersionId;
- ahspResourceId;
- rawResourceRef;
- resolved ResourceCatalog ID;
- selected Basic Price ID;
- source origin;
- source price as an exact decimal string;
- source unit;
- AHSP unit;
- canonical unit `PERSON_DAY`;
- conversion factor as exact string `1`;
- adapted price as the same exact decimal string;
- selection status `AUTO_SELECTED`;
- deterministic reason codes;
- a human-readable Indonesian explanation.

Suggested reason codes:

- `EXACT_RESOURCE_NAME_MATCH`
- `RESOURCE_TYPE_MATCH`
- `LABOR_DAY_UNIT_EQUIVALENT`
- `SINGLE_ELIGIBLE_BASIC_PRICE`

For `UNRESOLVED` or `NEEDS_REVIEW`, return:

- stable status;
- deterministic reason code(s);
- no fabricated ResourceCatalog ID;
- no fabricated Basic Price ID;
- no adapted price.

Do not throw for ordinary unresolved/ambiguous domain outcomes. Reserve exceptions for malformed programmer input only.

---

## 8. Required Focused Tests

At minimum prove:

1. `Pekerja / LABOR / OH` resolves to exactly one `Pekerja / LABOR / Org/Hari` catalog and one Basic Price.
2. Case and surrounding whitespace do not break the exact proof.
3. `Mandor` does not resolve to `Pekerja`.
4. `LABOR` does not resolve to a `MATERIAL` catalog.
5. `OH` does not resolve to unsupported `Jam`.
6. `sak` does not resolve to `kg`; package conversion is outside scope.
7. Multiple exact ResourceCatalog candidates return `NEEDS_REVIEW`.
8. Multiple Basic Prices for the resolved catalog return `NEEDS_REVIEW`; the kernel does not select by price or array order.
9. No matching Basic Price returns `UNRESOLVED`.
10. A very high nominal price resolves exactly the same way as another nominal value and produces no price-based warning.
11. Unrelated Basic Prices from another ResourceCatalog are never selected.
12. Input decimal strings are returned exactly without conversion to JavaScript number.

Tests must inspect the explanation/reason codes, not only the status.

---

## 9. Forbidden Scope

- No Prisma schema change.
- No migration.
- No database writes or reads.
- No controller or endpoint.
- No module wiring unless compilation makes a tiny export unavoidable.
- No frontend.
- No RAB changes.
- No BOQ changes.
- No AHSP master mutation.
- No snapshot change or backfill.
- No publication-status fix.
- No Basic Price eligibility redesign.
- No global/workspace precedence rule.
- No multi-price ranking.
- No `EXPIRED` policy.
- No fuzzy matching or AI matching.
- No Resource Catalog alias system.
- No package conversion.
- No Cost Kernel arithmetic.
- No resource-cost, AHSP-unit-price, or RAB-line calculation.
- No reuse of unsafe `first-real-input-sample.json.matches` as production truth.
- Do not touch PR #19 or its branch.

---

## 10. Implementation Quality Rules

- Pure and deterministic.
- No I/O.
- No current-time dependency.
- No random IDs.
- No global mutable state.
- No `any` in the new production kernel.
- Exhaustive result union where practical.
- Stable reason codes.
- Indonesian explanation for product-facing trace.
- Clear comment that the labor-day unit rule is deliberately bounded and is not a universal unit dictionary.

---

## 11. Required Gates

Run and report exact commands and exit codes:

1. `git status --short`
2. `git branch --show-current`
3. `git rev-parse HEAD`
4. `git rev-parse origin/main`
5. `git diff --check`
6. focused unit test for the new kernel with `--runInBand`
7. `npm run build`
8. full backend unit tests serially: `npm test -- --runInBand`
9. Prisma validation using the guarded test environment, without migration/reset
10. `npm run verify:db:test`
11. `npm run test:e2e:safe`
12. `npm --prefix ../frontend run build`
13. secret-leak review
14. final `git status --short`

Database law:

- never run destructive or acceptance tests against `simprok_db`;
- use only the official guarded `simprok_test` lifecycle;
- this slice does not authorize migration, reset, seed redesign, or production-data mutation.

---

## 12. Git and Delivery Rules

1. Start from clean current `origin/main` containing this gate.
2. Create branch:

```text
feat/bp-ahsp-phase1-deterministic-proof
```

3. Implement only the bounded scope.
4. Commit only after all required gates pass.
5. Suggested commit message:

```text
feat(ahsp): prove deterministic worker price resolution
```

6. Do not merge.
7. Do not declare Owner PASS.
8. Return the branch and commit SHA for PM review.

---

## 13. Required Final Report

### A. Baseline proof

- branch;
- exact base SHA;
- clean status.

### B. Re-anchor proof

- documents read;
- locked laws applied.

### C. Changed files

- exact list;
- why each file changed.

### D. Contract proof

- input union/types;
- output union/types;
- supported normalization;
- explicit unsupported cases.

### E. Focused test matrix

Report every required positive and negative case.

### F. Gate evidence

- command;
- result/count;
- exit code.

### G. Scope audit

Confirm every forbidden area remained untouched.

### H. Final verdict

Exactly one:

- `IMPLEMENTATION_PASS_AWAITING_PM_GATE`
- `STOP_ARCHITECTURE_CONFLICT`
- `FAIL`

---

## 14. PM Acceptance Boundary

This phase is successful only when the repository contains a reusable backend kernel that deterministically proves:

```text
Pekerja + LABOR + OH
→ Pekerja + LABOR + Org/Hari
→ exactly one already-eligible Basic Price
→ AUTO_SELECTED with factor 1 and a traceable explanation
```

It is not yet a live Cost Kernel, not persistence, not a snapshot, and not a live RAB line.
