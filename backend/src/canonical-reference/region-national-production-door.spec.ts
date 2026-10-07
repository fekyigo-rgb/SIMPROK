import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  CANONICAL_REFERENCE_WORKSPACE_ID,
  verifyCanonicalReferenceAuthority,
} from './canonical-reference-target';
import {
  NATIONAL_MASTER_INCOMPLETE,
  NATIONAL_MASTER_INTEGRITY,
  NATIONAL_MASTER_READY_FOR_APPLY,
  NATIONAL_REGION_EXPECTED_COVERAGE,
  type NationalRegionDump,
  type NationalRegionMasterAssessment,
} from './region-national-master.gate';
import type { NationalRegionApplyResult } from './region-national-master.provisioner';
import type { NationalRegionReadOnlyPlanReport } from './region-national-master.readonly-verifier';
import {
  NATIONAL_REGION_EXPECTED_TOTAL,
  NATIONAL_REGION_PRODUCTION_CONFIRMATION_ENV,
  assertNationalRegionApplyPreconditions,
  assertNationalRegionPostApply,
  parseNationalRegionProductionMode,
  planCurrentNationalRegionStateReadOnly,
  readProductionConfirmation,
  runNationalRegionProductionDoor,
  summarizeNationalRegionSnapshot,
  type NationalRegionProductionClient,
  type NationalRegionProductionDependencies,
  type NationalRegionProductionPlan,
} from './region-national-production-door';
import {
  REGION_CONFIRMATION_TOKEN,
  type RegionDesignation,
  type RegionRow,
} from './region-provisioner';

const CANONICAL_DATABASE_URL =
  'postgresql://simprok_app:not-printed@127.0.0.1:55432/simprok_db';

const DESIGNATION: RegionDesignation = {
  regionCode: 'ID',
  regionName: 'Indonesia',
  administrativeLevel: 'COUNTRY',
};
const COMPLETE_DESIGNATIONS = Array<RegionDesignation>(
  NATIONAL_REGION_EXPECTED_TOTAL,
).fill(DESIGNATION);

const DUMP: NationalRegionDump = {
  source: 'KEMENDAGRI',
  sourceDocument: 'TEST-ONLY injected assessed master',
  rows: [],
};

const COMPLETE_ASSESSMENT: NationalRegionMasterAssessment = {
  status: 'READY_FOR_APPLY',
  reasonCode: NATIONAL_MASTER_READY_FOR_APPLY,
  nationalMasterComplete: true,
  coverage: { ...NATIONAL_REGION_EXPECTED_COVERAGE },
  integrityErrors: [],
  designations: COMPLETE_DESIGNATIONS,
  sameNameSameScopeDistinctValidCodeCount: 0,
  sourceTransformationLossCount: 0,
  supportingProvenance: [],
  historicalSuccession: null,
};

function plan(
  overrides: Partial<NationalRegionProductionPlan> = {},
): NationalRegionProductionPlan {
  return {
    transactionReadOnly: 'on',
    regionTotal: 0,
    designationCount: NATIONAL_REGION_EXPECTED_TOTAL,
    prospectiveRegionTotal: NATIONAL_REGION_EXPECTED_TOTAL,
    levelCounts: {
      COUNTRY: 0,
      PROVINCE: 0,
      REGENCY_CITY: 0,
      DISTRICT: 0,
      VILLAGE: 0,
    },
    duplicateCodeCount: 0,
    missingParentCount: 0,
    illegalParentLevelCount: 0,
    plannedCreate: NATIONAL_REGION_EXPECTED_TOTAL,
    plannedReuse: 0,
    plannedConflict: 0,
    conflictReasonCounts: {},
    ...overrides,
  };
}

function completePlan(): NationalRegionProductionPlan {
  return plan({
    regionTotal: NATIONAL_REGION_EXPECTED_TOTAL,
    levelCounts: { ...NATIONAL_REGION_EXPECTED_COVERAGE },
    plannedCreate: 0,
    plannedReuse: NATIONAL_REGION_EXPECTED_TOTAL,
  });
}

function client(liveDatabase = 'simprok_db'): NationalRegionProductionClient {
  return {
    $queryRawUnsafe: async <T>() =>
      [
        {
          current_database: liveDatabase,
          server_host: '127.0.0.1',
          server_port: 55432,
          current_role: 'simprok_app',
        },
      ] as T,
    $transaction: async () => {
      throw new Error('unexpected transaction');
    },
  };
}

