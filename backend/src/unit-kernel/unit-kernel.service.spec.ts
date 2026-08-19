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

  /**
   * RM-03D2 — "which canonical unit is this spelling?", asked in bulk.
   *
   * This is a strictly smaller question than `resolve()`, and the tests below
   * exist mostly to prove what it does NOT do: it never reads a conversion rule,
   * so no caller can turn convertibility into evidence about identity.
   */
  describe('resolveCanonicalUnitIdentities (RM-03D2)', () => {
    const m3 = unit('m3', 'M3', 'VOLUME');
    const contextual = (id: string, rawAlias: string, definition: any, context: string) => ({ ...alias(id, rawAlias, definition), context });

    it('resolves every distinct spelling in ONE query and reads no conversion rule', async () => {
      prisma.unitAlias.findMany.mockResolvedValue([alias('a', 'm3', m3), alias('b', 'kg', kg)]);

      const facts = await service.resolveCanonicalUnitIdentities(['m3', 'kg']);

      expect(facts).toEqual([
        expect.objectContaining({ rawUnit: 'm3', status: 'RESOLVED', unitDefinition: m3, reasonCode: UNIT_REASON.EXACT_UNIT_IDENTITY }),
        expect.objectContaining({ rawUnit: 'kg', status: 'RESOLVED', unitDefinition: kg }),
      ]);
      expect(prisma.unitAlias.findMany).toHaveBeenCalledTimes(1);
      // THE load-bearing assertion of this whole slice.
      expect(prisma.unitConversionRule.findMany).not.toHaveBeenCalled();
    });

    it('asks for each NORMALIZED spelling once but answers every raw spelling given', async () => {
      prisma.unitAlias.findMany.mockResolvedValue([alias('a', 'm3', m3)]);

      const facts = await service.resolveCanonicalUnitIdentities(['m3', 'M3', 'm3']);

      // "m3" and "M3" are one lookup and one canonical meaning — and the
      // duplicate is not asked twice.
      expect(prisma.unitAlias.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.unitAlias.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ normalizedAlias: { in: ['m3'] } }) }));
      expect(facts).toHaveLength(2);
      expect(facts.map((f) => f.rawUnit)).toEqual(['m3', 'M3']);
      expect(facts.every((f) => f.unitDefinition?.id === m3.id)).toBe(true);
    });

    it('an unknown spelling is NEEDS_REVIEW with UNKNOWN_UNIT_ALIAS, never a guess', async () => {
      prisma.unitAlias.findMany.mockResolvedValue([]);
      expect(await service.resolveCanonicalUnitIdentities(['mystery'])).toEqual([
        expect.objectContaining({ status: 'NEEDS_REVIEW', unitDefinition: null, reasonCode: UNIT_REASON.UNKNOWN_UNIT_ALIAS }),
      ]);
    });

    it('a spelling with two meanings is AMBIGUOUS and never picks the first row', async () => {
      prisma.unitAlias.findMany.mockResolvedValue([alias('a', 'x', kg), alias('b', 'x', sak)]);
      expect(await service.resolveCanonicalUnitIdentities(['x'])).toEqual([
        expect.objectContaining({ status: 'NEEDS_REVIEW', unitDefinition: null, reasonCode: UNIT_REASON.AMBIGUOUS_UNIT_ALIAS }),
      ]);
    });

    it('a spelling whose every meaning is context-scoped needs the context named', async () => {
      prisma.unitAlias.findMany.mockResolvedValue([contextual('a', 'jam', personDay, 'LABOR')]);
      expect(await service.resolveCanonicalUnitIdentities(['jam'])).toEqual([
        expect.objectContaining({ status: 'NEEDS_REVIEW', reasonCode: UNIT_REASON.CONTEXT_REQUIRED_UNIT_ALIAS }),
      ]);
    });

    it('with a trusted context the context-scoped alias answers, and says so', async () => {
      const equipmentHour = unit('equipment-hour', 'EQUIPMENT_HOUR', 'EQUIPMENT_TIME');
      prisma.unitAlias.findMany.mockResolvedValue([contextual('a', 'jam', personDay, 'LABOR'), contextual('b', 'jam', equipmentHour, 'EQUIPMENT')]);

      const [labor] = await service.resolveCanonicalUnitIdentities(['jam'], 'LABOR');

      expect(labor).toMatchObject({ status: 'RESOLVED', unitDefinition: personDay, contextScoped: true, reasonCode: UNIT_REASON.CONTEXT_SCOPED_UNIT_ALIAS });
    });

    it('a FOREIGN-context alias never becomes the last row standing, and is not called unknown', async () => {
      // Only an EQUIPMENT meaning is catalogued; asking as MATERIAL must not
      // fall back to it merely because nothing else survives.
      //
      // The VERDICT is the whole safety property and it does not move: no unit
      // definition, NEEDS_REVIEW, nothing borrowed from another context.
      //
      // What did move is the DIAGNOSIS. This used to report UNKNOWN_UNIT_ALIAS,
      // which was a false statement about SIMPROK's own knowledge: the spelling
      // is catalogued and the system knows exactly why it does not apply here.
      // Telling a reviewer "never heard of it" sends them to add an alias that
      // already exists.
      prisma.unitAlias.findMany.mockResolvedValue([contextual('b', 'jam', kg, 'EQUIPMENT')]);
      expect(await service.resolveCanonicalUnitIdentities(['jam'], 'MATERIAL')).toEqual([
        expect.objectContaining({ status: 'NEEDS_REVIEW', unitDefinition: null, matchedAliasIds: [], reasonCode: UNIT_REASON.FOREIGN_CONTEXT_UNIT_ALIAS }),
      ]);
    });

    it('a genuinely unheard-of spelling is still UNKNOWN — the two stay distinguishable', async () => {
      prisma.unitAlias.findMany.mockResolvedValue([]);
      expect(await service.resolveCanonicalUnitIdentities(['betul-betul-asing'], 'MATERIAL')).toEqual([
        expect.objectContaining({ reasonCode: UNIT_REASON.UNKNOWN_UNIT_ALIAS }),
      ]);
    });

    it('a foreign-context alias does NOT suppress an eligible context-free meaning', async () => {
      // The refinement must not change eligibility in the other direction
      // either: a context-free row still answers, and the foreign row is simply
      // not consulted.
      prisma.unitAlias.findMany.mockResolvedValue([contextual('b', 'jam', sak, 'EQUIPMENT'), alias('free', 'jam', kg)]);
      expect(await service.resolveCanonicalUnitIdentities(['jam'], 'MATERIAL')).toEqual([
        expect.objectContaining({ status: 'RESOLVED', unitDefinition: kg, contextScoped: false, reasonCode: UNIT_REASON.EXACT_UNIT_IDENTITY }),
      ]);
    });

    it('`resolve()` reports the same foreign-context fact rather than claiming ignorance', async () => {
      // The two entry points share `selectEligibleAliases`/`aliasProblem`, so the
      // refinement must surface identically here — and must still refuse.
      prisma.unitAlias.findMany.mockResolvedValueOnce([contextual('b', 'jam', kg, 'EQUIPMENT')]).mockResolvedValueOnce([alias('target', 'KG', kg)]);

      const result = await service.resolve('jam', 'KG', undefined, 'MATERIAL');

      expect(result).toMatchObject({ status: 'NEEDS_REVIEW', reasonCodes: [UNIT_REASON.FOREIGN_CONTEXT_UNIT_ALIAS] });
      expect(result.explanation).toContain('konteks lain');
      // Diagnostic only: no conversion rule was ever consulted.
      expect(prisma.unitConversionRule.findMany).not.toHaveBeenCalled();
    });

    // ---------- PROVENANCE THE CALLER KEEPS (§7, §9) ----------
    it('names the trusted context ONLY when the answer actually depended on it', async () => {
      const equipmentHour = unit('equipment-hour', 'EQUIPMENT_HOUR', 'EQUIPMENT_TIME');
      prisma.unitAlias.findMany.mockResolvedValue([contextual('a', 'jam', personDay, 'LABOR'), contextual('b', 'jam', equipmentHour, 'EQUIPMENT')]);

      const [scoped] = await service.resolveCanonicalUnitIdentities(['jam'], 'EQUIPMENT');

      expect(scoped).toMatchObject({ contextScoped: true, resolvedContext: 'EQUIPMENT', matchedAliasIds: ['b'] });
    });

    it('a context-free answer records NO context, even when a context was supplied', async () => {
      // §6: when context did not matter, do not manufacture context provenance.
      // Recording 'MATERIAL' here would make a globally valid meaning read as
      // though it held only for materials.
      prisma.unitAlias.findMany.mockResolvedValue([alias('a', 'm3', m3)]);

      const [free] = await service.resolveCanonicalUnitIdentities(['m3'], 'MATERIAL');

      expect(free).toMatchObject({ status: 'RESOLVED', contextScoped: false, resolvedContext: null });
    });

    it('deciding alias evidence is CANONICALLY ORDERED, never database order', async () => {
      // Same two alias rows, two arrival orders. Provenance is a set, so its
      // record must not change when Postgres returns the rows the other way
      // round — otherwise "same evidence, same output" fails on serialization
      // alone, and the RAB pre-lock comparison inherits that instability.
      const both = [contextual('zzz', 'jam', personDay, 'LABOR'), contextual('aaa', 'jam', personDay, 'LABOR')];

      prisma.unitAlias.findMany.mockResolvedValue(both);
      const forwards = await service.resolveCanonicalUnitIdentities(['jam'], 'LABOR');
      prisma.unitAlias.findMany.mockResolvedValue([...both].reverse());
      const backwards = await service.resolveCanonicalUnitIdentities(['jam'], 'LABOR');

      expect(forwards[0].matchedAliasIds).toEqual(['aaa', 'zzz']);
      expect(JSON.stringify(backwards)).toBe(JSON.stringify(forwards));
    });

    it('reads through the caller transaction when one is given, never the global client', async () => {
      const tx = { unitAlias: { findMany: jest.fn().mockResolvedValue([alias('a', 'm3', m3)]) } };

      const [fact] = await service.resolveCanonicalUnitIdentities(['m3'], undefined, tx as any);

      expect(fact).toMatchObject({ status: 'RESOLVED', unitDefinition: m3 });
      expect(tx.unitAlias.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.unitAlias.findMany).not.toHaveBeenCalled();
    });

    it('asks nothing at all when there is nothing to ask', async () => {
      expect(await service.resolveCanonicalUnitIdentities([])).toEqual([]);
      expect(prisma.unitAlias.findMany).not.toHaveBeenCalled();
    });

    it('only ACTIVE aliases of ACTIVE definitions are eligible', async () => {
      prisma.unitAlias.findMany.mockResolvedValue([]);
      await service.resolveCanonicalUnitIdentities(['m3']);
      expect(prisma.unitAlias.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ isActive: true, unitDefinition: { is: { isActive: true } } }) }));
    });
  });
});
