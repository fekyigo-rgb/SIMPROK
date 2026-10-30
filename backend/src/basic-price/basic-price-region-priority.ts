/**
 * RAB-36B — regional fallback policy over the EXISTING canonical Region hierarchy.
 *
 * A workspace's selected/project-authorised location is the origin.
 * The chain consists ONLY of its own canonical ancestors, nearest first,
 * stopping at province. Never infer a parent from names or string prefixes.
 *
 * This is a pure proof projection, NOT a second Region / Basic Price selector:
 * caller retains basicPriceRegionApplicabilityWhere(), source validity, date,
 * resource specification, private/catalog eligibility and pricing cardinality.
 */
export type PriceRegionLevel = 'VILLAGE' | 'DISTRICT' | 'REGENCY_CITY' | 'PROVINCE';

export type PriceRegionFact = Readonly<{
  id: string;
  parentId: string | null;
  administrativeLevel: string | null;
  isActive: boolean;
}>;

export type PriceRegionTier = Readonly<{ regionId: string; level: PriceRegionLevel; priority: number }>;

export type PriceRegionLadder =
  | Readonly<{ status: 'COMPLETE'; tiers: readonly PriceRegionTier[] }>
  | Readonly<{ status: 'INCOMPLETE'; tiers: readonly PriceRegionTier[]; reason:
    'ORIGIN_NOT_FOUND' | 'ORIGIN_NOT_SUPPORTED' | 'REGION_INACTIVE' |
    'PARENT_NOT_PROVEN' | 'HIERARCHY_LEVEL_MISMATCH' | 'HIERARCHY_CYCLE' }>;

const nextParentLevel: Record<PriceRegionLevel, PriceRegionLevel | null> = {
  VILLAGE: 'DISTRICT',
  DISTRICT: 'REGENCY_CITY',
  REGENCY_CITY: 'PROVINCE',
  PROVINCE: null,
};

const isPriceRegionLevel = (raw: string | null): raw is PriceRegionLevel =>
  raw === 'VILLAGE' || raw === 'DISTRICT' ||
  raw === 'REGENCY_CITY' || raw === 'PROVINCE';

/**
 * The node map must be loaded from canonical Region.id/parentId.
 * Missing ancestors are NOT treated as "no higher prices": an incomplete
 * chain carries an explicit refusal, preventing a false exhaustive search.
 */
export function projectPriceRegionLadder(
  originRegionId: string,
  canonicalNodes: readonly PriceRegionFact[],
): PriceRegionLadder {
  const nodes = new Map(canonicalNodes.map((node) => [node.id, node]));
  const origin = nodes.get(originRegionId);
  if (!origin) return { status: 'INCOMPLETE', tiers: [], reason: 'ORIGIN_NOT_FOUND' };
  if (!isPriceRegionLevel(origin.administrativeLevel)) {
    return { status: 'INCOMPLETE', tiers: [], reason: 'ORIGIN_NOT_SUPPORTED' };
  }

  const tiers: PriceRegionTier[] = [];
  const visited = new Set<string>();
  let current: PriceRegionFact = origin;
  while (true) {
    if (visited.has(current.id)) {
      return { status: 'INCOMPLETE', tiers, reason: 'HIERARCHY_CYCLE' };
    }
    visited.add(current.id);
    if (!current.isActive) {
      return { status: 'INCOMPLETE', tiers, reason: 'REGION_INACTIVE' };
    }
    if (!isPriceRegionLevel(current.administrativeLevel)) {
      return { status: 'INCOMPLETE', tiers, reason: 'HIERARCHY_LEVEL_MISMATCH' };
    }
    const level: PriceRegionLevel = current.administrativeLevel;
    tiers.push({ regionId: current.id, level, priority: tiers.length });
    const parentLevel = nextParentLevel[level];
    if (!parentLevel) return { status: 'COMPLETE', tiers };
    const parent: PriceRegionFact | undefined =
      current.parentId === null ? undefined : nodes.get(current.parentId);
    if (!parent) return { status: 'INCOMPLETE', tiers, reason: 'PARENT_NOT_PROVEN' };
    if (parent.administrativeLevel !== parentLevel) {
      return { status: 'INCOMPLETE', tiers, reason: 'HIERARCHY_LEVEL_MISMATCH' };
    }
    current = parent;
  }
}

/**
 * Locate the nearest tier that has existing, ALREADY ELIGIBLE offers.
 * Candidate eligibility is decided by the existing price/unit/spec/date
 * laws BEFORE this function. It does not rank prices or resolve ambiguity.
 */
export function firstEligiblePriceRegionTier<T>(
  ladder: PriceRegionLadder,
  offers: readonly T[],
  applicableAtExactTier: (offer: T, regionId: string) => boolean,
): Readonly<{ kind: 'FOUND'; tier: PriceRegionTier; candidates: readonly T[] } |
            { kind: 'NOT_FOUND' } |
            { kind: 'HIERARCHY_INCOMPLETE'; reason: Extract<PriceRegionLadder, {status: 'INCOMPLETE'}>['reason'] }> {
  for (const tier of ladder.tiers) {
    const matching = offers.filter((offer) => applicableAtExactTier(offer, tier.regionId));
    if (matching.length > 0) return { kind: 'FOUND', tier, candidates: matching };
  }
  return ladder.status === 'COMPLETE'
    ? { kind: 'NOT_FOUND' }
    : { kind: 'HIERARCHY_INCOMPLETE', reason: ladder.reason };
}

/**
 * Read the canonical ancestry from the same Prisma transaction as pricing.
 * Never maintain a second hierarchy or infer geography from textual codes.
 */
export async function loadCanonicalPriceRegionContext(
  tx: Pick<import('@prisma/client').Prisma.TransactionClient, 'region'>,
  originRegionId: string,
): Promise<{
  ladder: PriceRegionLadder;
  facts: readonly (PriceRegionFact & { name: string; code: string })[];
}> {
  const facts: Array<PriceRegionFact & { name: string; code: string }> = [];
  let cursor: string | null = originRegionId;
  for (let depth = 0; depth < 4 && cursor !== null; depth++) {
    const region: (PriceRegionFact & { name: string; code: string }) | null =
      await tx.region.findUnique({
        where: { id: cursor },
        select: {
          id: true, parentId: true, administrativeLevel: true, isActive: true,
          name: true, code: true,
        },
      });
    if (!region) break;
    facts.push(region);
    cursor = region.parentId;
  }
  return { ladder: projectPriceRegionLadder(originRegionId, facts), facts };
}
