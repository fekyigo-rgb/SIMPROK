# SIMPROK — OWNER LAW: ENTRY PATH, ORIGIN & RAB TRACEABILITY v1.0

**Status:** LOCKED  
**Authority:** Owner Decision  
**Locked:** 2026-08-11  
**Amended:** 2026-08-11 — Adaptive Gravity & Future Compatibility Law  
**Amended:** 2026-08-11 — Grade-A Trust, Single-Truth & Gatekeeper Standard  
**Law ID:** `SIMPROK-OWNER-LAW-ENTRY-ORIGIN-TRACEABILITY-v1.0`  
**Scope:** Product / architecture / UI semantics / traceability / future compatibility / Grade-A quality gate.  
**Important:** This law does not by itself authorize schema, enum, migration, Cost Kernel, lifecycle, monitoring, recovery, import-engine, snapshot-browser, or runtime changes.

---

# 1. NORTH STAR

SIMPROK helps users understand project reality, prepare a realistic/appropriate RAB or budget, monitor execution, and support recovery when needed.

**SIMPROK does not require every user or every project to traverse the full lifecycle inside SIMPROK.**

> **SIMPROK does not force real-world projects to follow a SIMPROK sequence. SIMPROK understands the current real-world position, preserves existing truth, and activates only capabilities supported by lawful available truth.**

SIMPROK must be strong enough to become a gravitational standard, but adaptive enough to receive lawful truth that was created outside SIMPROK.

> **Native SIMPROK is the richest path, not the only lawful path.**

SIMPROK Grade-A is not defined merely by a feature working or a CI job turning green. It is defined by trust:

> **One lawful truth, honestly represented, deterministically derived where applicable, traceable to evidence, auditable, verifiable, precise, reliable, simple to use, rich in intelligence, adaptive at the boundary, and gravitational toward canonical SIMPROK structure.**

---

# 2. USAGE-PHASE & ENTRY-PATH LAW — LOCKED

## 2.1 End-to-end use is optional
A user may use one phase, several phases, or the whole cycle.

Examples:
- Estimator / cost consultant: only prepare RAB.
- PPK / Owner: only establish budget/HPS/RAB.
- Contractor/project team: enter when execution is ready or already running.
- Project team: enter during monitoring.
- Troubled project: enter specifically for recovery.

A user is not incomplete merely because later phases are not used.

## 2.2 Project/RAB does not have to be born in SIMPROK
Lawful existing project truth may enter through creation, import, transfer, sharing, invitation, assignment, or intake of an already-running project.

SIMPROK must not force an existing RAB to be recreated merely to satisfy an internal journey.

## 2.3 Skipping workflow is allowed; inventing history is forbidden
If a RAB was produced outside SIMPROK, SIMPROK must not fabricate historical Draft/Lock/Approval events that did not occur in SIMPROK.

If a project enters after execution has begun, SIMPROK must not invent prior monitoring history.

## 2.4 Workflow prerequisite != truth prerequisite
> A user may skip the production workflow of an artifact inside SIMPROK, but a capability may not skip the truth it requires.

Examples:
- Monitoring need not start from a RAB created in SIMPROK, but plan/baseline truth is still required for plan-vs-actual.
- Recovery need not start on day one, but sufficient baseline, actual, evidence, and context are still required.

If required truth is absent, SIMPROK must say unavailable/not yet known. It must not guess or silently convert absence to zero.

## 2.5 `Proyek Saya` is a project registry
`Proyek Saya` is not a list of “RABs I created”. A project may appear because the user created, owns, was assigned to, was invited to, received/shared, imported, transferred, or joined it during execution/monitoring/recovery.

## 2.6 Imported RAB is first-class
A lawful imported RAB is not second-class. It can support later planning, monitoring, reporting, and recovery when the minimum required truth is present.

Its actual origin must remain visible and honest.

