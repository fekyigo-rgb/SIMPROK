import { Prisma } from '@prisma/client';
import {
  createProgressSemanticVerificationContext,
  readProgressSemanticAuthority,
  type ProgressSemanticAuditCandidate,
  type ProgressSemanticContextEntry,
  type ProgressSemanticContextScope,
} from './progress-semantic-authority.policy';
import {
  isProgressActualCalculationEligible,
  type ProgressCalculationLineageInvalidReason,
} from './progress-actual-calculation.policy';

export type Law1CalculationEntry = ProgressSemanticContextEntry & {
  auditEvents: readonly ProgressSemanticAuditCandidate[];
};

export type CurrentGovernedOfficialFact<
  T extends Law1CalculationEntry = Law1CalculationEntry,
> = {
  entry: T;
  quantity: Prisma.Decimal;
};

export type CurrentGovernedOfficialFactsResult<
  T extends Law1CalculationEntry = Law1CalculationEntry,
> =
  | { state: 'NOT_YET_RECORDED' }
  | { state: 'NO_ELIGIBLE_CURRENT_FACT' }
  | {
      state: 'INVALID_LINEAGE';
      reason: ProgressCalculationLineageInvalidReason;
    }
  | { state: 'INVALID_NUMERIC_FACT' }
  | { state: 'SEMANTICS_UNPROVEN' }
  | {
      state: 'INCOMPLETE' | 'COMPLETE';
      eligibleCurrentFacts: readonly CurrentGovernedOfficialFact<T>[];
    };

export type CurrentOfficialQuantityResult =
  | { state: 'NOT_YET_RECORDED' }
  | { state: 'NO_ELIGIBLE_CURRENT_FACT' }
  | {
      state: 'INVALID_LINEAGE';
      reason: ProgressCalculationLineageInvalidReason;
    }
  | { state: 'INVALID_NUMERIC_FACT' }
  | { state: 'SEMANTICS_UNPROVEN' }
  | {
      state: 'INCOMPLETE';
      knownEligibleQuantitySubtotal: Prisma.Decimal;
    }
  | {
      state: 'COMPLETE';
      currentOfficialQuantity: Prisma.Decimal;
    };

/**
 * Resolves the governed current physical facts used by LAW 1.
 *
 * This is the narrow reusable seam for projections that need the current
 * leaf identities and their validated Decimal quantities. It deliberately
 * performs no temporal filtering or aggregation. Keeping that separation
 * makes it impossible for a cutoff to resurrect a superseded predecessor.
 */
export function resolveCurrentGovernedOfficialFacts<
  T extends Law1CalculationEntry,
>(
  scope: ProgressSemanticContextScope,
  entries: readonly T[],
): CurrentGovernedOfficialFactsResult<T> {
  if (entries.length === 0) {
    return { state: 'NOT_YET_RECORDED' };
  }

  const context = createProgressSemanticVerificationContext(scope, entries);

  if (context.state === 'INVALID_LINEAGE') {
    return {
      state: 'INVALID_LINEAGE',
      reason: context.reason,
    };
  }

  const currentLeaves = context.currentLeaves;

  if (currentLeaves.length === 0) {
    return { state: 'NOT_YET_RECORDED' };
  }

  const entryById = new Map(entries.map((entry) => [entry.id, entry]));
  const eligibleCurrentLeaves = currentLeaves.filter((leaf) =>
    isProgressActualCalculationEligible(leaf.status),
  );
  const hasIneligibleCurrentLeaf =
    eligibleCurrentLeaves.length !== currentLeaves.length;

  if (eligibleCurrentLeaves.length === 0) {
    return { state: 'NO_ELIGIBLE_CURRENT_FACT' };
  }

  const quantityByEntryId = new Map<string, Prisma.Decimal>();

  for (const leaf of eligibleCurrentLeaves) {
    let quantity: Prisma.Decimal;

    try {
      quantity = new Prisma.Decimal(leaf.installedQuantity.toString());
    } catch {
      return { state: 'INVALID_NUMERIC_FACT' };
    }

    if (quantity.isNaN() || !quantity.isFinite() || quantity.isNegative()) {
      return { state: 'INVALID_NUMERIC_FACT' };
    }

    quantityByEntryId.set(leaf.id, quantity);
  }

  for (const leaf of eligibleCurrentLeaves) {
    const fullEntry = entryById.get(leaf.id);

    if (!fullEntry) {
      return { state: 'SEMANTICS_UNPROVEN' };
    }

    const semanticAuthority = readProgressSemanticAuthority(
      context,
      fullEntry.auditEvents,
    );

    if (semanticAuthority.state !== 'PROVEN') {
      return { state: 'SEMANTICS_UNPROVEN' };
    }
  }

  return {
    state: hasIneligibleCurrentLeaf ? 'INCOMPLETE' : 'COMPLETE',
    eligibleCurrentFacts: eligibleCurrentLeaves.map((entry) => ({
      entry,
      quantity: quantityByEntryId.get(entry.id)!,
    })),
  };
}

/**
 * Owner-ratified MON-04 LAW 1:
 * Current Official Actual Quantity for one Active-Baseline WORK_ITEM.
 *
 * Permanent calculation order:
 *
 * LINEAGE
 * → CURRENT LEAVES
 * → LIFECYCLE ELIGIBILITY
 * → NUMERIC DOMAIN
 * → SEMANTIC AUTHORITY
 * → COMPLETENESS
 * → EXACT DECIMAL SUM
 *
 * This policy is deliberately pure. It does not know RAB weight,
 * planned quantity, progress percentages, H2-A1, or persistence.
 */
export function calculateCurrentOfficialQuantity(
  scope: ProgressSemanticContextScope,
  entries: readonly Law1CalculationEntry[],
): CurrentOfficialQuantityResult {
  const governed = resolveCurrentGovernedOfficialFacts(scope, entries);

  switch (governed.state) {
    case 'NOT_YET_RECORDED':
    case 'NO_ELIGIBLE_CURRENT_FACT':
    case 'INVALID_LINEAGE':
    case 'INVALID_NUMERIC_FACT':
    case 'SEMANTICS_UNPROVEN':
      return governed;
    case 'INCOMPLETE':
    case 'COMPLETE':
      break;
  }

  /*
   * PHASE 4 — exact Decimal subtotal.
   *
   * No JavaScript Number accumulation and no intermediate rounding.
   */
  let subtotal = new Prisma.Decimal(0);

  for (const fact of governed.eligibleCurrentFacts) {
    subtotal = subtotal.plus(fact.quantity);
  }

  /*
   * A distinct current ineligible fact means the quantity layer is not
   * complete even though the known eligible subtotal is truthful.
   */
  if (governed.state === 'INCOMPLETE') {
    return {
      state: 'INCOMPLETE',
      knownEligibleQuantitySubtotal: subtotal,
    };
  }

  return {
    state: 'COMPLETE',
    currentOfficialQuantity: subtotal,
  };
}
