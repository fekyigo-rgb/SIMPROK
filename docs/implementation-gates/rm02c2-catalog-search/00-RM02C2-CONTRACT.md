# RM-02C2 Contract

Status: implementation candidate; merge remains Owner-only.

RM-02C2 replaces editable ResourceCatalog and UnitDefinition UUID fields in
Basic Price import review with explicit human search and selection. SIMPROK
may present candidates; a human must select both candidates and explicitly
click `Selesaikan`.

Locked boundaries:

- resource search is limited to `ACTIVE` resources owned by the active
  workspace; `workspaceId = NULL` and other workspaces are excluded;
- global ResourceCatalog semantics remain deferred;
- unit search is limited to active UnitDefinition rows and active aliases;
- search is read-only, deterministic, bounded, and uses
  `BASIC_PRICE_REVIEW_VIEW`;
- no fuzzy/AI matching, provenance aggregation, conversion inference,
  auto-selection, auto-resolution, or auto-submit exists;
- direct resolution repeats workspace/status eligibility checks and rejects
  cross-tenant, global, inactive, and unknown IDs;
- canonical permission seeds and production role grants are unchanged.

No schema, migration, seed, or production database operation belongs to this
slice.
