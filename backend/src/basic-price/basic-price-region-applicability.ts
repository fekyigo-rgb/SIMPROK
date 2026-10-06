import { Prisma } from '@prisma/client';

/**
 * The one exact Region applicability predicate for Basic Price consumers.
 * Scalar rows match their scalar Region only. Explicit coverage rows match a
 * named member only; their structural District anchor is never implied.
 */
export const basicPriceRegionApplicabilityWhere = (
  targetRegionId: string,
): Prisma.BasicPriceWhereInput => ({
  OR: [
    { regionCoverageSetId: null, regionId: targetRegionId },
    {
      regionCoverageSetId: { not: null },
      regionCoverageSet: {
        is: { members: { some: { regionId: targetRegionId } } },
      },
    },
  ],
});

export interface BasicPriceRegionApplicabilityFacts {
  regionId: string | null;
  /** Optional only for legacy unit fixtures; persisted rows always carry null/id. */
  regionCoverageSetId?: string | null;
  regionCoverageSet?: {
    members: readonly { regionId: string }[];
  } | null;
}

export const basicPriceRegionMatches = (
  price: BasicPriceRegionApplicabilityFacts,
  targetRegionId: string,
): boolean =>
  price.regionCoverageSetId == null
    ? price.regionId === targetRegionId
    : (price.regionCoverageSet?.members.some(
        (member) => member.regionId === targetRegionId,
      ) ?? false);
