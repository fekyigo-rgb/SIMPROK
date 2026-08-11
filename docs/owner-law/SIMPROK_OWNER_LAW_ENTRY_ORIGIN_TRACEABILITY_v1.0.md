# SIMPROK — OWNER LAW: ENTRY PATH, ORIGIN & RAB TRACEABILITY v1.0

**Status:** LOCKED  
**Authority:** Owner Decision  
**Locked:** 2026-08-11  
**Law ID:** `SIMPROK-OWNER-LAW-ENTRY-ORIGIN-TRACEABILITY-v1.0`  
**Scope:** Product / architecture / UI semantics / traceability.  
**Important:** This law does not by itself authorize schema, enum, migration, Cost Kernel, lifecycle, or runtime changes.

---

## 1. North Star

SIMPROK helps users understand project reality, prepare a realistic/appropriate RAB or budget, monitor execution, and support recovery when needed.

**SIMPROK does not require every user or every project to traverse the full lifecycle inside SIMPROK.**

> **SIMPROK does not force real-world projects to follow a SIMPROK sequence. SIMPROK understands the current real-world position, preserves existing truth, and activates only capabilities supported by lawful available truth.**

---

# 2. USAGE-PHASE & ENTRY-PATH LAW — LOCKED

### 2.1 End-to-end use is optional
A user may use one phase, several phases, or the whole cycle.

Examples:
- Estimator / cost consultant: only prepare RAB.
- PPK / Owner: only establish budget/HPS/RAB.
- Contractor/project team: enter when execution is ready or already running.
- Project team: enter during monitoring.
- Troubled project: enter specifically for recovery.

A user is not incomplete merely because later phases are not used.

### 2.2 Project/RAB does not have to be born in SIMPROK
Lawful existing project truth may enter through creation, import, transfer, sharing, invitation, assignment, or intake of an already-running project.

SIMPROK must not force an existing RAB to be recreated merely to satisfy an internal journey.

### 2.3 Skipping workflow is allowed; inventing history is forbidden
If a RAB was produced outside SIMPROK, SIMPROK must not fabricate historical Draft/Lock/Approval events that did not occur in SIMPROK.

If a project enters after execution has begun, SIMPROK must not invent prior monitoring history.

### 2.4 Workflow prerequisite != truth prerequisite
> A user may skip the production workflow of an artifact inside SIMPROK, but a capability may not skip the truth it requires.

Examples:
- Monitoring need not start from a RAB created in SIMPROK, but plan/baseline truth is still required for plan-vs-actual.
- Recovery need not start on day one, but sufficient baseline, actual, evidence, and context are still required.

If required truth is absent, SIMPROK must say unavailable/not yet known. It must not guess or silently convert absence to zero.

### 2.5 `Proyek Saya` is a project registry
`Proyek Saya` is not a list of “RABs I created”. A project may appear because the user created, owns, was assigned to, was invited to, received/shared, imported, transferred, or joined it during execution/monitoring/recovery.

### 2.6 Imported RAB is first-class
A lawful imported RAB is not second-class. It can support later planning, monitoring, reporting, and recovery when the minimum required truth is present.

Its actual origin must remain visible and honest.

### 2.7 Capability may grow as knowledge grows
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

---

# 4. RAB TRACEABILITY & DOOR SEMANTICS LAW — LOCKED

## 4.1 `NO` = official structural position
`NO` is the row's structural number in the RAB hierarchy.

The same row must show the same number in Ruang Kerja RAB, Ruang Hidup RAB, and any other lawful view of the same structure.

Examples: `1`, `1.1`, `1.2`, `2`.

Do not create independent numbering algorithms per screen.

## 4.2 AHSP door = analysis / recipe
An AHSP code such as `R75` answers:

> **What analysis/recipe is used for one unit of this work item?**

AHSP detail may show identity/code, version, output unit, labor/material/equipment, coefficients, and AHSP source/standard/knowledge context.

AHSP is not the same thing as project-specific price trace.

## 4.3 Generic `Detail` must not duplicate the AHSP door
A generic `Detail` button that opens the exact same AHSP drawer as the AHSP code is not a meaningful second door.

Locked semantic target for a WORK ITEM:

> **Rincian Harga**

