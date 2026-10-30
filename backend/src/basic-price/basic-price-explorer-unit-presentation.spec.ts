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
