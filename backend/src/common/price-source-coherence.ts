import { PriceSourceOrigin, PriceSourceType } from '@prisma/client';

/**
 * THE origin → type authority. One table, one meaning, no competing copy.
 *
 * This shipped inside reality-intake's business-subscription worker, where it
 * decided the sourceType of a submission derived from a KnowledgeEvent. It was
 * always general domain semantics rather than that worker's private opinion:
 * a government-issued standard price list is REGULATION, a supplier/store/
 * distributor figure is a VENDOR_QUOTE, and a field or community report is a
 * MARKET_SURVEY. Basic Price needs exactly the same judgement, so the table
 * moves here and both consumers import it. Copying it would have created a
 * second authority able to disagree with the first — which is how "government
 * origin, market survey type" becomes representable again.
 *
 * RM-03D1: this is the rule that makes `GOVERNMENT + MARKET_SURVEY` refusable.
 */
export const SOURCE_TYPE_BY_ORIGIN: Record<PriceSourceOrigin, PriceSourceType> =
  {
    GOVERNMENT: 'REGULATION',
    SUPPLIER: 'VENDOR_QUOTE',
    STORE: 'VENDOR_QUOTE',
    DISTRIBUTOR: 'VENDOR_QUOTE',
    FIELD_REPORT: 'MARKET_SURVEY',
    COMMUNITY_REPORT: 'MARKET_SURVEY',
  };

/** Every origin must map, or a caller would silently get `undefined`. */
export function assertSourceOriginMappingComplete(): void {
  const unmapped = Object.values(PriceSourceOrigin).filter(
    (origin) => !SOURCE_TYPE_BY_ORIGIN[origin],
  );
  if (unmapped.length > 0) {
    throw new Error(
      `Unmapped PriceSourceOrigin values: ${unmapped.join(', ')}`,
    );
  }
}

/**
 * Is this (origin, type) pair coherent?
 *
 * Deliberately an EQUALITY against the one table rather than a looser "is this
 * plausible" test. The whole defect being closed is a government-origin price
 * carrying MARKET_SURVEY, and any rule permissive enough to allow a second type
 * per origin would permit exactly that again.
 */
export function isCoherentSourcePair(
  origin: PriceSourceOrigin,
  type: PriceSourceType,
): boolean {
  return SOURCE_TYPE_BY_ORIGIN[origin] === type;
}

/** The single type an origin implies, for error messages and defaults-free reads. */
export function expectedSourceTypeFor(
  origin: PriceSourceOrigin,
): PriceSourceType {
  return SOURCE_TYPE_BY_ORIGIN[origin];
}
