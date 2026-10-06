import {
  NATIONAL_MASTER_READY_FOR_APPLY,
  assessNationalRegionMaster,
  type NationalRegionDump,
} from './region-national-master.gate';
import {
  applyRegionPlan,
  buildRegionPlan,
  computeRegionPlanHash,
  type RegionPrismaLike,
  type RegionQueryClient,
} from './region-provisioner';

export type NationalRegionPrismaLike = RegionPrismaLike & RegionQueryClient;

export interface NationalRegionApplyProgress {
  processed: number;
  total: number;
  created: number;
  reused: number;
}

export interface NationalRegionApplyResult extends NationalRegionApplyProgress {
  nationalMasterComplete: true;
}

/**
 * Activates the official national dump through the existing governed Region
 * writer. This is orchestration only: it owns no INSERT/UPDATE/DELETE path.
 * Parent-first order comes from the national-master gate; the one Region
 * writer owns planning, hashing, locking, conflict checks and readback.
 */
export async function applyNationalRegionMaster(params: {
  prisma: NationalRegionPrismaLike;
  dump: NationalRegionDump;
  confirmationToken: string;
  expectedConfirmationToken: string;
  onProgress?: (progress: NationalRegionApplyProgress) => void;
}): Promise<NationalRegionApplyResult> {
  const assessment = assessNationalRegionMaster(params.dump);
  if (
    assessment.status !== 'READY_FOR_APPLY' ||
    assessment.reasonCode !== NATIONAL_MASTER_READY_FOR_APPLY ||
    !assessment.nationalMasterComplete
  ) {
    throw new Error(
      `STOP_NATIONAL_REGION_MASTER_NOT_COMPLETE:${assessment.reasonCode}`,
    );
  }

  const total = assessment.designations.length;
  let processed = 0;
  let created = 0;
  let reused = 0;
  for (const designation of assessment.designations) {
    const reviewedPlan = await buildRegionPlan(params.prisma, designation);
    const applied = await applyRegionPlan(params.prisma, {
      ...designation,
      expectedPlanSha256: computeRegionPlanHash(reviewedPlan),
      confirmationToken: params.confirmationToken,
      expectedConfirmationToken: params.expectedConfirmationToken,
    });
    processed += 1;
    created += applied.regionCreatedDelta;
    reused += applied.regionReusedDelta;
    params.onProgress?.({ processed, total, created, reused });
  }

  return {
    processed,
    total,
    created,
    reused,
    nationalMasterComplete: true,
  };
}