## 2.7 Capability may grow as knowledge grows
An imported RAB may begin with only description, unit, volume, unit price, and amount. It may later be enriched with AHSP, Basic Price, region/date, Cost Kernel re-proof, and supporting evidence.

Enrichment must not erase original truth or falsify history.

---

# 3. SOURCE / ORIGIN LAW — LOCKED

There are exactly **two top-level origin categories** for user-facing semantics.

## 3.1 Category A — Dari Akun Pengguna
Truth is created or established inside the current user's SIMPROK working context.

- **Auto SIMPROK** — produced automatically by SIMPROK from lawful available truth.
- **Input Pengguna** — directly entered or established by a human user inside SIMPROK.

## 3.2 Category B — Import
Truth enters the current context from outside it.

- **Import SIMPROK** — imported from another lawful SIMPROK account/workspace/project or a verifiable SIMPROK export/package.
- **Import Pengguna** — imported from outside SIMPROK, or SIMPROK cannot truthfully claim it as SIMPROK-produced (Excel, consultant RAB, contractor BOQ/RAB, owner/PPK document, other software, external manual calculation).

## 3.3 Locked user-facing origin vocabulary
1. **Auto SIMPROK**
2. **Input Pengguna**
3. **Import SIMPROK**
4. **Import Pengguna**

No new user-facing origin category is introduced without a new Owner decision.

## 3.4 Origin != verification status
Origin says where/how truth entered the current context. It does not by itself mean verified, approved, trusted, publishable, current, or authoritative.

Examples:
- Auto SIMPROK may still require review.
- Input Pengguna is not automatically wrong.
- Import SIMPROK is not automatically authoritative.
- Import Pengguna is not automatically low-quality; it simply must not be represented as SIMPROK-generated.

## 3.5 Preserve origin history
If original truth is `Import Pengguna` and SIMPROK later performs a re-proof/new calculation, the new derived result may be `Auto SIMPROK`.

The original imported truth must not be silently rewritten to pretend it was originally generated by SIMPROK.

## 3.6 Entry origin != calculation origin
A future imported row may have an imported historical origin and later receive a SIMPROK-derived calculation/re-proof.

These are distinct truths. A calculation-origin field must not silently become the universal historical-entry-origin model.

---

# 4. RAB TRACEABILITY & DOOR SEMANTICS LAW — LOCKED

## 4.1 `NO`, `KODE`, and `AHSP` are three different truths

### `NO`
`NO` is the row's official structural position in the RAB hierarchy.

The same row must show the same structural number in Ruang Kerja RAB, Ruang Hidup RAB, and any other lawful view of the same structure.

Examples: `1`, `1.1`, `1.2`, `2`.

Do not create independent numbering algorithms per screen.

### `KODE`
`KODE` is the lawful row/source/WBS code carried by the RAB row.

Current Golden Thread example: `R75`.

`KODE` may originate in SIMPROK or an external/imported RAB. It is not automatically an AHSP identity and must not become database identity merely because it is human-readable.

### `AHSP`
`AHSP` is the actual linked analysis identity that repository/domain truth can prove.

Current Golden Thread identity is represented by the linked analysis facts (for example `Pemadatan secara Manual · v4`), not by pretending the row code `R75` is an AHSP code when the domain has no such canonical code field.

> **Preserve source truth; separate canonical linkage.**

## 4.2 AHSP door = analysis / recipe
The AHSP door answers:

> **What analysis/recipe is used for one unit of this work item?**

AHSP detail may show lawful identity, work/method context, version, output unit, labor/material/equipment, coefficients, snapshot/reference truth, and AHSP source/standard/knowledge context.

AHSP is not the same thing as project-specific price trace.

If AHSP truth is absent, SIMPROK must say so honestly. It must not derive AHSP identity from `KODE` merely because the current row code looks familiar.

## 4.3 Generic `Detail` must not duplicate the AHSP door
A generic `Detail` button that opens the exact same semantic room as the AHSP door is not a meaningful second door.

