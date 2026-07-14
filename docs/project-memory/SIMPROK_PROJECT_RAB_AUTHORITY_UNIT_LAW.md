# SIMPROK — PROJECT, RAB, AUTHORITY & UNIT LAW

**Owner:** Feky de Fretes  
**Date:** 14 Juli 2026  
**Version:** v1.0 — normalized canonical law  
**Status:** `OWNER LOCKED — CANONICAL`  
**Source:** Owner document “DESAIN 6. Pintu dan Kewenangan RAB”, normalized against current Project Memory, Basic Price–AHSP Blueprint, and binding implementation gates.

This document is the canonical repository form of the Owner’s locked direction for project identity, workspace authority, RAB doors, AHSP/Basic Price placement, and unit conversion.

When an older conversation, draft, or attachment differs from this document, this document controls unless a later Owner-locked record explicitly supersedes it.

---

## 1. Retrieval and precedence law

For work involving projects, RAB, permissions, AHSP, Basic Price, unit conversion, Cost Kernel, or Golden Thread, read in this order:

1. `docs/project-memory/SIMPROK_PROJECT_MEMORY.md`
2. this document
3. `docs/project-memory/SIMPROK_BASIC_PRICE_AHSP_IMPLEMENTATION_BLUEPRINT_OWNER_LOCK.md`
4. `docs/project-memory/SIMPROK_BASIC_PRICE_AHSP_IMPLEMENTATION_BLUEPRINT.md`
5. applicable binding implementation-gate documents
6. current repository and runtime evidence

Later binding Owner/PM gate decisions may refine implementation order or a bounded technical contract, but must not silently overturn the domain laws in this document.

---

# A. PROJECT, WORKSPACE, AND AUTHORITY LAW

## A.1 Identity and workspace

- `Account` is the login identity of a person.
- `Workspace` is an organizational or personal working space.
- `WorkspaceMembership` connects an Account to a Workspace.
- Workspace Role and Permission define general authority inside that Workspace.
- `ProjectAssignment` defines which specific project the person may access.
- `roleInProject` defines the person’s operational function on that project.

The effective right to act on a project is not proven by Workspace membership alone.

For a project-scoped action, SIMPROK must evaluate the correct combination of:

```text
Account
+ active WorkspaceMembership
+ permission in the project’s real Workspace
+ active ProjectAssignment
+ project-specific role/authority when required
```

## A.2 Example — PT. DirkJO

- Feky owns his own Account and is Director/Owner in the PT. DirkJO Workspace.
- Feky may create an organizational project when he has `PROJECT_CREATE`.
- To act on a specific project, Feky still has a `ProjectAssignment`; project creation may create this assignment automatically.
- Agus has his own Account and may be invited into PT. DirkJO as a limited member.
- Agus may receive a ProjectAssignment only for Project Gedung A as Mandor.
- Agus may see and act only on Gedung A according to his permission, role, and duties.
- The project remains owned by PT. DirkJO, not by Agus.

## A.3 Personal workspace

The same person may simultaneously have:

- a limited Mandor role in the PT. DirkJO Workspace; and
- an Owner role in his personal Workspace.

A person may create a personal project or RAB in the personal Workspace because the person has the proper Owner role and permissions there—not because of a Mandor role held in another Workspace.

## A.4 Project Governance center

The canonical product direction is:

```text
Proyek Saya
→ Lihat Detail
→ Pihak Terlibat & Kewenangan
```

This is the future Project Governance center for:

- organizations and project parties;
- personnel;
- ProjectAssignment;
- roleInProject;
- duties and responsibilities;
- project-specific authority;
- authority/approval matrix;
- validity, revocation, and audit trail.

General Workspace creation and membership remain managed in the Workspace/Organization area.

---

# B. DOOR AND PERMISSION LAW

## B.1 Create Project is not Create RAB

The intended permission meanings are distinct:

```text
PROJECT_CREATE   = create a new project container
RAB_VIEW         = view RAB on an assigned project
RAB_DRAFT_EDIT   = create or edit Draft RAB
RAB_LOCK         = lock RAB
RAB_APPROVE      = approve RAB
```

The product doors should also be distinct:

```text
Buat Proyek Baru
Proyek Saya

Inside a project:
Mulai Susun RAB
Lanjutkan Draft RAB
Lihat RAB
```

