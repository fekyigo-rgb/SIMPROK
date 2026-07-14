# SIMPROK — BP-AHSP-PHASE-2

## ARCHITECT CLARIFICATION ADDENDUM

**Status:** `OWNER/PM IMPLEMENTATION GATE — BINDING ADDENDUM`  
**Date:** 14 Juli 2026  
**Applies to:** `BP_AHSP_PHASE2_PROJECT_OCCURRENCE_PERSISTENCE.md`  
**Required base:** latest clean `origin/main` containing this addendum and the Repository Synchronization Law.

This addendum closes interpretation gaps found during Architect review. It does not widen Phase 2. When wording in the Phase 2 gate is less specific, this addendum controls.

---

## 1. Owner and Architecture Status

- The Basic Price–AHSP Blueprint v1.0 is `OWNER PASS — FOUNDATION LOCKED` through its Owner Lock Record dated 14 Juli 2026.
- Production names are locked for this bounded slice:
  - `ProjectAhspOccurrence`
  - `ProjectAhspResourceResolution`
- Phase 2 remains persistence and runtime wiring only. It is not the Cost Kernel and does not make RAB automatic.

---

## 2. Resolution Law — No Guessing

The only authorized resolver is:

```text
backend/src/ahsp/price-resolution/ahsp-resource-price-resolution.kernel.ts
```

For Phase 2:

- Resource matching must use the exact bounded behavior already implemented by the Phase 1 kernel: trim, lowercase, collapse repeated whitespace, exact name equality, matching resource type, and supported labor-day unit equivalence.
- Do not add a pre-resolution or fallback layer using fuzzy match, similarity score, embeddings, AI/LLM matching, semantic guesswork, or arbitrary aliases.
- Do not read, seed, or treat `matches` from `docs/data-intake/first-real-input-sample.json` as production truth.
- Do not invent `ResourceCatalog.id` or `BasicPrice.id`.
- Zero exact catalog candidates → persist `UNRESOLVED` with the kernel reason.
- More than one exact catalog candidate → persist `NEEDS_REVIEW`; no catalog is auto-selected.
- Zero public-eligible compatible Basic Prices → persist `UNRESOLVED`; no manual price fallback.
- More than one compatible Basic Price → persist `NEEDS_REVIEW` and `selectedBasicPriceId = null`.
- A type/domain mismatch remains `UNRESOLVED` with a stable reason code; do not introduce a new Phase 2 status.
- No tie-breaker based on nominal value, effective date, freshness ordering, database order, `findFirst`, array order, or UUID.
- A high or low nominal value has no effect on trust or resolution status.

---

## 3. Freshness and Global/Workspace Boundary

- `CURRENT` and `EXPIRING` may enter the bounded automatic proof.
- `EXPIRED` must not be automatically selected in Phase 2.
- If only expired compatible candidates exist, persist `NEEDS_REVIEW`, with no selected Basic Price.
- If global and workspace candidates both remain compatible and eligible, the Phase 1 multi-candidate rule applies: `NEEDS_REVIEW`.
- Do not invent global-versus-workspace precedence in this phase.

---

## 4. Migration Law

The migration may contain only:

- the bounded enums needed by Phase 2;
- two new tables:
  - `project_ahsp_occurrences`
  - `project_ahsp_resource_resolutions`;
- foreign keys, unique constraints, and indexes required by those two tables.

Existing Prisma models may receive relation-array declarations only where required for the new relations.

Forbidden:

- no new scalar identity or persistence column on `AHSP`, `AHSPVersion`, `AHSPResource`, `AHSPSnapshot`, `AHSPSnapshotResource`, `ResourceCatalog`, `BasicPrice`, `BoqItem`, or `RabDocument`;
- do not alter `AHSPResource.resourceId`, coefficient, unit, or conversion fields;
- do not add a ResourceCatalog FK to master `AHSPResource`;
- no snapshot schema change or historical backfill;
- no `prisma db push`;
- no `prisma migrate reset`;
- no `--force-reset` or equivalent destructive command;
- no production database backfill.

The raw AHSP fields are copied into the new occurrence-resolution row for traceability; the master AHSP is unchanged.

---

## 5. Idempotency Law

Phase 2 is intentionally independent from mutable draft `BoqItem` rows.

Database constraint:

```text
unique(projectId, idempotencyKey)
```

Runtime behavior:

- same key + same `projectId`, `ahspVersionId`, and `ahspResourceId` → return the existing occurrence and existing resolution IDs;
- same key + different version/resource payload → `409 Conflict`;
- concurrent retries must produce one occurrence and one resource-resolution row;
- do not add `boqItemId` to the Phase 2 idempotency key or occurrence schema.

