import { Prisma } from '@prisma/client';
import { UNIT_KERNEL_POLICY_VERSION } from '../unit-kernel/unit-kernel.contracts';
import { certifiedImportedBasicPrice } from './basic-price-import-conversion-price';

const U = { id: 'unit-zak', code: 'ZAK', dimension: 'PACKAGE', isActive: true };
const K = { id: 'unit-kg', code: 'KG', dimension: 'MASS', isActive: true };
const row = {
  id: 'row-1',
  rawUnitText: 'Zak',
  proposedCanonicalPrice: new Prisma.Decimal('80000.00'),
  resourceCatalogId: 'catalog-1',
  unitDefinitionId: 'unit-kg',
};
const mapping = (value = '2000.00', factor = '40') => ({
  id: 'mapping-1', decidedAt: new Date('2026-10-30T01:00:00Z'),
  rowId: row.id, resourceCatalogId: row.resourceCatalogId,
  unitDefinitionId: row.unitDefinitionId, compensation: null,
  conversionSourcePriceValue: new Prisma.Decimal('80000.00'),
  conversionAdaptedPriceValue: new Prisma.Decimal(value),
  conversionQuantityFactor: new Prisma.Decimal(factor),
  conversionRuleId: 'rule-zak-kg', conversionRuleVersion: 2,
  conversionPolicyVersion: UNIT_KERNEL_POLICY_VERSION,
});
const harness = (input: {
  price?: string;
  factor?: string;
  ruleFactor?: string;
  ruleEvidence?: string | null;
  rulePresent?: boolean;
  conversion?: boolean;
} = {}) => {
  const m = input.conversion === false ? {
    ...mapping(), conversionRuleId: null, conversionSourcePriceValue: null,
    conversionAdaptedPriceValue: null, conversionQuantityFactor: null,
    conversionRuleVersion: null, conversionPolicyVersion: null,
  } : mapping(input.price, input.factor);
  const tx = {
    basicPriceImportRowResourceMapping: {
      findMany: jest.fn(async () => [m]),
    },
    resourceCatalog: {
      findUnique: jest.fn(async () => ({
        id: 'catalog-1', type: 'MATERIAL', baseUnit: 'KG',
      })),
    },
    unitDefinition: { findUnique: jest.fn(async () => K) },
    unitAlias: {
      findMany: jest.fn(async ({ where }: any) => {
        if (where.normalizedAlias === 'zak') {
          return [{ id: 'alias-zak', context: null, unitDefinition: U }];
        }
        if (where.normalizedAlias === 'kg') {
          return [{ id: 'alias-kg', context: null, unitDefinition: K }];
        }
        return [];
      }),
    },
    unitConversionRule: {
      findMany: jest.fn(async () =>
        input.rulePresent === false ? [] : [{
          id: 'rule-zak-kg', sourceUnitId: 'unit-zak',
          targetUnitId: 'unit-kg', version: 2,
          quantityFactor: input.ruleFactor ?? '40',
          conversionType: 'PACKAGE_CONTENT',
          evidenceReference: input.ruleEvidence === undefined
            ? 'manufacturer-40kg' : input.ruleEvidence,
          evidenceHash: null, evidencePayload: null,
          status: 'ACTIVE',
        }]),
    },
  };
  return { tx, m };
};

describe('SCOPE-03B1 canonical price proof (writer-consumable, isolated)', () => {
  it('returns the exact adapted catalog price only with direct Unit Kernel evidence', async () => {
    const { tx } = harness();
    const value = await certifiedImportedBasicPrice(tx as never, row);
    expect(value.toFixed(2)).toBe('2000.00');
    expect(row.proposedCanonicalPrice.toFixed(2)).toBe('80000.00');
  });

  it('rejects forged adapted money', async () => {
    const { tx } = harness({ price: '2500.00' });
    await expect(certifiedImportedBasicPrice(tx as never, row)).rejects.toThrow(
      'BASIC_PRICE_IMPORT_CONVERSION_PROVENANCE_INVALID',
    );
  });

  it('rejects a drifted rule factor even if the frozen amount looks right', async () => {
    const { tx } = harness({ ruleFactor: '50' });
    await expect(certifiedImportedBasicPrice(tx as never, row)).rejects.toThrow(
      'BASIC_PRICE_IMPORT_CONVERSION_PROVENANCE_INVALID',
    );
  });

  it('rejects absent directional evidence', async () => {
    const { tx } = harness({ rulePresent: false });
    await expect(certifiedImportedBasicPrice(tx as never, row)).rejects.toThrow(
      'BASIC_PRICE_IMPORT_CONVERSION_PROVENANCE_INVALID',
    );
  });

  it('rejects unsupported package evidence', async () => {
    const { tx } = harness({ ruleEvidence: null });
    await expect(certifiedImportedBasicPrice(tx as never, row)).rejects.toThrow(
      'BASIC_PRICE_IMPORT_CONVERSION_PROVENANCE_INVALID',
    );
  });

  it('preserves a historic exact-unit import with no converted evidence', async () => {
    const { tx } = harness({ conversion: false });
    const value = await certifiedImportedBasicPrice(tx as never, row);
    expect(value.toFixed(2)).toBe('80000.00');
    expect(tx.unitConversionRule.findMany).not.toHaveBeenCalled();
  });

  it('never permits a price rate for a different catalog price unit', async () => {
    const { tx } = harness();
    tx.resourceCatalog.findUnique.mockResolvedValue({
      id: 'catalog-1', type: 'MATERIAL', baseUnit: 'M3',
    });
    await expect(certifiedImportedBasicPrice(tx as never, row)).rejects.toThrow(
      'BASIC_PRICE_IMPORT_CONVERSION_PROVENANCE_INVALID',
    );
  });
});