function dependencies(
  plans: NationalRegionProductionPlan[],
  assessment: NationalRegionMasterAssessment = COMPLETE_ASSESSMENT,
): NationalRegionProductionDependencies & {
  applyMaster: jest.Mock;
  planCurrentState: jest.Mock;
} {
  const applyResult: NationalRegionApplyResult = {
    processed: NATIONAL_REGION_EXPECTED_TOTAL,
    total: NATIONAL_REGION_EXPECTED_TOTAL,
    created: plans[0]?.plannedCreate ?? 0,
    reused: plans[0]?.plannedReuse ?? 0,
    nationalMasterComplete: true,
  };
  return {
    loadDump: jest.fn(() => DUMP),
    assessMaster: jest.fn(() => assessment),
    verifyAuthority: verifyCanonicalReferenceAuthority,
    planReuse: jest.fn<Promise<NationalRegionReadOnlyPlanReport>, []>(),
    planCurrentState: jest
      .fn()
      .mockImplementation(async () => plans.shift() ?? completePlan()),
    applyMaster: jest.fn(async () => applyResult),
  };
}

describe('national Region production door mode and confirmation', () => {
  it('accepts exactly one explicit mode', () => {
    expect(parseNationalRegionProductionMode(['--dry-run'])).toBe('dry-run');
    expect(parseNationalRegionProductionMode(['--apply'])).toBe('apply');
  });

  it.each([
    { argv: [] },
    { argv: ['--dry-run', '--apply'] },
    { argv: ['--apply', '--other'] },
  ])('rejects invalid mode arguments $argv', ({ argv }) => {
    expect(() => parseNationalRegionProductionMode(argv)).toThrow(
      'STOP_INVALID_MODE',
    );
  });

  it('reads and removes the explicit operator confirmation from the environment', () => {
    const env: NodeJS.ProcessEnv = {
      [NATIONAL_REGION_PRODUCTION_CONFIRMATION_ENV]: REGION_CONFIRMATION_TOKEN,
    };
    expect(readProductionConfirmation(env)).toBe(REGION_CONFIRMATION_TOKEN);
    expect(env[NATIONAL_REGION_PRODUCTION_CONFIRMATION_ENV]).toBeUndefined();
  });
});

describe('national Region production door exact database guard', () => {
  it.each([
    ['E2E', 'simprok_e2e'],
    ['acceptance', 'simprok_test'],
    ['other', 'another_database'],
  ])(
    'rejects the %s database before loading the master',
    async (_, database) => {
      const deps = dependencies([plan()]);
      await expect(
        runNationalRegionProductionDoor({
          mode: 'dry-run',
          repoRoot: 'unused',
          databaseUrl: `postgresql://u:p@127.0.0.1:55432/${database}`,
          client: client(database),
          dependencies: deps,
        }),
      ).rejects.toThrow(
        /STOP_(NON_CANONICAL_DATABASE_REFUSED|CANONICAL_DATABASE_MISMATCH)/,
      );
      expect(deps.loadDump).not.toHaveBeenCalled();
    },
  );

  it('also proves the live target instead of trusting a canonical-looking URL', async () => {
    const deps = dependencies([plan()]);
    await expect(
      runNationalRegionProductionDoor({
        mode: 'dry-run',
        repoRoot: 'unused',
        databaseUrl: CANONICAL_DATABASE_URL,
        client: client('simprok_e2e'),
        dependencies: deps,
      }),
    ).rejects.toThrow('STOP_NON_CANONICAL_DATABASE_REFUSED');
    expect(deps.loadDump).not.toHaveBeenCalled();
  });
});

