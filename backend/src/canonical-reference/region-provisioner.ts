import { createHash } from 'node:crypto';

/**
 * RM-03D0 — the smallest governed Region provisioner.
 *
 * Region is REFERENCE DATA, not a user-editable entity. This module is
 * therefore deliberately NOT CRUD: it can bring one explicitly designated
 * Region into existence and it can recognise that Region already exists. It
 * cannot rename, cannot deactivate, cannot delete, and cannot guess.
 *
 * NOTHING here infers a location. The code and name are supplied by the Owner
 * as explicit inputs and are copied verbatim. No file name, project name,
 * organization name, workspace name, locale, timezone or IP is ever consulted
 * — an inferred region would be a fabricated fact about the real world.
 *
 * Shape follows the reviewed RM-02C1b planner on purpose: pure plan → canonical
 * JSON → SHA-256 → apply gated on that exact hash, under an advisory lock, in
 * one transaction. Same discipline, so operators read one pattern, not two.
 */

export const REGION_PLAN_CONTRACT_VERSION = 'RM03D0_REGION_PLAN_V1';

export type RegionDisposition = 'CREATE_REGION' | 'REUSE_EXACT_REGION';

export class RegionProvisionError extends Error {
  constructor(
    public readonly reasonCode: string,
    detail: string,
  ) {
    super(`${reasonCode}: ${detail}`);
    this.name = 'RegionProvisionError';
  }
}

export interface RegionDesignation {
  regionCode: string;
  regionName: string;
}

