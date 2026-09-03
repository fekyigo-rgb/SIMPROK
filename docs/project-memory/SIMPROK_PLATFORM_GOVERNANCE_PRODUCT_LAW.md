# SIMPROK — Platform Governance Product Law

**Status:** OWNER LOCKED — CANONICAL
**Decision date:** 2026-09-03
**Scope:** Platform Governance / Official & Shared Knowledge

## 1. Owner Decisions

The Owner ratifies the following Product Law:

1. **Platform Governance = YES.** SIMPROK has a governance layer above Workspace for knowledge owned by SIMPROK itself, including Official/Shared Repository knowledge.
2. **Strict separation = YES.** Platform Governance must remain strictly separate from Owner/DIRECTOR, Workspace RBAC, and Project Authority.
3. **Vocabulary separation = YES.** `Authority`, `Permission`, and `Approval Requirement` remain distinct concepts. They must not be merged merely to solve platform governance.
4. **Current Platform Authority Holder = PERSON (`Account`).** Platform Authority is attached directly to the platform person/principal represented by `Account`. It is not attached to a Platform Seat/Office in the current Product Law.

## 2. Canonical Boundary

Platform-owned knowledge is a Platform Layer concern. A customer/business Workspace must not acquire platform governance merely by convention, by using a magic workspace/project identifier, or by treating a workspace role as a platform authority.

The current lawful platform governance subject/holder is the `Account` person/principal. The authority is therefore conceptually direct:

`Account (Person) -> Authority`

No `Position`, `PositionAssignment`, `PositionAuthority`, Workspace, Workspace Role, Workspace Permission, or Project Authority may be inserted into this platform holder relationship.

The decision is intentionally **current-state Product Law**, not a permanent prohibition on future evolution. A future change to a Seat/Office model would require a new explicit Owner decision and a separate architecture/product-law gate; it must never emerge implicitly from implementation.

## 3. Existing Machinery — Preserve

The following remain authoritative and must not be duplicated or replaced:

- existing `Authority` vocabulary;
- existing `PositionAuthority` machinery for its existing Workspace/Position semantics;
- existing `PositionAssignment` machinery for its existing Workspace/Position semantics;
- existing `ProgressAuthorityService` for its existing project/workspace scope;
- existing Workspace RBAC (`Role` / `Permission`) for workspace governance;
- existing audit/revocation semantics where applicable;
- existing AHSP, Basic Price, Unit Kernel, Cost Kernel, RAB, Monitoring and publication machinery.

`AuthorityService` is known to contain a broken/inconsistent implementation path and is **not** thereby authorized for repair or activation. Repairing/activating it requires separate adjudication because it may create a live authority-grant capability.

## 4. Non-Negotiable Separation

- Platform Governance != Workspace RBAC.
- Platform Governance != Project Authority.
- `Authority` != `Permission`.
- `Authority` != Approval Requirement.
- Owner/DIRECTOR != automatic platform authority holder.
- `SUPER_ADMIN` workspace role != automatic platform authority holder.
- A workspace must not be designated as the SIMPROK platform merely by convention.
- A magic workspace/project identifier must never be used as platform scope.
- A Workspace `Position` is not a Platform Seat/Office.
- `PositionAssignment` and `PositionAuthority` remain Workspace/Position machinery and must not be repurposed for platform-person authority.

## 5. Holder Law — Current State

### 5.1 Holder

The current Platform Authority holder is the **person/principal represented by `Account`**.

### 5.2 Meaning

A platform authority grant means:

> This specific platform person/account is explicitly authorized to exercise the specified `Authority` at Platform scope.

The authority does not arise from the person's Workspace membership, Workspace Role, Workspace Permission, DIRECTOR status, SUPER_ADMIN role, Position, or Project assignment.

### 5.3 Revocation

Revocation removes the person's current platform authority. Revocation must fail closed and must take effect according to the canonical authority state; absence, inactive state, revoked state, or ambiguous holder state must never be interpreted as active authority.

### 5.4 Succession

The current model is person-based. A successor therefore receives an explicit grant after the predecessor's authority is revoked or otherwise lawfully ended. No office/seat succession semantics are implied by this Product Law.

### 5.5 Future evolution

A future Seat/Office model is **not prohibited forever**. It is simply not the current law. Any future migration from Person to Seat/Office requires a new Owner decision, explicit Product Law update, impact analysis, and implementation gate.