describe('national Region production door read-only planning', () => {
  const rows: RegionRow[] = [
    {
      id: 'country',
      code: 'ID',
      name: 'Indonesia',
      isActive: true,
      parentId: null,
      administrativeLevel: 'COUNTRY',
    },
    {
      id: 'province',
      code: '94',
      name: 'Papua',
      isActive: true,
      parentId: 'country',
      administrativeLevel: 'PROVINCE',
    },
  ];

  it('uses a repeatable-read, transactionally read-only snapshot and canonical planner', async () => {
    const executed: string[] = [];
    const planReuse = jest.fn(async () => ({
      plannedCreate: 0,
      plannedReuse: 2,
      plannedConflict: 0,
      conflictReasonCounts: {},
    }));
    const fake: NationalRegionProductionClient = {
      $queryRawUnsafe: async <T>() => [] as T,
      $transaction: async (run, options) => {
        expect(options).toEqual({
          isolationLevel: 'RepeatableRead',
          maxWait: 10_000,
          timeout: 120_000,
        });
        return run({
          $executeRawUnsafe: async (sql) => {
            executed.push(sql);
            return 0;
          },
          $queryRawUnsafe: async <T>(sql: string) => {
            executed.push(sql);
            return [{ transaction_read_only: 'on' }] as T;
          },
          region: { findMany: async () => rows },
        });
      },
    };

    await expect(
      planCurrentNationalRegionStateReadOnly({
        client: fake,
        designations: [DESIGNATION, DESIGNATION],
        planReuse,
      }),
    ).resolves.toMatchObject({
      transactionReadOnly: 'on',
      regionTotal: 2,
      plannedReuse: 2,
      prospectiveRegionTotal: 2,
    });
    expect(executed).toEqual([
      'SET TRANSACTION READ ONLY',
      'SHOW transaction_read_only',
    ]);
    expect(planReuse).toHaveBeenCalledWith({
      designations: [DESIGNATION, DESIGNATION],
      rows,
    });
  });

  it('fails closed when PostgreSQL does not confirm read-only mode', async () => {
    const fake: NationalRegionProductionClient = {
      $queryRawUnsafe: async <T>() => [] as T,
      $transaction: async (run) =>
        run({
          $executeRawUnsafe: async () => 0,
          $queryRawUnsafe: async <T>() =>
            [{ transaction_read_only: 'off' }] as T,
          region: { findMany: async () => [] },
        }),
    };
    await expect(
      planCurrentNationalRegionStateReadOnly({
        client: fake,
        designations: [],
        planReuse: async () => ({
          plannedCreate: 0,
          plannedReuse: 0,
          plannedConflict: 0,
          conflictReasonCounts: {},
        }),
      }),
    ).rejects.toThrow('STOP_READ_ONLY_TRANSACTION_NOT_CONFIRMED');
  });
});

