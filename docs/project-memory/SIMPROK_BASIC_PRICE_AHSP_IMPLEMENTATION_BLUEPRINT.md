# SIMPROK BASIC PRICE–AHSP IMPLEMENTATION BLUEPRINT

**Version:** v1.0  
**Status:** OWNER REVIEW DRAFT — BASIS BEFORE IMPLEMENTATION PROMPT  
**Date:** 14 Juli 2026  
**Repository baseline:** `main` @ `e182ed352e3b4decd77c3123ce137e34745bf871`  
**Purpose:** Key product and implementation document before any execution prompt is issued.

> **Core law:** SIMPROK menghitung, manusia memutuskan.  
> **Domain law:** AHSP adalah otoritas. Basic Price menyesuaikan.  
> **Product objective:** Reduce Uncertainty.

---

## 1. Executive Decision Summary

1. **Basic Price records market facts, not “right” or “wrong” prices.** A price is accepted when its origin, item, unit, time, location, coverage, and evidence are accountable. A high or low nominal value is not, by itself, a warning condition.
2. **Public Basic Price is identified primarily by its origin:** Harga Pemerintah, Harga Toko/Supplier, or Harga Lapangan. Verification/publication states are internal trust gates; freshness is secondary contextual information.
3. **SIMPROK automatically selects Basic Price inside the project AHSP occurrence.** Users do not have to choose every price manually.
4. **Users can inspect the reason, compare alternatives, and replace SIMPROK’s choice.** The override is stored and audited inside the project AHSP occurrence, not in the RAB row.
5. **RAB consumes the final AHSP unit price only.** RAB does not independently select resource prices.
6. **Master AHSP remains authoritative and unchanged.** Project context, selected Basic Price, conversion evidence, and overrides belong to the project AHSP occurrence/snapshot.
7. **The first production proof must use one deterministic resource chain and avoid a universal conversion engine.**
8. **Old snapshots are never backfilled.** History must not change meaning.

---

## 2. Document Status Vocabulary

- **OWNER DECISION:** Direct product decision from the Owner and treated as binding for this blueprint.
- **LOCKED LAW:** Existing SIMPROK doctrine that implementation must not weaken.
- **REPO REALITY:** Verified condition in the current repository.
- **PM ARCHITECTURE RECOMMENDATION:** Proposed implementation structure, still subject to Owner lock.
- **OPEN DECISION:** Must be resolved before the affected implementation slice.

---

## 3. Locked Product Laws

### 3.1 Basic Price is a fact record

Basic Price states:

> “At this source, place, time, unit, specification, and coverage, this price was offered, reported, or officially published.”

Basic Price does **not** state:

- that the price is universally correct;
- that a higher price is suspicious;
- that a lower price is better;
- that the price is the only valid price;
- that one market fact invalidates another market fact.

### 3.2 No nominal-based warning

SIMPROK must not warn merely because a price is higher or lower than another price. Differences may arise from location, transport, stock, brand, package, timing, unloading, delivery coverage, risk, or other real conditions.

Attention indicators are allowed only for data context such as:

- unclear unit;
- missing specification;
- incomplete evidence;
- unknown delivery coverage;
- unresolved resource identity;
- stale/expired time context;
- data corruption or duplication.

### 3.3 Automatic choice with human control

SIMPROK automatically selects the most contextually appropriate eligible Basic Price for each resource inside the project AHSP occurrence.

The user may:

- **Lihat alasan pemilihan**
- **Lihat harga pembanding**
- **Ganti harga**

The selection remains auditable as `AUTO_SELECTED` or `USER_OVERRIDDEN`.

---

## 4. Correct Domain Placement

### 4.1 Master AHSP

Master AHSP stores authoritative technical content:

- work identity;
- method;
- resource reference;
- resource type;
- coefficient;
- AHSP unit;
- regulation/source evidence.

Master AHSP must not be changed by project price context.

### 4.2 Project AHSP occurrence

The project occurrence stores contextual resolution:

- resolved ResourceCatalog identity;
- candidate Basic Prices;
- selected Basic Price;
- source/origin;
- adapted price in AHSP unit;
- conversion evidence;
- selection reason;
- comparison set;
- automatic or user override status;
- project/location/time context.

### 4.3 AHSP Snapshot

The snapshot freezes:

- raw AHSP resource;
- coefficient and AHSP unit;
- resolved resource identity;
- selected Basic Price identity and value;
- source/origin and freshness at snapshot time;
- conversion rule/factor and evidence;
- selection reason;
- override actor/reason, if any.

Old snapshots are never backfilled.

### 4.4 RAB

RAB stores/consumes:

- work item;
- volume;
- AHSP unit price result;
- line total.

Formula:

`RAB line total = volume × AHSP unit price`

RAB does not re-select Basic Price per resource.

---

## 5. Basic Price Source and Origin Model

| Public family | Technical origins | Public label | Trust pathway |
|---|---|---|---|
| PEMERINTAH | GOVERNMENT, BPS/official publication | Harga Pemerintah / Publikasi Pemerintah | Official source authenticity and document integrity are verified; nominal value is not curated by SIMPROK. |
| TOKO_SUPPLIER | STORE, SUPPLIER, DISTRIBUTOR | Harga Toko/Supplier | Source identity, item, unit, date, and offer integrity are verified; SIMPROK does not regulate the seller’s nominal price. |
| USULAN_USER | FIELD_REPORT, COMMUNITY_REPORT | Harga Lapangan | Evidence is reviewed/curated for authenticity, context, and completeness before becoming eligible. |

Important distinction:

- **Source** answers: “Whose price is this?”
- **Reporter** answers: “Who entered/reported it to SIMPROK?”

A user may report a store price while the source remains `STORE`.

---

## 6. Multi-Axis Status Model

One overloaded status must not carry every meaning.

### 6.1 Intake/review status

`SUBMITTED → UNDER_REVIEW → NEEDS_CORRECTION / VERIFIED / REJECTED`

This indicates evidence-processing state.

### 6.2 Publication/availability status

`INTERNAL → PUBLISHED → WITHDRAWN`

This indicates whether a record may appear in the public information room and become an automatic-selection candidate.

### 6.3 Freshness status

`CURRENT → EXPIRING → EXPIRED`

Freshness does not mean right/wrong.

Public meaning of `EXPIRED`:

> Data ini pernah dibuktikan, tetapi kondisi terkini belum dipastikan. Pastikan kembali bila akan digunakan.

### 6.4 AHSP selection status

- `UNRESOLVED`
- `AUTO_SELECTED`
- `USER_OVERRIDDEN`
- `NEEDS_REVIEW`
- `LOCKED_IN_SNAPSHOT`

### 6.5 Public display law

Primary visual identity:

- Harga Pemerintah
- Harga Toko/Supplier
- Harga Lapangan

Secondary metadata:

- date;
- location;
- specification;
- unit/package;
- delivery coverage;
- freshness.

`VERIFIED/PUBLISHED` should not dominate the public card.

---

## 7. Unit and Conversion Plan

### 7.1 Non-negotiable rules

1. AHSP unit is never altered.
2. Raw commercial price unit is preserved.
3. Conversion is one-way: **Basic Price adapts to the unit required by AHSP.**
4. Every conversion must be deterministic, explainable, and evidence-backed.
5. Unsupported conversion remains `UNRESOLVED`; SIMPROK does not guess.
6. No universal conversion engine in the first slice.

### 7.2 Required unit data

For every Basic Price candidate, retain:

- raw unit text;
- canonical unit;
- package quantity/content;
- numerator unit;
- denominator unit;
- conversion factor;
- conversion rule identifier;
- evidence/source of package capacity;
- precision/rounding rule.

### 7.3 Initial supported classes

**Class A — Exact canonical equivalence**

Examples:

- `OH` = `Org/Hari` = orang-hari
- `U/J` = unit-jam
- `m3` = `M³` after canonical normalization

These may auto-resolve when resource identity and type also match.

**Class B — Evidence-backed package conversion**

Examples:

- 1 sak = 50 kg, only when the package evidence states 50 kg;
- 1 drum = 200 liter, only when the product/source states 200 liter;
- price per box → price per piece, only when box content is known.

**Class C — Contextual/unsupported conversion**

Examples:

- loose volume to weight without density evidence;
- equipment day to hour without operating-hour basis;
- location/delivery adjustment without explicit coverage.

These must not be guessed.

### 7.4 Adaptation formula

`adapted price in AHSP unit = source price × conversion factor`

`resource cost = AHSP coefficient × adapted price`

The original price, original unit, conversion factor, and adapted value must all remain visible in the audit trail.

---

## 8. Automatic Basic Price Selection Inside AHSP

### 8.1 Candidate eligibility

A candidate must satisfy:

1. resolved canonical resource identity;
2. resource type compatibility;
3. exact or supported unit adaptation;
4. tenant/global visibility rules;
5. permitted publication/availability state;
6. usable freshness policy;
7. sufficient source and context data.

### 8.2 Selection priorities

SIMPROK selects by contextual fitness, not by cheapest or highest nominal value.

Priority factors:

1. exact resource identity;
2. specification fit;
3. exact unit or deterministic conversion;
4. project location and reference region;
5. delivery/coverage fit;
6. effective date and freshness;
7. source applicability;
8. evidence completeness;
9. deterministic tie-breaker.

Nominal price is the calculation input, not a trust score and not a warning trigger.

### 8.3 Explanation and comparison

Inside the project AHSP resource row:

- selected price and origin;
- why SIMPROK selected it;
- alternative candidates;
- differences in location, date, source, unit, and coverage;
- action to replace the selection.

### 8.4 Override law

When a user replaces the selected price:

- the replacement is stored inside the project AHSP occurrence;
- the prior automatic selection is retained in history;
- actor, time, reason, old selection, and new selection are audited;
- AHSP unit price is recalculated;
- RAB receives the updated AHSP result;
- master AHSP and global Basic Price records remain unchanged.

---

## 9. Resource Identity Bridge

### 9.1 Repository reality

Current production schema:

- `AHSPResource.resourceId` is a temporary raw `String` without a foreign key.
- `ResourceCatalog.id` is the canonical UUID.
- `BasicPrice.resourceId` is a foreign key to `ResourceCatalog`.
- production Cost Kernel is not implemented.
- current RAB draft uses manually entered `unitPrice`.

### 9.2 First-real-input evidence

`first-real-input-sample.json` does not contain production `AHSPResource.resourceId` or a full `ResourceCatalog` dataset.

It contains:

- AHSP components by `resourceName`;
- Basic Price entries by `code` and `name`;
- preview match outputs.

Some preview matches are clearly unsafe, e.g. Pasir Beton → Panel beton pracetak or Batu Belah → Tukang Batu. Therefore the legacy `matches` list is not a production bridge.

The current preview resolver is a proof of concept that:

- canonicalizes resource name;
- checks resource category;
- canonicalizes unit;
- resolves only when name and unit match;
- otherwise remains `UNRESOLVED`;
- calculates coefficient × price when all components resolve.

### 9.3 Recommended production bridge

**PM ARCHITECTURE RECOMMENDATION**

Do not overwrite raw master AHSP resource evidence.

Create a project-occurrence resolution record, conceptually:

`ProjectAhspResourceResolution`

Core fields:

- projectAhspOccurrenceId / snapshotResourceId;
- rawAhspResourceRef;
- resourceCatalogId;
- resolutionStatus;
- resolutionMethod;
- resolutionConfidence;
- resolvedBySystem;
- confirmed/overriddenByUserId;
- selectedBasicPriceId;
- sourcePriceValue and unit;
- adaptedPriceValue and AHSP unit;
- conversionRuleId/factor/evidence;
- selectionReason;
- comparisonSnapshot;
- createdAt/updatedAt.

Optional future enhancement:

- nullable canonical `resourceCatalogId` on master AHSP resource only when official import/mapping is deterministic;
- never overwrite the raw source reference;
- never backfill old snapshots.

