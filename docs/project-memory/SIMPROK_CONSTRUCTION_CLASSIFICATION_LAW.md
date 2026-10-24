# SIMPROK CONSTRUCTION CLASSIFICATION LAW

Status: OWNER LOCKED
Owner: Feky de Fretes
Decision date: 2026-09-02

## 1. Core Decision

SIMPROK MUST NOT use a universal rigid taxonomy of:

`Bidang → Domain → Subcategory → Division`

as the canonical construction classification tree.

The canonical conceptual model is:

**MULTIDIMENSIONAL + AUTHORITY-AWARE + CONTEXT-AWARE.**

Construction classification, project/work structure, technical work identity, and knowledge/intelligence context are distinct dimensions. They may be related and cross-mapped, but they MUST NOT be collapsed into one universal hierarchy merely for implementation convenience.

## 2. External Authority Law

Official Indonesian classifications remain external authorities when applicable, including relevant PUPR classification/subclassification and KBLI/BPS references.

SIMPROK MUST NOT silently replace, redefine, or claim ownership of an official external classification.

SIMPROK's role is to provide a canonical crosswalk / work-identity layer that can relate relevant external classifications, project context, user input, and AHSP discovery without pretending that they are the same taxonomy.

International classification frameworks may be used as reference and crosswalk sources, but MUST NOT be copied wholesale into the SIMPROK runtime domain without a separate evidence-based Owner decision.

## 3. Conceptual Roles

### Field / Bidang

High-level construction or industry context. The term is context-dependent in real construction practice and MUST NOT be assumed to have one universal official meaning.

### Domain

SIMPROK intelligence/discovery context describing a broad construction knowledge or industry area. `Domain` is a SIMPROK conceptual layer, not a claim that it is an official PUPR classification level.

### Subcategory

A refinement describing a family/type of construction work or asset within the applicable context. It is a discovery/classification aid, not a universal mandatory parent of every other concept.

### Work Type

The actual work identity being performed. This is closer to the operational identity needed for AHSP discovery and downstream intelligence.

### Division

Project/document/specification/work-breakdown context. A Division MUST NOT be treated as a universal industry classification or as an intrinsic universal AHSP parent.

A Division may legitimately differ between project/specification systems while the underlying work identity remains the same.

### Method Type / Location Type / Method Name

These remain distinct technical/AHSP identity concepts already present in SIMPROK Product Law. They MUST retain their distinct semantic roles and MUST NOT be collapsed into Field, Domain, Subcategory, or Division.

## 4. Canonical Relationship Principle

A single construction work may legitimately have multiple views:

- official industry/classification view;
- SIMPROK Field/Domain/Subcategory discovery view;
- canonical Work Type view;
- project/document Division/work-breakdown view;
- technical method/location view;
- AHSP view;
- resource/cost view;
- future execution/intelligence view.

The relationship among these views is more important than forcing them into one tree.

## 5. AHSP Discovery Law

Classification/category information is a discovery signal, not a prison.

SIMPROK should prioritize the most relevant known category/domain/subcategory context, then perform controlled broader fallback when necessary and safe. A candidate MUST still satisfy the actual AHSP identity/applicability requirements before binding.

Category matching MUST NOT override:

- exact/trusted work identity requirements;
- Unit Kernel authority;
- Resource Identity authority;
- Basic Price authority;
- fail-closed truth/persistence boundaries;
- human decision gates where ambiguity remains.

## 6. Intelligence Architecture Principle

SIMPROK should become a translator and intelligence layer across construction classification systems, not a replacement for all construction standards.

Conceptually:

`External Classifications + Project Structure + User BOQ + AHSP Source + Technical Identity`

→ `SIMPROK Discovery / Crosswalk`

→ `Canonical Work Identity`

→ `AHSP / RAB / Execution Intelligence`

This is a conceptual Product Law. It is NOT permission to create schema, taxonomy tables, seed data, or runtime engines without a separate bounded implementation gate.

## 7. Formation Knowledge Boundary

Formation Knowledge remains DEFERRED until AHSP core is live/locked and real supporting AHSP evidence has been audited.

Formation Knowledge MUST NOT become a replacement taxonomy. It is a future evidence-backed layer explaining how AHSP knowledge/formulas/coefficients are formed and may later support execution method, equipment, manpower, schedule, material/specification, RKK, and Execution Factor reasoning.

No speculative graph database, vector database, giant ontology, or runtime LLM dependency is authorized by this law.

## 8. Evidence Basis

This decision was established after external research into relevant construction classification practice, including:

- Indonesian PUPR classification/subclassification and related KBLI/BPS structures;
- Bina Marga specification/division structure;
- ISO 12006-2 classification framework concepts;
- CSI MasterFormat division/work-result organization;
- NBS Uniclass 2015 multidimensional table approach.

These references support the architectural conclusion that construction information is usefully represented through multiple related views rather than one universal tree.

The external references are evidence for the architectural principle, not new SIMPROK implementation authority by themselves.

## 9. Implementation Guardrails

Agents MUST:

- KEEP existing healthy AHSP, Unit Kernel, Resource Identity, Basic Price, and other canonical authorities;
- CONNECT existing intelligence where it is orphaned rather than rebuilding it;
- distinguish external authority from SIMPROK internal concepts and project context;
- preserve fail-closed semantics;
- avoid speculative taxonomy/schema expansion;
- derive exact values from authoritative source evidence before seeding or persisting them;
- use bounded implementation slices with explicit Owner/PM gates.

Agents MUST NOT:

- create `Field → Domain → Subcategory → Division → AHSP` as a universal foreign-key chain merely because it is convenient;
- invent official PUPR/KBLI values;
- present SIMPROK Domain as an official government classification;
- treat project Division as canonical AHSP identity;
- rebuild existing classification/intelligence engines without concrete evidence of a defect;
- implement Formation Knowledge merely because this law mentions it.

## 10. Authority

This document records the Owner's decision on 2026-09-02.

It is a Product/Architecture law and a guardrail for future classification/discovery work. It does not authorize implementation by itself.

Before implementation, agents MUST read the current repository control documents and establish the current canonical base SHA/repository reality.

Soli Deo Gloria. Haleluya. Amin.
