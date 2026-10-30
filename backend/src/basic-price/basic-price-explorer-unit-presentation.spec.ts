import { BasicPriceService } from './basic-price.service';

describe('BP-C3 - Explorer canonical display unit from existing Unit Kernel', () => {
  it('renders different verified equipment aliases as one symbol, and leaves unknown units unresolved', async () => {
    const prisma = {
      unitDefinition: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'unit-equipment-hour', symbol: 'jam-alat' },
        ]),
      },
    };
    const kernel = {
      resolveCanonicalUnitIdentities: jest.fn().mockImplementation(async (units: string[], context: string) => {
        expect(context).toBe('EQUIPMENT');
        return units.map((rawUnit) =>
          rawUnit === 'U/J' || rawUnit === 'EQUIPMENT_HOUR'
            ? { rawUnit, status: 'RESOLVED', unitDefinition: { id: 'unit-equipment-hour', code: 'EQUIPMENT_HOUR', dimension: 'EQUIPMENT_TIME' } }
            : { rawUnit, status: 'NEEDS_REVIEW', unitDefinition: null },
        );
      }),
    };
    const service = new BasicPriceService(prisma as never, {} as never, kernel as never);
    const input = [
      { resource: { id: 'vibrator', type: 'EQUIPMENT', baseUnit: 'U/J' } },
      { resource: { id: 'roller', type: 'EQUIPMENT', baseUnit: 'EQUIPMENT_HOUR' } },
      { resource: { id: 'unknown', type: 'EQUIPMENT', baseUnit: 'UNIT/JAM' } },
    ];
    const fn = service as unknown as {
      explorerVerifiedUnitDisplays: (rows: unknown[]) => Promise<Map<string, string | null>>
    };
    const displays = await fn.explorerVerifiedUnitDisplays(input);
    expect(displays.get('vibrator')).toBe('jam-alat');
    expect(displays.get('roller')).toBe('jam-alat');
    expect(displays.get('unknown')).toBeNull();
    expect(kernel.resolveCanonicalUnitIdentities).toHaveBeenCalledTimes(1);
    expect(prisma.unitDefinition.findMany).toHaveBeenCalledTimes(1);
  });
});


describe('BP-UNIT-DISPLAY - per-offer unit truth, not catalog-forced conversion', () => {
  it('retains distinct source hour/day/week/month identities with uniform human labels', async () => {
    const source = new Map([
      ['h', { id: 'h', code: 'PERSON_HOUR', symbol: 'jam-orang', dimension: 'PERSON_TIME' }],
      ['d', { id: 'd', code: 'PERSON_DAY', symbol: 'PERSON_DAY', dimension: 'PERSON_TIME' }],
      ['w', { id: 'w', code: 'PERSON_WEEK', symbol: 'person/week', dimension: 'PERSON_TIME' }],
      ['m', { id: 'm', code: 'PERSON_MONTH', symbol: 'Org/Bulan', dimension: 'PERSON_TIME' }],
    ]);
    const prisma = {
      unitDefinition: {
        findMany: jest.fn().mockImplementation(async (args: { where: { id: { in: string[] } } }) =>
          args.where.id.in.map(id => source.get(id)).filter(Boolean)),
      },
    };
    const kernel = {
      resolveCanonicalUnitIdentities: jest.fn().mockImplementation(async (units: string[], context: string) => {
        expect(context).toBe('LABOR');
        return units.map(rawUnit => ({
          rawUnit, status: 'RESOLVED',
          unitDefinition: { id: 'd', code: 'PERSON_DAY', dimension: 'PERSON_TIME' },
        }));
      }),
    };
    const resource = { id: 'one-worker', name: 'Pekerja', code: 'L.01', type: 'LABOR', baseUnit: 'Org/Hari' };
    const rows = [
      { id: 'hourly', resource, sourceImportRow: { unitDefinitionId: 'h' } },
      { id: 'daily', resource, sourceImportRow: { unitDefinitionId: 'd' } },
      { id: 'weekly', resource, sourceSubmission: { importRow: { unitDefinitionId: 'w' } } },
      { id: 'monthly', resource, sourceImportRow: { unitDefinitionId: 'm' } },
      { id: 'unknown', resource, sourceImportRow: { unitDefinitionId: null } },
      { id: 'catalog-only', resource },
      { id: 'correction-without-unit-evidence', resource, supersedesBasicPriceId: 'previous' },
    ];
    const service = new BasicPriceService(prisma as never, {} as never, kernel as never);
    const displays = await (service as unknown as {
      explorerVerifiedPriceUnitDisplays: (r: unknown[]) => Promise<Map<string, string | null>>
    }).explorerVerifiedPriceUnitDisplays(rows);
    expect([...displays.entries()]).toEqual([
      ['hourly', 'Orang-Jam'],
      ['daily', 'Orang-Hari'],
      ['weekly', 'Orang-Minggu'],
      ['monthly', 'Orang-Bulan'],
      ['unknown', null],
      ['catalog-only', null],
      ['correction-without-unit-evidence', null],
    ]);
    expect(prisma.unitDefinition.findMany).toHaveBeenCalledTimes(1);
  });
});