Locked semantic target for a WORK ITEM:

> **Rincian Harga**

It answers:

> **Why does this RAB row have this price/amount in this project context?**

## 4.4 `Rincian Harga` = project-specific authoritative price trace
Where available it may explain:
- stored unit price and line amount;
- volume/unit;
- AHSP used;
- region;
- calculation/effective date;
- Basic Price components;
- resource coefficients/costs;
- Cost Kernel result and reproduction/integrity evidence;
- relevant Execution Factor when lawfully available;
- calculation/resolution policy/version;
- occurrence/evidence identity under technical detail.

The price-trace UI must derive from the **authoritative persisted calculation/evidence truth already owned by SIMPROK**, not from an independent competing summary that can drift.

> **One business fact must have one authority. Multiple views may exist; competing truths may not.**

## 4.5 Read-only evidence retrieval is lawful
Opening evidence must not mutate business state, persist, or trigger a state-changing recalculation.

However, a lawful authenticated **read-only GET** to retrieve authoritative persisted evidence is allowed and expected when that is the source of truth.

`Read-only` does not mean `no server read`.

## 4.6 Imported RAB must not be forced to have AHSP/Cost Kernel truth
If an imported row has no AHSP identity, SIMPROK must not invent one.

Use truthful states such as `Belum terhubung` / `Tidak tersedia dari sumber` (final wording subject to Owner-approved UI copy).

If an imported price has no cost breakdown, Rincian Harga must not fabricate SIMPROK provenance. It may state its origin and that detailed price formation is unavailable from the import source.

## 4.7 `Asal Harga` is both concise fact and evidence door when evidence exists
`Asal Harga` uses the locked vocabulary:
- Auto SIMPROK
- Input Pengguna
- Import SIMPROK
- Import Pengguna

When lawful evidence exists, the visible origin badge/label itself may be the door to the evidence surface.

A separate repetitive `Lihat Bukti Harga` text is not required when the origin badge already functions as the clear evidence door.

For current native Cost Kernel truth:

> **Auto SIMPROK** → open **Jejak Perhitungan Harga**.

## 4.8 `provenance` is not primary Owner language
Do not use `Detail provenance` as the primary Owner-facing concept.

Preferred primary semantics:
- **Rincian Harga**
- **Jejak Perhitungan Harga**

Technical fields such as occurrence IDs or internal policy identifiers may remain under `Detail Teknis` / `ID Bukti`.

## 4.9 Evidence detail must not break RAB geometry
Opening price evidence/details must not make the RAB appear empty, expand the table uncontrollably, destroy scroll position, or destabilize the document canvas.

Preferred direction: a stable right-side slot, drawer, or detail surface outside table geometry.

> **Open detail != mutate document layout.**

## 4.10 WBS/KODE != AHSP identity until proven
Do not rename or reinterpret a row/source/WBS code as AHSP identity merely because current Golden Thread historically displayed `R75` in an AHSP-like position.

Before presenting a value as AHSP identity, implementation must prove it comes from canonical/live/snapshot AHSP truth.

No schema redesign/migration is authorized solely to manufacture an AHSP short code for UI convenience without a separate architecture decision.

## 4.11 Draft, baseline, and snapshot must resolve AHSP through one authority
The same lawful RAB row must not show one AHSP identity in draft and lose/change it when viewed from baseline or historical snapshot.

AHSP identity projection/read logic must reuse one authority across relevant RAB read paths.

A lawful frozen AHSP snapshot is historical truth and must not be mislabeled `Belum terhubung` merely because its live version is not the current authority.

---

# 5. LOCKED RAB INVARIANTS — PRESERVED

Nothing in this law weakens existing frozen/LOCKED behavior:

- row values remain read-only;
- destructive/write actions remain disabled/non-actionable;
- Save is not offered as a live write action;
- AHSP analysis and lawful evidence remain readable;
- opening details does not alter canonical business truth;
- Cost Kernel is not state-changing recalculated merely because a read-only detail is opened;
- Rincian Harga must not expose AHSP selection/persist/write controls in LOCKED read mode.

---

# 6. IMPLEMENTATION BOUNDARY

This document is governing Product/Architecture Law. It does **not** automatically authorize:

- schema/enum changes;
- migrations;
- Cost Kernel redesign;
- Basic Price redesign;
- lifecycle redesign;
- approval/reopen implementation;
- import-engine implementation;
- monitoring implementation;
- recovery implementation;
- full AHSP Snapshot browser implementation;
- full Basic Price Snapshot browser implementation;
- runtime/operations changes.

Every implementation step must begin with repository reality audit, reuse healthy existing artifacts, and close only proven gaps.

The required engineering order is:

> **Reuse healthy → extend healthy → repair proven gap → replace only when preserving the existing mechanism would preserve a proven defect or competing truth.**

Do not rebuild healthy work merely because a different implementation can be imagined.

---

# 7. ACCEPTANCE EXAMPLES

## 7.1 Native SIMPROK-calculated row
Conceptual row:

`1 | R75 | Pemadatan Manual · v4 | Timbunan dan Pemadatan Sirtu | m3 | 659 | Rp197.005 | Rp129.826.295 | Auto SIMPROK | Terkunci`

Interpretation:
- `1` = NO / structural position.
- `R75` = KODE / row-WBS truth.
- `Pemadatan Manual · v4` = linked AHSP identity presentation.
- Click AHSP identity -> AHSP analysis.
- Click `Rincian Harga` -> authoritative project-specific price trace.
- Click `Auto SIMPROK` where evidence is available -> the same authoritative Jejak Perhitungan Harga, not a competing third truth.

## 7.2 Imported external row with no AHSP breakdown
Example future truth:
- Source/work code: `A.03` or another lawful external code.
- Origin: `Import Pengguna`.
- AHSP: `Tidak tersedia dari sumber` / `Belum terhubung`.
- Price: preserve imported truth.
- Rincian Harga: state what was imported and which supporting breakdown is unavailable.

SIMPROK must not claim `Auto SIMPROK` or fabricate AHSP/Cost Kernel evidence.

---

# 8. ADAPTIVE GRAVITY & FUTURE COMPATIBILITY LAW — LOCKED

This section governs how current construction must remain compatible with SIMPROK's long-term role as both an adaptive intake platform and a gravitational construction-intelligence standard.

## 8.1 Canonical core, adaptive boundary
SIMPROK must have a strong canonical internal core and an adaptive boundary for lawful external truth.

> **Adaptation happens at the entry boundary; canonical discipline happens inside the house.**

External diversity must be absorbed through intake, mapping, adapters, normalization, linkage, and provenance — not by making the canonical core itself ambiguous or unstructured.

Conversely, the boundary must not be so narrow that SIMPROK rejects lawful RAB/project truth merely because it did not originate in SIMPROK.

## 8.2 Native-first experience, import-capable architecture
The product experience may deliberately make native SIMPROK creation the richest and most seamless path.

However, architecture must remain capable of accepting lawful imported/existing truth without future foundation teardown.

> **Native-first experience does not authorize native-only architecture.**

Current implementation slices do not have to build Import, Monitoring, or Recovery now; they must simply avoid hard-coding assumptions that would make those future capabilities require destructive redesign.

## 8.3 Source identity and canonical identity must be distinguishable
External identifiers may differ from SIMPROK canonical identifiers.

Examples include:
- source row number;
- source WBS/work code;
- source AHSP/code system;
- source description;
- source unit vocabulary;
- source price/breakdown structure.

SIMPROK must preserve lawful source identity while separately establishing canonical linkage when available.

Example:
- source work code: `A.03`;
- later canonical AHSP linkage: a separately represented linked analysis identity.

