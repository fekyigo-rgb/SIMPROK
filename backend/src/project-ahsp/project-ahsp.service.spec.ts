import { ConflictException } from '@nestjs/common';
import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import * as kernel from '../ahsp/price-resolution/ahsp-resource-price-resolution.kernel';
import { BasicPriceEligibilityPolicy } from '../basic-price/basic-price-eligibility.policy';
import { ProjectAhspService } from './project-ahsp.service';

describe('ProjectAhspService E1A', () => {
  const workspaceId = '20000000-0000-4000-8000-000000000001';
  let prisma: any;
  let service: ProjectAhspService;
  let units: { resolve: jest.Mock };
  let lifecycle: { evaluateInTransaction: jest.Mock };

  const selectionInput = {
    projectId: '10000000-0000-4000-8000-000000000001',
    workspaceId,
    accountId: '30000000-0000-4000-8000-000000000001',
    boqItemId: '60000000-0000-4000-8000-000000000001',
    ahspVersionId: '40000000-0000-4000-8000-000000000001',
    businessPricingAsOfDate: '2026-08-04',
    referenceRegionId: '50000000-0000-4000-8000-000000000001',
    idempotencyKey: 'e1a-key',
  };

  const requestHash = (input = selectionInput) =>
    createHash('sha256')
      .update(
        JSON.stringify({
          boqItemId: input.boqItemId,
          ahspVersionId: input.ahspVersionId,
          businessPricingAsOfDate: input.businessPricingAsOfDate,
          referenceRegionId: input.referenceRegionId,
          resolutionPolicyVersion: 'E1A_CONTEXTUAL_EXACT_REGION_V1',
        }),
      )
      .digest('hex');

  const resource = (id: string) => ({
    id,
    resourceId: `Resource ${id}`,
    resourceType: 'LABOR',
    coefficient: new Prisma.Decimal('1.250000'),
    baseUnit: 'OH',
  });

  const makeSuccessTx = (resources = [resource('resource-1')]) => {
    const catalog = {
      id: '70000000-0000-4000-8000-000000000001',
      code: 'LAB-1',
      name: resources[0].resourceId,
      type: 'LABOR',
      baseUnit: 'OH',
    };
    const price = {
      id: '80000000-0000-4000-8000-000000000001',
      resourceId: catalog.id,
      value: new Prisma.Decimal('1234567890123456.78'),
      sourceOrigin: 'SUPPLIER',
      freshnessStatus: 'CURRENT',
      effectiveDate: new Date('2026-08-01T00:00:00.000Z'),
      resource: catalog,
    };
    const created: { data?: any } = {};
    const tx: any = {
      $queryRaw: jest.fn().mockResolvedValue([
        { id: selectionInput.projectId, status: 'PLANNED', workspaceId },
      ]),
      projectAhspOccurrence: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(async ({ data }: any) => {
          created.data = data;
          return {
            id: 'occurrence-new',
            ...data,
            resourceResolutions: data.resourceResolutions.create,
          };
        }),
      },
      boqStructure: {
        findFirst: jest.fn().mockResolvedValue({ id: 'structure-1' }),
      },
      boqItem: {
        findFirst: jest.fn().mockResolvedValue({
          id: selectionInput.boqItemId,
          itemType: 'WORK_ITEM',
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      region: { findFirst: jest.fn().mockResolvedValue({ id: selectionInput.referenceRegionId }) },
      aHSPVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: selectionInput.ahspVersionId,
          outputUnit: 'M1',
          resources,
        }),
      },
      resourceCatalog: { findMany: jest.fn().mockResolvedValue([catalog]) },
      basicPrice: {
        findMany: jest.fn().mockResolvedValue([price]),
        findFirst: jest.fn().mockResolvedValue(price),
      },
    };
    return { tx, created, catalog, price };
  };

  beforeEach(() => {
    prisma = {
      aHSPVersion: { findMany: jest.fn().mockResolvedValue([]) },
      region: { findMany: jest.fn().mockResolvedValue([]) },
      projectAhspOccurrence: { findFirst: jest.fn() },
      $transaction: jest.fn(),
    };
    units = {
      resolve: jest.fn().mockResolvedValue({
        status: 'RESOLVED',
        sourceUnitDefinition: { id: 'unit-1', code: 'PERSON_DAY' },
        targetUnitDefinition: { id: 'unit-1', code: 'PERSON_DAY' },
        conversionRuleId: null,
        conversionRuleVersion: null,
        quantityFactor: '1',
        priceOperation: 'IDENTITY',
        rawSourceUnit: 'OH',
        rawTargetUnit: 'OH',
      }),
    };
    lifecycle = {
      evaluateInTransaction: jest
        .fn()
        .mockResolvedValue({ canEditDraft: true }),
    };
    // RM-03C: the REAL policy, not a stub. A hand-written stub could only ever
    // assert the predicate this spec already believed in — the point of these
    // tests is that the candidate query and the re-verification query are both
    // built from the one shipped predicate, so the stub is the wrong tool.
    service = new ProjectAhspService(
      prisma,
      new BasicPriceEligibilityPolicy(),
      units as any,
      lifecycle as any,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  /**
   * RM-03B: this test previously asserted a single top-level
   * `status: 'PUBLISHED'`, which encoded "catalog is the only way to be
   * eligible". That is no longer the whole truth — a workspace's own private
   * AHSP is eligible too — so the assertion is restated rather than deleted.
   * Its original intents are all preserved and made explicit below: the
   * CATALOG route still demands PUBLISHED, the date scope is unchanged, the
   * query is still tenant-scoped, and SUPERSEDED is still never eligible.
   */
  it('Q-01 eligible query is tenant/date scoped; catalog still requires PUBLISHED', async () => {
    await service.listEligibleVersions(workspaceId, '2026-08-04');
    const where = prisma.aHSPVersion.findMany.mock.calls[0][0].where;
    expect(where.effectiveDate.lte).toEqual(new Date('2026-08-04T00:00:00.000Z'));
    expect(JSON.stringify(where)).toContain(workspaceId);

    const [, originBranch] = where.AND;
    const [catalog, priv] = originBranch.OR;
    expect(catalog.status).toBe('PUBLISHED');
    // The private branch must never accept a retired version.
    expect(priv.status.notIn).toEqual(['SUPERSEDED', 'ARCHIVED']);
  });

  it('Q-01b the private branch is scoped to this workspace by strict equality, never to null', async () => {
    await service.listEligibleVersions(workspaceId, '2026-08-04');
    const where = prisma.aHSPVersion.findMany.mock.calls[0][0].where;
    const [, originBranch] = where.AND;
    const [, priv] = originBranch.OR;

    // Both the version AND its owning AHSP must belong to this exact
    // workspace. A null workspaceId must never satisfy the private branch —
    // ownershipType defaults to USER_ASSET even on null-workspace catalog
    // rows, so a `workspaceId: null` match here would expose those rows to
    // every tenant at once.
    expect(priv.workspaceId).toBe(workspaceId);
    expect(priv.ahsp.is.workspaceId).toBe(workspaceId);
    expect(priv.ahsp.is.ownershipType).toBe('USER_ASSET');
    expect(priv.ahsp.is.deletedAt).toBeNull();
    expect(priv.ahsp.is.archivedAt).toBeNull();
    expect(JSON.stringify(priv)).not.toContain('null,"workspaceId"');
  });

  it('Q-01c SUPERSEDED is not eligible through either origin', async () => {
    await service.listEligibleVersions(workspaceId, '2026-08-04');
    const where = prisma.aHSPVersion.findMany.mock.calls[0][0].where;
    const [, originBranch] = where.AND;
    const [catalog, priv] = originBranch.OR;
    // Catalog: only the exact literal PUBLISHED passes.
    expect(catalog.status).toBe('PUBLISHED');
    // Private: SUPERSEDED is explicitly excluded.
    expect(priv.status.notIn).toContain('SUPERSEDED');
  });

  it('Q-02 requires a non-null output unit and at least one resource', async () => {
    await service.listEligibleVersions(workspaceId, '2026-08-04');
    expect(prisma.aHSPVersion.findMany.mock.calls[0][0].where).toMatchObject({
      outputUnit: { not: null },
      resources: { some: {} },
    });
  });

  it('region query returns active regions only', async () => {
    await service.listActiveRegions();
    expect(prisma.region.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true } }),
    );
  });

  it('S-02 rejects a local-* row deterministically before transaction work', async () => {
    prisma.$transaction.mockImplementation(async (callback: any) =>
      callback({
        $queryRaw: jest.fn().mockResolvedValue([{ id: 'p', status: 'PLANNED', workspaceId }]),
        projectAhspOccurrence: { findFirst: jest.fn().mockResolvedValue(null) },
        projectBaseline: { count: jest.fn() },
        rabDocument: { count: jest.fn() },
        boqStructure: { count: jest.fn(), findFirst: jest.fn().mockResolvedValue({ id: 's' }) },
        boqItem: { findFirst: jest.fn().mockResolvedValue(null) },
      }),
    );
    (service as any).lifecycle.evaluateInTransaction.mockResolvedValue({ canEditDraft: true });
    await expect(
      service.selectForBoqItem({
        projectId: '10000000-0000-4000-8000-000000000001',
        workspaceId,
        accountId: '30000000-0000-4000-8000-000000000001',
        boqItemId: 'local-1',
        ahspVersionId: '40000000-0000-4000-8000-000000000001',
        businessPricingAsOfDate: '2026-08-04',
        referenceRegionId: '50000000-0000-4000-8000-000000000001',
        idempotencyKey: 'key',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('S-03 rejects the same idempotency key with a different request hash', async () => {
    prisma.$transaction.mockImplementation(async (callback: any) =>
      callback({
        $queryRaw: jest.fn().mockResolvedValue([{ id: 'p', status: 'PLANNED', workspaceId }]),
        projectAhspOccurrence: {
          findFirst: jest.fn().mockResolvedValue({ requestPayloadHash: 'different' }),
        },
      }),
    );
    await expect(
      service.selectForBoqItem({
        projectId: '10000000-0000-4000-8000-000000000001',
        workspaceId,
        accountId: '30000000-0000-4000-8000-000000000001',
        boqItemId: '60000000-0000-4000-8000-000000000001',
        ahspVersionId: '40000000-0000-4000-8000-000000000001',
        businessPricingAsOfDate: '2026-08-04',
        referenceRegionId: '50000000-0000-4000-8000-000000000001',
        idempotencyKey: 'key',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('findOne is scoped by occurrence, project, and workspace', async () => {
    prisma.projectAhspOccurrence.findFirst.mockResolvedValue({ id: 'o' });
    await service.findOne('o', 'p', 'w');
    expect(prisma.projectAhspOccurrence.findFirst).toHaveBeenCalledWith({
      where: { id: 'o', projectId: 'p', workspaceId: 'w' },
      include: { resourceResolutions: true },
    });
  });

  it('S-03 successor: same idempotency key and same hash returns the identical generation', async () => {
    const replay = {
      id: 'occurrence-existing',
      requestPayloadHash: requestHash(),
      generation: 3,
      resourceResolutions: [{ id: 'resolution-existing' }],
    };
    prisma.$transaction.mockImplementation(async (callback: any) =>
      callback({
        $queryRaw: jest.fn().mockResolvedValue([{ id: selectionInput.projectId, status: 'PLANNED', workspaceId }]),
        projectAhspOccurrence: { findFirst: jest.fn().mockResolvedValue(replay) },
      }),
    );
    await expect(service.selectForBoqItem(selectionInput)).resolves.toBe(replay);
    expect(lifecycle.evaluateInTransaction).not.toHaveBeenCalled();
  });

  it('Q-01 successor: invisible or ineligible selected version fails before occurrence creation', async () => {
    const { tx } = makeSuccessTx();
    tx.aHSPVersion.findFirst.mockResolvedValue(null);
    prisma.$transaction.mockImplementation((callback: any) => callback(tx));
    await expect(service.selectForBoqItem(selectionInput)).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.projectAhspOccurrence.create).not.toHaveBeenCalled();
  });

  it('O-02 successor: every stored resolution belongs to the selected Version resource set', async () => {
    const resources = [resource('resource-1'), resource('resource-2')];
    const { tx, created } = makeSuccessTx(resources);
    prisma.$transaction.mockImplementation((callback: any) => callback(tx));
    jest.spyOn(kernel, 'resolveAhspResourcePrice').mockImplementation((input: any) => ({
      ...input,
      status: 'UNRESOLVED',
      reasonCodes: ['NO_CATALOG_CANDIDATE'],
      explanation: 'unresolved',
    }));
    await service.selectForBoqItem(selectionInput);
    expect(created.data.resourceResolutions.create.map((row: any) => row.ahspResourceId).sort()).toEqual(resources.map((row) => row.id).sort());
  });

  it('R-02/R-03 successor: candidate query requires exact non-null region and business date', async () => {
    const { tx } = makeSuccessTx();
    prisma.$transaction.mockImplementation((callback: any) => callback(tx));
    jest.spyOn(kernel, 'resolveAhspResourcePrice').mockReturnValue({
      projectId: selectionInput.projectId,
      ahspVersionId: selectionInput.ahspVersionId,
      ahspResourceId: 'resource-1',
      rawResourceRef: 'Resource resource-1',
      status: 'UNRESOLVED',
      reasonCodes: ['NO_ELIGIBLE_BASIC_PRICE'],
      explanation: 'none',
    });
    await service.selectForBoqItem(selectionInput);
    expect(tx.basicPrice.findMany.mock.calls[0][0].where).toMatchObject({
      regionId: selectionInput.referenceRegionId,
      effectiveDate: { lte: new Date('2026-08-04T00:00:00.000Z') },
    });
    expect(tx.basicPrice.findMany.mock.calls[0][0].where).not.toHaveProperty(
      'freshnessStatus',
    );
  });

  /**
   * RM-03C: the Basic Price candidate set is now two additive branches —
   * publicly published catalog prices, OR this workspace's own private ones.
   * The catalog branch is restated here rather than deleted: it still demands
   * the full publication predicate, and it still carries the tenant/global
   * clause it always had.
   */
  it('RM-03C the candidate query offers catalog-published prices OR this workspace own private prices', async () => {
    const { tx } = makeSuccessTx();
    prisma.$transaction.mockImplementation((callback: any) => callback(tx));
    jest.spyOn(kernel, 'resolveAhspResourcePrice').mockReturnValue({
      projectId: selectionInput.projectId,
      ahspVersionId: selectionInput.ahspVersionId,
      ahspResourceId: 'r1',
      rawResourceRef: 'Resource resource-1',
      status: 'UNRESOLVED',
      reasonCodes: ['NO_ELIGIBLE_BASIC_PRICE'],
      explanation: 'none',
    });

    await service.selectForBoqItem(selectionInput);

    const where = tx.basicPrice.findMany.mock.calls[0][0].where;
    const [catalog, priv] = where.OR;
    expect(catalog.status).toBe('PUBLISHED');
    expect(catalog.verificationStatus).toBe('PUBLISHED');
    expect(catalog.OR).toEqual([{ workspaceId }, { workspaceId: null }]);
    expect(priv.assetScope).toBe('WORKSPACE_PRIVATE');
    expect(priv.workspaceId).toBe(workspaceId);
    // Strict equality only — a null-workspace row is never a private candidate.
    expect(priv).not.toHaveProperty('OR');

    // Technical applicability is asserted OUTSIDE the branch OR, so it binds
    // both asset families identically. There is no private shortcut past
    // region, effective date or the validity window.
    expect(where.regionId).toBe(selectionInput.referenceRegionId);
    expect(where.effectiveDate).toEqual({
      lte: new Date('2026-08-04T00:00:00.000Z'),
    });
    expect(where.AND).toEqual([
      { OR: [{ validUntil: null }, { validUntil: { gte: new Date('2026-08-04T00:00:00.000Z') } }] },
    ]);
  });

  it('RM-03C introduces no private-vs-catalog precedence in the candidate read', async () => {
    const { tx } = makeSuccessTx();
    prisma.$transaction.mockImplementation((callback: any) => callback(tx));

    await service.selectForBoqItem(selectionInput);

    const call = tx.basicPrice.findMany.mock.calls[0][0];
    // No ordering at all on the candidate read: cardinality is decided by the
    // scope-blind kernel (>1 compatible candidate -> NEEDS_REVIEW, a human
    // decides), never by an implicit "private wins" or "catalog wins".
    expect(call).not.toHaveProperty('orderBy');
    expect(JSON.stringify(call.where)).not.toContain('orderBy');
  });

  it('E1A-06 uses the real kernel to hold one EXPIRED candidate for review without revalidation', async () => {
    const { tx, created, price } = makeSuccessTx();
    price.freshnessStatus = 'EXPIRED';
    prisma.$transaction.mockImplementation((callback: any) => callback(tx));

    await service.selectForBoqItem(selectionInput);

    expect(created.data.resourceResolutions.create[0]).toMatchObject({
      status: 'NEEDS_REVIEW',
      selectedBasicPriceId: null,
      selectedFreshnessStatus: null,
    });
    expect(created.data.resourceResolutions.create[0].reasonCodes).toContain(
      'ONLY_EXPIRED_BASIC_PRICE_CANDIDATES',
    );
    expect(created.data.resourceResolutions.create[0].explanation).toContain(
      'seluruh 1 Basic Price yang kompatibel',
    );
    expect(created.data.resourceResolutions.create[0].explanation).toContain(
      'Pemilihan otomatis ditahan',
    );
    expect(tx.basicPrice.findFirst).not.toHaveBeenCalled();
    expect(tx.projectAhspOccurrence.create).toHaveBeenCalledTimes(1);
  });

  it('O-01/O-02 successor: N resources create one occurrence with exactly N resolutions', async () => {
    const resources = [resource('resource-1'), resource('resource-2'), resource('resource-3')];
    const { tx, created } = makeSuccessTx(resources);
    prisma.$transaction.mockImplementation((callback: any) => callback(tx));
    jest.spyOn(kernel, 'resolveAhspResourcePrice').mockImplementation((input: any) => ({ ...input, status: 'UNRESOLVED', reasonCodes: ['NO_CATALOG_CANDIDATE'], explanation: 'none' }));
    await service.selectForBoqItem(selectionInput);
    expect(tx.projectAhspOccurrence.create).toHaveBeenCalledTimes(1);
    expect(created.data.resourceResolutions.create).toHaveLength(3);
  });

  it('O-01 successor: RESOLVED evidence keeps exact Decimal strings and one atomic pointer write', async () => {
    const { tx, created, catalog, price } = makeSuccessTx();
    prisma.$transaction.mockImplementation((callback: any) => callback(tx));
    jest.spyOn(kernel, 'resolveAhspResourcePrice').mockReturnValue({
      projectId: selectionInput.projectId,
      ahspVersionId: selectionInput.ahspVersionId,
      ahspResourceId: 'resource-1',
      rawResourceRef: 'Resource resource-1',
      status: 'RESOLVED',
      resolvedResourceCatalogId: catalog.id,
      selectedBasicPriceId: price.id,
      canonicalUnit: 'PERSON_DAY',
      sourcePriceValue: '1234567890123456.78',
      adaptedPriceValue: '1234567890123456.78',
      sourceOrigin: 'SUPPLIER',
      reasonCodes: ['EXACT_MATCH'],
      explanation: 'exact',
    });
    await service.selectForBoqItem(selectionInput);
    expect(created.data.resourceResolutions.create[0]).toMatchObject({
      status: 'RESOLVED',
      sourcePriceValue: '1234567890123456.78',
      adaptedPriceValue: '1234567890123456.78',
    });
    expect(tx.boqItem.update).toHaveBeenCalledWith({
      where: { id: selectionInput.boqItemId },
      data: { ahspVersionId: selectionInput.ahspVersionId, workingOccurrenceId: 'occurrence-new' },
    });
  });

  it('unit-kernel successor: resolves AHSP and candidate units without a duplicate conversion implementation', async () => {
    const { tx } = makeSuccessTx();
    prisma.$transaction.mockImplementation((callback: any) => callback(tx));
    jest.spyOn(kernel, 'resolveAhspResourcePrice').mockImplementation((input: any) => ({ ...input, status: 'UNRESOLVED', reasonCodes: ['NO_PRICE'], explanation: 'none' }));
    await service.selectForBoqItem(selectionInput);
    expect(units.resolve).toHaveBeenCalledTimes(2);
  });

  it('O-03 successor: UNRESOLVED is persisted without selected evidence', async () => {
    const { tx, created } = makeSuccessTx();
    prisma.$transaction.mockImplementation((callback: any) => callback(tx));
    jest.spyOn(kernel, 'resolveAhspResourcePrice').mockImplementation((input: any) => ({ ...input, status: 'UNRESOLVED', reasonCodes: ['INSUFFICIENT_EVIDENCE'], explanation: 'honest' }));
    await service.selectForBoqItem(selectionInput);
    expect(created.data.resourceResolutions.create[0]).toMatchObject({ status: 'UNRESOLVED', selectedBasicPriceId: null, selectionMode: null });
  });

  it('O-03 successor: NEEDS_REVIEW is persisted without selected evidence', async () => {
    const { tx, created } = makeSuccessTx();
    prisma.$transaction.mockImplementation((callback: any) => callback(tx));
    jest.spyOn(kernel, 'resolveAhspResourcePrice').mockImplementation((input: any) => ({ ...input, status: 'NEEDS_REVIEW', reasonCodes: ['MULTIPLE_CANDIDATES'], explanation: 'review' }));
    await service.selectForBoqItem(selectionInput);
    expect(created.data.resourceResolutions.create[0]).toMatchObject({ status: 'NEEDS_REVIEW', selectedBasicPriceId: null, selectionMode: null });
  });

  it('revalidation successor: selected Basic Price disappearing becomes truthful UNRESOLVED', async () => {
    const { tx, created, catalog, price } = makeSuccessTx();
    tx.basicPrice.findFirst.mockResolvedValue(null);
    prisma.$transaction.mockImplementation((callback: any) => callback(tx));
    jest.spyOn(kernel, 'resolveAhspResourcePrice').mockReturnValue({
      projectId: selectionInput.projectId, ahspVersionId: selectionInput.ahspVersionId, ahspResourceId: 'resource-1', rawResourceRef: 'Resource resource-1',
      status: 'RESOLVED', resolvedResourceCatalogId: catalog.id, selectedBasicPriceId: price.id, canonicalUnit: 'PERSON_DAY', sourcePriceValue: price.value.toString(), adaptedPriceValue: price.value.toString(), sourceOrigin: 'SUPPLIER', reasonCodes: ['EXACT_MATCH'], explanation: 'exact',
    });
    await service.selectForBoqItem(selectionInput);
    expect(created.data.resourceResolutions.create[0]).toMatchObject({ status: 'UNRESOLVED', selectedBasicPriceId: null, selectionMode: null });
  });

  it('O-04/O-05 successor: retry inserts next generation and previous lineage without mutating old bytes', async () => {
    const { tx, created } = makeSuccessTx();
    const old = { id: 'occurrence-old', generation: 4, updatedAt: new Date('2026-08-01T00:00:00Z') };
    const before = JSON.stringify(old);
    tx.projectAhspOccurrence.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(old);
    prisma.$transaction.mockImplementation((callback: any) => callback(tx));
    jest.spyOn(kernel, 'resolveAhspResourcePrice').mockImplementation((input: any) => ({ ...input, status: 'UNRESOLVED', reasonCodes: ['NO_PRICE'], explanation: 'none' }));
    await service.selectForBoqItem(selectionInput);
    expect(created.data).toMatchObject({ generation: 5, previousOccurrenceId: 'occurrence-old' });
    expect(JSON.stringify(old)).toBe(before);
    expect(Object.keys(tx.projectAhspOccurrence)).not.toContain('update');
    expect(Object.keys(tx.projectAhspOccurrence)).not.toContain('updateMany');
  });

  it('P2002 successor: a same-payload race returns the winning generation', async () => {
    const winner = { id: 'winner', requestPayloadHash: requestHash(), resourceResolutions: [] };
    prisma.$transaction.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('race', { code: 'P2002', clientVersion: 'test' }));
    prisma.projectAhspOccurrence.findFirst.mockResolvedValue(winner);
    await expect(service.selectForBoqItem(selectionInput)).resolves.toBe(winner);
  });

  it('P2002 successor: a different-payload race returns 409 Conflict', async () => {
    prisma.$transaction.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('race', { code: 'P2002', clientVersion: 'test' }));
    prisma.projectAhspOccurrence.findFirst.mockResolvedValue({ requestPayloadHash: 'different', resourceResolutions: [] });
    await expect(service.selectForBoqItem(selectionInput)).rejects.toBeInstanceOf(ConflictException);
  });

  it('infrastructure successor: non-P2002 errors are never swallowed', async () => {
    const error = new Error('database unavailable');
    prisma.$transaction.mockRejectedValue(error);
    await expect(service.selectForBoqItem(selectionInput)).rejects.toBe(error);
  });

  it('GET mismatch successor: cross-project or missing occurrence returns 404', async () => {
    prisma.projectAhspOccurrence.findFirst.mockResolvedValue(null);
    await expect(service.findOne('o', 'other-project', workspaceId)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('selection-policy successor: request cannot write USER_OVERRIDDEN or a caller policy version', async () => {
    const { tx, created } = makeSuccessTx();
    prisma.$transaction.mockImplementation((callback: any) => callback(tx));
    jest.spyOn(kernel, 'resolveAhspResourcePrice').mockImplementation((input: any) => ({ ...input, status: 'UNRESOLVED', reasonCodes: ['NO_PRICE'], explanation: 'none' }));
    await service.selectForBoqItem({ ...selectionInput, ...( { selectionMode: 'USER_OVERRIDDEN', resolutionPolicyVersion: 'CALLER' } as any) });
    expect(created.data.resolutionPolicyVersion).toBe('E1A_CONTEXTUAL_EXACT_REGION_V1');
    expect(created.data.resourceResolutions.create[0].selectionMode).toBeNull();
  });
});