describe('BP-UNIT-DISPLAY-01 - uniform symbols without changing price truth', () => {
  it('shows m, m², m³ and bh/m from source-proven canonical identities', async () => {
    const definitions = new Map([
      ['m1', { id: 'm1', code: 'M1', symbol: 'm1', dimension: 'LENGTH' }],
      ['m2', { id: 'm2', code: 'M2', symbol: 'm2', dimension: 'AREA' }],
      ['m3', { id: 'm3', code: 'M3', symbol: 'm3', dimension: 'VOLUME' }],
      ['bhm', { id: 'bhm', code: 'BH_PER_M', symbol: 'bh/m', dimension: 'COUNT' }],
    ]);
    const prisma = {
      unitDefinition: {
        findMany: jest.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
          where.id.in.map(id => definitions.get(id)).filter(Boolean)),
      },
    };
    const resource = { id: 'material', code: 'M.01', name: 'Material', type: 'MATERIAL', baseUnit: 'M1' };
    const rows = [
      { id: 'source-m1', resource, sourceImportRow: { unitDefinitionId: 'm1', rawUnitText: 'M1' } },
      { id: 'source-meter', resource, sourceImportRow: { unitDefinitionId: 'm1', rawUnitText: 'Meter' } },
      { id: 'source-m2', resource, sourceImportRow: { unitDefinitionId: 'm2', rawUnitText: 'm²' } },
      { id: 'source-m3', resource, sourceImportRow: { unitDefinitionId: 'm3', rawUnitText: 'M3' } },
      { id: 'source-bh-m', resource, sourceImportRow: { unitDefinitionId: 'bhm', rawUnitText: 'BH/M' } },
      { id: 'source-buah-meter', resource, sourceImportRow: { unitDefinitionId: 'bhm', rawUnitText: 'Buah/Meter' } },
      { id: 'unproven', resource, sourceImportRow: { unitDefinitionId: null } },
    ];
    const service = new BasicPriceService(prisma as never, {} as never);
    const labels = await (service as unknown as {
      explorerVerifiedPriceUnitDisplays: (r: unknown[]) => Promise<Map<string, string | null>>
    }).explorerVerifiedPriceUnitDisplays(rows);
    expect([...labels.values()]).toEqual(['m', 'm', 'm²', 'm³', 'bh/m', 'bh/m', null]);
    expect(prisma.unitDefinition.findMany).toHaveBeenCalledTimes(1);
  });
});

