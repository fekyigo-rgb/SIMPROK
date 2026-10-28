import { ResourceCatalogNameCorrectionService } from './resource-catalog-name-correction.service';
import { ResourceObservationController } from './resource-observation.controller';
import { PERMISSIONS_KEY } from '../common/decorators/permissions.decorator';

const before = new Date('2026-10-24T12:00:00.000Z');
const after = new Date('2026-10-24T12:00:00.125Z');
const original = 'Sewa Asphalt Finisher  Kap. 10 Ton';
const normalized = 'Sewa Asphalt Finisher Kap. 10 Ton';
const request = (overrides: Record<string, unknown> = {}) => ({
  workspaceId: 'ws-A', resourceCatalogId: 'resource-A', actorAccountId: 'curator-A',
  previousName: original, correctedName: normalized,
  expectedUpdatedAt: before.toISOString(),
  sameIdentityConfirmed: true,
  reason: 'Merapikan salah ketik nama katalog.',
  evidence: 'Nama yang sama dengan kapasitas tetap 10 Ton; perbaikan hanya spasi.',
  ...overrides,
});

const setup = () => {
  const resource = {
    id: 'resource-A', workspaceId: 'ws-A', status: 'ACTIVE', name: original,
    type: 'EQUIPMENT', baseUnit: 'EQUIPMENT_HOUR', specifications: null,
    updatedAt: before,
  };
  const tx = {
    resourceCatalog: {
      findFirst: jest.fn()
        .mockResolvedValueOnce({ type: 'EQUIPMENT' })
        .mockResolvedValueOnce(resource),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        name: normalized, type: 'EQUIPMENT', baseUnit: 'EQUIPMENT_HOUR',
        updatedAt: after,
      }),
    },
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
  };
  const prisma = { $transaction: jest.fn().mockImplementation((fn) => fn(tx)) };
  const service = new ResourceCatalogNameCorrectionService(prisma as never);
  return { service, prisma, tx };
};

