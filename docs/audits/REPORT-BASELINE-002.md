# REPORT-BASELINE-002

## Status

STOPPED and ROLLED BACK at STEP-4. No Baseline 002 schema/guard changes remain applied.

Reason: `npx prisma migrate dev --name baseline_002_rework --create-only` failed because Prisma Migrate detected a non-interactive execution environment.

## STEP-2A Migration Impact Report

Attempted Baseline 002 rework impact:

- `Project` would gain organization linkage, project type, lifecycle/date/budget/client fields, soft-delete marker, and updated `ProjectStatus`.
- `ProjectAssignment` would move from `User`-based assignment to `WorkspaceMembership`-based assignment with `AssignmentStatus`, `roleInProject`, and `isPrimaryAssignment`.
- `ProjectTeam` would be removed.
- `WbsNode` would be added and optionally linked from `BoqItem`.
- Redundant `BoqItem.aHSPId` and paired `AHSP.boqItems` relation would be removed.
- `PriceConfidence` and `BasicPrice.confidence` would be replaced by verification/source-origin/freshness enums and fields.
- `ResourceCatalog.tkdnValue` would be added.
- `BoqStructure.projectId` and `RabDocument.projectId` would become optional; `RabDocument` would gain `documentType` and `businessLabel`.
- `ApprovalMatrix.authorityCode` would be replaced by `authorityId` FK to `Authority`.

Rollback performed after migration create-only failure:

- Restored `prisma/schema.prisma` from `prisma/schema.prisma.bak-001`.
- Restored `src/auth/guards/project-access.guard.ts` from `src/auth/guards/project-access.guard.ts.bak`.
- Restored `src/auth/guards/project-access.guard.spec.ts` to the pre-Baseline-002 guard spec.

## Prisma Validation Result

Initial sandboxed command:

```text
npx prisma validate
Error: request to https://binaries.prisma.sh/all_commits/a9055b89e58b4b5bfb59600785423b1db3d0e75d/windows/schema-engine.exe.gz.sha256 failed, reason: connect ECONNREFUSED 127.0.0.1:9
```

Escalated retry:

```text
npx prisma validate
Exit code: 0
```

## Prisma Format Result

```text
npx prisma format
Exit code: 0
```

## Migration Result

```text
npx prisma migrate dev --name baseline_002_rework --create-only
Environment variables loaded from .env
Prisma schema loaded from prisma\schema.prisma
Datasource "db": PostgreSQL database "simprok_db", schema "public" at "localhost:5432"

Error: Prisma Migrate has detected that the environment is non-interactive, which is not supported.

`prisma migrate dev` is an interactive command designed to create new migrations and evolve the database in development.
To apply existing migrations in deployments, use prisma migrate deploy.
See https://www.prisma.io/docs/reference/api-reference/command-reference#migrate-deploy
```

## Build Result

Not run. STEP-4 stopped at the first migration failure per instruction.

## Test Result

Not run. STEP-4 stopped at the first migration failure per instruction.

## git diff --stat

Not available. `git` is not present on PATH in this execution environment.
