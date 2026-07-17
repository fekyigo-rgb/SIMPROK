import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BasicPriceService } from '../basic-price/basic-price.service';
import { PrismaService } from '../prisma/prisma.service';
import * as kernel from '../ahsp/price-resolution/ahsp-resource-price-resolution.kernel';
import { ProjectAhspService } from './project-ahsp.service';
import { UnitKernelService } from '../unit-kernel/unit-kernel.service';

describe('ProjectAhspService', () => {
  const input = {
    projectId: '10000000-0000-4000-8000-000000000001',
    workspaceId: '20000000-0000-4000-8000-000000000001',
    createdByAccountId: '30000000-0000-4000-8000-000000000001',
    ahspVersionId: '40000000-0000-4000-8000-000000000001',
    ahspResourceId: '50000000-0000-4000-8000-000000000001',
    idempotencyKey: 'commit-d-key',
  };
  const resource = {
    id: input.ahspResourceId,
    ahspVersionId: input.ahspVersionId,
    resourceId: 'Pekerja',
    resourceType: 'LABOR',
    coefficient: new Prisma.Decimal('1.234567'),
    baseUnit: 'OH',
    conversionFactor: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const catalog = {
    id: '60000000-0000-4000-8000-000000000001',
    code: 'LAB-01',
    name: 'Pekerja',
    type: 'LABOR',
    baseUnit: 'Org/Hari',
  };
  const price = {
    id: '70000000-0000-4000-8000-000000000001',
    resourceId: catalog.id,
    value: new Prisma.Decimal('1234567890123456.78'),
    sourceOrigin: 'SUPPLIER',
    freshnessStatus: 'CURRENT',
    effectiveDate: new Date('2026-07-15T00:00:00Z'),
    resource: catalog,
  };

  let prisma: any;
  let basicPrices: any;
  let service: ProjectAhspService;
  let units: any;
  let createData: any;

  beforeEach(() => {
    createData = undefined;
    prisma = {
      projectAhspOccurrence: { findFirst: jest.fn().mockResolvedValue(null) },
      aHSPVersion: {
        findFirst: jest.fn().mockResolvedValue({ id: input.ahspVersionId }),
      },
      aHSPResource: { findUnique: jest.fn().mockResolvedValue(resource) },
      resourceCatalog: { findMany: jest.fn().mockResolvedValue([catalog]) },
      $transaction: jest.fn(async (callback: (tx: any) => unknown) =>
        callback({
          projectAhspOccurrence: {
            create: jest.fn(async ({ data }: any) => {
              createData = data;
              return {
                id: 'occurrence-1',
                ...data,
                resourceResolutions: [
                  { id: 'resolution-1', ...data.resourceResolutions.create },
                ],
              };
            }),
          },
        }),
      ),
    };
    basicPrices = {
      findByResource: jest.fn().mockResolvedValue([price]),
      findOneForWorkspace: jest.fn().mockResolvedValue(price),
    };
    units = {
      resolve: jest.fn().mockImplementation((rawSourceUnit: string, rawTargetUnit: string) => Promise.resolve({
        status: 'RESOLVED',
        sourceUnitDefinition: { id: 'unit-person-day', code: 'PERSON_DAY' },
        targetUnitDefinition: { id: 'unit-person-day', code: 'PERSON_DAY' },
        conversionRuleId: null,
        conversionRuleVersion: null,
        quantityFactor: '1',
        priceOperation: 'IDENTITY',
        rawSourceUnit,
        rawTargetUnit,
      })),
    };
    service = new ProjectAhspService(
      prisma as PrismaService,
      basicPrices as BasicPriceService,
      units as UnitKernelService,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  const existing = (overrides: Record<string, unknown> = {}) => ({
    id: 'occurrence-existing',
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    ahspVersionId: input.ahspVersionId,
    idempotencyKey: input.idempotencyKey,
    resourceResolutions: [
      { id: 'resolution-existing', ahspResourceId: input.ahspResourceId },
    ],
    ...overrides,
  });

  it('returns identical replay with the same IDs and no kernel call', async () => {
    prisma.projectAhspOccurrence.findFirst.mockResolvedValue(existing());
    const spy = jest.spyOn(kernel, 'resolveAhspResourcePrice');
    const result = await service.create(input);
    expect(result.id).toBe('occurrence-existing');
    expect(result.resourceResolutions[0].id).toBe('resolution-existing');
    expect(spy).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    ['version', { ahspVersionId: 'different-version' }],
    [
      'resource',
      { resourceResolutions: [{ ahspResourceId: 'different-resource' }] },
    ],
  ])('rejects the same key with different %s', async (_label, change) => {
    prisma.projectAhspOccurrence.findFirst.mockResolvedValue(existing(change));
    await expect(service.create(input)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('rejects an invisible version before writes or kernel invocation', async () => {
    prisma.aHSPVersion.findFirst.mockResolvedValue(null);
    const spy = jest.spyOn(kernel, 'resolveAhspResourcePrice');
    await expect(service.create(input)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(spy).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a resource that does not belong to the version', async () => {
    prisma.aHSPResource.findUnique.mockResolvedValue({
      ...resource,
      ahspVersionId: 'other',
    });
    await expect(service.create(input)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('passes tenant/global catalogs and exact freshness values to the kernel once', async () => {
    const global = { ...catalog, id: 'catalog-global', code: 'G' };
    prisma.resourceCatalog.findMany.mockResolvedValue([catalog, global]);
    basicPrices.findByResource
      .mockResolvedValueOnce([{ ...price, freshnessStatus: 'CURRENT' }])
      .mockResolvedValueOnce([
        {
          ...price,
          id: 'price-expiring',
          resourceId: global.id,
          resource: global,
          freshnessStatus: 'EXPIRING',
        },
        {
          ...price,
          id: 'price-expired',
          resourceId: global.id,
          resource: global,
          freshnessStatus: 'EXPIRED',
        },
      ]);
    const spy = jest.spyOn(kernel, 'resolveAhspResourcePrice');
    await service.create(input);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].resourceCatalogCandidates).toEqual([
      catalog,
      global,
    ]);
    expect(
      spy.mock.calls[0][0].eligibleBasicPriceCandidates.map(
        (p) => p.freshnessStatus,
      ),
    ).toEqual(['CURRENT', 'EXPIRING', 'EXPIRED']);
  });

  it('maps RESOLVED evidence and exact Decimal strings in one transaction', async () => {
    const result = await service.create(input);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const saved = createData.resourceResolutions.create;
    expect(saved.status).toBe('RESOLVED');
    expect(saved.selectionMode).toBe('AUTO_SELECTED');
    expect(saved.sourcePriceValue).toBe('1234567890123456.78');
    expect(saved.adaptedPriceValue).toBe('1234567890123456.78');
    expect(saved.ahspCoefficient.toString()).toBe('1.234567');
    expect(saved.conversionFactor).toBeNull();
    expect(saved.quantityFactor).toBe('1');
    expect(saved.canonicalUnit).toBe('PERSON_DAY');
    expect(saved.policyVersion).toBe('BP_AHSP_PHASE2_NAME_EXACT_OPTION_C_V1');
    expect(result.resourceResolutions).toHaveLength(1);
  });

  it('uses UnitKernelService for AHSP-to-catalog and each matching Basic Price unit', async () => {
    const aliasPrice = { ...price, resource: { ...catalog, baseUnit: 'OH' } };
    basicPrices.findByResource.mockResolvedValue([aliasPrice]);
    basicPrices.findOneForWorkspace.mockResolvedValue(aliasPrice);
    await service.create(input);
    expect(units.resolve).toHaveBeenNthCalledWith(1, 'OH', 'Org/Hari', catalog.id);
    expect(units.resolve).toHaveBeenNthCalledWith(2, 'OH', 'Org/Hari', catalog.id);
    expect(units.resolve).toHaveBeenCalledTimes(2);
  });

  it.each([
    [
      'UNRESOLVED',
      {
        status: 'UNRESOLVED',
        reasonCodes: ['NO_CATALOG_CANDIDATE'],
        explanation: 'tidak ada',
      },
    ],
    [
      'NEEDS_REVIEW',
      {
        status: 'NEEDS_REVIEW',
        reasonCodes: ['MULTIPLE_CATALOG_CANDIDATES'],
        explanation: 'ambigu',
      },
    ],
  ])('persists %s without selected evidence', async (status, kernelResult) => {
    jest.spyOn(kernel, 'resolveAhspResourcePrice').mockReturnValue({
      projectId: input.projectId,
      ahspVersionId: input.ahspVersionId,
      ahspResourceId: input.ahspResourceId,
      rawResourceRef: resource.resourceId,
      ...kernelResult,
    } as any);
    await service.create(input);
    const saved = createData.resourceResolutions.create;
    expect(saved.status).toBe(status);
    expect(saved.selectionMode).toBeNull();
    expect(saved.resourceCatalogId).toBeNull();
    expect(saved.selectedBasicPriceId).toBeNull();
    expect(saved.sourcePriceValue).toBeNull();
    expect(saved.resolutionMethod).toBe('DETERMINISTIC_ATTEMPTED');
  });

  it.each([
    ['EXPIRED', 'ONLY_EXPIRED_BASIC_PRICE_CANDIDATES'],
    ['CURRENT', 'MULTIPLE_BASIC_PRICE_CANDIDATES'],
  ])(
    'keeps %s candidate ambiguity as NEEDS_REVIEW',
    async (freshness, reason) => {
      const second = { ...price, id: 'price-2', freshnessStatus: freshness };
      basicPrices.findByResource.mockResolvedValue([
        {
          ...price,
          freshnessStatus: freshness === 'EXPIRED' ? 'EXPIRED' : 'CURRENT',
        },
        ...(freshness === 'CURRENT' ? [second] : []),
      ]);
      await service.create(input);
      expect(createData.resourceResolutions.create.status).toBe('NEEDS_REVIEW');
      expect(createData.resourceResolutions.create.reasonCodes).toContain(
        reason,
      );
      expect(
        createData.resourceResolutions.create.selectedBasicPriceId,
      ).toBeNull();
    },
  );

  it('maps revalidation not-found to truthful UNRESOLVED', async () => {
    basicPrices.findOneForWorkspace.mockRejectedValue(new NotFoundException());
    await service.create(input);
    expect(createData.resourceResolutions.create).toMatchObject({
      status: 'UNRESOLVED',
      selectedBasicPriceId: null,
      reasonCodes: ['SELECTED_BASIC_PRICE_NO_LONGER_ELIGIBLE'],
      resolutionMethod: 'DETERMINISTIC_ATTEMPTED',
    });
  });

  it.each([
    ['changed value', { value: new Prisma.Decimal('1.00') }],
    ['expired', { freshnessStatus: 'EXPIRED' }],
  ])('maps %s revalidation evidence to UNRESOLVED', async (_label, change) => {
    basicPrices.findOneForWorkspace.mockResolvedValue({ ...price, ...change });
    await service.create(input);
    expect(createData.resourceResolutions.create.status).toBe('UNRESOLVED');
    expect(
      createData.resourceResolutions.create.selectedBasicPriceId,
    ).toBeNull();
  });

  it('re-reads and returns the identical P2002 winner', async () => {
    const winner = existing();
    prisma.projectAhspOccurrence.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winner);
    prisma.$transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('race', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    await expect(service.create(input)).resolves.toBe(winner);
  });

  it('returns 409 for a conflicting P2002 winner', async () => {
    prisma.projectAhspOccurrence.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existing({ ahspVersionId: 'other' }));
    prisma.$transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('race', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    await expect(service.create(input)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it.each([
    [
      'unrelated P2002',
      new Prisma.PrismaClientKnownRequestError('race', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    ],
    ['infrastructure error', new Error('database unavailable')],
  ])('does not swallow %s', async (_label, error) => {
    prisma.$transaction.mockRejectedValue(error);
    await expect(service.create(input)).rejects.toBe(error);
  });

  it('GET uses occurrenceId, projectId, and workspaceId together', async () => {
    prisma.projectAhspOccurrence.findFirst.mockResolvedValue(existing());
    await service.findOne(
      'occurrence-existing',
      input.projectId,
      input.workspaceId,
    );
    expect(prisma.projectAhspOccurrence.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'occurrence-existing',
        projectId: input.projectId,
        workspaceId: input.workspaceId,
      },
      include: { resourceResolutions: true },
    });
  });

  it('GET mismatch returns 404', async () => {
    prisma.projectAhspOccurrence.findFirst.mockResolvedValue(null);
    await expect(
      service.findOne('missing', input.projectId, input.workspaceId),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('never writes USER_OVERRIDDEN or a request-owned policy version', async () => {
    await service.create(input);
    const saved = createData.resourceResolutions.create;
    expect(saved.selectionMode).not.toBe('USER_OVERRIDDEN');
    expect(saved.policyVersion).toBe('BP_AHSP_PHASE2_NAME_EXACT_OPTION_C_V1');
  });
});
