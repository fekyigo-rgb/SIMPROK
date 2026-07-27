# RM-02C1a — Resource Identity & Provenance Schema Contract

**Status:** IMPLEMENTED, NOT MERGED. Draft PR only. `RM02C1B_BOOTSTRAP=LOCKED`.

```
BASE_SHA=80223a5dd5256921bf7dd237afff51c30b583ded
BRANCH=feat/rm02c1a-resource-identity-schema-foundation
WORKTREE=C:\Users\asus\SIMPROK-WT-RM02C1A
ROADMAP_ITEM=RM-02C1a
```

This document is the schema contract for RM-02C1a. It does not reopen or
change the RM-02C0 canonical discovery evidence
(`docs/implementation-gates/rm02c0-discovery/`), which remains untouched and
authoritative for the 271-resource count.

---

## 1. Architecture summary

```
GLOBAL_RESOURCE_WITH_PROVENANCE=NOT_SUPPORTED_IN_RM02C1A
GLOBAL_RESOURCE_SEMANTICS=DEFERRED
RM02C1B_TARGET_SCOPE=WORKSPACE_A_ONLY
```

`ResourceCatalog.id` remains the sole canonical internal identity. Source
codes (from an imported workbook) are **never** treated as canonical unless a
human explicitly verifies and sets `ResourceCatalog.code`. This slice makes
that policy possible at the schema level (`code` becomes nullable) and adds a
dedicated, append-style provenance model (`ResourceSourceIdentity`) so that
where-a-resource-was-seen-in-a-source-file is recorded permanently without
ever being confused with the canonical identity itself.

Cardinality: `ResourceCatalog` 1 → N `ResourceSourceIdentity`. One resource
may have been seen in many source rows (re-imports, re-uses); a provenance
row always points at exactly one resource.

## 2. Schema before / after

**Before:**
```prisma
model ResourceCatalog {
  workspaceId String?
  code        String
  ...
  @@unique([workspaceId, code])
}
```

**After:**
```prisma
model ResourceCatalog {
  workspaceId String?
  code        String?
  ...
  sourceIdentities ResourceSourceIdentity[]
  // @@unique([workspaceId, code]) removed — replaced by a manual partial
  // unique index in migration SQL (Prisma cannot express partial indexes).
}

model ResourceSourceIdentity {
  id                    String       @id @default(uuid()) @db.Uuid
  resourceCatalogId     String       @db.Uuid
  workspaceId           String       @db.Uuid
  sourceSha256          String       @db.VarChar(64)
  sourceFileName        String
  parserContractVersion String
  sheetName             String
  sourceRowNumber       Int
  sourceSection         ResourceType
  sourceCodeCellAddress String?
  sourceNameCellAddress String
  sourceUnitCellAddress String?
  rawCode               String?
  rawName               String
  rawUnit               String?
  createdAt             DateTime     @default(now())

  resourceCatalog ResourceCatalog @relation(fields: [resourceCatalogId], references: [id], onDelete: Restrict)
  workspace       Workspace       @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@unique([workspaceId, sourceSha256, sheetName, sourceRowNumber, parserContractVersion])
}
```

`Workspace` gains the inverse relation `resourceSourceIdentities`.

No field on `ResourceSourceIdentity` is mutable after creation in this
slice's contract: no `updatedAt`, no price field, no canonical-code field, no
resolution-status field. It is pure, permanent evidence.

## 3. Tenancy enforcement — why database triggers, not just application code

The Architect's cross-tenant finding was accepted as blocking:
`ResourceCatalog.workspaceId` stays nullable (global resources exist today
and independently proving their production safety as NOT NULL is out of
scope here), so Prisma's `@@unique([id, workspaceId])` trick for a
composite-FK tenancy guarantee is not available. Two PostgreSQL trigger
functions close the gap at the database layer instead — verified to survive
even when the write goes through Prisma Client (not just raw SQL), per the
committed test file.

**Trigger 1 — `check_resource_source_identity_workspace_match()`**
Fires `BEFORE INSERT OR UPDATE OF "resourceCatalogId", "workspaceId"` on
`resource_source_identities`. Rejects the write with error identifier
`RESOURCE_SOURCE_IDENTITY_WORKSPACE_MISMATCH` unless the referenced
`ResourceCatalog` exists, has a non-null `workspaceId`, and that
`workspaceId` equals the provenance row's own `workspaceId`. This is what
makes attaching provenance to a global resource, or to a resource in a
different workspace, structurally impossible.

