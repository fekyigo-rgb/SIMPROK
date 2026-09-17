import { readFileSync } from 'node:fs';

describe('MON-04 Execution Plan schema boundary', () => {
  const schema = readFileSync('prisma/schema.prisma', 'utf8');
  const migration = readFileSync(
    'prisma/migrations/20260915120000_execution_plan_foundation_v1/migration.sql',
    'utf8',
  );

  it('stores only version truth and incremental WORK_ITEM distributions', () => {
    expect(schema).toMatch(/model ExecutionPlanVersion \{/);
    expect(schema).toMatch(/model ExecutionPlanDistribution \{/);
    expect(schema).toMatch(/plannedIncrementalQuantity Decimal\s+@db\.Decimal\(18, 6\)/);
    expect(schema).not.toMatch(/model ExecutionPlanWorkItem \{/);
    expect(schema).not.toMatch(/model ExecutionPlanEvent \{/);
    expect(schema).not.toMatch(/plannedCumulativeQuantity|plannedWeight|curvePoint/);
  });

  it('pins cross-project baseline identity and restricts historical deletion', () => {
    expect(migration).toMatch(
      /FOREIGN KEY \("baselineId", "projectId"\) REFERENCES "project_baselines"\("id", "projectId"\) ON DELETE RESTRICT/,
    );
    expect(migration).toMatch(
      /FOREIGN KEY \("boqItemId"\) REFERENCES "boq_items"\("id"\) ON DELETE RESTRICT/,
    );
    expect(migration).not.toMatch(/ON DELETE CASCADE/);
  });

  it('enforces exact lifecycle provenance and positive inclusive intervals', () => {
    expect(migration).toMatch(/"lockedAuthorityCode" = 'EXECUTION_PLAN_LOCK'/);
    expect(migration).toMatch(/"lockedFromRevision" = "revision"/);
    expect(migration).toMatch(
      /"lockedFromProjectStatus" IN \('PLANNED', 'ACTIVE'\)/,
    );
    expect(migration).toMatch(/"lockedFromProjectStatus" IS NULL/);
    expect(migration).toMatch(/"periodStartDate" <= "periodEndDate"/);
    expect(migration).toMatch(/"plannedIncrementalQuantity" > 0/);
    expect(migration).toMatch(/execution_plan_one_locked_per_context_key/);
  });
});