Reason: draft BOQ persistence currently deletes and recreates its rows; a draft `boqItemId` is not a stable structural occurrence identity.

---

## 6. Access and Tenant Law

Use repository reality; do not invent permissions.

POST:

```text
JwtAuthGuard + ProjectAccessGuard + PermissionsGuard + AHSP_MANAGE
```

GET:

```text
JwtAuthGuard + ProjectAccessGuard + PermissionsGuard + AHSP_VIEW
```

- `ProjectAccessGuard` must continue to use `ProjectAccessPolicyService` as the single project-access predicate.
- Do not create `RAB_VIEW` or `RAB_DRAFT_EDIT` in this phase.
- Account ID and active workspace ID come from authenticated request context, never from request body.
- Occurrence create/read queries must be constrained by the authorized `projectId` and active `workspaceId`.
- The project remains the source of truth for organization ownership; do not duplicate `organizationId` into the new tables merely as a copied field.
- Preserve current guard semantics:
  - project/membership not visible → `404`;
  - authenticated workspace member not assigned to the project → `403`;
  - insufficient AHSP permission → `403`.
- Cross-workspace occurrence access must not reveal the record.

---

## 7. No-Money and No-EF Law

Phase 2 persists resolution and deterministic unit-adaptation trace only.

Allowed for the bounded labor-day proof:

- source price value and unit;
- canonical unit `PERSON_DAY`;
- conversion factor `1`;
- adapted price equal to source price;
- source origin, freshness, and effective date;
- selection and resolution trace.

Forbidden:

- coefficient × price;
- resource cost;
- AHSP unit price;
- subtotal;
- grand total;
- RAB line total;
- update of `BoqItem.unitPrice` or `BoqItem.lineTotal`;
- manual-price fallback;
- Execution Factor calculation, selection, or persistence.

Execution Factor is absent from this Phase 2 runtime path.

---

## 8. Audit Trace Law

Persist at minimum:

- resolution status;
- nullable selection mode;
- resolution method;
- reason-code array;
- Indonesian explanation;
- policy version;
- authenticated `createdByAccountId` on the occurrence;
- created and updated timestamps;
- raw AHSP resource reference, type, coefficient, and unit;
- resolved catalog and selected Basic Price references only when they genuinely exist and are authorized.

For a Phase 1 exact result:

```text
resolutionMethod = EXACT_DETERMINISTIC
```

Do not add a numeric confidence value in this phase. The proof is deterministic, and a fabricated confidence number would create false precision. Future recommendation confidence requires a separate gate and cannot authorize auto-resolution by itself.

---

## 9. Basic Price Eligibility Law

- Reuse `BasicPriceService.findByResource()` for candidate eligibility.
- Revalidate the final selected Basic Price through `BasicPriceService.findOneForWorkspace()` immediately before persistence.
- Do not duplicate, copy, loosen, or reinterpret the public publication predicate.
- `VERIFIED`-only or otherwise public-ineligible prices must not be selected.
- If the current BasicPrice service cannot satisfy the gate without redefining eligibility, stop with `STOP_ARCHITECTURE_CONFLICT`; do not create a second predicate.

---

## 10. Evidence Law

The final implementation report must contain raw evidence, not only conclusions:

1. baseline branch, local `HEAD`, `origin/main`, feature-branch remote head, and clean status;
2. exact final commit SHA after commit;
3. proof local feature `HEAD` equals remote feature-branch head after push;
4. exact changed-file list;
5. migration filename and complete raw SQL;
6. raw `schema.prisma` snippets for the two new models, enums, constraints, and relation arrays;
7. focused test output and counts;
8. backend build and full serial unit-test output/counts;
9. Prisma validate and `verify:db:test` exit codes;
10. safe E2E database guard, suite/test counts, `RESIDUAL_RESULT: PASS`, and advisory-lock release;
11. frontend regression build;
12. before/after proof that master AHSP records, `BoqItem`, `RabDocument`, and historical snapshots were not mutated;
13. `git diff --check` and final clean worktree.

No PR and no merge before PM code review.

---

## 11. Final Binding Verdict

```text
PHASE 2 ARCHITECTURE: VALID WITH THIS ADDENDUM
PERMISSIONS: AHSP_MANAGE / AHSP_VIEW
IDEMPOTENCY: projectId + idempotencyKey
BOQ ITEM RELATION: FORBIDDEN IN PHASE 2
ADAPTED PRICE TRACE: PERSIST FACTOR-1 EVIDENCE
COST KERNEL / RAB / EF: FORBIDDEN
IMPLEMENTER GUESSING: FORBIDDEN
```

**SIMPROK menghitung. Manusia memutuskan.**  
**AHSP adalah otoritas. Basic Price menyesuaikan.**