describe('BP-UNIT-DISPLAY - independent audit regressions', () => {
  it('keeps historical inactive source identity and refuses mismatched dimensions', async () => {
    const definitions = new Map([
      ['inactive-hour', { id: 'inactive-hour', code: 'PERSON_HOUR', symbol: 'jam-orang', dimension: 'PERSON_TIME', isActive: false }],
      ['mass', { id: 'mass', code: 'KILOGRAM', symbol: 'kg', dimension: 'MASS', isActive: true }],
      ['equipment-hour', { id: 'equipment-hour', code: 'EQUIPMENT_HOUR', symbol: 'jam-alat', dimension: 'EQUIPMENT_TIME', isActive: true }],
      ['unit-count', { id: 'unit-count', code: 'UNIT', symbol: 'unit', dimension: 'COUNT', isActive: true }],
    ]);
    const prisma = {
      unitDefinition: {
        findMany: jest.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
          where.id.in.map(id => definitions.get(id)).filter(Boolean)),
      },
    };
    const labor = { id: 'worker', code: 'L.01', name: 'Pekerja', type: 'LABOR', baseUnit: 'Org/Hari' };
    const equipment = { id: 'excavator', code: 'E.01', name: 'Excavator', type: 'EQUIPMENT', baseUnit: 'jam-alat' };
    const rows = [
      { id: 'historical-hour', resource: labor, sourceImportRow: { unitDefinitionId: 'inactive-hour' } },
      { id: 'mass-on-labor', resource: labor, sourceImportRow: { unitDefinitionId: 'mass' } },
      { id: 'equipment-hour', resource: equipment, sourceImportRow: { unitDefinitionId: 'equipment-hour' } },
      { id: 'labor-on-equipment', resource: equipment, sourceImportRow: { unitDefinitionId: 'inactive-hour' } },
      { id: 'mass-on-equipment', resource: equipment, sourceImportRow: { unitDefinitionId: 'mass' } },
      { id: 'count-on-equipment', resource: equipment, sourceImportRow: { unitDefinitionId: 'unit-count' } },
      { id: 'new-observation-without-evidence', resource: labor, sourceImportRow: null },
      { id: 'legacy-price-no-unit-evidence', resource: labor },
    ];
    const service = new BasicPriceService(prisma as never, {} as never);
    const output = await (service as unknown as {
      explorerVerifiedPriceUnitDisplays: (r: unknown[]) => Promise<Map<string, string | null>>
    }).explorerVerifiedPriceUnitDisplays(rows);
    expect([...output.entries()]).toEqual([
      ['historical-hour', 'Orang-Jam'],
      ['mass-on-labor', null],
      ['equipment-hour', 'jam-alat'],
      ['labor-on-equipment', null],
      ['mass-on-equipment', null],
      ['count-on-equipment', 'unit'],
      ['new-observation-without-evidence', null],
      ['legacy-price-no-unit-evidence', null],
    ]);
    expect(prisma.unitDefinition.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.unitDefinition.findMany.mock.calls[0][0].where).toEqual({
      id: { in: ['inactive-hour', 'mass', 'equipment-hour', 'unit-count'] },
    });
  });
});


