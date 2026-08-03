import { Prisma } from '@prisma/client';
import { toMoneyDecimal2 } from '../common/money';

/**
 * The one canonical default recap policy — RabWorkspacePage's initial UI
 * state, buildDraftRecap's own default, and every server-computed recap
 * (saveDraftBoq and RabKernelPersistenceService alike) all resolve to
 * exactly these two constants when no more specific percentage is known.
 * No caller may hardcode 10/11 (or any other pair) independently — that is
 * precisely the divergence this file exists to prevent.
 */
export const RAB_DRAFT_DEFAULT_MARGIN_PERCENT = 10;
export const RAB_DRAFT_DEFAULT_TAX_PERCENT = 11;

/**
 * Pure RAB draft recap math, extracted from ProjectService so
 * RabKernelPersistenceService can write RabDocument totals using the exact
 * same margin/tax formula saveDraftBoq already uses — never a second,
 * divergent implementation of the same money arithmetic.
 */
export function buildDraftRecap(
  subtotal: Prisma.Decimal,
  marginPercentInput?: number | Prisma.Decimal | null,
  taxPercentInput?: number | Prisma.Decimal | null,
) {
  const marginPercent = new Prisma.Decimal(
    marginPercentInput ?? RAB_DRAFT_DEFAULT_MARGIN_PERCENT,
  );
  const taxPercent = new Prisma.Decimal(
    taxPercentInput ?? RAB_DRAFT_DEFAULT_TAX_PERCENT,
  );
  const marginAmount = subtotal.mul(marginPercent).div(100);
  const taxAmount = subtotal.add(marginAmount).mul(taxPercent).div(100);
  const grandTotal = subtotal.add(marginAmount).add(taxAmount);

  return {
    subtotal,
    marginPercent,
    marginAmount,
    taxPercent,
    taxAmount,
    grandTotal,
  };
}

export type DraftRecap = ReturnType<typeof buildDraftRecap>;

/**
 * UTANG-API-MONEY-05 / OD-04 canonical wire-scale for every recap
 * money/percent field: exactly two fraction digits, an explicit
 * ROUND_HALF_UP, fixed-point notation only — never a JavaScript Number
 * round-trip and never a silent dependency on decimal.js's ambient default
 * rounding mode. Reuses the same persistence-boundary rounding
 * (`toMoneyDecimal2`) RabKernelPersistenceService already writes to the DB
 * with, then renders it with `toFixed`, which decimal.js guarantees is
 * always fixed-point (no scientific notation) regardless of magnitude.
 */
const toExactDecimalString = (value: Prisma.Decimal): string =>
  toMoneyDecimal2(value).toFixed(2, Prisma.Decimal.ROUND_HALF_UP);

const toExactDecimalStringOrNull = (
  value?: number | Prisma.Decimal | null,
): string | null =>
  value === null || value === undefined
    ? null
    : toExactDecimalString(new Prisma.Decimal(value));

export function serializeDraftRecap(
  recap: DraftRecap,
  pricingStatus: 'COMPLETE' | 'INCOMPLETE' = 'COMPLETE',
) {
  return {
    pricingStatus,
    subtotal: toExactDecimalString(recap.subtotal),
    marginPercent: toExactDecimalString(recap.marginPercent),
    marginAmount: toExactDecimalString(recap.marginAmount),
    taxPercent: toExactDecimalString(recap.taxPercent),
    ppnPercent: toExactDecimalString(recap.taxPercent),
    taxAmount: toExactDecimalString(recap.taxAmount),
    grandTotal: toExactDecimalString(recap.grandTotal),
  };
}

/**
 * Honest "no authoritative total yet" recap. Used whenever one or more
 * WORK_ITEM rows lack a priced unitPrice — never fabricate a Rp0/partial
 * grand total from rows that are still unpriced (5D null-integrity law).
 */
export function incompletePricingRecap(
  marginPercentInput?: number | Prisma.Decimal | null,
  taxPercentInput?: number | Prisma.Decimal | null,
) {
  return {
    pricingStatus: 'INCOMPLETE' as const,
    subtotal: null,
    marginPercent: toExactDecimalStringOrNull(marginPercentInput),
    marginAmount: null,
    taxPercent: toExactDecimalStringOrNull(taxPercentInput),
    ppnPercent: toExactDecimalStringOrNull(taxPercentInput),
    taxAmount: null,
    grandTotal: null,
  };
}

/** Any WORK_ITEM row without a priced unitPrice makes the whole draft's monetary recap non-authoritative. */
export function hasIncompletePricing(
  items: readonly { itemType: string; unitPrice: Prisma.Decimal | null }[],
): boolean {
  return items.some(
    (item) => item.itemType === 'WORK_ITEM' && item.unitPrice === null,
  );
}
