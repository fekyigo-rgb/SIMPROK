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

/**
 * The ONE authority that may apply a Region plan — owned by this module, not
 * supplied by the caller.
 *
 * A caller-supplied allow-list would have meant the gate trusted whoever it
 * was defending against: a caller could widen the set to include a token it
 * had just invented. The closed set lives here so `applyRegionPlan` cannot be
 * talked into recognising anything else.
 *
 * There is no acceptance Region path — Region provisioning is an RM-03D0
 * canonical concept — so the RM-02C1b acceptance token is deliberately NOT a
 * member and can never authorize a Region write.
 *
 * THE GOVERNED REHEARSAL AUTHORITY IS A MEMBER, and for the same reason the
 * canonical one is. A rehearsal that cannot designate the Owner's actual region
 * cannot rehearse the Owner's journey: the only regions a rehearsal database
 * held were "Jakarta Selatan" provisioning fixtures, so a reviewer either saw a
 * place the source never named or was blocked outright. This module still
 * refuses to derive, guess, trim or case-fold a designation, and every conflict
 * law below is unchanged — a rehearsal designates the same real place, by the
 * same rules, through the same reviewed plan hash.
 *
 * Additive only. Each caller names the token it expects and must supply that
 * exact string, so no authority can stand in for another.
 */
export const REGION_CONFIRMATION_TOKEN = 'APPLY_RM03D0_CANONICAL_REFERENCES';
export const GOVERNED_REHEARSAL_REGION_CONFIRMATION_TOKEN =
  'APPLY_GOVERNED_REHEARSAL_REFERENCES';
export const KNOWN_REGION_CONFIRMATION_TOKENS: readonly string[] = [
  REGION_CONFIRMATION_TOKEN,
  GOVERNED_REHEARSAL_REGION_CONFIRMATION_TOKEN,
];

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

export type RegionAdministrativeLevel =
  | 'COUNTRY'
  | 'PROVINCE'
  | 'REGENCY_CITY'
  | 'DISTRICT'
  | 'VILLAGE';

export interface RegionDesignation {
  regionCode: string;
  regionName: string;
  /** Optional Kemendagri parent code. Omitted plans hash exactly as before. */
  parentRegionCode?: string;
  administrativeLevel?: RegionAdministrativeLevel;
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
  parentRegionId?: string;
  administrativeLevel?: RegionAdministrativeLevel;
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

async function resolveRegionHierarchy(
  client: RegionQueryClient,
  designation: RegionDesignation,
): Promise<Pick<RegionPlan, 'parentRegionId' | 'administrativeLevel'>> {
  const parentRegionCode = designation.parentRegionCode;
  const administrativeLevel = designation.administrativeLevel;
  if (parentRegionCode !== undefined) {
    if (typeof parentRegionCode !== 'string' || parentRegionCode.length === 0) {
      throw new RegionProvisionError(
        'STOP_REGION_PARENT_CODE_REQUIRED',
        'parentRegionCode, when supplied, must be an explicit existing Region code.',
      );
    }
    if (parentRegionCode === designation.regionCode) {
      throw new RegionProvisionError(
        'STOP_REGION_PARENT_SELF',
        'A Region cannot be its own parent.',
      );
    }
  }
  if (administrativeLevel === 'COUNTRY' && parentRegionCode) {
    throw new RegionProvisionError(
      'STOP_REGION_COUNTRY_HAS_PARENT',
      'COUNTRY has no Kemendagri parent.',
    );
  }

  const hierarchy: Pick<RegionPlan, 'parentRegionId' | 'administrativeLevel'> =
    {};
  if (administrativeLevel) {
    hierarchy.administrativeLevel = administrativeLevel;
  }
  if (!parentRegionCode) {
    return hierarchy;
  }

  const parents = await client.region.findMany({
    where: { OR: [{ code: parentRegionCode }] },
    select: { id: true, code: true, name: true, isActive: true },
  });
  const parent = parents.find((row) => row.code === parentRegionCode);
  if (!parent) {
    throw new RegionProvisionError(
      'STOP_REGION_PARENT_NOT_FOUND',
      `Parent Region code "${parentRegionCode}" does not exist. Provision the parent first.`,
    );
  }
  if (!parent.isActive) {
    throw new RegionProvisionError(
      'STOP_REGION_PARENT_INACTIVE',
      `Parent Region code "${parentRegionCode}" exists but is inactive.`,
    );
  }
  hierarchy.parentRegionId = parent.id;
  return hierarchy;
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

  const hierarchy = await resolveRegionHierarchy(client, designation);

  if (byCode) {
    return {
      planContractVersion: REGION_PLAN_CONTRACT_VERSION,
      regionCode,
      regionName,
      disposition: 'REUSE_EXACT_REGION',
      existingRegionId: byCode.id,
      expectedCreateCount: 0,
      expectedReuseCount: 1,
      ...hierarchy,
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
    ...hierarchy,
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
      ...(plan.parentRegionId
        ? { parentRegionId: plan.parentRegionId }
        : {}),
      ...(plan.administrativeLevel
        ? { administrativeLevel: plan.administrativeLevel }
        : {}),
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
      data: {
        code: string;
        name: string;
        parentId?: string;
        administrativeLevel?: RegionAdministrativeLevel;
      };
      select: { id: true; code: true; name: true; isActive: true };
    }): Promise<RegionRow>;
  };
  $executeRawUnsafe(sql: string): Promise<number>;
}

export interface RegionPrismaLike {
  $transaction<T>(fn: (tx: RegionTransactionClient) => Promise<T>): Promise<T>;
}

/**
 * ONE global lock for the whole Region provisioning domain — deliberately NOT
 * keyed on the region code.
 *
 * A per-code key looked tidier and was wrong. The conflict domain is not a
 * single code: the same-name/different-code rule compares a designation
 * against rows it does NOT share a code with. Two concurrent applies of
 * `{A, "Kota X"}` and `{B, "Kota X"}` would take two different per-code locks,
 * both read a table with no match, both plan CREATE, and both commit — leaving
 * one real place recorded twice under two codes, which is exactly the
 * invariant this module exists to hold.
 *
 * Serializing the whole domain is cheap and bounded: Region is governed
 * reference data provisioned rarely, by an operator, a handful of rows at a
 * time. There is no throughput to trade away.
 */
export const REGION_PROVISIONING_LOCK_DOMAIN = 'rm03d0-region-provisioning';

export function regionProvisioningAdvisoryLockKey(): bigint {
  const digest = createHash('sha256')
    .update(REGION_PROVISIONING_LOCK_DOMAIN)
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
): Promise<RegionApplyResult> {
  // The allow-list is this module's own. A caller cannot widen it, so it
  // cannot authorize a token it invented.
  if (!KNOWN_REGION_CONFIRMATION_TOKENS.includes(params.expectedConfirmationToken)) {
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
    // Domain-wide, taken BEFORE the plan is rebuilt, so the read that decides
    // CREATE vs conflict cannot interleave with another provisioning run.
    const lockKey = regionProvisioningAdvisoryLockKey();
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${lockKey})`);

    const plan = await buildRegionPlan(tx, {
      regionCode: params.regionCode,
      regionName: params.regionName,
      parentRegionCode: params.parentRegionCode,
      administrativeLevel: params.administrativeLevel,
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
      data: {
        code: plan.regionCode,
        name: plan.regionName,
        ...(plan.parentRegionId ? { parentId: plan.parentRegionId } : {}),
        ...(plan.administrativeLevel
          ? { administrativeLevel: plan.administrativeLevel }
          : {}),
      },
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
