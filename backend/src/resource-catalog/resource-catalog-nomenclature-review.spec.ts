import {
  classifyCatalogNameChange,
  ResourceCatalogNameCorrectionService,
} from './resource-catalog-name-correction.service';

describe('BP-C3 numeric notation is identity-bearing, not disposable punctuation', () => {
  it.each([
    ['AMP 80-100 Ton/Jam', 'AMP 80100 Ton/Jam'],
    ['AMP 80-100 Ton/Jam', 'AMP 80 100 Ton/Jam'],
    ['AMP 80-100 Ton/Jam', 'AMP 80/100 Ton/Jam'],
    ['Kayu 5/7 cm', 'Kayu 57 cm'],
    ['Beton 1.5 MPa', 'Beton 15 MPa'],
    ['Baja 10:15', 'Baja 1015'],
    ['Plat 4×4 mm', 'Plat 44 mm'],
  ])('blocks technical notation %s -> %s', (original, proposed) => {
    expect(classifyCatalogNameChange(original, proposed))
      .toBe('TECHNICAL_CHANGE_BLOCKED');
  });

  it.each([
    ['Sewa Asphalt Finisher  Kap. 10 Ton', 'Sewa Asphalt Finisher Kap. 10 Ton'],
    ['AMP 80 - 100 Ton/Jam', 'AMP 80-100 Ton/Jam'],
    ['AMP 80–100 Ton/Jam', 'AMP 80-100 Ton/Jam'],
    ['Kayu 5 / 7 cm', 'Kayu 5/7 cm'],
  ])('retains safe typography %s -> %s', (original, proposed) => {
    expect(classifyCatalogNameChange(original, proposed))
      .toBe('TYPOGRAPHY_ONLY');
  });

  it('preserves the human-verified typo path without calling TC and Ton synonyms', () => {
    expect(classifyCatalogNameChange('CRANE ON TRUCK 10-15 TC', 'CRANE ON TRUCK 10-15 Ton'))
      .toBe('NOMENCLATURE_REQUIRES_VERIFICATION');
  });
});

const before = new Date('2026-10-24T12:00:00.000Z');
const after = new Date('2026-10-24T12:00:00.125Z');

