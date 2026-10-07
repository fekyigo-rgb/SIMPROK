import {
  CANONICAL_REFERENCE_WORKSPACE_ID,
  verifyCanonicalReferenceAuthority,
  type CanonicalReferenceAuthority,
} from './canonical-reference-target';
import {
  NATIONAL_MASTER_READY_FOR_APPLY,
  NATIONAL_REGION_DUMP_CONTRACT,
  NATIONAL_REGION_EXPECTED_COVERAGE,
  assessNationalRegionMaster,
  tryLoadNationalRegionDump,
  type NationalRegionCoverage,
  type NationalRegionDump,
  type NationalRegionMasterAssessment,
} from './region-national-master.gate';
import {
  applyNationalRegionMaster,
  type NationalRegionApplyProgress,
  type NationalRegionApplyResult,
  type NationalRegionPrismaLike,
} from './region-national-master.provisioner';
import {
  planNationalRegionReuseReadOnly,
  type NationalRegionReadOnlyPlanReport,
} from './region-national-master.readonly-verifier';
import {
  REGION_CONFIRMATION_TOKEN,
  type RegionAdministrativeLevel,
  type RegionRow,
} from './region-provisioner';

export type NationalRegionProductionMode = 'dry-run' | 'apply';

export const NATIONAL_REGION_PRODUCTION_CONFIRMATION_ENV =
  'RM03D0_CONFIRMATION_TOKEN';

export const NATIONAL_REGION_EXPECTED_TOTAL = Object.values(
  NATIONAL_REGION_EXPECTED_COVERAGE,
).reduce((sum, count) => sum + count, 0);

const LEVELS = [
  'COUNTRY',
  'PROVINCE',
  'REGENCY_CITY',
  'DISTRICT',
  'VILLAGE',
] as const satisfies readonly RegionAdministrativeLevel[];

export interface NationalRegionSnapshotSummary {
  regionTotal: number;
  levelCounts: NationalRegionCoverage;
  duplicateCodeCount: number;
  missingParentCount: number;
  illegalParentLevelCount: number;
}

export interface NationalRegionProductionPlan
  extends NationalRegionReadOnlyPlanReport, NationalRegionSnapshotSummary {
  transactionReadOnly: string;
  designationCount: number;
  prospectiveRegionTotal: number;
}

interface NationalRegionReadTransaction {
  $executeRawUnsafe(sql: string): Promise<number>;
  $queryRawUnsafe<T>(sql: string): Promise<T>;
  region: {
    findMany(args: {
      select: {
        id: true;
        code: true;
        name: true;
        isActive: true;
        parentId: true;
        administrativeLevel: true;
      };
    }): Promise<RegionRow[]>;
  };
}

export interface NationalRegionProductionClient {
  $queryRawUnsafe<T>(sql: string): Promise<T>;
  $transaction<T>(
    run: (tx: NationalRegionReadTransaction) => Promise<T>,
    options?: {
      isolationLevel: 'RepeatableRead';
      maxWait: number;
      timeout: number;
    },
  ): Promise<T>;
}

export interface NationalRegionProductionDependencies {
  loadDump(repoRoot: string): NationalRegionDump | null;
  assessMaster(dump: NationalRegionDump | null): NationalRegionMasterAssessment;
  verifyAuthority: typeof verifyCanonicalReferenceAuthority;
  planReuse: typeof planNationalRegionReuseReadOnly;
  planCurrentState: typeof planCurrentNationalRegionStateReadOnly;
  applyMaster: typeof applyNationalRegionMaster;
}

const DEFAULT_DEPENDENCIES: NationalRegionProductionDependencies = {
  loadDump: tryLoadNationalRegionDump,
  assessMaster: assessNationalRegionMaster,
  verifyAuthority: verifyCanonicalReferenceAuthority,
  planReuse: planNationalRegionReuseReadOnly,
  planCurrentState: planCurrentNationalRegionStateReadOnly,
  applyMaster: applyNationalRegionMaster,
};

export interface RunNationalRegionProductionDoorParams {
  mode: NationalRegionProductionMode;
  repoRoot: string;
  databaseUrl: string | undefined;
  confirmationToken?: string;
  client: NationalRegionProductionClient;
  onProgress?: (progress: NationalRegionApplyProgress) => void;
  dependencies?: NationalRegionProductionDependencies;
}

export interface NationalRegionProductionDoorResult {
  mode: NationalRegionProductionMode;
  authority: CanonicalReferenceAuthority;
  assessment: NationalRegionMasterAssessment;
  planBefore: NationalRegionProductionPlan;
  applyResult: NationalRegionApplyResult | null;
  planAfter: NationalRegionProductionPlan | null;
}