describe('national Region production door master/apply law', () => {
  it('blocks an absent or incomplete master before planning', async () => {
    const incomplete: NationalRegionMasterAssessment = {
      ...COMPLETE_ASSESSMENT,
      status: 'BLOCKED',
      reasonCode: NATIONAL_MASTER_INCOMPLETE,
      nationalMasterComplete: false,
      designations: [],
    };
    const deps = dependencies([plan()], incomplete);
    deps.loadDump.mockReturnValue(null);
    await expect(
      runNationalRegionProductionDoor({
        mode: 'dry-run',
        repoRoot: 'unused',
        databaseUrl: CANONICAL_DATABASE_URL,
        client: client(),
        dependencies: deps,
      }),
    ).rejects.toThrow('STOP_NATIONAL_REGION_MASTER_NOT_COMPLETE');
    expect(deps.planCurrentState).not.toHaveBeenCalled();
  });

  it('blocks a master integrity failure before planning or applying', async () => {
    const invalid: NationalRegionMasterAssessment = {
      ...COMPLETE_ASSESSMENT,
      status: 'BLOCKED',
      reasonCode: NATIONAL_MASTER_INTEGRITY,
      nationalMasterComplete: false,
      integrityErrors: ['PARENT_LEVEL_MISMATCH:94.01'],
      designations: [],
    };
    const deps = dependencies([plan()], invalid);
    await expect(
      runNationalRegionProductionDoor({
        mode: 'apply',
        repoRoot: 'unused',
        databaseUrl: CANONICAL_DATABASE_URL,
        confirmationToken: REGION_CONFIRMATION_TOKEN,
        client: client(),
        dependencies: deps,
      }),
    ).rejects.toThrow(
      `STOP_NATIONAL_REGION_MASTER_NOT_COMPLETE:${NATIONAL_MASTER_INTEGRITY}`,
    );
    expect(deps.planCurrentState).not.toHaveBeenCalled();
    expect(deps.applyMaster).not.toHaveBeenCalled();
  });

  it('keeps dry-run read-only and never delegates to the writer', async () => {
    const deps = dependencies([plan()]);
    const result = await runNationalRegionProductionDoor({
      mode: 'dry-run',
      repoRoot: 'unused',
      databaseUrl: CANONICAL_DATABASE_URL,
      client: client(),
      dependencies: deps,
    });
    expect(result.applyResult).toBeNull();
    expect(result.planAfter).toBeNull();
    expect(deps.applyMaster).not.toHaveBeenCalled();
  });

  it('blocks canonical planner conflicts before confirmation or apply', async () => {
    const deps = dependencies([
      plan({
        plannedCreate: NATIONAL_REGION_EXPECTED_TOTAL - 1,
        plannedConflict: 1,
        conflictReasonCounts: { STOP_REGION_CODE_CONFLICT: 1 },
      }),
    ]);
    await expect(
      runNationalRegionProductionDoor({
        mode: 'apply',
        repoRoot: 'unused',
        databaseUrl: CANONICAL_DATABASE_URL,
        confirmationToken: REGION_CONFIRMATION_TOKEN,
        client: client(),
        dependencies: deps,
      }),
    ).rejects.toThrow('STOP_NATIONAL_REGION_CONFLICT');
    expect(deps.applyMaster).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', undefined, 'STOP_MISSING_PRODUCTION_CONFIRMATION'],
    ['wrong', 'not-the-canonical-token', 'STOP_WRONG_PRODUCTION_CONFIRMATION'],
  ])('blocks %s confirmation', async (_, confirmationToken, reason) => {
    const deps = dependencies([plan()]);
    await expect(
      runNationalRegionProductionDoor({
        mode: 'apply',
        repoRoot: 'unused',
        databaseUrl: CANONICAL_DATABASE_URL,
        confirmationToken,
        client: client(),
        dependencies: deps,
      }),
    ).rejects.toThrow(reason);
    expect(deps.applyMaster).not.toHaveBeenCalled();
  });

  it('delegates a confirmed apply only to the existing national orchestrator and canonical token', async () => {
    const deps = dependencies([plan(), completePlan()]);
    await expect(
      runNationalRegionProductionDoor({
        mode: 'apply',
        repoRoot: 'unused',
        databaseUrl: CANONICAL_DATABASE_URL,
        confirmationToken: REGION_CONFIRMATION_TOKEN,
        client: client(),
        dependencies: deps,
      }),
    ).resolves.toMatchObject({
      mode: 'apply',
      planAfter: { plannedCreate: 0, plannedReuse: 91_600 },
    });
    expect(deps.applyMaster).toHaveBeenCalledTimes(1);
    expect(deps.applyMaster.mock.calls[0][0]).toMatchObject({
      dump: DUMP,
      confirmationToken: REGION_CONFIRMATION_TOKEN,
      expectedConfirmationToken: REGION_CONFIRMATION_TOKEN,
    });
  });

  it('protects an idempotent rerun through canonical reuse rather than a count-based skip', async () => {
    const alreadyComplete = completePlan();
    const deps = dependencies([alreadyComplete, alreadyComplete]);
    const result = await runNationalRegionProductionDoor({
      mode: 'apply',
      repoRoot: 'unused',
      databaseUrl: CANONICAL_DATABASE_URL,
      confirmationToken: REGION_CONFIRMATION_TOKEN,
      client: client(),
      dependencies: deps,
    });
    expect(result.planBefore.plannedReuse).toBe(91_600);
    expect(deps.applyMaster).toHaveBeenCalledTimes(1);
  });

  it('permits a conflict-free partial canonical state to resume and demands complete reuse afterward', async () => {
    const partial = plan({
      regionTotal: 2,
      plannedCreate: 91_598,
      plannedReuse: 2,
    });
    const deps = dependencies([partial, completePlan()]);
    await expect(
      runNationalRegionProductionDoor({
        mode: 'apply',
        repoRoot: 'unused',
        databaseUrl: CANONICAL_DATABASE_URL,
        confirmationToken: REGION_CONFIRMATION_TOKEN,
        client: client(),
        dependencies: deps,
      }),
    ).resolves.toMatchObject({
      planBefore: { plannedCreate: 91_598, plannedReuse: 2 },
      planAfter: { plannedCreate: 0, plannedReuse: 91_600 },
    });
  });

  it('blocks unrelated legacy rows before apply rather than deleting or rewriting them', () => {
    expect(() =>
      assertNationalRegionApplyPreconditions(
        plan({
          regionTotal: 2,
          plannedCreate: 91_600,
          prospectiveRegionTotal: 91_602,
        }),
      ),
    ).toThrow('STOP_NATIONAL_REGION_PROSPECTIVE_TOTAL');
  });
});