## 6. Audit Boundary

Platform governance acts must be independently provable at **Platform scope**.

A Workspace context must not be required as the semantic source of a Platform Authority grant, revocation, or authorization decision.

Existing audit patterns may be reused where semantically valid, but this record does **not** pre-authorize changing any existing audit model. The exact platform-scoped audit extension remains an implementation-boundary question.

At minimum, the eventual implementation must be able to prove from authoritative data:

- holder/account;
- authority;
- current state;
- grant event/time;
- grantor/authorized governance act;
- revocation event/time when applicable;
- reason/history sufficient to explain the governance change.

## 7. Grant / Revoke Law

Platform Authority must never be auto-granted by:

- account creation;
- login;
- Workspace creation;
- Workspace membership;
- Workspace Role or Permission assignment;
- DIRECTOR status;
- SUPER_ADMIN workspace role;
- import;
- cron;
- event;
- subscription;
- ordinary bootstrap.

Every Platform Authority grant must be an explicit, authorized governance act.

The exact grantor and revoker authority remain an implementation-preparation/governance sub-question and must be proven before live grant/revoke implementation. No role or person is implicitly granted that power by this document merely by title.

## 8. Implementation Gate

This Product Law now resolves the **holder question** but does **not** by itself authorize a schema or implementation choice.

Before implementation, the exact lawful binding of `Account` to the existing `Authority` vocabulary must be reconciled against the canonical architecture using existing machinery first.

No option such as:

- nullable `Position.workspaceId`;
- repurposing `Position`;
- repurposing `PositionAssignment`;
- repurposing `PositionAuthority`;
- magic platform Workspace;
- Workspace Role/Permission elevation;
- DIRECTOR/SUPER_ADMIN elevation;
- second Authority engine/resolver;
- permanent out-of-band governance;

is authorized by this record.

The implementation must remain the smallest semantic change that realizes:

`Account (Person) -> existing Authority`

while preserving all existing Workspace and Project isolation.

## 9. Current Gate State

- Platform Governance Product Law: **LOCKED**.
- Strict separation: **LOCKED**.
- Vocabulary separation: **LOCKED**.
- Platform Authority holder = `Account` / Person: **LOCKED**.
- Seat/Office as current holder: **NOT THE CURRENT LAW**.
- Structural gap for platform-level authority representation: **PROVEN** in the current implementation.
- Exact Account↔Authority binding implementation: **NOT YET AUTHORIZED**.
- Platform-scoped audit implementation: **NOT YET AUTHORIZED**.
- Grantor/revoker implementation authority: **NOT YET AUTHORIZED**.
- Schema change: **NOT AUTHORIZED by this record**.
- Migration: **NOT AUTHORIZED by this record**.
- New authority engine/resolver: **NOT AUTHORIZED**.
- AHSP reopening: **NOT AUTHORIZED**.
- Publication/shared-promotion activation: **NOT AUTHORIZED** until the governance implementation boundary is separately proven.

## 10. Required Next Gate

The next gate is now a narrow **PLATFORM GOVERNANCE IMPLEMENTATION BOUNDARY PROOF** and must determine, using existing machinery first:

1. the smallest lawful Account↔Authority binding;
2. whether any existing entity can safely carry that binding without semantic collision;
3. the minimum auditable grant/revoke state and history;
4. the minimum platform-scoped audit mechanism;
5. the exact authorization boundary for grant/revoke;
6. the smallest implementation that realizes this law without creating a second authority system or weakening Workspace/Project isolation.

The next gate must be **READ / ANALYZE / PROVE ONLY** unless separately authorized to implement.

## 11. Preservation Lock

The following must remain untouched unless a future gate provides concrete contrary evidence and explicit authorization:

- AHSP;
- Basic Price;
- Unit Kernel;
- Cost Kernel;
- RAB;
- Monitoring;
- existing Workspace RBAC;
- existing Project Authority;
- existing Position/PositionAssignment/PositionAuthority semantics;
- publication firewall;
- existing healthy authority/audit machinery.

No closed machine is to be rebuilt merely to accommodate Platform Governance.

**Owner decision:** Platform Governance YES; strict separation YES; `Authority` / `Permission` / `Approval Requirement` remain distinct; current Platform Authority Holder = PERSON (`Account`).

Soli Deo Gloria.
