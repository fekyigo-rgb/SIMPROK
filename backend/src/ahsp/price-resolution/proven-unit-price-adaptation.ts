import { Prisma } from '@prisma/client';

/**
 * Thin arithmetic consumer of an ALREADY PROVEN directional UnitKernel verdict.
 * Not a unit dictionary, alias matcher, conversion rule, or price selector.
 * Nothing here reads/writes catalog, prices, AHSP, occurrences, or RAB.
 *
 * UnitKernel says: one source quantity = quantityFactor target quantities.
 * Hence source PRICE / quantityFactor = target PRICE.
 *
 * This first, isolated slice admits only exact cent-representable results.
 * Non-cent quotients stay on HOLD until the canonical money precision
 * boundary is explicitly adjudicated; never silently round here.
 */
export type ProvenUnitPriceOperation = {
  status: 'RESOLVED' | 'NEEDS_REVIEW' | 'NOT_CONVERTIBLE';
  rawSourceUnit: string;
  rawTargetUnit: string;
  quantityFactor: string | null;
  priceOperation: 'IDENTITY' | 'DIVIDE_SOURCE_UNIT_PRICE_BY_QUANTITY_FACTOR' | null;
  conversionRuleId: string | null;
  conversionRuleVersion: number | null;
};

export type AdaptedUnitPrice =
  | { status: 'RESOLVED'; sourcePrice: string; adaptedPrice: string; factor: string; conversionRuleId: string | null; conversionRuleVersion: number | null }
  | { status: 'NEEDS_REVIEW'; reason: 'UNPROVEN_DIRECTION' | 'UNPROVEN_PRICE_OPERATION' | 'INVALID_AMOUNT_OR_FACTOR' | 'RULE_PROVENANCE_REQUIRED' | 'FRACTIONAL_CENT_NOT_ADMITTED' };

export function adaptPriceWithProvenUnitVerdict(
  sourcePrice: string,
  sourceUnit: string,
  targetUnit: string,
  proof: ProvenUnitPriceOperation,
): AdaptedUnitPrice {
  const held = (reason: Extract<AdaptedUnitPrice, { status: 'NEEDS_REVIEW' }>['reason']): AdaptedUnitPrice =>
    ({ status: 'NEEDS_REVIEW', reason });
  if (
    proof.status !== 'RESOLVED' ||
    proof.rawSourceUnit !== sourceUnit ||
    proof.rawTargetUnit !== targetUnit
  ) return held('UNPROVEN_DIRECTION');
  let money: Prisma.Decimal, factor: Prisma.Decimal;
  try {
    money = new Prisma.Decimal(sourcePrice);
    factor = new Prisma.Decimal(proof.quantityFactor ?? '');
  } catch {
    return held('INVALID_AMOUNT_OR_FACTOR');
  }
  if (!money.isFinite() || money.isNegative() || !factor.isFinite() || !factor.greaterThan(0)) {
    return held('INVALID_AMOUNT_OR_FACTOR');
  }
  if (proof.priceOperation === 'IDENTITY' && factor.equals(1)) {
    return {
      status: 'RESOLVED', sourcePrice, adaptedPrice: sourcePrice,
      factor: proof.quantityFactor!, conversionRuleId: proof.conversionRuleId,
      conversionRuleVersion: proof.conversionRuleVersion,
    };
  }
  if (proof.priceOperation !== 'DIVIDE_SOURCE_UNIT_PRICE_BY_QUANTITY_FACTOR' || factor.equals(1)) {
    return held('UNPROVEN_PRICE_OPERATION');
  }
  if (!proof.conversionRuleId || !Number.isInteger(proof.conversionRuleVersion) || (proof.conversionRuleVersion ?? 0) < 1) {
    return held('RULE_PROVENANCE_REQUIRED');
  }
  // An exact source-price quotient with at most 2 decimals is the ONLY money
  // result representable without rounding in the existing Decimal(18,2) field.
  // Check divisibility BEFORE dividing: no decimal.js quotient precision loss.
  if (!money.mul(100).mod(factor).equals(0)) {
    return held('FRACTIONAL_CENT_NOT_ADMITTED');
  }
  const adapted = money.div(factor).toFixed(2);
  const digitsBeforeDecimal = adapted.split('.')[0].replace('-', '').length;
  if (digitsBeforeDecimal > 16) return held('INVALID_AMOUNT_OR_FACTOR');
  return {
    status: 'RESOLVED', sourcePrice, adaptedPrice: adapted,
    factor: proof.quantityFactor!, conversionRuleId: proof.conversionRuleId,
    conversionRuleVersion: proof.conversionRuleVersion,
  };
}
