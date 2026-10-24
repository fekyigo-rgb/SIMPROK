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
