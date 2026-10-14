import { BasicPriceRowResolutionService } from './basic-price-row-resolution.service';

const W = '10000000-0000-4000-8000-000000000004';
const ACTOR = '10000000-0000-4000-8000-000000000007';
const BATCH = '2b81f706-77ce-40c2-98f0-020d603e5ac2';
const ROW = '7ad01c8c-b9af-40b1-83fc-2ff3f35d5390';
const CATALOG = '79c6db2f-1f3d-4db6-88ed-490640ff2ddf';
const UNIT = '10000000-0000-4000-8000-000000000005';
const SOURCE = 'A'.repeat(64);
const NAME = '-  Agreg at  Kasar';
const REASON = 'Keputusan katalog preview lama menggunakan ejaan sumber yang keliru.';

describe('BP-ROW-COMPENSATION-01 — append-only governed self-compensation', () => {
  const build = () => {
    const oldMapping = {
      id: '0209d360-4b32-48a9-8029-842433bf39d3',
      reviewerAccountId: ACTOR,
      resourceCatalogId: CATALOG,
      unitDefinitionId: UNIT,
      compensation: null,
    };
    const row = {
      id: ROW, batchId: BATCH, version: 1, status: 'READY_FOR_SUBMISSION',
      resolutionStatus: 'RESOLVED', resourceCatalogId: CATALOG,
      unitDefinitionId: UNIT, resolvedByAccountId: ACTOR, priceSubmissionId: null,
      privateBasicPrice: null,
      rawResourceNameText: NAME, sourceRowNumber: 8,
      sourceNameCellAddress: 'B8',
      resourceMappings: [oldMapping],
      batch: { id: BATCH, workspaceId: W, uploadedByAccountId: ACTOR, sourceSha256: SOURCE },
    };
    const counts = () => ({ count: jest.fn().mockResolvedValue(0) });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: ROW }]),
      basicPriceImportRow: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(row),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        count: jest.fn().mockImplementation(({ where }: { where: { resourceCatalogId?: string } }) =>
          Promise.resolve(where.resourceCatalogId ? 0 : 1)),
      },
      basicPriceImportBatch: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: BATCH, status: 'NEEDS_REVIEW' }),
        update: jest.fn(),
      },
      basicPriceImportRowResolutionCompensation: {
        create: jest.fn().mockResolvedValue({ id: 'compensation-001' }),
      },
      resourceCatalog: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: CATALOG, workspaceId: W, status: 'ACTIVE', name: NAME,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      resourceSourceIdentity: {
        findMany: jest.fn().mockResolvedValue([{
          id: 'source-001', resourceCatalogId: CATALOG, workspaceId: W,
          sourceSha256: SOURCE, sourceRowNumber: 8,
          rawName: NAME, sourceNameCellAddress: 'B8',
        }]),
      },
      basicPrice: counts(), priceSubmission: counts(), canonicalPricePoint: counts(),
      projectAhspResourceResolution: counts(), unitConversionRule: counts(),
      ahspResourceIdentityDecision: counts(), observedResource: counts(),
      resourceIdentityQuestionDecision: counts(),
      basicPriceImportRowResourceMapping: counts(),
    };
    const prisma = { $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
      callback(tx)) };
    const service = new BasicPriceRowResolutionService(
      prisma as never, {} as never, {} as never, {} as never, {} as never,
    );
    const perform = () => service.compensateOwnDecision(
      W, BATCH, ROW, ACTOR, { version: 1, reason: REASON },
    );
    return { tx, row, oldMapping, perform, prisma };
  };

  it('writes an immutable compensation reference, retires the exclusive catalog, then reopens one row', async () => {
    const { tx, perform, oldMapping, prisma } = build();
    const response = await perform();
    expect(response).toMatchObject({
      rowId: ROW, status: 'NEEDS_REVIEW',
      priorRowVersion: 1, newRowVersion: 2,
      retiredResourceCatalogId: CATALOG,
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.basicPriceImportRowResolutionCompensation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: W, rowId: ROW,
        mappingId: oldMapping.id, resourceCatalogId: CATALOG,
        actorAccountId: ACTOR, reason: REASON,
        priorRowVersion: 1, newRowVersion: 2,
        previousCatalogName: NAME,
      }),
    });
    expect(tx.resourceCatalog.updateMany).toHaveBeenCalledWith({
      where: { id: CATALOG, workspaceId: W, status: 'ACTIVE' },
      data: { status: 'RETIRED' },
    });
    const rowUpdate = tx.basicPriceImportRow.updateMany.mock.calls[0][0];
    expect(rowUpdate.where).toMatchObject({
      id: ROW, batchId: BATCH, version: 1, resourceCatalogId: CATALOG,
    });
    expect(rowUpdate.data).toMatchObject({
      status: 'NEEDS_REVIEW', resolutionStatus: 'UNRESOLVED',
      resourceCatalogId: null, resolvedResourceType: null,
      unitDefinitionId: null, resolvedByAccountId: null, resolvedAt: null,
      version: { increment: 1 },
    });
    expect(rowUpdate.data).not.toHaveProperty('rawResourceNameText');
    expect(rowUpdate.data).not.toHaveProperty('rawUnitText');
    expect(rowUpdate.data).not.toHaveProperty('proposedCanonicalPrice');
    expect(tx.basicPriceImportBatch.findUniqueOrThrow).toHaveBeenCalled();
    expect(tx.basicPriceImportRowResourceMapping.count).toHaveBeenCalled();
  });

  it('rejects stale row version without writing an event or retiring a catalog', async () => {
    const { tx, perform, row } = build();
    row.version = 2;
    await expect(perform()).rejects.toThrow('ROW_VERSION_STALE');
    expect(tx.basicPriceImportRowResolutionCompensation.create).not.toHaveBeenCalled();
    expect(tx.resourceCatalog.updateMany).not.toHaveBeenCalled();
  });

  it('rejects another reviewer even inside the same workspace', async () => {
    const { tx, perform, row } = build();
    row.resolvedByAccountId = 'different-reviewer';
    await expect(perform()).rejects.toThrow('COMPENSATION_ROW_INELIGIBLE');
    expect(tx.basicPriceImportRowResolutionCompensation.create).not.toHaveBeenCalled();
  });

  it('never compensates a batch owned by someone else', async () => {
    const { tx, perform, row } = build();
    row.batch.uploadedByAccountId = 'different-account';
    await expect(perform()).rejects.toThrow('Batch not found');
    expect(tx.basicPriceImportRowResolutionCompensation.create).not.toHaveBeenCalled();
  });

  it('refuses a catalog consumed by any other price, AHSP or row', async () => {
    const { tx, perform } = build();
    tx.projectAhspResourceResolution.count.mockResolvedValue(1);
    await expect(perform()).rejects.toThrow('COMPENSATION_CATALOG_IN_USE');
    expect(tx.basicPriceImportRowResolutionCompensation.create).not.toHaveBeenCalled();
    expect(tx.resourceCatalog.updateMany).not.toHaveBeenCalled();
  });

  it('refuses when the source sighting no longer matches immutable workbook evidence', async () => {
    const { tx, perform } = build();
    tx.resourceSourceIdentity.findMany.mockResolvedValue([{
      id: 'source-001', workspaceId: W, sourceSha256: SOURCE,
      sourceRowNumber: 8, rawName: 'some other original', sourceNameCellAddress: 'B8',
    }]);
    await expect(perform()).rejects.toThrow('COMPENSATION_SOURCE_NOT_EXCLUSIVE');
    expect(tx.basicPriceImportRowResolutionCompensation.create).not.toHaveBeenCalled();
  });

  it('refuses an already compensated decision rather than performing a second compensation', async () => {
    const { tx, perform, oldMapping } = build();
    oldMapping.compensation = { id: 'old-compensation' } as never;
    await expect(perform()).rejects.toThrow('COMPENSATION_DECISION_AMBIGUOUS');
    expect(tx.basicPriceImportRowResolutionCompensation.create).not.toHaveBeenCalled();
  });

  it('refuses a previously saved private price', async () => {
    const { tx, perform, row } = build();
    row.privateBasicPrice = { id: 'saved-price' } as never;
    await expect(perform()).rejects.toThrow('COMPENSATION_ROW_INELIGIBLE');
    expect(tx.basicPriceImportRowResolutionCompensation.create).not.toHaveBeenCalled();
  });
});
