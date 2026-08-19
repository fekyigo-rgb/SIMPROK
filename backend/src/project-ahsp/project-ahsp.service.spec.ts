import { ConflictException } from '@nestjs/common';
import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import * as kernel from '../ahsp/price-resolution/ahsp-resource-price-resolution.kernel';
import { BasicPriceEligibilityPolicy } from '../basic-price/basic-price-eligibility.policy';
import { ProjectAhspService } from './project-ahsp.service';
import {
  AhspResourceResolutionOrchestrator,
  E1A_RESOLUTION_POLICY_VERSION,
} from './ahsp-resource-resolution.orchestrator';
import { ResourceIdentityResolutionService } from '../resource-catalog/resource-identity-resolution.service';

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
          // Read from the shipped constant, never retyped. The policy version
          // is part of the idempotency payload BY DESIGN — advancing the law
          // must make a replayed request a different request — so a literal
          // here would silently assert the old law forever.
          resolutionPolicyVersion: E1A_RESOLUTION_POLICY_VERSION,
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

  const makeSuccessTx = (
    resources = [resource('resource-1')],
    /**
     * RAB-TRUTH-01H — the AHSP ownership as the transaction sees it right now.
     * Varying this between two selections is exactly what a lawful ownership
     * transfer does between two calculations.
     */
    ownershipType: string | null = 'USER_ASSET',
  ) => {
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
          ahsp: ownershipType === null ? null : { ownershipType },
        }),
      },
      resourceCatalog: { findMany: jest.fn().mockResolvedValue([catalog]) },
      // RM-03D1: the identity evidence the resolver may now consult. Empty by
      // default, so every case below still resolves purely on exact canonical
      // name exactly as it did before — a recorded human mapping must never be
      // what makes a previously-passing assertion pass.
      resourceSourceIdentity: { findMany: jest.fn().mockResolvedValue([]) },
      basicPriceImportRowResourceMapping: {
        findMany: jest.fn().mockResolvedValue([]),
      },
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
    // RM-03D1: the REAL identity service too, for the same reason the real
    // eligibility policy is used above — a stub could only assert the identity
    // rule this spec already believed in, whereas the shipped loader + kernel
    // are exactly what must run against the transaction client.
    // RM-03D1: the resolution loop now lives in a shared orchestrator so the
    // RAB pre-lock gate can ask the SAME authority. The REAL orchestrator is
    // built from the SAME real policy/units/identity instances this spec
    // already used, so every assertion below still exercises the shipped
    // decision path rather than a stub of it.
    const eligibility = new BasicPriceEligibilityPolicy();
    // RM-03D2: the REAL identity service now consults the Unit authority to
    // settle an exact-representation tie, so it takes the SAME real-ish unit
    // stub this spec already drives the orchestrator with. Nothing about the
    // identity decision itself is stubbed.
    const identity = new ResourceIdentityResolutionService(prisma, units as any);
    service = new ProjectAhspService(
      prisma,
      eligibility,
      units as any,
      lifecycle as any,
      identity,
      new AhspResourceResolutionOrchestrator(eligibility, units as any, identity),
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

  /**
   * RAB-TRUTH-01H — A CALCULATION REMEMBERS THE AUTHORITY THAT FORMED IT.
   *
   * Behavioural, through the real selection path: two selections are made with
   * a lawful ownership transfer between them, and each occurrence must record
   * the ownership as it stood when THAT occurrence was created. The old one
   * must not be re-interpreted by the new reality — that was the drift.
   */
  describe('freezes the AHSP ownership that formed each occurrence', () => {
    const selectWithOwnership = async (ownershipType: string | null) => {
      const { tx, created } = makeSuccessTx([resource('resource-1')], ownershipType);
      prisma.$transaction.mockImplementation((callback: any) => callback(tx));
      jest.spyOn(kernel, 'resolveAhspResourcePrice').mockImplementation((input: any) => ({
        ...input,
        status: 'UNRESOLVED',
        reasonCodes: ['NO_CATALOG_CANDIDATE'],
        explanation: 'none',
      }));
      await service.selectForBoqItem(selectionInput);
      return created;
    };

    it('occurrence A, created while the AHSP is a user asset, freezes USER_ASSET', async () => {
      const occurrenceA = await selectWithOwnership('USER_ASSET');
      expect(occurrenceA.data.ahspOwnershipAtCalculation).toBe('USER_ASSET');
    });

    it('occurrence B, created after a lawful transfer, freezes the NEW authority', async () => {
      // Same row, same input — only the AHSP's ownership changed in between,
      // exactly as a transfer would leave it.
      const occurrenceA = await selectWithOwnership('USER_ASSET');
      const occurrenceB = await selectWithOwnership('SIMPROK_ASSET');

      expect(occurrenceA.data.ahspOwnershipAtCalculation).toBe('USER_ASSET');
      expect(occurrenceB.data.ahspOwnershipAtCalculation).toBe('SIMPROK_ASSET');
      // The old capture is untouched by the new one: history and present are
      // two different rows, each answering for its own moment.
      expect(occurrenceA.data.ahspOwnershipAtCalculation).not.toBe(
        occurrenceB.data.ahspOwnershipAtCalculation,
      );
    });

    it('an approved community asset is captured verbatim, not normalised', async () => {
      const created = await selectWithOwnership('APPROVED_COMMUNITY_ASSET');
      expect(created.data.ahspOwnershipAtCalculation).toBe('APPROVED_COMMUNITY_ASSET');
    });

    it('an unknowable ownership is captured as null, never invented', async () => {
      const created = await selectWithOwnership(null);
      expect(created.data.ahspOwnershipAtCalculation).toBeNull();
    });
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
    expect(created.data.resolutionPolicyVersion).toBe(E1A_RESOLUTION_POLICY_VERSION);
    expect(created.data.resourceResolutions.create[0].selectionMode).toBeNull();
  });

  // ==========================================================
  // RM-03D1 — resource identity reaches the persisted occurrence
  // ==========================================================

  it('RM03D1: a row-scoped human decision enriches the exception and never prices the line', async () => {
    const { tx, created, catalog } = makeSuccessTx();
    // The AHSP says one thing, the catalog is spelled another — the exact-name
    // path alone could never join these two.
    tx.aHSPVersion.findFirst.mockResolvedValue({
      id: selectionInput.ahspVersionId,
      outputUnit: 'M1',
      resources: [{ ...resource('resource-1'), resourceId: 'Kawat bendrat' }],
    });
    tx.resourceCatalog.findMany.mockResolvedValue([
      { ...catalog, name: 'Kawat benrad' },
    ]);
    tx.basicPriceImportRowResourceMapping.findMany.mockResolvedValue([
      {
        resourceCatalogId: catalog.id,
        reviewerAccountId: selectionInput.accountId,
        decidedAt: new Date('2026-08-07T00:00:00.000Z'),
        reason: 'Ejaan sumber berbeda, barang sama.',
        row: {
          rawResourceNameText: 'Kawat bendrat',
          rawResourceCodeText: 'M.72',
          resolvedResourceType: 'LABOR',
          sourceSection: 'LABOR',
        },
      },
    ]);
    prisma.$transaction.mockImplementation((callback: any) => callback(tx));

    await service.selectForBoqItem(selectionInput);

    const persisted = created.data.resourceResolutions.create[0];
    // The human settled what one Basic Price import row meant. Nobody asked
    // them about this AHSP line, so nothing here answers for them.
    expect(persisted.status).toBe('NEEDS_REVIEW');
    expect(persisted.reasonCodes).not.toContain('VERIFIED_MAPPING_REUSED');
    expect(persisted.reasonCodes).not.toContain('RESOURCE_NOT_FOUND');
    // Their work is still not wasted: the right row is named in the exception.
    expect(persisted.explanation).toContain('Kawat benrad');
    expect(persisted.explanation).toContain(catalog.id);
    // And no money was derived from an unproven identity.
    expect(persisted.resourceCatalogId).toBeNull();
    expect(persisted.selectedBasicPriceId).toBeNull();
    expect(persisted.adaptedPriceValue).toBeNull();
    // The raw AHSP reference is preserved verbatim, never overwritten.
    expect(persisted.rawAhspResourceRef).toBe('Kawat bendrat');
  });

  it('RM03D1: an unproven identity is persisted as a reviewable exception, never as "not found"', async () => {
    const { tx, created, catalog } = makeSuccessTx();
    tx.aHSPVersion.findFirst.mockResolvedValue({
      id: selectionInput.ahspVersionId,
      outputUnit: 'M1',
      resources: [{ ...resource('resource-1'), resourceId: 'Portland Cement' }],
    });
    // Two plausible cements and no recorded human decision between them.
    tx.resourceCatalog.findMany.mockResolvedValue([
      { ...catalog, id: 'cat-a', name: 'Semen Portlan' },
      { ...catalog, id: 'cat-b', name: 'Semen Portland / Tonasa' },
    ]);
    prisma.$transaction.mockImplementation((callback: any) => callback(tx));

    await service.selectForBoqItem(selectionInput);

    const persisted = created.data.resourceResolutions.create[0];
    expect(persisted.status).toBe('NEEDS_REVIEW');
    expect(persisted.reasonCodes).toContain('MULTIPLE_CANDIDATES_NEEDS_REVIEW');
    expect(persisted.reasonCodes).not.toContain('RESOURCE_NOT_FOUND');
    // Both candidates, with their ids, survive into the stored explanation so
    // the exception can be closed later without re-running discovery.
    expect(persisted.explanation).toContain('Semen Portlan');
    expect(persisted.explanation).toContain('Semen Portland / Tonasa');
    expect(persisted.explanation).toContain('cat-a');
    // Nothing was priced off an unproven identity.
    expect(persisted.resourceCatalogId).toBeNull();
    expect(persisted.selectedBasicPriceId).toBeNull();
    expect(persisted.adaptedPriceValue).toBeNull();
  });

  it('RM03D1: an exact name whose catalog row claims more than the source lets no money through', async () => {
    const { tx, created, catalog } = makeSuccessTx();
    tx.aHSPVersion.findFirst.mockResolvedValue({
      id: selectionInput.ahspVersionId,
      outputUnit: 'M1',
      resources: [{ ...resource('resource-1'), resourceId: 'Baja tulangan' }],
    });
    // Names match exactly; the row additionally claims a grade and a diameter
    // the AHSP never mentioned.
    tx.resourceCatalog.findMany.mockResolvedValue([
      {
        ...catalog,
        name: 'Baja tulangan',
        specifications: { grade: 'BjTS 420B', diameter: 13 },
      },
    ]);
    prisma.$transaction.mockImplementation((callback: any) => callback(tx));

    await service.selectForBoqItem(selectionInput);

    const persisted = created.data.resourceResolutions.create[0];
    expect(persisted.status).toBe('NEEDS_REVIEW');
    expect(persisted.reasonCodes).toContain('SPECIFICATION_UNPROVED');
    // Money safety: an unproven specification must stop every monetary field.
    expect(persisted.resourceCatalogId).toBeNull();
    expect(persisted.selectedBasicPriceId).toBeNull();
    expect(persisted.adaptedPriceValue).toBeNull();
    expect(persisted.sourcePriceValue).toBeNull();
    // And the reviewer is told exactly which claims are unsupported.
    expect(persisted.explanation).toContain('BjTS 420B');
  });

  it('RM03D1: the AHSP source code channel is empty, never back-filled from the catalog', async () => {
    // AHSPResource carries no source-code column, and no existing model binds
    // one to a resource. Taking the code from the candidate catalog row would
    // make the evidence prove itself, so the channel is passed through empty.
    const { tx, catalog } = makeSuccessTx();
    tx.aHSPVersion.findFirst.mockResolvedValue({
      id: selectionInput.ahspVersionId,
      outputUnit: 'M1',
      resources: [{ ...resource('resource-1'), resourceId: 'Kawat bendrat' }],
    });
    tx.resourceCatalog.findMany.mockResolvedValue([
      { ...catalog, name: 'Kawat benrad', code: 'M.72' },
    ]);
    prisma.$transaction.mockImplementation((callback: any) => callback(tx));

    const identityService = (service as any).identity;
    const resolveSpy = jest.spyOn(identityService, 'resolve');

    await service.selectForBoqItem(selectionInput);

    expect(resolveSpy).toHaveBeenCalled();
    const reference = resolveSpy.mock.calls[0][1] as { rawCode: unknown; rawName: string };
    expect(reference.rawCode).toBeNull();
    expect(reference.rawName).toBe('Kawat bendrat');
  });

  it('RM03D1: a genuinely unknown resource is still reported as not found, with no candidates', async () => {
    const { tx, created, catalog } = makeSuccessTx();
    tx.aHSPVersion.findFirst.mockResolvedValue({
      id: selectionInput.ahspVersionId,
      outputUnit: 'M1',
      resources: [{ ...resource('resource-1'), resourceId: 'Geotextile Woven' }],
    });
    tx.resourceCatalog.findMany.mockResolvedValue([
      { ...catalog, name: 'Kawat benrad' },
    ]);
    prisma.$transaction.mockImplementation((callback: any) => callback(tx));

    await service.selectForBoqItem(selectionInput);

    const persisted = created.data.resourceResolutions.create[0];
    expect(persisted.status).toBe('UNRESOLVED');
    expect(persisted.reasonCodes).toContain('RESOURCE_NOT_FOUND');
    expect(persisted.selectedBasicPriceId).toBeNull();
  });
});