Mapping/linkage must not erase or rewrite the original source identity.

## 8.4 Display numbering must not become database identity
External RABs may use numbering such as `1`, `1.1`, `A`, `A.1`, `DIV-03`, or another lawful convention.

The imported/source number may be preserved as source truth, but SIMPROK's stable internal identity and hierarchy must not depend on a fragile human display number.

Internal structural truth should remain based on stable identity plus lawful hierarchy/order semantics, while presentation may expose source and/or SIMPROK numbering according to product law.

A numbering difference must not make a lawful imported RAB impossible to house.

## 8.5 AHSP linkage is enrichable truth, not a universal admission requirement
Native SIMPROK RAB may naturally carry a complete Golden Thread:

`BOQ -> AHSP -> Resource -> Basic Price -> Cost Kernel -> RAB`.

An imported RAB may lawfully arrive with only:

`item -> quantity -> unit price -> amount`.

The absence of an AHSP link must be representable honestly; it must not require fabricated AHSP or rejection of the whole RAB.

SIMPROK may later propose/map/link that row to canonical AHSP knowledge through lawful verification.

The resulting enrichment must be additive and traceable, not a rewrite of what originally entered the system.

## 8.6 Low-information truth may enter; high-information truth is the gravitational destination
SIMPROK may accept lawful low-information project truth and progressively enrich it.

A typical progression may be:

`Imported row -> normalized structure -> AHSP candidate -> verified AHSP link -> Basic Price linkage -> SIMPROK re-proof -> richer intelligence`.

This is a direction of increasing intelligence, not a requirement that every imported row complete every enrichment step.

SIMPROK's gravity should come from the usefulness and trust gained by canonical linkage, deterministic calculation, provenance, verification, monitoring continuity, and recovery intelligence — not from coercively rewriting external truth.

## 8.7 Historical truth is immutable in meaning under enrichment
Enrichment, mapping, re-proof, or a new Auto SIMPROK result must not silently overwrite the historical meaning of the imported/original value.

Examples:
- an `Import Pengguna` contract price remains historically an imported contract price;
- a later Auto SIMPROK re-proof is a new derived truth/evidence;
- a canonical AHSP mapping does not pretend the imported source originally used that AHSP unless the source proves it.

> **Enrichment may add intelligence; it may not falsify history.**

## 8.8 Imported RAB must be able to connect to Monitoring baseline
Monitoring must not require that its baseline/RAB was originally created by SIMPROK.

A lawful imported/existing RAB may become planned/baseline truth when the required governance and minimum facts are satisfied.

Monitoring may then compare lawful baseline/plan against actual/project reality even when some cost-intelligence enrichment (AHSP, Basic Price, Cost Kernel proof) is unavailable.

Missing enrichment must reduce available intelligence honestly; it must not automatically invalidate the baseline.

## 8.9 Enrichment must not mutate historical baseline silently
If an imported or established RAB becomes contractual/planned/baseline truth, later AHSP linkage or Cost Kernel re-proof must not silently change that historical baseline.

New calculations, forecasts, recommendations, or recovery simulations are separate derived truths unless a lawful change-control/governance action explicitly establishes a new baseline/revision.

This preserves continuity for Monitoring, Reporting, Revision/Addendum, and Recovery.

## 8.10 Recovery may start from imperfect existing truth
A project may enter SIMPROK after execution has begun or after trouble has occurred.

Recovery capability must be able to work from the lawful baseline, actuals, schedule/evidence, and contextual truth available at intake, while marking unavailable facts honestly.

SIMPROK must never reject a recoverable real-world project merely because it did not originate from a native SIMPROK workflow.

## 8.11 Gravity means convergence by value, not forced conformity
SIMPROK should progressively become the preferred place where projects originate because native use provides richer continuity and intelligence from the beginning.