const sample = (overrides: Record<string, unknown> = {}) => ({
  id: 'catalog-e07',
  workspaceId: 'ws-a',
  type: 'EQUIPMENT',
  name: 'CRANE ON TRUCK 10-15 TC',
  code: 'E07',
  baseUnit: 'EQUIPMENT_HOUR',
  updatedAt: before,
  status: 'ACTIVE',
  ...overrides,
});
const payload = (overrides: Record<string, unknown> = {}) => ({
  workspaceId: 'ws-a',
  resourceCatalogId: 'catalog-e07',
  actorAccountId: 'curator-a',
  previousName: 'CRANE ON TRUCK 10-15 TC',
  correctedName: 'CRANE ON TRUCK 10-15 Ton',
  expectedUpdatedAt: before.toISOString(),
  reason: 'Membetulkan kesalahan penulisan TC pada label katalog E07.',
  evidence: 'Penetapan kurator: TC pada label E07 adalah salah tulis; kapasitas 10-15 dan satuan katalog tidak berubah.',
  sourceReference: 'Penetapan kurator mengenai salah tulis nama resource E07',
  nomenclatureVerified: true,
  confirmedCatalogCode: 'E07',
  sameIdentityConfirmed: true,
  ...overrides,
});
const setup = () => {
  const tx = {
    resourceCatalog: {
      findFirst: jest.fn().mockResolvedValueOnce({ type: 'EQUIPMENT' })
        .mockResolvedValueOnce(sample()),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        name: 'CRANE ON TRUCK 10-15 Ton',
        type: 'EQUIPMENT', baseUnit: 'EQUIPMENT_HOUR',
        updatedAt: after,
      }),
    },
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
  };
  const prisma = { $transaction: jest.fn().mockImplementation(async (f) => f(tx)) };
  return {
    service: new ResourceCatalogNameCorrectionService(prisma as never),
    prisma, tx,
  };
};
describe('BP-C3 canonical nomenclature review, not auto-equivalence', () => {
  it.each([
    ['Beton fc 30 MPa', "Beton f'c 30 MPa"],
    ['Beton fc 30 MPa', 'Beton f’c 30 MPa'],
    ['Sewa Asphalt Finisher  Kap. 10 Ton', 'Sewa Asphalt Finisher Kap. 10 Ton'],
  ])('reuses typography lane for %s -> %s', (a, b) => {
    expect(classifyCatalogNameChange(a, b)).toBe('TYPOGRAPHY_ONLY');
  });
  it.each([
    ['CRANE ON TRUCK 10-15 TC', 'CRANE ON TRUCK 10-15 Ton'],
    ['Semen Portlan', 'Semen Portland'],
  ])('offers human nomenclature review, NOT automatic equivalence (%s -> %s)', (a, b) => {
    expect(classifyCatalogNameChange(a, b))
      .toBe('NOMENCLATURE_REQUIRES_VERIFICATION');
  });
  it.each([
    ['CRANE ON TRUCK 10-15 TC', 'CRANE ON TRUCK 10-20 Ton'],
    ['Beton K-325', "Beton f'c 30 MPa"],
    ['Excavator 10 Ton', 'Crane 10 Ton'],
    ['Pipa 10 mm', 'Pipa 10 cm'],
    ['Excavator 10 HP', 'Excavator 10 kW'],
    ['CRANE ON TRUCK 10-15 Ton', 'CRANE ON TRUCK 10-15 TC'],
    ['Semen Portlan', 'Baja Portland'],
  ])('blocks technical changes regardless of claimed evidence (%s -> %s)', (a, b) => {
    expect(classifyCatalogNameChange(a, b)).toBe('TECHNICAL_CHANGE_BLOCKED');
  });
  it('does not accept TC→Ton without curator reference, confirmation and code', async () => {
    const { service, prisma } = setup();
    await expect(service.correct(payload({ nomenclatureVerified: false })))
      .rejects.toThrow('CATALOG_NOMENCLATURE_CURATOR_VERIFICATION_REQUIRED');
    await expect(service.correct(payload({ sourceReference: 'no' })))
      .rejects.toThrow('CATALOG_NOMENCLATURE_SOURCE_REQUIRED');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('preserves catalog identity, price/unit and records nomenclature evidence transactionally', async () => {
    const { service, tx, prisma } = setup();
    const result = await service.correct(payload());
    expect(result).toMatchObject({
      correctionClass: 'NOMENCLATURE_REQUIRES_VERIFICATION',
      catalogIdentityPreserved: true,
      basicPricesUntouched: true,
      unitUnchanged: true,
    });
    expect(tx.resourceCatalog.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'catalog-e07', workspaceId: 'ws-a', updatedAt: before }),
      data: { name: 'CRANE ON TRUCK 10-15 Ton' },
    }));
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
    const auditSql = tx.$executeRaw.mock.calls[1][0] as { values: unknown[] };
    expect(auditSql.values).toContain('[KOREKSI_SALAH_TULIS_TERVERIFIKASI] Membetulkan kesalahan penulisan TC pada label katalog E07.');
    expect(auditSql.values).toContainEqual(expect.stringContaining('DASAR_PENETAPAN: Penetapan kurator mengenai salah tulis nama resource E07'));
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
  it('rejects a curator code mismatch, stale version and duplicate catalog name', async () => {
    const mismatched = setup();
    await expect(mismatched.service.correct(payload({ confirmedCatalogCode: 'E70' })))
      .rejects.toThrow('CATALOG_NOMENCLATURE_CODE_MISMATCH');
    expect(mismatched.tx.resourceCatalog.updateMany).not.toHaveBeenCalled();
    const stale = setup();
    await expect(stale.service.correct(payload({ expectedUpdatedAt: after.toISOString() })))
      .rejects.toThrow('CATALOG_CORRECTION_STALE_DECISION');
    const duplicate = setup();
    duplicate.tx.resourceCatalog.findMany.mockResolvedValue([
      { id: 'another', name: 'CRANE ON TRUCK 10-15 Ton' },
    ]);
    await expect(duplicate.service.correct(payload()))
      .rejects.toThrow('CATALOG_CORRECTION_IDENTITY_CONFLICT');
    expect(duplicate.tx.resourceCatalog.updateMany).not.toHaveBeenCalled();
  });
});
