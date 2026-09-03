# SIMPROK — Platform Governance Product Law

**Status:** OWNER LOCKED — CANONICAL
**Decision date:** 2026-09-03
**Scope:** Platform Governance / Official & Shared Knowledge

## 1. Owner Decision

The Owner ratifies the following Product Law:

1. **Platform Governance = YES.** SIMPROK has a governance layer above Workspace for knowledge owned by SIMPROK itself, including Official/Shared Repository knowledge.
2. **Strict separation = YES.** Platform Governance must remain strictly separate from Owner/DIRECTOR, Workspace RBAC, and Project Authority.
3. **Vocabulary separation = YES.** `Authority`, `Permission`, and `Approval Requirement` remain distinct concepts. They must not be merged merely to solve platform governance.

## 2. Canonical Boundary

Platform-owned knowledge is a Platform Layer concern. A customer/business Workspace must not acquire platform governance merely by convention, by using a magic workspace/project identifier, or by treating a workspace role as a platform authority.

The existence of platform-scoped knowledge does **not** by itself establish a lawful human platform authority holder. The platform governance subject/holder must be represented explicitly and lawfully before implementation.

## 3. Existing Machinery — Preserve

The following remain authoritative and must not be duplicated or replaced:

- existing `Authority` vocabulary;
- existing `PositionAuthority` machinery;
- existing `PositionAssignment` machinery;
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

## 5. Implementation Gate

This Product Law does **not** authorize a schema or implementation choice by itself.

Before implementation, the exact platform governance subject/holder and its lawful binding to the existing authority machinery must be reconciled against the canonical architecture. No option such as nullable `Position.workspaceId`, a new Account↔Authority table, a platform workspace convention, or permanent out-of-band governance is pre-approved by this record.

## 6. Current Gate State

- Structural gap for platform-level authority representation: **PROVEN in the current implementation**.
- Product Law existence: **NOW LOCKED for platform governance, separation, and vocabulary distinction**.
- Exact holder/binding implementation: **NOT YET AUTHORIZED**.
- Schema change: **NOT AUTHORIZED by this record**.
- Migration: **NOT AUTHORIZED by this record**.
- New authority engine/resolver: **NOT AUTHORIZED**.
- AHSP reopening: **NOT AUTHORIZED**.
- Publication/shared-promotion activation: **NOT AUTHORIZED** until the governance implementation boundary is separately proven.

## 7. Required Next Gate

The next implementation-preparation gate must determine, using existing machinery first:

1. the lawful platform governance principal/holder;
2. the canonical relationship between that holder and existing `Authority`/`Permission` concepts;
3. the minimum auditable grant/revoke semantics;
4. the exact extension point that preserves Workspace and Project isolation;
5. the smallest implementation that realizes this law without creating a second authority system.

Until that gate passes, implementation remains blocked.

**Owner decision:** Platform Governance YES; strict separation YES; `Authority` / `Permission` / `Approval Requirement` remain distinct.

Soli Deo Gloria.