export function parseNationalRegionProductionMode(
  argv: readonly string[],
): NationalRegionProductionMode {
  const hasDryRun = argv.includes('--dry-run');
  const hasApply = argv.includes('--apply');
  if (argv.length !== 1 || hasDryRun === hasApply) {
    throw new Error(
      'STOP_INVALID_MODE: pass exactly one of --dry-run or --apply',
    );
  }
  return hasApply ? 'apply' : 'dry-run';
}

export function readProductionConfirmation(
  env: NodeJS.ProcessEnv,
): string | undefined {
  const confirmation = env[NATIONAL_REGION_PRODUCTION_CONFIRMATION_ENV];
  delete env[NATIONAL_REGION_PRODUCTION_CONFIRMATION_ENV];
  return confirmation;
}

export function summarizeNationalRegionSnapshot(
  rows: readonly RegionRow[],
): NationalRegionSnapshotSummary {
  const levelCounts: NationalRegionCoverage = {
    COUNTRY: 0,
    PROVINCE: 0,
    REGENCY_CITY: 0,
    DISTRICT: 0,
    VILLAGE: 0,
  };
  const byId = new Map(rows.map((row) => [row.id, row]));
  const codeCounts = new Map<string, number>();
  let missingParentCount = 0;
  let illegalParentLevelCount = 0;

  for (const row of rows) {
    codeCounts.set(row.code, (codeCounts.get(row.code) ?? 0) + 1);
    if (row.isActive && row.administrativeLevel) {
      levelCounts[row.administrativeLevel] += 1;
    }

    const level = row.administrativeLevel;
    if (!level || level === 'COUNTRY') continue;
    const parent = row.parentId ? byId.get(row.parentId) : undefined;
    if (!parent) {
      missingParentCount += 1;
      continue;
    }
    if (
      parent.administrativeLevel !==
      NATIONAL_REGION_DUMP_CONTRACT.parentOf[level]
    ) {
      illegalParentLevelCount += 1;
    }
  }

  return {
    regionTotal: rows.length,
    levelCounts,
    duplicateCodeCount: [...codeCounts.values()].filter((count) => count > 1)
      .length,
    missingParentCount,
    illegalParentLevelCount,
  };
}

export async function planCurrentNationalRegionStateReadOnly(params: {
  client: NationalRegionProductionClient;
  designations: NationalRegionMasterAssessment['designations'];
  planReuse?: typeof planNationalRegionReuseReadOnly;
}): Promise<NationalRegionProductionPlan> {
  const planReuse = params.planReuse ?? planNationalRegionReuseReadOnly;
  return params.client.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      const rows = await tx.region.findMany({
        select: {
          id: true,
          code: true,
          name: true,
          isActive: true,
          parentId: true,
          administrativeLevel: true,
        },
      });
      const plan = await planReuse({
        designations: params.designations,
        rows,
      });
      const readOnly = await tx.$queryRawUnsafe<
        Array<{ transaction_read_only: string }>
      >('SHOW transaction_read_only');
      const transactionReadOnly =
        readOnly[0]?.transaction_read_only ?? 'unknown';
      if (transactionReadOnly !== 'on') {
        throw new Error(
          'STOP_READ_ONLY_TRANSACTION_NOT_CONFIRMED: national Region planning must run in a read-only transaction.',
        );
      }
      const summary = summarizeNationalRegionSnapshot(rows);
      return {
        transactionReadOnly,
        designationCount: params.designations.length,
        ...summary,
        ...plan,
        prospectiveRegionTotal: summary.regionTotal + plan.plannedCreate,
      };
    },
    {
      isolationLevel: 'RepeatableRead',
      maxWait: 10_000,
      timeout: 120_000,
    },
  );
}

export function assertNationalMasterReady(
  assessment: NationalRegionMasterAssessment,
): void {
  if (
    assessment.status !== 'READY_FOR_APPLY' ||
    assessment.reasonCode !== NATIONAL_MASTER_READY_FOR_APPLY ||
    !assessment.nationalMasterComplete ||
    assessment.designations.length !== NATIONAL_REGION_EXPECTED_TOTAL
  ) {
    throw new Error(
      `STOP_NATIONAL_REGION_MASTER_NOT_COMPLETE:${assessment.reasonCode}`,
    );
  }
  for (const level of LEVELS) {
    if (
      assessment.coverage[level] !== NATIONAL_REGION_EXPECTED_COVERAGE[level]
    ) {
      throw new Error('STOP_NATIONAL_REGION_MASTER_COVERAGE_MISMATCH');
    }
  }
}

