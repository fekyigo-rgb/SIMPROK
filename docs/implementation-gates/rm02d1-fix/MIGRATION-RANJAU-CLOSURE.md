# RM-02D1-REMEDIATION-V3.1 — Migration Landmine Closure

**Status:** CLOSED. Both target databases verified.

## 1. Root cause

During the original RM-02D1 session, `prisma migrate dev` against
`simprok_test` generated migration `20260728103627_rm02d1_resource_identity_mapping`
and bundled in 3 unrelated `RENAME CONSTRAINT` statements for
`ProjectAhspResourceResolution`'s FKs (`sourceUnitDefinitionId`,
`targetUnitDefinitionId`, `unitConversionRuleId`) — pre-existing drift from
migration `20260717010000_kamus_unit_kernel_01a`, which had renamed those
constraints to short `pahr_*` names in the database without a corresponding
`map:` override ever being added to `schema.prisma`.

That session reverted the 3 renames on `simprok_test` (restoring the
`pahr_*` names) and stripped the `RENAME CONSTRAINT` statements from the
migration file **after** it had already been recorded as applied — leaving
`_prisma_migrations.checksum` on `simprok_test` referring to the original
(pre-edit) file content. That mismatch is the landmine this closure
resolves. `simprok_e2e` was never affected: it received the already-cleaned
migration file on its first (and only) apply, so its checksum was correct
from the start.

## 2. Permanent fix — explicit `map:` (schema-level, no DDL)

`ProjectAhspResourceResolution`'s three FK relations now declare their real
constraint names explicitly in `schema.prisma`:

```prisma
sourceUnitDefinition UnitDefinition?     @relation("ResolutionSourceUnit", fields: [sourceUnitDefinitionId], references: [id], onDelete: Restrict, map: "pahr_sourceUnitDefinitionId_fkey")
targetUnitDefinition UnitDefinition?     @relation("ResolutionTargetUnit", fields: [targetUnitDefinitionId], references: [id], onDelete: Restrict, map: "pahr_targetUnitDefinitionId_fkey")
unitConversionRule   UnitConversionRule? @relation(fields: [unitConversionRuleId], references: [id], onDelete: Restrict, map: "pahr_unitConversionRuleId_fkey")
```

This is annotation-only — it changes nothing in any database, it just makes
`schema.prisma` describe the constraint names that have existed in both
databases all along. No DDL was run for this step.

### Verification — `migrate diff`, both databases

```
npx dotenv-cli -e .env.test -- npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma
→ No difference detected.

npx dotenv-cli -e .env.e2e -- npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma
→ No difference detected.
```

Both confirm: live database state now matches `schema.prisma` exactly, on
both `simprok_test` and `simprok_e2e`. This drift will not resurface on the
next `migrate dev` run for either database.

## 3. Checksum landmine closure — official path only

**FORBIDDEN**: no manual DDL was used anywhere in this closure. The only
manual DML executed was the two statements the remediation task explicitly
authorized, against `_prisma_migrations` only, on `simprok_test` only, each
preceded by a live `current_database() = 'simprok_test'` assertion inside
the same script (refuses to run against any other database name).

**Exact commands, in order:**

```sql
-- BEFORE (captured before any write)
SELECT migration_name, checksum, finished_at, applied_steps_count
FROM "_prisma_migrations"
WHERE migration_name = '20260728103627_rm02d1_resource_identity_mapping';
```
```
BEFORE checksum: 74775b4ab1b8b250c8214cfd063c8e989fabc3ed51cc53277d53a5875f4e592c
BEFORE finished_at: 2026-07-28T10:36:28.060Z
BEFORE applied_steps_count: 1
```

```sql
DELETE FROM "_prisma_migrations"
WHERE migration_name = '20260728103627_rm02d1_resource_identity_mapping';
-- DELETED_ROW_COUNT: 1
```

```
npx dotenv-cli -e .env.test -- npx prisma migrate resolve --applied 20260728103627_rm02d1_resource_identity_mapping
```
```
Migration 20260728103627_rm02d1_resource_identity_mapping marked as applied.
```

```sql
-- AFTER (captured after prisma migrate resolve, no further manual writes)
SELECT migration_name, checksum, finished_at, applied_steps_count
FROM "_prisma_migrations"
WHERE migration_name = '20260728103627_rm02d1_resource_identity_mapping';
```
```
AFTER checksum: 0e5227ca68fb30dc51c02fb5747d70fb5049b5a3a58d48e483150c73a7a042aa
AFTER finished_at: 2026-07-28T12:34:17.948Z
AFTER applied_steps_count: 0
```

`applied_steps_count: 0` is expected and correct — `migrate resolve --applied`
records the migration as applied without re-executing its SQL (the table it
creates already exists from the original apply); only the checksum record
is corrected to match the current, cleaned migration file on disk.

## 4. Deploy verification — both databases, real command output

```
npx dotenv-cli -e .env.test -- npx prisma migrate deploy
→ 25 migrations found in prisma/migrations
→ No pending migrations to apply.
```

```
npx dotenv-cli -e .env.e2e -- npx prisma migrate deploy
→ 25 migrations found in prisma/migrations
→ No pending migrations to apply.
```

Neither run reported a checksum mismatch (Prisma's `migrate deploy` fails
loudly — `P3018`-class error — if any applied migration's stored checksum
no longer matches its on-disk file; it did not, on either database).

## 5. What was explicitly NOT done

- No `ALTER TABLE ... RENAME CONSTRAINT` (or any other DDL) was executed
  manually against any database in this closure.
- No migration file content was changed after this closure began — the
  file was already correct; only its `_prisma_migrations` bookkeeping
  record was wrong, and only that was fixed, via the sanctioned Prisma
  command.
- `simprok_db` was never connected to.

## 6. Result

- `simprok_test`: landmine closed, checksum now correct, `migrate deploy`
  clean.
- `simprok_e2e`: unaffected by the landmine, `migrate deploy` clean,
  reconfirmed.
- Both databases: zero schema drift against `schema.prisma` (§2).