describe('national Region production door exact post-apply verification', () => {
  it('accepts only the exact complete state and second canonical all-reuse plan', () => {
    expect(() => assertNationalRegionPostApply(completePlan())).not.toThrow();
    expect(() => assertNationalRegionPostApply(completePlan())).not.toThrow();
  });

  it.each([
    ['total', { regionTotal: 91_599 }],
    ['duplicate code', { duplicateCodeCount: 1 }],
    ['missing parent', { missingParentCount: 1 }],
    ['illegal parent', { illegalParentLevelCount: 1 }],
    ['not idempotent', { plannedCreate: 1, plannedReuse: 91_599 }],
  ])('rejects a post-apply %s mismatch', (_, overrides) => {
    expect(() =>
      assertNationalRegionPostApply(plan({ ...completePlan(), ...overrides })),
    ).toThrow();
  });

  it('derives structural counts from the read-only Region snapshot', () => {
    const rows: RegionRow[] = [
      {
        id: 'country',
        code: 'ID',
        name: 'Indonesia',
        isActive: true,
        parentId: null,
        administrativeLevel: 'COUNTRY',
      },
      {
        id: 'province',
        code: '94',
        name: 'Papua',
        isActive: true,
        parentId: 'country',
        administrativeLevel: 'PROVINCE',
      },
      {
        id: 'orphan',
        code: '95',
        name: 'Orphan',
        isActive: true,
        parentId: 'missing',
        administrativeLevel: 'PROVINCE',
      },
      {
        id: 'wrong-parent',
        code: '94.01',
        name: 'Wrong parent',
        isActive: true,
        parentId: 'country',
        administrativeLevel: 'REGENCY_CITY',
      },
      {
        id: 'duplicate',
        code: '94',
        name: 'Duplicate code',
        isActive: true,
        parentId: 'country',
        administrativeLevel: 'PROVINCE',
      },
    ];
    expect(summarizeNationalRegionSnapshot(rows)).toMatchObject({
      regionTotal: 5,
      duplicateCodeCount: 1,
      missingParentCount: 1,
      illegalParentLevelCount: 1,
    });
  });
});

describe('national Region production door static anti-duplication law', () => {
  const moduleSource = readFileSync(
    join(__dirname, 'region-national-production-door.ts'),
    'utf8',
  );
  const scriptSource = readFileSync(
    join(
      __dirname,
      '..',
      '..',
      'scripts',
      'bp-reg01',
      'national-region-master-production.ts',
    ),
    'utf8',
  );
  const combined = `${moduleSource}\n${scriptSource}`;

  it('contains no direct Region create/update/delete/upsert or raw mutation', () => {
    expect(combined).not.toMatch(
      /\.region\.(create|update|delete|upsert)\s*\(/,
    );
    expect(combined).not.toMatch(
      /\b(INSERT|UPDATE|DELETE|TRUNCATE)\s+(INTO|FROM|TABLE)?\s*regions\b/i,
    );
  });

  it('reuses the canonical gate, planner, national orchestrator, and confirmation authority', () => {
    expect(moduleSource).toContain('assessNationalRegionMaster');
    expect(moduleSource).toContain('planNationalRegionReuseReadOnly');
    expect(moduleSource).toContain('applyNationalRegionMaster');
    expect(moduleSource).toContain('REGION_CONFIRMATION_TOKEN');
  });

  it('does not import E2E guards or load test environment files', () => {
    expect(combined).not.toContain('verifyE2EDatabase');
    expect(combined).not.toMatch(/\.env\.(e2e|test)/);
    expect(combined).not.toMatch(/dotenv/);
  });

  it('keeps the CLI as import-safe orchestration', () => {
    expect(scriptSource).toMatch(/require\.main === module/);
    expect(scriptSource).toContain('runNationalRegionProductionDoor');
    expect(CANONICAL_REFERENCE_WORKSPACE_ID).toBe(
      'a9978fab-d1fc-4bb3-9beb-5d8b89d973e3',
    );
  });
});