### 9.4 Resolution policy

- Exact identity/code mapping with compatible tenant, type, and unit: may resolve automatically.
- Supported canonical alias with deterministic evidence: may resolve automatically and explain why.
- Multiple candidates or semantic ambiguity: `NEEDS_REVIEW`.
- Domain mismatch: reject the candidate.
- No candidate: `UNRESOLVED`.

Humans are not required to map every resource manually, but they remain the decision-maker for ambiguous cases and may override automatic choices.

---

## 10. Snapshot and Audit Design

Every frozen resource selection must include:

- raw AHSP resource name/reference;
- canonical resource identity;
- coefficient;
- AHSP unit;
- selected Basic Price ID;
- price source/origin;
- source price and raw unit;
- adapted price and AHSP unit;
- conversion factor and evidence;
- freshness at selection time;
- automatic-selection reason;
- alternatives considered;
- selection mode (`AUTO_SELECTED` or `USER_OVERRIDDEN`);
- actor and override reason;
- timestamp and policy version.

Snapshot law:

- immutable after lock;
- old snapshots never backfilled;
- later Basic Price updates do not rewrite historical RAB;
- recalculation requires a new project AHSP snapshot/version.

---

## 11. Cost Kernel Contract

### 11.1 First kernel scope

The first Cost Kernel must:

1. read one project AHSP occurrence;
2. read resolved resource selections;
3. adapt each selected Basic Price into the AHSP unit;
4. calculate each resource cost;
5. sum resource costs into the AHSP unit price;
6. return a fully traceable calculation.

Formula:

`resource cost = coefficient × adapted Basic Price`

`AHSP unit price = Σ resource costs`

`RAB line total = volume × AHSP unit price`

Execution Factor remains a separate occurrence-level policy and is disabled in the first proof unless explicitly selected and allowed.

### 11.2 Fail-closed behavior

No AHSP unit price is finalized when:

- any required resource is unresolved;
- conversion is unsupported;
- candidate identity is ambiguous;
- selected Basic Price is unavailable under policy;
- tenant scope is invalid;
- required context is missing.

SIMPROK must say what is missing; it must not invent a number.

---

## 12. Public Basic Price Information Room

Basic Price is also an announcement/information list for users.

### 12.1 Card hierarchy

1. Origin label: Government / Store-Supplier / Field
2. Resource and specification
3. Price and unit/package
4. Source name
5. Location and coverage
6. Effective/recorded date
7. Freshness note
8. Provenance detail

### 12.2 Freshness language

- `CURRENT`: Terkini
- `EXPIRING`: Perlu diperbarui
- `EXPIRED`: Data lama — pastikan kondisi terkini

Expired data remains visible as historical fact unless withdrawn for integrity reasons.

### 12.3 Prohibited public behavior

- no “too expensive” warning solely from nominal value;
- no “too cheap” warning solely from nominal value;
- no red warning for age alone;
- no hiding origin behind technical workflow status;
- no claim that one published price is universally correct.

---

## 13. Implementation Roadmap

### Phase 0 — Lock this blueprint

No implementation prompt before Owner review and lock.

### Phase 1 — One deterministic resource identity proof

Target one low-risk chain:

- AHSP resource: `Pekerja`
- AHSP unit: `OH`
- Resource Catalog: canonical Pekerja
- Basic Price: Pekerja / `Org/Hari`
- rule: exact canonical labor-day equivalence

Output: one resolved project AHSP resource with explanation.

### Phase 2 — Project AHSP occurrence persistence

Persist resource resolution and selected Basic Price inside the project AHSP occurrence, not the RAB row.

### Phase 3 — Minimal unit dictionary

Implement only exact canonical equivalences needed for the first live proof.

### Phase 4 — Automatic selection and comparison

Select automatically from eligible candidates; expose reason, comparison, and replacement.

### Phase 5 — Snapshot freeze

Freeze resource identity, selected price, source, adapted price, conversion evidence, and override history.

### Phase 6 — First Cost Kernel

