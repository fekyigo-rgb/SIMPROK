import { BasicPriceService } from './basic-price.service';

describe('BP-C3 existing ResourceCatalog name correction — impact gate', () => {
  const record = {
    id: 'catalog-1',
    workspaceId: 'workspace-A',
    name: 'Sewa Asphalt Finisher  Kap. 10 Ton',
    code: 'E02',
    type: 'EQUIPMENT',
    baseUnit: 'EQUIPMENT_HOUR',
    specifications: null,
    updatedAt: new Date('2026-10-24T00:00:00.000Z'),
    status: 'ACTIVE',
  };
  const make = () => {
    const prisma = {
      resourceCatalog: {
        findFirst: jest.fn().mockResolvedValue(record),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
      },
      basicPrice: { count: jest.fn().mockResolvedValue(2) },
      projectAhspResourceResolution: { count: jest.fn().mockResolvedValue(3) },
      basicPriceImportRow: { count: jest.fn().mockResolvedValue(5) },
      resourceSourceIdentity: { count: jest.fn().mockResolvedValue(7) },
      unitConversionRule: { count: jest.fn().mockResolvedValue(1) },
    };
    const service = new BasicPriceService(prisma as never, {} as never);
    return { service, prisma };
  };
  it('normalizes whitespace in a preview, preserves identity, and NEVER writes', async () => {
    const {service,prisma} = make();
    const result = await service.previewCatalogNameCorrection(
      'workspace-A','catalog-1','  Sewa   Asphalt Finisher Kap. 10 Ton ',
    );
    expect(result).toMatchObject({
      currentName: record.name,
      proposedName: 'Sewa Asphalt Finisher Kap. 10 Ton',
      verdict: 'SPELLING_ONLY_PREVIEW',
      writable: false,
      impact: {
        basicPrices: 2,
        projectAhspResolutions: 3,
        importRows: 5,
        sourceIdentityRecords: 7,
        conversionRules: 1,
      },
    });
    expect(prisma.resourceCatalog.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'catalog-1', workspaceId: 'workspace-A', status: 'ACTIVE' },
    }));
    expect(prisma.resourceCatalog.update).not.toHaveBeenCalled();
  });
  it('fails closed for foreign or inactive resources without enumerating dependents', async () => {
    const {service,prisma}=make();
    prisma.resourceCatalog.findFirst.mockResolvedValue(null);
    await expect(service.previewCatalogNameCorrection('other-workspace','catalog-1','Correct Name'))
      .rejects.toThrow('RESOURCE_CATALOG_NOT_FOUND');
    expect(prisma.basicPrice.count).not.toHaveBeenCalled();
    expect(prisma.resourceCatalog.update).not.toHaveBeenCalled();
  });
  it('blocks using the preview as a duplicate-name permission', async () => {
    const {service,prisma}=make();
    prisma.resourceCatalog.findMany.mockResolvedValue([
      {id:'other',name:'Sewa Asphalt Finisher Kap. 10 Ton',baseUnit:'EQUIPMENT_HOUR'}
    ]);
    const result=await service.previewCatalogNameCorrection(
      'workspace-A','catalog-1','Sewa Asphalt Finisher Kap. 10 Ton',
    );
    expect(result.verdict).toBe('IDENTITY_CONFLICT_REVIEW_REQUIRED');
    expect(result.conflictingSameTypeNames).toBe(1);
    expect(result.writable).toBe(false);
  });
  it('will never call a semantic name change a simple spelling fix', async () => {
    const {service}=make();
    const result=await service.previewCatalogNameCorrection(
      'workspace-A','catalog-1','Sewa Asphalt Finisher Kap. 12 Ton',
    );
    expect(result.verdict).toBe('IDENTITY_REVIEW_REQUIRED');
    expect(result.writable).toBe(false);
  });
  it('rejects empty and unsafe names', async () => {
    const {service}=make();
    await expect(service.previewCatalogNameCorrection('workspace-A','catalog-1','  '))
      .rejects.toThrow('RESOURCE_CATALOG_NAME_PROPOSAL_INVALID');
    await expect(service.previewCatalogNameCorrection('workspace-A','catalog-1','Foo\nBar'))
      .rejects.toThrow('RESOURCE_CATALOG_NAME_PROPOSAL_INVALID');
  });
});