Expected long-term gravity includes:
- canonical vocabulary;
- stable identities;
- shared/normalized units;
- AHSP knowledge linkage;
- Basic Price identity and verification;
- deterministic Cost Kernel calculation;
- traceability/provenance;
- governed lifecycle;
- Monitoring continuity;
- Recovery intelligence.

But this gravity is achieved by making canonical SIMPROK truth more useful, traceable, and interoperable — not by refusing lawful external truth.

## 8.12 Future-compatibility gate for every current build
Every current implementation must be reviewed not only for the current native Golden Thread, but also for whether it preserves the future path for imported/existing truth.

PM/Gatekeeper and Architecture review must ask, where relevant:

1. Does this design assume every RAB was created in SIMPROK?
2. Does it incorrectly make AHSP mandatory where imported truth may not have one?
3. Does it bind internal identity to source/display numbering or codes?
4. Can source identity be preserved separately from canonical linkage?
5. Can missing provenance/breakdown be represented honestly without fabricating it?
6. Can a lawful imported RAB later become/attach to Monitoring baseline truth?
7. Can later enrichment occur without rewriting historical baseline/origin?
8. Does this design keep Recovery possible for projects that enter mid-execution?
9. Are we accidentally hard-coding the current Golden Thread as a universal domain law?
10. Would this decision predictably require destructive schema/foundation teardown when Import/Monitoring/Recovery arrive?

If a current design closes a necessary future path without a constitutional reason, it must be corrected before becoming foundation.

## 8.13 Future compatibility does not mean premature feature construction
This law does **not** require every current slice to implement Import, Monitoring, Recovery, every origin type, every external AHSP format, or every numbering convention.

The requirement is architectural:

> **Build today's bounded capability so tomorrow's lawful capability can attach without destroying today's foundation.**

Do not broaden a current task merely because future compatibility is considered. Preserve extension points and honest domain distinctions; implement future capabilities when their roadmap slice arrives.

## 8.14 Locked strategic formulation
The governing product/architecture posture is:

> **Native-first experience. Import-capable architecture. Canonical core. Adaptive boundary. Progressive enrichment. Historical truth preserved. Monitoring-compatible. Recovery-compatible.**

And the governing balance is:

> **SIMPROK accepts real-world diversity at the boundary, then becomes gravity toward clearer canonical structure and richer intelligence inside — without erasing where the truth came from.**

---

# 9. GRADE-A TRUST, SINGLE-TRUTH & GATEKEEPER STANDARD — LOCKED

This section defines the minimum quality posture required before a SIMPROK capability is accepted as Grade-A foundation.

## 9.1 Working is necessary, but not sufficient
A feature is not Grade-A merely because:
- it renders correctly;
- its tests pass;
- its build succeeds;
- CI is green;
- it works for the current Golden Thread example.

Those are required evidence, not the full definition of correctness.

PM/Gatekeeper must also verify that the implementation locks the **right law**, uses the **right authority**, preserves historical truth, and does not create predictable future teardown.

## 9.2 One business fact = one authority
For every important business fact, SIMPROK must have one lawful authority.

Multiple screens, projections, summaries, or read surfaces may present that truth, but they must derive from the same authority.

Do not allow:
- two independent price-trace truths;
- separate numbering laws per screen;
- UI-local lifecycle truth competing with server lifecycle truth;
- a thin convenience projection becoming a second business authority;
- duplicated algorithms that can drift.

> **Many views are allowed. Competing truths are forbidden.**

## 9.3 Honesty and fail-closed behavior
When required truth is missing, malformed, stale, contradictory, inaccessible, or not yet proven, SIMPROK must say so honestly.

It must not:
- guess;
- silently default missing business truth to zero;
- invent provenance;
- invent AHSP linkage;
- invent import origin;
- fabricate lifecycle;
- hide a mismatch behind a plausible number.

Where safety, money, authority, tenant scope, lifecycle, or historical meaning is at stake, uncertainty must fail closed.