**Trigger 2 — `check_resource_catalog_workspace_immutable_with_provenance()`**
Fires `BEFORE UPDATE OF "workspaceId"` on `resource_catalogs`, guarded by
`WHEN (OLD."workspaceId" IS DISTINCT FROM NEW."workspaceId")`. Rejects the
write with error identifier
`RESOURCE_CATALOG_WORKSPACE_IMMUTABLE_WITH_PROVENANCE` if one or more
`resource_source_identities` rows already reference that resource —
including an attempted change to `NULL` (i.e. a provenance-bearing resource
can never be "promoted" to global). A resource with zero provenance rows may
still have its workspace changed freely (not over-blocked).

## 4. Manual partial unique index

Prisma's schema DSL cannot express a filtered/partial unique index, so the
replacement for the dropped `resource_catalogs_workspaceId_code_key` compound
unique index is hand-written directly in the migration SQL:

```sql
CREATE UNIQUE INDEX "resource_catalogs_workspace_code_nonnull_key"
ON "resource_catalogs" ("workspaceId", "code")
WHERE "workspaceId" IS NOT NULL
  AND "code" IS NOT NULL;
```

Effect: workspace-scoped code uniqueness applies only among non-null codes.
Multiple `code IS NULL` rows in the same workspace are legal (a workspace may
hold many not-yet-canonicalized resources). Global (`workspaceId IS NULL`)
resources are outside this index entirely — global code uniqueness is not
part of this slice's contract.

The old index was dropped by its **exact literal name**
(`resource_catalogs_workspaceId_code_key`, confirmed against
`prisma/migrations/20260619101739_init_intelligence_domains/migration.sql`),
with no `IF EXISTS` — an unnoticed prior rename or drift would make this
migration fail closed rather than silently do nothing.

## 5. Source hash format

`ResourceSourceIdentity.sourceSha256` is `VARCHAR(64)` (not `CHAR(64)`) with
an explicit CHECK constraint requiring exactly 64 uppercase hexadecimal
characters (`^[0-9A-F]{64}$`). Uppercase hex is this domain's canonical
storage convention (matches how `RM02C0_CANONICAL_DISCOVERY`'s
`SOURCE_WORKBOOK_SHA256` is recorded). No trimming or silent repair of an
invalid value is performed — an invalid write is rejected outright.

## 6. Bounded scope confirmation

```
RESOURCE_BOOTSTRAP_EXECUTED=NO
L01_FIXTURE_CHANGED=NO — no persisted ResourceCatalog row literally coded
  'L.01' exists anywhere in the current test/seed suite (verified by search);
  the only 'L.01'/'L01' references in the repo are inside XLSX-parsing
  fixtures (raw workbook text), which this slice does not touch.
UNIT_KERNEL_CHANGED=NO
BASIC_PRICE_BEHAVIOR_CHANGED=NO
CATALOG_SEARCH_CREATED=NO
```

## 7. Null-readiness audit result

`ResourceCatalog.code` becoming nullable was traced through every backend
and frontend call site. Application-source impact was exactly **one file**:

- `backend/src/ahsp/price-resolution/ahsp-resource-price-resolution.kernel.ts`
  — `ResourceCatalogCandidate.code` changed from `string` to `string | null`
  (type-only; the kernel's matching logic never reads `.code`, only `.name`
  and `.type`, so this is a pure compile-safety change, not a behavior
  change).

No other backend service reads `ResourceCatalog.code` (the only other
`.code` matches found during the audit were `Prisma.PrismaClientKnownRequestError.code`
and `UnitDefinition.code`, both unrelated). No frontend component displays
`ResourceCatalog.code` at all — the frontend's only `code`-nullable display
logic (`BasicPriceImportRow.code`, already `string | null` with an existing
`?? '—'` fallback) belongs to the RM-02B import-row raw code, not this
model, and needed no change.

```
APPLICATION_SOURCE_FILE_COUNT=1
NULLABILITY_SCOPE_LIMIT_RESPECTED=YES
```

## 8. Excluded pre-existing drift

Prisma's auto-generated diff for this migration also proposed renaming three
unrelated, pre-existing foreign-key constraints on
`project_ahsp_resource_resolutions` (`pahr_sourceUnitDefinitionId_fkey` etc.
→ their default-convention names). That mismatch predates this slice — an
earlier migration manually shortened those constraint names, and Prisma's
diff engine always re-proposes the rename because Prisma's schema DSL has no
way to pin a custom constraint name. It is unrelated to the RM-02C1a
contract and has been deliberately excluded from the committed migration to
keep this slice bounded. It is not a regression introduced here, and it will
resurface the next time anyone runs `prisma migrate dev` against this table
— a pre-existing, named-nowhere-else piece of schema drift, now recorded
here for visibility.

Soli Deo Gloria.