A broad permission must not permanently stand in for a more precise write permission.

## B.2 Current permission debt

Repository reality currently contains borrowed permissions, including `PROJECT_CREATE` for saving a BOQ/RAB draft. The project AHSP occurrence write permission is also not yet final.

Canonical debt:

```text
DEBT-PERMISSION-01
```

It includes the need for Owner decisions on:

- `RAB_DRAFT_EDIT`;
- project AHSP occurrence write authority;
- related lock/approval permissions before general user exposure.

This debt must be resolved in a dedicated permission-catalog slice. Do not invent new permission codes inside an unrelated implementation slice.

## B.3 No implicit access

For a project-scoped action, the project Workspace resolved from repository/database truth is authoritative.

A permission held in Workspace B must never authorize an operation on a project in Workspace A.

Client-supplied Workspace context cannot override the project’s real Workspace.

---

# C. AHSP, BASIC PRICE, AND RAB PLACEMENT LAW

## C.1 AHSP is the authority

Master AHSP remains authoritative for:

- resource identity/evidence;
- resource type;
- coefficient;
- AHSP resource unit;
- AHSP output unit when available.

Project context must not overwrite master AHSP evidence.

## C.2 Basic Price selection lives inside project AHSP occurrence

SIMPROK automatically resolves and selects Basic Price in the project AHSP occurrence.

The user may later:

```text
Lihat alasan pemilihan
Lihat harga pembanding
Ganti harga
```

The selected Basic Price, conversion evidence, reason codes, and override history belong to the project AHSP occurrence/snapshot—not to a RAB row and not to master AHSP.

## C.3 RAB consumes AHSP result

RAB must consume the resulting AHSP unit price.

RAB must not independently repeat resource resolution, Basic Price selection, or unit conversion.

Canonical direction:

```text
AHSP resource
→ canonical resource and eligible Basic Price
→ deterministic unit adaptation
→ resource cost
→ AHSP unit price
→ BOQ/RAB
```

Until the required bridges, unit gates, and calculation kernel exist, no stage may claim that the Golden Thread or automatic RAB calculation is live.

---

# D. SIMPROK UNIT DICTIONARY LAW

## D.1 Purpose

The SIMPROK unit dictionary connects:

```text
Supplier Commercial Unit
→ Canonical Resource Unit
→ AHSP Resource Unit
→ AHSP Output Unit
→ BOQ/RAB Unit
```

## D.2 Five unit roles

1. **Supplier Commercial Unit** — examples: SAK, ROLL, DUS, BATANG, TRUCK.
2. **Canonical Resource Unit** — examples: KG, M1, L, BH.
3. **AHSP Resource Unit** — examples: KG, OH, JAM, M3.
4. **AHSP Output Unit** — examples: M1, M2, M3, BH, LS.
5. **BOQ Unit** — must be compatible with the AHSP Output Unit.

## D.3 Compound units must be structural

Do not store a compound fact such as `6.5 KG/M2` only as a free string.

Store the meaning structurally:

```text
coefficient = 6.5
resourceUnit = KG
outputUnit = M2
```

## D.4 AHSP output gate is mandatory

`AHSPVersion.outputUnit` is a required gate before end-to-end BOQ/RAB multiplication.

SIMPROK must not calculate:

```text
BOQ Volume × AHSP Unit Price
```

until:

```text
BoqItem.unit is compatible with AHSPVersion.outputUnit
```

If incompatible:

```text
NEEDS_REVIEW
```

No silent calculation or unit assumption is allowed.

## D.5 Conversion types

Canonical conversion categories:

```text
EXACT_GLOBAL
PACKAGE_CONTENT
RESOURCE_SPECIFIC
DENSITY_REQUIRED
CONTEXTUAL_TIME
NOT_CONVERTIBLE
```

Canonical factor convention:

```text
targetQuantity = sourceQuantity × factor
```

## D.6 Existing conversionFactor audit

Current schema contains `AHSPResource.conversionFactor` and snapshot-equivalent evidence.

Before adding `UnitConversionRule`, a read-only audit is mandatory for:

- every writer and reader of `conversionFactor`;
- its current business meaning;
- whether it is active in runtime;
- whether it is only inherited or unused data.

Law:

```text
There must not be two canonical homes for the same conversion factor.
```