## 9.4 Verifiable and auditable by design
Important outputs must be traceable back to lawful supporting truth where that truth exists.

For calculated/project-critical facts, the system should preserve or expose enough evidence to answer, as applicable:
- what source was used;
- which version/policy was used;
- which region/date/effective date applied;
- which AHSP/resource/Basic Price contributed;
- who/what produced or approved the fact;
- when it was produced;
- whether a persisted result can be reproduced or independently checked.

Auditability is not an afterthought or a debug-only feature. It is part of product trust.

## 9.5 Precision and determinism
Money, quantities, units, dates, identities, lifecycle, ordering, and tenant scope must use authoritative deterministic rules.

Presentation convenience must not alter business precision.

Examples:
- persisted monetary strings must not be casually recomputed from rounded display values;
- source/display numbers must not become database identity;
- timestamps/dates must preserve their intended domain meaning;
- unit conversion/normalization must use explicit law, not ad-hoc UI assumptions.

## 9.6 Automation under human authority
SIMPROK should automate every routine operation that can be performed lawfully, deterministically, and safely.

But automation must preserve the governing principle:

> **SIMPROK menghitung, manusia memutuskan.**

SIMPROK may calculate, validate, detect, compare, recommend, map, trace, warn, prepare, and explain.

Human authority remains required where governance, approval, override, contractual establishment, publication, baseline change, or other human decision law requires it.

## 9.7 Simple outside, rich inside
The Owner/user experience should remain simple, clear, lightweight, and professional.

Users should not need to understand UUIDs, occurrence IDs, resolution policies, database vocabulary, or engine internals merely to read and use a RAB.

The system may be deeply sophisticated internally when that sophistication creates:
- stronger truth;
- safer automation;
- better traceability;
- higher reliability;
- easier human decisions.

Complexity is acceptable when it serves lawful simplicity. Accidental complexity and duplicated truth are not.

> **Simple outside. Rich inside.**

## 9.8 Smart means connected intelligence, not just automatic calculation
SIMPROK intelligence should understand lawful relationships across the construction truth chain, including where available:

`Project Reality -> BOQ/RAB -> AHSP -> Resource -> Basic Price -> Cost Kernel -> Baseline -> Actual -> Monitoring -> Forecast -> Recovery`.

A smart system must distinguish facts, derived facts, assumptions, recommendations, forecasts, simulations, and decisions rather than blending them into one opaque output.

## 9.9 Reliability and resilience
Grade-A capabilities must remain trustworthy across reloads, read paths, lifecycle states, lawful baseline/history, and partial/missing data.

A capability should not work only because the current acceptance project happens to have:
- no baseline;
- one row;
- one AHSP;
- one region;
- complete provenance.

Where relevant, tests and review must include the lawful alternate states that can expose a hidden coupling.

## 9.10 Adaptive boundary + gravitational core
Adaptivity does not authorize canonical ambiguity.

Gravity does not authorize rejecting lawful external truth.

SIMPROK must:
1. accept lawful diversity at intake;
2. preserve source truth;
3. normalize/map/link without falsifying history;
4. progressively increase intelligence;
5. make canonical SIMPROK truth valuable enough that users naturally converge toward it.

## 9.11 CI green does not overrule a wrong law
Tests prove what they test.

A green test suite cannot convert an incorrect requirement into a correct one.

If a test locks the wrong behavior, PM/Gatekeeper must correct the test and implementation rather than accepting the green result.

Example principle:
- a read-only evidence surface must forbid business mutation;
- it must not incorrectly forbid a lawful authoritative GET merely because an earlier test equated `read-only` with `no fetch`.

> **Reality and governing law outrank test wording.**

## 9.12 Browser reality does not overrule domain truth — and domain claims do not overrule browser reality
Both layers matter.

- Repository/domain truth decides what a fact actually is.
- Owner browser reality decides whether the product communicates and behaves according to that truth.

