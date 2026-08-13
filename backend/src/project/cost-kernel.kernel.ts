import { Prisma } from '@prisma/client';
import {
  COST_CALCULATION_POLICY,
  COST_CALCULATION_REASON,
  COST_CALCULATION_STATUS,
  CostCalculationFailure,
  CostCalculationReason,
  CostCalculationResult,
  CostKernelInput,
  CalculatedResource,
} from './cost-kernel.contracts';
import { normalizeUnitAlias } from '../unit-kernel/unit-normalization';

const fail = (
  boqItemId: string,
  reason: CostCalculationReason,
): CostCalculationFailure => ({
  status: COST_CALCULATION_STATUS.FAIL_CLOSED,
  boqItemId,
  reason,
  currency: 'IDR',
  calculationPolicy: COST_CALCULATION_POLICY,
});

const parsePositiveDecimal = (value: string): Prisma.Decimal | null => {
  try {
    const decimal = new Prisma.Decimal(value);
    return decimal.isFinite() && decimal.greaterThan(0) ? decimal : null;
  } catch {
    return null;
  }
};

/**
 * A PRICE OF ZERO IS A PRICE. IT IS NOT A MISSING PRICE.
 *
 * The two facts are already separate everywhere else in this repository:
 * `adaptedPriceValue === null` is refused below as MISSING_ADAPTED_PRICE, and
 * SaveDraftBoqDto states the same law from the other side — "null/undefined =
 * no authoritative price yet (never invent 0). An explicit numeric 0 is a real
 * human-entered price and must round-trip as 0, distinct from 'not priced'."
 *
 * Only this kernel conflated them, by reusing `parsePositiveDecimal` for the
 * price as well as for the volume and the coefficient. For those two, `> 0` is
 * a real requirement — a line with no volume, or a resource used in no
 * quantity, is a data error, and the specs assert exactly that. For the price
 * it was incidental: an explicitly stated Rp0 came back as INVALID_DECIMAL, a
 * parse-failure verdict about a number that parsed perfectly.
 *
 * Real sources state it. Every AHSP in the Bina Marga B1-B12 drainage section
 * carries an "Alat Bantu" line whose published price is 0, and the official
 * table carries that zero into its own component subtotals. Refusing it would
 * be SIMPROK declaring the document unreadable because the document said
 * "nothing to add here".
 *
 * Negative stays refused. A negative unit price is not a fact this kernel has
 * been shown evidence for, and inventing a meaning for one is not its job.
 */
const parseNonNegativeDecimal = (value: string): Prisma.Decimal | null => {
  try {
    const decimal = new Prisma.Decimal(value);
    return decimal.isFinite() && decimal.greaterThanOrEqualTo(0)
      ? decimal
      : null;
  } catch {
    return null;
  }
};

/**
 * Identity comparison only (BOQ unit vs AHSP output unit), via the existing
 * canonical unit-kernel string primitive. M1/m1/M¹ normalize equal; "M" and
 * "M1" stay distinct because unit-kernel treats them as separate canonical
 * dimensional codes — this must never widen into alias/conversion lookup.
 */
const exactUnit = (value: string) => normalizeUnitAlias(value);

/** Pure Grade A arithmetic over already-frozen resource resolutions. */
export function calculateCostKernel(
  input: CostKernelInput,
): CostCalculationResult {
  if (input.itemType !== 'WORK_ITEM')
    return fail(
      input.boqItemId,
      COST_CALCULATION_REASON.BOQ_ITEM_NOT_WORK_ITEM,
    );
  if (!input.ownershipMatches)
    return fail(input.boqItemId, COST_CALCULATION_REASON.OWNERSHIP_MISMATCH);
  if (!input.ahspVersionId)
    return fail(input.boqItemId, COST_CALCULATION_REASON.MISSING_AHSP_VERSION);
  if (!input.outputUnit?.trim())
    return fail(
      input.boqItemId,
      COST_CALCULATION_REASON.MISSING_AHSP_OUTPUT_UNIT,
    );
  if (exactUnit(input.boqUnit) !== exactUnit(input.outputUnit))
    return fail(
      input.boqItemId,
      COST_CALCULATION_REASON.BOQ_AHSP_UNIT_MISMATCH,
    );
  if (input.occurrenceCount === 0 || !input.occurrenceId)
    return fail(input.boqItemId, COST_CALCULATION_REASON.OCCURRENCE_NOT_FOUND);
  if (input.occurrenceCount !== 1)
    return fail(input.boqItemId, COST_CALCULATION_REASON.AMBIGUOUS_OCCURRENCE);
  if (input.resources.length === 0)
    return fail(input.boqItemId, COST_CALCULATION_REASON.EMPTY_RESOURCES);

  const volume = parsePositiveDecimal(input.volume);
  if (!volume)
    return fail(input.boqItemId, COST_CALCULATION_REASON.INVALID_VOLUME);

  let ahspUnitPrice = new Prisma.Decimal(0);
  const resources: CalculatedResource[] = [];
  for (const resource of input.resources) {
    if (resource.ahspVersionId !== input.ahspVersionId)
      return fail(
        input.boqItemId,
        COST_CALCULATION_REASON.RESOURCE_AHSP_VERSION_MISMATCH,
      );
    if (resource.status !== 'RESOLVED')
      return fail(input.boqItemId, COST_CALCULATION_REASON.UNRESOLVED_RESOURCE);
    if (resource.adaptedPriceValue === null)
      return fail(
        input.boqItemId,
        COST_CALCULATION_REASON.MISSING_ADAPTED_PRICE,
      );

    const coefficient = parsePositiveDecimal(resource.coefficient);
    if (!coefficient)
      return fail(input.boqItemId, COST_CALCULATION_REASON.INVALID_COEFFICIENT);
    const adaptedPrice = parseNonNegativeDecimal(resource.adaptedPriceValue);
    if (!adaptedPrice)
      return fail(input.boqItemId, COST_CALCULATION_REASON.INVALID_DECIMAL);

    const resourceCost = coefficient.mul(adaptedPrice);
    ahspUnitPrice = ahspUnitPrice.add(resourceCost);
    resources.push({
      ahspResourceId: resource.ahspResourceId,
      resolutionId: resource.resolutionId,
      coefficient: coefficient.toString(),
      adaptedUnitPrice: adaptedPrice.toString(),
      resourceCost: resourceCost.toString(),
    });
  }

  return {
    status: COST_CALCULATION_STATUS.CALCULATED,
    boqItemId: input.boqItemId,
    ahspVersionId: input.ahspVersionId,
    occurrenceId: input.occurrenceId,
    volume: volume.toString(),
    outputUnit: input.outputUnit,
    resources,
    ahspUnitPrice: ahspUnitPrice.toString(),
    lineTotal: volume.mul(ahspUnitPrice).toString(),
    currency: 'IDR',
    calculationPolicy: COST_CALCULATION_POLICY,
  };
}
