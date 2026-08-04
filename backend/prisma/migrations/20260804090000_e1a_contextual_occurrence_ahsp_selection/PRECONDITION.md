# E1A migration precondition

Run these read-only queries against `simprok_db` before a separately authorized
`prisma migrate deploy`. Expected result for every query is `0`.

```sql
SELECT COUNT(*) AS duplicate_idempotency_keys
FROM (
  SELECT "projectId", "idempotencyKey", COUNT(*)
  FROM "project_ahsp_occurrences"
  GROUP BY "projectId", "idempotencyKey"
  HAVING COUNT(*) > 1
) duplicates;

SELECT COUNT(*) AS orphan_occurrence_projects
FROM "project_ahsp_occurrences" o
LEFT JOIN "projects" p ON p."id" = o."projectId"
WHERE p."id" IS NULL;

SELECT COUNT(*) AS orphan_boq_structures
FROM "boq_items" b
LEFT JOIN "boq_structures" s ON s."id" = b."boqStructureId"
WHERE s."id" IS NULL;
```

The proposed unique constraint for the derived current generation is withheld
for Architect review. A conventional PostgreSQL unique index treats NULL values
as distinct; `NULLS NOT DISTINCT` would materially change that behavior and is
therefore not introduced by this migration.
