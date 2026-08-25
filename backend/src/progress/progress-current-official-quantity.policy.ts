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

  /*
   * PHASE 1 — lifecycle classification.
   *
   * Do not inspect numeric or semantic truth before determining which
   * current leaves are lifecycle-eligible calculation candidates.
   */
  const eligibleCurrentLeaves = currentLeaves.filter((leaf) =>
    isProgressActualCalculationEligible(leaf.status),
  );

  const hasIneligibleCurrentLeaf =
    eligibleCurrentLeaves.length !== currentLeaves.length;

  if (eligibleCurrentLeaves.length === 0) {
    return { state: 'NO_ELIGIBLE_CURRENT_FACT' };
  }

  /*
   * PHASE 2 — numeric domain.
   *
   * Validate every eligible current fact before semantic evaluation so
   * result precedence cannot depend on leaf/input ordering.
   *
   * Official physical quantity must be finite and non-negative.
   */
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

  /*
   * PHASE 3 — semantic / non-overlap authority.
   *
   * Every eligible current fact that could contribute to an official sum
   * must be PROVEN against the exact current semantic context.
   */
  for (const leaf of eligibleCurrentLeaves) {
    const fullEntry = entryById.get(leaf.id);

    if (!fullEntry) {
      // Canonical context leaves are derived from `entries`, so this is
      // unreachable under lawful input. Fail closed rather than guessing.
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

  /*
   * PHASE 4 — exact Decimal subtotal.
   *
   * No JavaScript Number accumulation and no intermediate rounding.
   */
  let subtotal = new Prisma.Decimal(0);

  for (const leaf of eligibleCurrentLeaves) {
    subtotal = subtotal.plus(quantityByEntryId.get(leaf.id)!);
  }

  /*
   * A distinct current ineligible fact means the quantity layer is not
   * complete even though the known eligible subtotal is truthful.
   */
  if (hasIneligibleCurrentLeaf) {
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
