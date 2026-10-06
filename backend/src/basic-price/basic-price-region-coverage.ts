import { createHash } from 'node:crypto';

export const BASIC_PRICE_REGION_COVERAGE_CONTRACT_VERSION =
  'BP_REGION_COVERAGE_V1';

export interface CoverageRegionFact {
  id: string;
  code: string;
  isActive: boolean;
  administrativeLevel: string | null;
  parentId: string | null;
}

export type BasicPriceRegionCoverageErrorCode =
  | 'REGION_COVERAGE_ANCHOR_MUST_BE_ACTIVE_DISTRICT'
  | 'REGION_COVERAGE_REQUIRES_MULTIPLE_VILLAGES'
  | 'REGION_COVERAGE_DUPLICATE_MEMBER'
  | 'REGION_COVERAGE_MEMBER_MUST_BE_ACTIVE_VILLAGE'
  | 'REGION_COVERAGE_MEMBER_OUTSIDE_ANCHOR';

export class BasicPriceRegionCoverageError extends Error {
  constructor(readonly code: BasicPriceRegionCoverageErrorCode) {
    super(code);
    this.name = 'BasicPriceRegionCoverageError';
  }
}

export interface CanonicalBasicPriceRegionCoverage {
  anchorRegionId: string;
  memberRegionIds: string[];
  deterministicDigest: string;
}

/**
 * Canonicalizes one explicit multi-Village coverage VALUE.
 *
 * Region remains the identity authority: the digest uses official Region
 * codes, never names or the coverage-set UUID. This helper neither discovers
 * hierarchy nor writes anything; it validates facts loaded from canonical
 * Region rows and gives the existing metadata writer one stable value.
 */
export function canonicalBasicPriceRegionCoverage(
  anchor: CoverageRegionFact,
  members: readonly CoverageRegionFact[],
): CanonicalBasicPriceRegionCoverage {
  if (
    !anchor.isActive ||
    anchor.administrativeLevel !== 'DISTRICT'
  ) {
    throw new BasicPriceRegionCoverageError(
      'REGION_COVERAGE_ANCHOR_MUST_BE_ACTIVE_DISTRICT',
    );
  }
  if (members.length < 2) {
    throw new BasicPriceRegionCoverageError(
      'REGION_COVERAGE_REQUIRES_MULTIPLE_VILLAGES',
    );
  }

  const memberIds = new Set<string>();
  for (const member of members) {
    if (memberIds.has(member.id)) {
      throw new BasicPriceRegionCoverageError(
        'REGION_COVERAGE_DUPLICATE_MEMBER',
      );
    }
    memberIds.add(member.id);
    if (
      !member.isActive ||
      member.administrativeLevel !== 'VILLAGE'
    ) {
      throw new BasicPriceRegionCoverageError(
        'REGION_COVERAGE_MEMBER_MUST_BE_ACTIVE_VILLAGE',
      );
    }
    if (member.parentId !== anchor.id) {
      throw new BasicPriceRegionCoverageError(
        'REGION_COVERAGE_MEMBER_OUTSIDE_ANCHOR',
      );
    }
  }

  const sortedMembers = [...members].sort(
    (left, right) =>
      left.code.localeCompare(right.code, 'en') ||
      left.id.localeCompare(right.id, 'en'),
  );
  const deterministicDigest = createHash('sha256')
    .update(
      [
        BASIC_PRICE_REGION_COVERAGE_CONTRACT_VERSION,
        `anchor:${anchor.code}`,
        ...sortedMembers.map((member) => `member:${member.code}`),
      ].join('|'),
    )
    .digest('hex')
    .toUpperCase();

  return {
    anchorRegionId: anchor.id,
    memberRegionIds: sortedMembers.map((member) => member.id),
    deterministicDigest,
  };
}