describe('BP-C3 governed ACTIVE ResourceCatalog typography correction', () => {
  it('reuses the existing identity-curator permission, not BASIC_PRICE_IMPORT', () => {
    const guard = Reflect.getMetadata(
      PERMISSIONS_KEY,
      ResourceObservationController.prototype.correctCatalogName,
    );
    expect(guard).toEqual(['AHSP_RESOURCE_IDENTITY_DECIDE']);
  });
  it('writes one canonical catalog name and one journal in ONE transaction', async () => {
    const { service, tx, prisma } = setup();
    const res = await service.correct(request());
    expect(res).toMatchObject({
      corrected: true, previousName: original,
      correctedName: normalized, catalogIdentityPreserved: true,
      unitUnchanged: true, sourceTextPreserved: true, basicPricesUntouched: true,
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.resourceCatalog.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'resource-A', workspaceId: 'ws-A', updatedAt: before }),
      data: { name: normalized },
    }));
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2); // shared admission lock; same-tx audit insert
    expect(tx.resourceCatalog.findMany).toHaveBeenCalledTimes(1);
  });
  it('denies dropping a numeric range operator on ACTIVE catalog before any transaction', async () => {
    const { service, prisma } = setup();
    const amp = 'Sewa Asphalt Mixing Plant (AMP) 80-100 Ton/Jam';
    for (const unsafe of [
      'Sewa Asphalt Mixing Plant (AMP) 80100 Ton/Jam',
      'Sewa Asphalt Mixing Plant (AMP) 80 100 Ton/Jam',
      'Sewa Asphalt Mixing Plant (AMP) 80/100 Ton/Jam',
    ]) {
      await expect(service.correct(request({
        previousName: amp,
        correctedName: unsafe,
      }))).rejects.toThrow('CATALOG_CORRECTION_REQUIRES_IDENTITY_ADJUDICATION');
    }
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('denies a change of a measured technical capacity before transaction', async () => {
    const { service, prisma } = setup();
    await expect(service.correct(request({ correctedName: 'Sewa Asphalt Finisher Kap. 12 Ton' })))
      .rejects.toThrow('CATALOG_CORRECTION_REQUIRES_IDENTITY_ADJUDICATION');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('denies an item of a different kind even with curator confirmation', async () => {
    const { service } = setup();
    await expect(service.correct(request({ correctedName: 'Sewa Excavator Kap. 10 Ton' })))
      .rejects.toThrow('CATALOG_CORRECTION_REQUIRES_IDENTITY_ADJUDICATION');
  });
  it('requires a human curator confirmation, reason and evidence', async () => {
    const { service } = setup();
    await expect(service.correct(request({ sameIdentityConfirmed: false })))
      .rejects.toThrow('CATALOG_SAME_IDENTITY_CONFIRMATION_REQUIRED');
    await expect(service.correct(request({ reason: 'typo' })))
      .rejects.toThrow('CATALOG_CORRECTION_REASON_REQUIRED');
    await expect(service.correct(request({ evidence: 'typo' })))
      .rejects.toThrow('CATALOG_CORRECTION_EVIDENCE_REQUIRED');
  });
  it('rejects stale version and does not touch the catalog', async () => {
    const { service, tx } = setup();
    await expect(service.correct(request({
      expectedUpdatedAt: '2026-10-24T11:00:00.000Z',
    }))).rejects.toThrow('CATALOG_CORRECTION_STALE_DECISION');
    expect(tx.resourceCatalog.updateMany).not.toHaveBeenCalled();
  });
  it('rejects a foreign or inactive catalog without edit', async () => {
    const { service, tx } = setup();
    tx.resourceCatalog.findFirst.mockReset().mockResolvedValue(null);
    await expect(service.correct(request({ workspaceId: 'foreign' })))
      .rejects.toThrow('RESOURCE_CATALOG_NOT_FOUND');
    expect(tx.resourceCatalog.updateMany).not.toHaveBeenCalled();
  });
  it('rejects collision with another identity (even if same unit)', async () => {
    const { service, tx } = setup();
    tx.resourceCatalog.findMany.mockResolvedValue([
      { id: 'different-catalog', name: normalized },
    ]);
    await expect(service.correct(request()))
      .rejects.toThrow('CATALOG_CORRECTION_IDENTITY_CONFLICT');
    expect(tx.resourceCatalog.updateMany).not.toHaveBeenCalled();
  });
  it('rejects a collision with an active global catalog while keeping the target local', async () => {
    const { service, tx } = setup();
    tx.resourceCatalog.findMany.mockResolvedValue([
      { id: 'global-catalog', name: normalized, specifications: null },
    ]);
    await expect(service.correct(request()))
      .rejects.toThrow('CATALOG_CORRECTION_IDENTITY_CONFLICT');
    expect(tx.resourceCatalog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: [{ workspaceId: 'ws-A' }, { workspaceId: null }],
      }),
    }));
    expect(tx.resourceCatalog.updateMany).not.toHaveBeenCalled();
  });
  it('does not report a same-name row with conflicting confirmed technical facts as a collision', async () => {
    const { service, tx } = setup();
    const local = {
      id: 'resource-A', workspaceId: 'ws-A', status: 'ACTIVE', name: original,
      type: 'EQUIPMENT', baseUnit: 'EQUIPMENT_HOUR',
      specifications: { mutu: 'K-250' }, updatedAt: before,
    };
    tx.resourceCatalog.findFirst.mockReset()
      .mockResolvedValueOnce({ type: 'EQUIPMENT' })
      .mockResolvedValueOnce(local);
    tx.resourceCatalog.findMany.mockResolvedValue([
      { id: 'global-catalog', name: normalized, specifications: { mutu: 'K-300' } },
    ]);
    await expect(service.correct(request())).resolves.toMatchObject({ corrected: true });
    expect(tx.resourceCatalog.updateMany).toHaveBeenCalledTimes(1);
  });
  it('must never treat a retry as a second correction', async () => {
    const { service, tx } = setup();
    tx.resourceCatalog.findFirst.mockReset()
      .mockResolvedValueOnce({ type: 'EQUIPMENT' })
      .mockResolvedValueOnce({
        id: 'resource-A', name: normalized, type: 'EQUIPMENT',
        baseUnit: 'EQUIPMENT_HOUR', updatedAt: after,
      });
    await expect(service.correct(request()))
      .rejects.toThrow('CATALOG_CORRECTION_STALE_DECISION');
    expect(tx.resourceCatalog.updateMany).not.toHaveBeenCalled();
  });
});