Calculate one AHSP unit price from resolved resources.

### Phase 7 — One live RAB line

Use the AHSP unit price in:

`volume × AHSP unit price = line total`

### Phase 8 — Expand sources and conversions

Add material/equipment package conversion, government/store/field ingestion pathways, and broader location/coverage logic.

### Phase 9 — Public Basic Price Room

Deliver the information/announcement experience with origin-first display.

---

## 14. First Golden Thread Acceptance Criteria

The first proof passes only when:

1. A BOQ work item is linked to a valid project AHSP occurrence.
2. At least one AHSP resource is resolved to exactly one ResourceCatalog record.
3. SIMPROK automatically selects an eligible Basic Price.
4. The AHSP unit and price unit are exactly equivalent or deterministically converted.
5. The selection reason is visible.
6. Alternative candidates are visible.
7. The user can replace the selected Basic Price.
8. Override history is retained.
9. The selection and conversion are frozen in a new snapshot.
10. Cost Kernel calculates the AHSP unit price.
11. RAB calculates volume × AHSP unit price.
12. No master AHSP, global Basic Price, or historical snapshot is mutated.

---

## 15. Open Decisions Before Affected Slices

1. Exact internal semantics of `ACCEPT`, `VERIFIED`, and `PUBLISHED`.
2. Global versus workspace ResourceCatalog precedence.
3. Exact production entity names for project AHSP occurrence and resource resolution.
4. Whether authenticated official government/store feeds may publish automatically after technical authenticity checks.
5. Policy for using `EXPIRED` candidates automatically versus requiring confirmation.
6. Whether master AHSP receives an optional canonical ResourceCatalog pointer in a later phase.

These open decisions do not change the locked placement law: selection belongs inside the project AHSP occurrence, while RAB only consumes the result.

---

## 16. Prohibited Implementation Shortcuts

- Do not overwrite raw AHSP resource references with UUIDs.
- Do not store resource-level Basic Price choices directly in RAB rows.
- Do not select by lowest nominal price.
- Do not warn merely because a price is high or low.
- Do not auto-map ambiguous names.
- Do not use unsafe preview `matches` as production truth.
- Do not build a universal unit engine first.
- Do not mutate old snapshots.
- Do not silently fall back to manual `unitPrice` while claiming Golden Thread success.
- Do not let frontend-only calculation become the source of truth.
- Do not weaken tenant isolation or publication eligibility to make a demo pass.

---

## 17. Repository Evidence Baseline

Baseline commit: `e182ed352e3b4decd77c3123ce137e34745bf871`

Key evidence paths:

- `backend/prisma/schema.prisma`
- `backend/src/ahsp/services/ahsp-version.service.ts`
- `backend/src/ahsp/services/ahsp-snapshot.service.ts`
- `backend/src/basic-price/basic-price.service.ts`
- `backend/src/reality-intake/price-submission-review.service.ts`
- `backend/src/project/project.service.ts`
- `backend/src/project/rab-intelligence-proposal.service.ts`
- `frontend/src/pages/RabWorkspacePage.tsx`
- `frontend/src/utils/goldenThread.ts`
- `docs/data-intake/first-real-input-sample.json`

Repository findings used in this blueprint:

- no production AHSP Resource → ResourceCatalog FK;
- BasicPrice is linked to ResourceCatalog;
- no integrated production Cost Kernel;
- RAB draft currently persists manual unit price;
- preview resolver proves canonical-name/unit calculation concept but not production persistence;
- sample preview match list contains unsafe semantic matches and must not be treated as canonical truth.

---

## 18. Owner Lock Statement

When approved, this document becomes the implementation basis for:

1. Basic Price source/status/unit model;
2. AHSP project-occurrence price resolution;
3. automatic selection and human override;
4. immutable snapshot;
5. Cost Kernel;
6. one live RAB line.

No implementation prompt may contradict this blueprint without explicit Owner revision.

**SIMPROK menghitung. Manusia memutuskan.**  
**AHSP adalah otoritas. Basic Price menyesuaikan.**  
**Reduce Uncertainty.**
