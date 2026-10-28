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
  it('includes active global catalogs in the collision preview', async () => {
    const {service,prisma}=make();
    prisma.resourceCatalog.findMany.mockResolvedValue([
      {id:'global',name:'Sewa Asphalt Finisher Kap. 10 Ton',baseUnit:'EQUIPMENT_HOUR',specifications:null}
    ]);
    const result=await service.previewCatalogNameCorrection(
      'workspace-A','catalog-1','Sewa Asphalt Finisher Kap. 10 Ton',
    );
    expect(result.verdict).toBe('IDENTITY_CONFLICT_REVIEW_REQUIRED');
    expect(prisma.resourceCatalog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: [{ workspaceId: 'workspace-A' }, { workspaceId: null }],
      }),
    }));
  });
  it('does not treat a same-name catalog with conflicting confirmed specifications as a collision', async () => {
    const {service,prisma}=make();
    prisma.resourceCatalog.findFirst.mockResolvedValue({
      ...record, specifications: { mutu: 'K-250' },
    });
    prisma.resourceCatalog.findMany.mockResolvedValue([
      {id:'global',name:'Sewa Asphalt Finisher Kap. 10 Ton',baseUnit:'EQUIPMENT_HOUR',specifications:{mutu:'K-300'}}
    ]);
    const result=await service.previewCatalogNameCorrection(
      'workspace-A','catalog-1','Sewa Asphalt Finisher Kap. 10 Ton',
    );
    expect(result.conflictingSameTypeNames).toBe(0);
    expect(result.verdict).toBe('SPELLING_ONLY_PREVIEW');
  });
  it('will never call a semantic name change a simple spelling fix', async () => {
    const {service}=make();
    const result=await service.previewCatalogNameCorrection(
      'workspace-A','catalog-1','Sewa Asphalt Finisher Kap. 12 Ton',
    );
    expect(result.verdict).toBe('IDENTITY_REVIEW_REQUIRED');
    expect(result.writable).toBe(false);
  });
  it('shows a controlled curator nomenclature review for TC to Ton, not a guaranteed match', async () => {
    const {service, prisma} = make();
    prisma.resourceCatalog.findFirst.mockResolvedValue({
      ...record, code: 'E07', name: 'CRANE ON TRUCK 10-15 TC',
    });
    const result = await service.previewCatalogNameCorrection(
      'workspace-A', 'catalog-1', 'CRANE ON TRUCK 10-15 Ton',
    );
    expect(result.verdict).toBe('NOMENCLATURE_VERIFICATION_REQUIRED');
    expect(result.resourceCode).toBe('E07');
    expect(result.writable).toBe(false);
    expect(prisma.resourceCatalog.update).not.toHaveBeenCalled();
  });
  it('keeps fc to f-prime-c in the already-proven typography lane', async () => {
    const {service, prisma} = make();
    prisma.resourceCatalog.findFirst.mockResolvedValue({
      ...record, type: 'MATERIAL', name: 'Beton fc 30 MPa',
    });
    const result = await service.previewCatalogNameCorrection(
      'workspace-A', 'catalog-1', "Beton f'c 30 MPa",
    );
    expect(result.verdict).toBe('SPELLING_ONLY_PREVIEW');
  });
  it('rejects empty and unsafe names', async () => {
    const {service}=make();
    await expect(service.previewCatalogNameCorrection('workspace-A','catalog-1','  '))
      .rejects.toThrow('RESOURCE_CATALOG_NAME_PROPOSAL_INVALID');
    await expect(service.previewCatalogNameCorrection('workspace-A','catalog-1','Foo\nBar'))
      .rejects.toThrow('RESOURCE_CATALOG_NAME_PROPOSAL_INVALID');
  });
});