describe('BP-HISTORY-UX-02A: exact same-source price refresh keeps proven denominator', () => {
  const examples = [
    ['Beton fc 30 MPa', 'M3', 'm³'],
    ['Cat dasar beton', 'LITER', 'liter'],
    ['Pasir Halus', 'M3', 'm³'],
  ] as const;
  const parentId = '11111111-1111-4111-8111-111111111111';
  const resource = {
    id: 'resource-a', name: 'Material', code: null, type: 'MATERIAL', baseUnit: 'M3',
  };
  const context = {
    workspaceId: 'workspace-one', assetScope: 'WORKSPACE_PRIVATE',
    resourceId: 'resource-a', regionId: 'region-one', regionCoverageSetId: null,
    sourceType: 'MARKET_SURVEY', sourceOrigin: 'FIELD_SURVEY',
  };
  const observation = (sameSourceIdentity: boolean) => ({
    ...context, id: 'new-price', resource, recordsNewObservation: true,
    supersedesBasicPriceId: null, sourceImportRow: null,
    provenanceCorrections: [{
      before: { semantic: 'NEW_OBSERVATION', observedAfterBasicPriceId: parentId },
      after: { semantic: 'NEW_OBSERVATION', sameSourceIdentity },
    }],
  });
  const predecessor = (unitId: string) => ({
    ...context, id: parentId, recordsNewObservation: false,
    supersedesBasicPriceId: null, sourceImportRow: { unitDefinitionId: unitId },
    sourceSubmission: null, provenanceCorrections: [],
  });
  it.each(examples)('%s retains canonical %s as %s', async (_, code, expected) => {
    const parent = predecessor(code);
    const prisma = {
      basicPrice: { findMany: jest.fn().mockResolvedValue([parent]) },
      unitDefinition: { findMany: jest.fn().mockResolvedValue([
        { id: code, code, symbol: code === 'M3' ? 'm3' : 'liter',
          dimension: code === 'M3' ? 'VOLUME' : 'VOLUME' },
      ]) },
    };
    const service = new BasicPriceService(prisma as never, {} as never);
    const result = await (service as unknown as {
      explorerVerifiedPriceUnitDisplays: (rows: unknown[]) => Promise<Map<string, string | null>>
    }).explorerVerifiedPriceUnitDisplays([observation(true)]);
    expect(result.get('new-price')).toBe(expected);
    expect(prisma.basicPrice.findMany).toHaveBeenCalledTimes(1);
  });

  it('refuses to inherit another source or another resource', async () => {
    const prisma = {
      basicPrice: { findMany: jest.fn().mockResolvedValue([
        { ...predecessor('M3'), resourceId: 'unrelated-resource' },
      ]) },
      unitDefinition: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new BasicPriceService(prisma as never, {} as never);
    const fn = (service as unknown as {
      explorerVerifiedPriceUnitDisplays: (rows: unknown[]) => Promise<Map<string, string | null>>
    }).explorerVerifiedPriceUnitDisplays.bind(service);
    expect((await fn([observation(false)])).get('new-price')).toBeNull();
    expect(prisma.basicPrice.findMany).not.toHaveBeenCalled();
    expect((await fn([observation(true)])).get('new-price')).toBeNull();
  });

  it('keeps a correction denominator only through a matching exact pointer', async () => {
    const prisma = {
      basicPrice: { findMany: jest.fn().mockResolvedValue([predecessor('M3')]) },
      unitDefinition: { findMany: jest.fn().mockResolvedValue([
        { id: 'M3', code: 'M3', symbol: 'm3', dimension: 'VOLUME' },
      ]) },
    };
    const service = new BasicPriceService(prisma as never, {} as never);
    const row = {
      ...context, id: 'correction', resource, recordsNewObservation: false,
      supersedesBasicPriceId: parentId, sourceImportRow: null, provenanceCorrections: [],
    };
    const result = await (service as unknown as {
      explorerVerifiedPriceUnitDisplays: (rows: unknown[]) => Promise<Map<string, string | null>>
    }).explorerVerifiedPriceUnitDisplays([row]);
    expect(result.get('correction')).toBe('m³');
  });
});


describe('BP-HISTORY-UX-02A: repeated price refresh follows only exact recorded lineage', () => {
  it('preserves denominator through two successive SAME-SOURCE observations without rewriting prices', async () => {
    const rootId = '22222222-2222-4222-8222-222222222222';
    const middleId = '33333333-3333-4333-8333-333333333333';
    const fields = {
      workspaceId: 'w1', assetScope: 'WORKSPACE_PRIVATE', resourceId: 'r1',
      regionId: null, regionCoverageSetId: null, sourceType: 'MARKET_SURVEY',
      sourceOrigin: 'FIELD_SURVEY', recordsNewObservation: true,
      supersedesBasicPriceId: null,
    };
    const audit = (id: string) => [{
      before: { semantic: 'NEW_OBSERVATION', observedAfterBasicPriceId: id },
      after: { semantic: 'NEW_OBSERVATION', sameSourceIdentity: true },
    }];
    const middle = {
      ...fields, id: middleId, provenanceCorrections: audit(rootId),
      sourceImportRow: null, sourceSubmission: null,
    };
    const oldest = {
      ...fields, id: rootId, recordsNewObservation: false,
      provenanceCorrections: [], sourceImportRow: { unitDefinitionId: 'M3' },
      sourceSubmission: null,
    };
    const db = {
      basicPrice: { findMany: jest.fn(async (args: { where: { id: { in: string[] } } }) =>
        args.where.id.in.includes(middleId) ? [middle] : [oldest]) },
      unitDefinition: { findMany: jest.fn().mockResolvedValue([
        { id: 'M3', code: 'M3', symbol: 'm3', dimension: 'VOLUME' },
      ]) },
    };
    const newest = {
      ...fields, id: 'newest', provenanceCorrections: audit(middleId),
      resource: { id: 'r1', name: 'Pasir Halus', code: null, type: 'MATERIAL', baseUnit: 'M3' },
      sourceImportRow: null, sourceSubmission: null,
    };
    const service = new BasicPriceService(db as never, {} as never);
    const labels = await (service as unknown as {
      explorerVerifiedPriceUnitDisplays: (rows: unknown[]) => Promise<Map<string, string | null>>
    }).explorerVerifiedPriceUnitDisplays([newest]);
    expect(labels.get('newest')).toBe('m³');
    expect(db.basicPrice.findMany).toHaveBeenCalledTimes(2);
  });
});