If `conversionFactor` and `UnitConversionRule` would coexist as independent sources of truth:

```text
STOP_ARCHITECTURE_CONFLICT
```

Migration, preservation, or deprecation must be explicit and auditable.

## D.7 No false conversion

Return `NEEDS_REVIEW` when required evidence is missing, including:

- SAK → KG without package content;
- BATANG → KG without resource specification;
- TRUCK → M3 without vehicle capacity;
- M3 → TON without density;
- equipment HARI → JAM without productive-hour context;
- LS → physical unit without breakdown.

SIMPROK may say “I do not know yet.” It must not invent a conversion.

---

# E. BOUNDED SLICE LAW

## E.1 KAMUS-UNIT-KERNEL-01A — Unit engine

Scope:

- audit existing `conversionFactor`;
- `UnitDefinition`;
- `UnitAlias`;
- `UnitConversionRule`;
- `AHSPVersion.outputUnit`;
- BOQ unit ↔ AHSP output-unit compatibility;
- deterministic/fail-closed unit tests.

Minimum future proof examples:

```text
SAK 50 KG                 → PASS
ROLL 100 M1               → PASS
TRUCK without capacity    → NEEDS_REVIEW
BOQ.unit ≠ AHSP.outputUnit→ NEEDS_REVIEW
```

Not included:

- end-to-end RAB price calculation;
- large UI;
- broad RBAC/Governance work;
- AI;
- Monitoring.

## E.2 KAMUS-UNIT-KERNEL-01B — Golden Thread

Uses 01A to calculate:

```text
supplier price ÷ package content
→ canonical resource price

coefficient × canonical resource price
→ resource cost

Σ resource costs
→ AHSP unit price

BOQ volume × AHSP unit price
→ line amount
```

The objective is to prove one live RAB line using real Owner data.

---

# F. CURRENT EFFECTIVE DELIVERY ORDER

The Owner’s product priority remains: move toward one live, truthful RAB line and do not drift into broad governance work.

The current effective sequence, normalized against later binding security and BP–AHSP decisions, is:

```text
0. SECURITY PREREQUISITE
   Close the proven project-workspace permission hole in PermissionsGuard.
   This is a bounded exception because opening a new project-AHSP write endpoint while the hole is known is prohibited.

1. BP-AHSP PHASE 2
   Persist deterministic resource resolution and selected Basic Price trace inside the project AHSP occurrence.
   No RAB arithmetic yet.

2. KAMUS-UNIT-KERNEL-01A
   Audit conversionFactor; establish structural unit definitions/rules; add AHSP output-unit and BOQ compatibility gates.

3. KAMUS-UNIT-KERNEL-01B
   Activate resource-cost and AHSP-unit-price calculation using the proven unit engine.

4. ONE LIVE RAB LINE
   Prove one real Owner data chain end-to-end.

5. GOVERNANCE / RBAC DEBTS
   Return to broader Governance, permission catalog, and other deferred guard normalization only after the live line milestone, except for independently proven critical security blockers.
```

No unrelated security, governance, or documentation expansion may displace this sequence.

---

# G. RECORDED DEBTS — NOT CURRENT SCOPE

## `DEBT-GUARD-02`

Reality Intake upload currently performs Workspace membership authorization directly inside its controller instead of using the normalized guard/access-policy path.

This is a second authorization truth. It must be normalized in a dedicated future security slice, not inside BP–AHSP Phase 2 or Unit Kernel work.

## `DEBT-PERMISSION-01`

The final write-permission catalog for RAB editing and project AHSP occurrence writing is not yet locked.

Do not solve this debt by borrowing unrelated permissions indefinitely, and do not invent permission codes inside a bounded implementation slice.

---

# H. ANTI-OVERCLAIM LAW

Do not claim any of the following until runtime evidence proves them:

- “Golden Thread is live”;
- “RAB is automatically using Basic Price”;
- “Cost Kernel is active”;
- “unit conversion is universal”;
- “project Governance is complete.”

Current bounded proofs must be named exactly according to what they deliver.

---

# I. CORE PRODUCT LAWS

```text
SIMPROK menghitung, manusia memutuskan.
AHSP adalah otoritas. Basic Price menyesuaikan.
Reduce Uncertainty.
No implicit access.
No false conversion.
No second source of truth.
```