If source code claims two modes are different but the Owner experiences them as the same semantic room, the product is not yet closed.

If a browser label suggests `R75` is AHSP but the domain proves it is a WBS/KODE, the label must be corrected rather than preserving a familiar falsehood.

## 9.13 Reuse before rebuild; no patchwork
Every slice must begin with reality audit and seek the existing healthy authority.

Required order:

> **Reuse → Extend → Repair → Replace only when proven necessary.**

Do not create:
- parallel helpers that own the same business rule;
- a new thin truth when a richer authority already exists;
- one-screen hacks that force later consolidation;
- cosmetic rewrites of healthy foundation.

A bounded multi-file shared fix is preferable to a one-file patch that creates duplicated truth.

## 9.14 STOP only for material blockers
Grade-A discipline must not become paralysis.

Executors should continue through ordinary engineering uncertainty and stop only for material blockers such as:
- conflict with LOCKED law;
- unapproved material domain/schema redesign being the only lawful solution;
- credible canonical-data/security/tenant risk;
- missing required truth where continuation would require fabrication;
- repository reality materially changing the task.

Minor naming differences, helper location, small read-projection extensions, test-anchor changes, or multiple lawful engineering choices are not reasons for repeated STOPs.

## 9.15 Gatekeeper merge standard
Before granting technical PASS for a foundation-level slice, PM/Gatekeeper should establish, proportionate to the scope:

1. **Reality:** exact branch/head and repository state are known.
2. **Truth:** business concepts have one lawful authority.
3. **Honesty:** missing/contradictory facts fail honestly.
4. **Precision:** important numeric/identity/time/unit semantics remain exact.
5. **Traceability:** important outputs can be traced to evidence where available.
6. **Security/scope:** tenant/project/permission boundaries remain intact.
7. **History:** enrichment does not silently rewrite historical truth.
8. **Reuse:** healthy existing authorities were reused rather than duplicated.
9. **Future compatibility:** current work does not predictably require teardown for lawful Import/Monitoring/Recovery evolution.
10. **Tests:** tests prove the correct behavior and are non-vacuous.
11. **CI/build:** required gates are green on the exact reviewed head.
12. **Product reality:** Owner-visible behavior matches the intended semantics.
13. **Scope:** unrelated debt was not pulled into the slice.
14. **No hidden mutation:** read-only surfaces do not perform business writes.

A capability may be held for a material truth/authority defect even when all tests are green.

A capability should not be held merely for unrelated cosmetic perfection when its locked scope is already truthful, coherent, safe, and complete.

## 9.16 Locked Grade-A formulation
The governing Grade-A formula is:

> **ONE TRUTH + PROVENANCE + DETERMINISM + HONESTY + AUDITABILITY + AUTOMATION + HUMAN AUTHORITY + SIMPLE UX + DEEP INTELLIGENCE + ADAPTIVE BOUNDARY + CANONICAL GRAVITY + FUTURE COMPATIBILITY = TRUST.**

And the operating principle is:

> **Super teliti tanpa menjadi lamban. Super kokoh tanpa menjadi kaku. Super kaya tanpa menjadi berat. Adaptif tanpa kehilangan bentuk. Gravitasi tanpa memaksa dunia luar berbohong.**

---

# 10. LOCK STATEMENT

These decisions are **LOCKED Owner Law** until explicitly superseded by a later Owner decision.

All SIMPROK AI agents and human executors must treat this document as a governing constraint, not optional design advice.

The Adaptive Gravity amendment is a future-compatibility gate, not permission to expand current implementation scope beyond the active roadmap slice.

The Grade-A Trust amendment is a quality/authority gate, not permission to pursue endless perfection or repeatedly stop for minor issues.

> **Build bounded. Reuse what is healthy. Preserve one truth. Fix only proven material gaps. Verify deeply. Move forward.**