export interface RegionRow {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

export interface RegionPlan {
  planContractVersion: typeof REGION_PLAN_CONTRACT_VERSION;
  regionCode: string;
  regionName: string;
  disposition: RegionDisposition;
  /** Non-null only for REUSE_EXACT_REGION. */
  existingRegionId: string | null;
  expectedCreateCount: number;
  expectedReuseCount: number;
}

/** Structural read surface — a test supplies a plain object, never a database. */
export interface RegionQueryClient {
  region: {
    findMany(args: {
      where: { OR: Array<{ code: string } | { name: string }> };
      select: { id: true; code: true; name: true; isActive: true };
    }): Promise<RegionRow[]>;
  };
}

/**
 * Designations are copied verbatim, so they must arrive clean. Trimming or
 * case-folding on the Owner's behalf would silently alter a designated fact.
 */
export function assertRegionDesignation(
  designation: RegionDesignation,
): RegionDesignation {
  const { regionCode, regionName } = designation;
  if (typeof regionCode !== 'string' || regionCode.length === 0) {
    throw new RegionProvisionError(
      'STOP_REGION_CODE_REQUIRED',
      'An explicit REGION_CODE is required; it is never derived or guessed.',
    );
  }
  if (typeof regionName !== 'string' || regionName.length === 0) {
    throw new RegionProvisionError(
      'STOP_REGION_NAME_REQUIRED',
      'An explicit REGION_NAME is required; it is never derived or guessed.',
    );
  }
  if (regionCode !== regionCode.trim() || regionName !== regionName.trim()) {
    throw new RegionProvisionError(
      'STOP_REGION_DESIGNATION_NOT_NORMALISED',
      'REGION_CODE and REGION_NAME must not carry leading or trailing whitespace; this module will not silently rewrite a designated value.',
    );
  }
  return { regionCode, regionName };
}

/**
 * Pure planning. Reads nothing but the two candidate rows, writes nothing.
 *
 * Conflict law — every one of these is a STOP, never a repair:
 *   - same code, different name   → the designation contradicts stored truth
 *   - same name, different code   → the same place would exist twice
 *   - exact match but inactive    → reusing a retired region is not reuse
 */
export async function buildRegionPlan(
  client: RegionQueryClient,
  designation: RegionDesignation,
): Promise<RegionPlan> {
  const { regionCode, regionName } = assertRegionDesignation(designation);

  const candidates = await client.region.findMany({
    where: { OR: [{ code: regionCode }, { name: regionName }] },
    select: { id: true, code: true, name: true, isActive: true },
  });

  const byCode = candidates.find((row) => row.code === regionCode);
  const byName = candidates.find((row) => row.name === regionName);

  if (byCode && byCode.name !== regionName) {
    throw new RegionProvisionError(
      'STOP_REGION_CODE_CONFLICT',
      `Region code "${regionCode}" already exists with a different name. Refusing to rename an existing canonical reference.`,
    );
  }
  if (byName && byName.code !== regionCode) {
    throw new RegionProvisionError(
      'STOP_REGION_NAME_CONFLICT',
      `Region name "${regionName}" already exists under a different code. Refusing to create a second region for the same place.`,
    );
  }
  if (byCode && !byCode.isActive) {
    throw new RegionProvisionError(
      'STOP_REGION_INACTIVE_CONFLICT',
      `Region code "${regionCode}" exists but is inactive. Reactivation is a separate governed decision, not a provisioning side effect.`,
    );
  }

  if (byCode) {
    return {
      planContractVersion: REGION_PLAN_CONTRACT_VERSION,
      regionCode,
      regionName,
      disposition: 'REUSE_EXACT_REGION',
      existingRegionId: byCode.id,
      expectedCreateCount: 0,
      expectedReuseCount: 1,
    };
  }

  return {
    planContractVersion: REGION_PLAN_CONTRACT_VERSION,
    regionCode,
    regionName,
    disposition: 'CREATE_REGION',
    existingRegionId: null,
    expectedCreateCount: 1,
    expectedReuseCount: 0,
  };
}

/**
 * Stable key order, so the same plan always hashes to the same value on any
 * machine. `existingRegionId` participates: reusing a DIFFERENT existing row
 * is a materially different plan and must not share a hash.
 */
export function canonicalRegionPlanJson(plan: RegionPlan): string {
  return JSON.stringify(
    {
      planContractVersion: plan.planContractVersion,
      regionCode: plan.regionCode,
      regionName: plan.regionName,
      disposition: plan.disposition,
      existingRegionId: plan.existingRegionId,
      expectedCreateCount: plan.expectedCreateCount,
      expectedReuseCount: plan.expectedReuseCount,
    },
    null,
    2,
  );
}

export function computeRegionPlanHash(plan: RegionPlan): string {
  return createHash('sha256')
    .update(canonicalRegionPlanJson(plan))
    .digest('hex')
    .toUpperCase();
}

export interface RegionApplyParams extends RegionDesignation {
  expectedPlanSha256: string;
  confirmationToken: string;
  expectedConfirmationToken: string;
}

export interface RegionApplyResult {
  plan: RegionPlan;
  planSha256: string;
  regionId: string;
  regionCreatedDelta: number;
  regionReusedDelta: number;
}

export interface RegionTransactionClient extends RegionQueryClient {
  region: RegionQueryClient['region'] & {
    create(args: {
      data: { code: string; name: string };
      select: { id: true; code: true; name: true; isActive: true };
    }): Promise<RegionRow>;
  };
  $executeRawUnsafe(sql: string): Promise<number>;
}

export interface RegionPrismaLike {
  $transaction<T>(fn: (tx: RegionTransactionClient) => Promise<T>): Promise<T>;
}

/** Deterministic advisory-lock key, mirroring the RM-02C1b planner's approach. */
export function regionAdvisoryLockKey(regionCode: string): bigint {
  const digest = createHash('sha256')
    .update(`rm03d0-region|${regionCode}`)
    .digest('hex');
  // First 60 bits: always non-negative, fits Postgres bigint and JS BigInt.
  return BigInt(`0x${digest.slice(0, 15)}`);
}

/**
 * Applies exactly the plan the operator reviewed, or nothing.
 *
 * The plan is REBUILT inside the transaction and re-hashed. A plan computed
 * against a state that has since changed will not match, and the apply stops
 * — that is what makes a reviewed hash meaningful rather than decorative.
 */
export async function applyRegionPlan(
  prisma: RegionPrismaLike,
  params: RegionApplyParams,
  knownConfirmationTokens: readonly string[],
): Promise<RegionApplyResult> {
  if (!knownConfirmationTokens.includes(params.expectedConfirmationToken)) {
    throw new RegionProvisionError(
      'STOP_UNKNOWN_CONFIRMATION_AUTHORITY',
      'expectedConfirmationToken is not a recognised confirmation authority.',
    );
  }
  if (params.confirmationToken !== params.expectedConfirmationToken) {
    throw new RegionProvisionError(
      'STOP_MISSING_CONFIRMATION_TOKEN',
      `Refusing to apply: confirmationToken must be exactly "${params.expectedConfirmationToken}".`,
    );
  }
  if (!params.expectedPlanSha256) {
    throw new RegionProvisionError(
      'STOP_MISSING_EXPECTED_PLAN_HASH',
      'Refusing to apply without an explicit expectedPlanSha256 from a reviewed dry-run.',
    );
  }

  return prisma.$transaction(async (tx) => {
    const lockKey = regionAdvisoryLockKey(params.regionCode);
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${lockKey})`);

    const plan = await buildRegionPlan(tx, {
      regionCode: params.regionCode,
      regionName: params.regionName,
    });
    const planSha256 = computeRegionPlanHash(plan);

    if (planSha256 !== params.expectedPlanSha256) {
      throw new RegionProvisionError(
        'STOP_PLAN_HASH_MISMATCH',
        'The live plan no longer matches the reviewed plan hash; canonical state changed since the dry-run.',
      );
    }

    if (plan.disposition === 'REUSE_EXACT_REGION') {
      // Idempotent re-run: the designated Region already exists exactly as
      // designated. Nothing is written — not even a touch of updatedAt.
      return {
        plan,
        planSha256,
        regionId: plan.existingRegionId as string,
        regionCreatedDelta: 0,
        regionReusedDelta: 1,
      };
    }

    const created = await tx.region.create({
      data: { code: plan.regionCode, name: plan.regionName },
      select: { id: true, code: true, name: true, isActive: true },
    });

    // Read back what the database actually stored, rather than trusting the
    // values we sent.
    if (created.code !== plan.regionCode || created.name !== plan.regionName) {
      throw new RegionProvisionError(
        'STOP_REGION_WRITE_READBACK_MISMATCH',
        'The created Region does not match the designated code/name.',
      );
    }

    return {
      plan,
      planSha256,
      regionId: created.id,
      regionCreatedDelta: 1,
      regionReusedDelta: 0,
    };
  });
}
