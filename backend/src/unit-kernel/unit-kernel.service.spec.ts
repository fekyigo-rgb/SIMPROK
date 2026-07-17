import { Prisma } from '@prisma/client';
import { UnitKernelService } from './unit-kernel.service';
import { UNIT_PRICE_OPERATION, UNIT_REASON } from './unit-kernel.contracts';

describe('UnitKernelService', () => {
  const unit = (id: string, code: string, dimension = 'COUNT') => ({ id, code, displayName: code, symbol: code, dimension, kind: 'CANONICAL', isActive: true, createdAt: new Date(), updatedAt: new Date() });
  const alias = (id: string, rawAlias: string, definition: any) => ({ id, rawAlias, normalizedAlias: rawAlias.toLowerCase(), unitDefinitionId: definition.id, context: null, isActive: true, createdAt: new Date(), updatedAt: new Date(), unitDefinition: definition });
  const personDay = unit('person-day', 'PERSON_DAY', 'PERSON_TIME');
  const kg = unit('kg', 'KG', 'MASS');
  const sak = unit('sak', 'SAK');
  let prisma: any;
  let service: UnitKernelService;

  beforeEach(() => {
    prisma = { unitAlias: { findMany: jest.fn() }, unitConversionRule: { findMany: jest.fn().mockResolvedValue([]) } };
    service = new UnitKernelService(prisma);
  });

  it.each(['OH', 'Org/Hari', 'Orang/Hari'])('%s to PERSON_DAY resolves identity factor 1', async (raw) => {
    prisma.unitAlias.findMany.mockResolvedValueOnce([alias('source', raw, personDay)]).mockResolvedValueOnce([alias('target', 'PERSON_DAY', personDay)]);
    const result = await service.resolve(raw, 'PERSON_DAY');
    expect(result).toMatchObject({ status: 'RESOLVED', quantityFactor: '1', priceOperation: UNIT_PRICE_OPERATION.IDENTITY });
  });

  it('unknown alias fails closed', async () => {
    prisma.unitAlias.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([alias('target', 'KG', kg)]);
    expect(await service.resolve('mystery', 'KG')).toMatchObject({ status: 'NEEDS_REVIEW', reasonCodes: [UNIT_REASON.UNKNOWN_UNIT_ALIAS] });
  });

  it('ambiguous alias never chooses the first row', async () => {
    prisma.unitAlias.findMany.mockResolvedValueOnce([alias('a', 'x', kg), alias('b', 'x', sak)]).mockResolvedValueOnce([alias('target', 'KG', kg)]);
    expect(await service.resolve('x', 'KG')).toMatchObject({ status: 'NEEDS_REVIEW', reasonCodes: [UNIT_REASON.AMBIGUOUS_UNIT_ALIAS] });
    expect(prisma.unitConversionRule.findMany).not.toHaveBeenCalled();
  });

  it.each([['SAK', sak, kg, '50'], ['ROLL', unit('roll', 'ROLL'), unit('m1', 'M1', 'LENGTH'), '100']])('%s resolves only through one evidence-bound directional rule', async (_raw, source, target, factor) => {
    prisma.unitAlias.findMany.mockResolvedValueOnce([alias('source', source.code, source)]).mockResolvedValueOnce([alias('target', target.code, target)]);
    prisma.unitConversionRule.findMany.mockResolvedValue([{ id: 'rule', sourceUnitId: source.id, targetUnitId: target.id, conversionType: 'PACKAGE_CONTENT', quantityFactor: new Prisma.Decimal(factor), resourceCatalogId: 'resource', evidenceReference: 'fixture', evidenceHash: null, evidencePayload: null, version: 1, status: 'ACTIVE', createdAt: new Date(), updatedAt: new Date() }]);
    expect(await service.resolve(source.code, target.code, 'resource')).toMatchObject({ status: 'RESOLVED', quantityFactor: factor, priceOperation: UNIT_PRICE_OPERATION.DIVIDE_SOURCE_UNIT_PRICE_BY_QUANTITY_FACTOR });
  });

  it.each([['SAK', sak, kg], ['TRUCK', unit('truck', 'TRUCK'), kg]])('%s without capacity/package evidence needs review', async (_raw, source, target) => {
    prisma.unitAlias.findMany.mockResolvedValueOnce([alias('source', source.code, source)]).mockResolvedValueOnce([alias('target', target.code, target)]);
    expect(await service.resolve(source.code, target.code)).toMatchObject({ status: 'NEEDS_REVIEW', reasonCodes: [UNIT_REASON.CONVERSION_RULE_NOT_FOUND] });
  });

  it.each(['0', '-1'])('rejects invalid quantityFactor %s', async (factor) => {
    prisma.unitAlias.findMany.mockResolvedValueOnce([alias('source', 'SAK', sak)]).mockResolvedValueOnce([alias('target', 'KG', kg)]);
    prisma.unitConversionRule.findMany.mockResolvedValue([{ id: 'rule', conversionType: 'EXACT_GLOBAL', quantityFactor: new Prisma.Decimal(factor), version: 1 }]);
    expect(await service.resolve('SAK', 'KG')).toMatchObject({ status: 'NEEDS_REVIEW', reasonCodes: [UNIT_REASON.INVALID_QUANTITY_FACTOR] });
  });

  it('two eligible rules are ambiguous and reciprocal conversion is not invented', async () => {
    prisma.unitAlias.findMany.mockResolvedValueOnce([alias('source', 'SAK', sak)]).mockResolvedValueOnce([alias('target', 'KG', kg)]);
    prisma.unitConversionRule.findMany.mockResolvedValue([{ id: 'one' }, { id: 'two' }]);
    expect(await service.resolve('SAK', 'KG')).toMatchObject({ status: 'NEEDS_REVIEW', reasonCodes: [UNIT_REASON.AMBIGUOUS_CONVERSION_RULE] });
    expect(prisma.unitConversionRule.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ sourceUnitId: sak.id, targetUnitId: kg.id }) }));
  });
});