It answers:

> **Why does this RAB row have this price/amount in this project context?**

## 4.4 `Rincian Harga` = project-specific price trace
Where available it may explain AHSP used, region, calculation/effective date, Basic Price components, Cost Kernel result, relevant Execution Factor when lawfully available, unit price, volume, amount, calculation policy/version, and evidence/persistence.

Current R75 example:
- AHSP R75 explains the analysis for `1 m3 Timbunan dan Pemadatan Sirtu`.
- Rincian Harga explains why this project yields `Rp197.005/m3` and `Rp129.826.295` for quantity `659`.

## 4.5 Imported RAB must not be forced to have AHSP/Cost Kernel truth
If an imported row has no AHSP identity, SIMPROK must not invent one.

Use truthful states such as `Belum terhubung` / `Tidak tersedia dari sumber` (final wording subject to Owner-approved UI copy).

If an imported price has no cost breakdown, Rincian Harga must not fabricate SIMPROK provenance. It may state its origin and that detailed price formation is unavailable from the import source.

## 4.6 `Asal Harga` and `Bukti Harga` are different
`Asal Harga` is a concise origin fact using the locked vocabulary:

- Auto SIMPROK
- Input Pengguna
- Import SIMPROK
- Import Pengguna

A separate evidence surface explains how the number was formed or received.

## 4.7 `provenance` is not primary Owner language
Do not use `Detail provenance` as the primary Owner-facing concept.

Preferred semantics:
- **Lihat Bukti Harga**
- **Jejak Perhitungan Harga**

Technical fields such as occurrence IDs or internal policy identifiers may remain under `Detail Teknis` / `ID Bukti`.

## 4.8 Evidence detail must not break RAB geometry
Opening price evidence/details must not make the RAB appear empty, expand the table uncontrollably, destroy scroll position, or destabilize the document canvas.

Preferred direction: stable drawer / side panel / detail surface outside table geometry.

> **Open detail != mutate document layout.**

## 4.9 WBS Code != AHSP Code until proven
Do not merely rename a `Kode` column to `AHSP` because current Golden Thread displays `R75`.

Before presenting a value as AHSP identity, implementation must prove it comes from canonical AHSP identity rather than an overloaded WBS display field.

No schema redesign/migration is authorized solely for this UI closure without a separate architecture decision.

---

# 5. LOCKED RAB INVARIANTS — PRESERVED

Nothing in this law weakens existing frozen/LOCKED behavior:

- row values remain read-only;
- destructive/write actions remain disabled/non-actionable;
- Save is not offered as a live write action;
- AHSP analysis and lawful evidence remain readable;
- opening details does not alter canonical R75;
- Cost Kernel is not recalculated merely because a read-only detail is opened.

---

# 6. IMPLEMENTATION BOUNDARY

This document is governing Product/Architecture Law. It does **not** automatically authorize:

- schema/enum changes;
- migrations;
- Cost Kernel redesign;
- Basic Price redesign;
- R75 recalculation;
- lifecycle redesign;
- approval/reopen implementation;
- runtime/operations changes.

Every implementation step must begin with repository reality audit, reuse healthy existing artifacts, and close only proven gaps.

---

# 7. ACCEPTANCE EXAMPLES

### Native SIMPROK-calculated row
`1 | R75 | Timbunan dan Pemadatan Sirtu | m3 | 659 | Rp197.005 | Rp129.826.295 | Auto SIMPROK | Terkunci`

- Click `R75` -> AHSP analysis.
- Click `Rincian Harga` -> project-specific price trace.
- `Lihat Bukti Harga` -> consistent evidence/trace, not a competing third truth.

### Imported external row with no AHSP breakdown
- Origin: `Import Pengguna`
- AHSP: `Tidak tersedia dari sumber` / `Belum terhubung`
- Price: preserve imported truth
- Rincian Harga: state what was imported and which supporting breakdown is unavailable

SIMPROK must not claim `Auto SIMPROK` or fabricate AHSP/Cost Kernel evidence.

---

# 8. LOCK STATEMENT

These decisions are **LOCKED Owner Law** until explicitly superseded by a later Owner decision.

All SIMPROK AI agents and human executors must treat this document as a governing constraint, not optional design advice.
