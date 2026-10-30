import { adaptPriceWithProvenUnitVerdict, ProvenUnitPriceOperation } from './proven-unit-price-adaptation';

const direct = (
  source: string,
  target: string,
  factor: string,
): ProvenUnitPriceOperation => ({
  status: 'RESOLVED',
  rawSourceUnit: source,
  rawTargetUnit: target,
  quantityFactor: factor,
  priceOperation: 'DIVIDE_SOURCE_UNIT_PRICE_BY_QUANTITY_FACTOR',
  conversionRuleId: 'unit-rule-proved',
  conversionRuleVersion: 2,
});

describe('AHSP price adaptation consumes UnitKernel proofs (isolated slice)', () => {
  it('converts a source zak price into kg only when zak -> kg is certified', () => {
    expect(adaptPriceWithProvenUnitVerdict('80000.00', 'zak', 'kg', direct('zak', 'kg', '40')))
      .toEqual({
        status: 'RESOLVED', sourcePrice: '80000.00', adaptedPrice: '2000.00',
        factor: '40', conversionRuleId: 'unit-rule-proved', conversionRuleVersion: 2,
      });
  });

  it('uses the other direction only with its own independently proven factor', () => {
    expect(adaptPriceWithProvenUnitVerdict('2000.00', 'kg', 'zak', direct('kg', 'zak', '0.025')))
      .toMatchObject({ status: 'RESOLVED', adaptedPrice: '80000.00' });
  });

  it('never inverts a quantityFactor proven for the opposite direction', () => {
    expect(adaptPriceWithProvenUnitVerdict('80000.00', 'zak', 'kg', direct('kg', 'zak', '0.025')))
      .toEqual({ status: 'NEEDS_REVIEW', reason: 'UNPROVEN_DIRECTION' });
  });

  it('preserves the exact original decimal text for identity prices', () => {
    expect(adaptPriceWithProvenUnitVerdict('999999999999.99', 'kg', 'kg', {
      status: 'RESOLVED', rawSourceUnit: 'kg', rawTargetUnit: 'kg',
      quantityFactor: '1', priceOperation: 'IDENTITY', conversionRuleId: null,
      conversionRuleVersion: null,
    })).toMatchObject({ status: 'RESOLVED', adaptedPrice: '999999999999.99' });
  });

  it('refuses an unproven/missing positive conversion rule', () => {
    expect(adaptPriceWithProvenUnitVerdict('80000.00', 'zak', 'kg', {
      ...direct('zak', 'kg', '40'), conversionRuleId: null,
    })).toEqual({ status: 'NEEDS_REVIEW', reason: 'RULE_PROVENANCE_REQUIRED' });
    expect(adaptPriceWithProvenUnitVerdict('80000.00', 'zak', 'kg', {
      ...direct('zak', 'kg', '40'), status: 'NEEDS_REVIEW',
    })).toEqual({ status: 'NEEDS_REVIEW', reason: 'UNPROVEN_DIRECTION' });
  });

  it('refuses zero, negative, and non-numeric factors instead of inventing an amount', () => {
    for (const factor of ['0', '-4', 'abc']) {
      expect(adaptPriceWithProvenUnitVerdict('80000.00', 'zak', 'kg', direct('zak', 'kg', factor)))
        .toEqual({ status: 'NEEDS_REVIEW', reason: 'INVALID_AMOUNT_OR_FACTOR' });
    }
  });

  it('does not round a fractional-cent result before money policy is adjudicated', () => {
    expect(adaptPriceWithProvenUnitVerdict('100.00', 'zak', 'kg', direct('zak', 'kg', '3')))
      .toEqual({ status: 'NEEDS_REVIEW', reason: 'FRACTIONAL_CENT_NOT_ADMITTED' });
  });

  it('does not use price multiplication or overwrite the source price', () => {
    expect(adaptPriceWithProvenUnitVerdict('80000.00', 'zak', 'kg', {
      ...direct('zak', 'kg', '40'), priceOperation: 'IDENTITY',
    })).toEqual({ status: 'NEEDS_REVIEW', reason: 'UNPROVEN_PRICE_OPERATION' });
  });
});