export function assertNationalRegionApplyPreconditions(
  plan: NationalRegionProductionPlan,
): void {
  if (plan.plannedConflict !== 0) {
    throw new Error(
      `STOP_NATIONAL_REGION_CONFLICT:${JSON.stringify(plan.conflictReasonCounts)}`,
    );
  }
  if (
    plan.plannedCreate + plan.plannedReuse !== plan.designationCount ||
    plan.designationCount !== NATIONAL_REGION_EXPECTED_TOTAL
  ) {
    throw new Error('STOP_NATIONAL_REGION_PLAN_INCOMPLETE');
  }
  if (plan.prospectiveRegionTotal !== NATIONAL_REGION_EXPECTED_TOTAL) {
    throw new Error(
      `STOP_NATIONAL_REGION_PROSPECTIVE_TOTAL:${plan.prospectiveRegionTotal}`,
    );
  }
}

export function assertProductionConfirmation(
  confirmationToken: string | undefined,
): void {
  if (!confirmationToken) {
    throw new Error(
      `STOP_MISSING_PRODUCTION_CONFIRMATION: ${NATIONAL_REGION_PRODUCTION_CONFIRMATION_ENV} must be supplied explicitly.`,
    );
  }
  if (confirmationToken !== REGION_CONFIRMATION_TOKEN) {
    throw new Error('STOP_WRONG_PRODUCTION_CONFIRMATION');
  }
}

export function assertNationalRegionPostApply(
  plan: NationalRegionProductionPlan,
): void {
  if (plan.regionTotal !== NATIONAL_REGION_EXPECTED_TOTAL) {
    throw new Error(`STOP_REGION_TOTAL_MISMATCH:${plan.regionTotal}`);
  }
  for (const level of LEVELS) {
    if (plan.levelCounts[level] !== NATIONAL_REGION_EXPECTED_COVERAGE[level]) {
      throw new Error(`STOP_REGION_LEVEL_COUNT_MISMATCH:${level}`);
    }
  }
  if (plan.duplicateCodeCount !== 0) {
    throw new Error(`STOP_DUPLICATE_REGION_CODE:${plan.duplicateCodeCount}`);
  }
  if (plan.missingParentCount !== 0) {
    throw new Error(`STOP_MISSING_REGION_PARENT:${plan.missingParentCount}`);
  }
  if (plan.illegalParentLevelCount !== 0) {
    throw new Error(
      `STOP_ILLEGAL_REGION_PARENT_LEVEL:${plan.illegalParentLevelCount}`,
    );
  }
  if (
    plan.plannedCreate !== 0 ||
    plan.plannedReuse !== NATIONAL_REGION_EXPECTED_TOTAL ||
    plan.plannedConflict !== 0
  ) {
    throw new Error('STOP_NATIONAL_REGION_POST_APPLY_REUSE_MISMATCH');
  }
}

export async function runNationalRegionProductionDoor(
  params: RunNationalRegionProductionDoorParams,
): Promise<NationalRegionProductionDoorResult> {
  const dependencies = params.dependencies ?? DEFAULT_DEPENDENCIES;
  const authority = await dependencies.verifyAuthority({
    databaseUrl: params.databaseUrl,
    workspaceId: CANONICAL_REFERENCE_WORKSPACE_ID,
    requireWriterRole: params.mode === 'apply',
    client: {
      query: async (sql) => ({
        rows: await params.client.$queryRawUnsafe(sql),
      }),
    },
  });

  const dump = dependencies.loadDump(params.repoRoot);
  const assessment = dependencies.assessMaster(dump);
  assertNationalMasterReady(assessment);

  const planBefore = await dependencies.planCurrentState({
    client: params.client,
    designations: assessment.designations,
    planReuse: dependencies.planReuse,
  });

  if (params.mode === 'dry-run') {
    return {
      mode: params.mode,
      authority,
      assessment,
      planBefore,
      applyResult: null,
      planAfter: null,
    };
  }

  assertNationalRegionApplyPreconditions(planBefore);
  assertProductionConfirmation(params.confirmationToken);

  const applyResult = await dependencies.applyMaster({
    prisma: params.client as unknown as NationalRegionPrismaLike,
    dump: dump as NationalRegionDump,
    confirmationToken: REGION_CONFIRMATION_TOKEN,
    expectedConfirmationToken: REGION_CONFIRMATION_TOKEN,
    onProgress: params.onProgress,
  });
  const planAfter = await dependencies.planCurrentState({
    client: params.client,
    designations: assessment.designations,
    planReuse: dependencies.planReuse,
  });
  assertNationalRegionPostApply(planAfter);

  return {
    mode: params.mode,
    authority,
    assessment,
    planBefore,
    applyResult,
    planAfter,
  };
}
