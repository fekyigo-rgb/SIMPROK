import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { BasicPriceRowResolutionService } from './basic-price-row-resolution.service';
import { PrismaService } from '../prisma/prisma.service';

describe('BasicPriceRowResolutionService', () => {
  let service: BasicPriceRowResolutionService;
  let tx: {
    $queryRaw: jest.Mock;
    basicPriceImportRow: { findFirst: jest.Mock; update: jest.Mock; count: jest.Mock };
    basicPriceImportBatch: { findUniqueOrThrow: jest.Mock; update: jest.Mock };
    resourceCatalog: { findUnique: jest.Mock };
    unitDefinition: { findUnique: jest.Mock };
  };
  let prisma: { $transaction: jest.Mock };

  const WORKSPACE_ID = 'ws-01';
  const BATCH_ID = 'batch-01';
  const ROW_ID = 'row-01';

  const baseRow = {
    id: ROW_ID,
    batchId: BATCH_ID,
    version: 0,
    status: 'NEEDS_REVIEW',
    proposedCanonicalPrice: { toString: () => '100.00' },
    resourceCatalogId: null,
    unitDefinitionId: null,
  };

  beforeEach(async () => {
    tx = {
      $queryRaw: jest.fn(),
      basicPriceImportRow: { findFirst: jest.fn(), update: jest.fn(), count: jest.fn() },
      basicPriceImportBatch: { findUniqueOrThrow: jest.fn(), update: jest.fn() },
      resourceCatalog: { findUnique: jest.fn() },
      unitDefinition: { findUnique: jest.fn() },
    };
    prisma = { $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(tx)) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [BasicPriceRowResolutionService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<BasicPriceRowResolutionService>(BasicPriceRowResolutionService);

    // Default happy-path stubs; individual tests override as needed.
    tx.$queryRaw.mockImplementation((query: { strings?: readonly string[] }) => {
      const sql = query?.strings?.join('') ?? '';
      if (sql.includes('basic_price_import_batches')) return Promise.resolve([{ id: BATCH_ID, workspaceId: WORKSPACE_ID }]);
      if (sql.includes('basic_price_import_rows')) return Promise.resolve([baseRow]);
      return Promise.resolve([]);
    });
    tx.resourceCatalog.findUnique.mockResolvedValue({ id: 'resource-01', type: 'MATERIAL' });
    tx.unitDefinition.findUnique.mockResolvedValue({ id: 'unit-01' });
    tx.basicPriceImportRow.findFirst.mockResolvedValue(null); // no collision by default
    tx.basicPriceImportRow.count.mockResolvedValue(0); // no other NEEDS_REVIEW rows -> batch can advance
    tx.basicPriceImportBatch.findUniqueOrThrow.mockResolvedValue({ id: BATCH_ID, status: 'NEEDS_REVIEW' });
    tx.basicPriceImportRow.update.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ ...baseRow, ...data }));
  });

  it('throws NotFound when the batch does not belong to the caller workspace', async () => {
    tx.$queryRaw.mockImplementation((query: { strings?: readonly string[] }) => {
      const sql = query?.strings?.join('') ?? '';
      if (sql.includes('basic_price_import_batches')) return Promise.resolve([{ id: BATCH_ID, workspaceId: 'other-workspace' }]);
      return Promise.resolve([baseRow]);
    });
    await expect(
      service.resolveRow(WORKSPACE_ID, BATCH_ID, ROW_ID, { version: 0, resourceCatalogId: 'r', unitDefinitionId: 'u' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a stale version (optimistic concurrency, test matrix I06)', async () => {
    await expect(
      service.resolveRow(WORKSPACE_ID, BATCH_ID, ROW_ID, { version: 99, resourceCatalogId: 'r', unitDefinitionId: 'u' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.basicPriceImportRow.update).not.toHaveBeenCalled();
  });

  it('rejects resolving a row that is not NEEDS_REVIEW (already resolved/rejected/submitted)', async () => {
    tx.$queryRaw.mockImplementation((query: { strings?: readonly string[] }) => {
      const sql = query?.strings?.join('') ?? '';
      if (sql.includes('basic_price_import_batches')) return Promise.resolve([{ id: BATCH_ID, workspaceId: WORKSPACE_ID }]);
      return Promise.resolve([{ ...baseRow, status: 'SUBMISSION_CREATED' }]);
    });
    await expect(
      service.resolveRow(WORKSPACE_ID, BATCH_ID, ROW_ID, { version: 0, resourceCatalogId: 'r', unitDefinitionId: 'u' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('resolves cleanly to READY_FOR_SUBMISSION when the resource/unit exist and no collision is found', async () => {
    const result = await service.resolveRow(WORKSPACE_ID, BATCH_ID, ROW_ID, {
      version: 0,
      resourceCatalogId: 'resource-01',
      unitDefinitionId: 'unit-01',
    });

    expect(tx.basicPriceImportRow.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          resourceCatalogId: 'resource-01',
          unitDefinitionId: 'unit-01',
          collisionType: 'NONE',
          resolutionStatus: 'RESOLVED',
          status: 'READY_FOR_SUBMISSION',
          version: { increment: 1 },
        }),
      }),
    );
    expect(result.status).toBe('READY_FOR_SUBMISSION');
  });

  it('a same-identity, same-value collision with another row in the batch stays NEEDS_REVIEW, never auto-submits', async () => {
    tx.basicPriceImportRow.findFirst.mockResolvedValue({
      id: 'other-row',
      proposedCanonicalPrice: { toString: () => '100.00' },
    });

    const result = await service.resolveRow(WORKSPACE_ID, BATCH_ID, ROW_ID, {
      version: 0,
      resourceCatalogId: 'resource-01',
      unitDefinitionId: 'unit-01',
    });

    expect(tx.basicPriceImportRow.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          collisionType: 'SAME_IDENTITY_SAME_VALUE',
          collisionOfRowId: 'other-row',
          status: 'NEEDS_REVIEW',
        }),
      }),
    );
    expect(result.status).toBe('NEEDS_REVIEW');
  });

  it('a same-identity, different-value collision is flagged distinctly and also stays NEEDS_REVIEW', async () => {
    tx.basicPriceImportRow.findFirst.mockResolvedValue({
      id: 'other-row',
      proposedCanonicalPrice: { toString: () => '999.00' },
    });

    const result = await service.resolveRow(WORKSPACE_ID, BATCH_ID, ROW_ID, {
      version: 0,
      resourceCatalogId: 'resource-01',
      unitDefinitionId: 'unit-01',
    });

    expect(tx.basicPriceImportRow.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ collisionType: 'SAME_IDENTITY_DIFFERENT_VALUE' }) }),
    );
    expect(result.status).toBe('NEEDS_REVIEW');
  });

  it('rejects resolving to an unknown resourceCatalogId (fail closed, never a fabricated identity)', async () => {
    tx.resourceCatalog.findUnique.mockResolvedValue(null);
    await expect(
      service.resolveRow(WORKSPACE_ID, BATCH_ID, ROW_ID, { version: 0, resourceCatalogId: 'ghost', unitDefinitionId: 'unit-01' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.basicPriceImportRow.update).not.toHaveBeenCalled();
  });

  it('rejects resolving to an unknown unitDefinitionId', async () => {
    tx.unitDefinition.findUnique.mockResolvedValue(null);
    await expect(
      service.resolveRow(WORKSPACE_ID, BATCH_ID, ROW_ID, { version: 0, resourceCatalogId: 'resource-01', unitDefinitionId: 'ghost' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('reject() requires a version match and records the reason', async () => {
    const result = await service.rejectRow(WORKSPACE_ID, BATCH_ID, ROW_ID, { version: 0, reason: 'wrong resource, superseded by row 12' });
    expect(tx.basicPriceImportRow.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'REJECTED',
          reasonCodes: { push: 'REJECTED:wrong resource, superseded by row 12' },
        }),
      }),
    );
    expect(result.status).toBe('REJECTED');
  });

  it('reject() fails closed on a stale version', async () => {
    await expect(service.rejectRow(WORKSPACE_ID, BATCH_ID, ROW_ID, { version: 7, reason: 'x' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('advances the batch to READY_FOR_REVIEW only when zero rows remain NEEDS_REVIEW', async () => {
    tx.basicPriceImportRow.count.mockResolvedValue(0);
    await service.resolveRow(WORKSPACE_ID, BATCH_ID, ROW_ID, { version: 0, resourceCatalogId: 'resource-01', unitDefinitionId: 'unit-01' });
    expect(tx.basicPriceImportBatch.update).toHaveBeenCalledWith({ where: { id: BATCH_ID }, data: { status: 'READY_FOR_REVIEW' } });
  });

  it('leaves the batch at NEEDS_REVIEW while any row is still pending', async () => {
    tx.basicPriceImportRow.count.mockResolvedValue(2);
    await service.resolveRow(WORKSPACE_ID, BATCH_ID, ROW_ID, { version: 0, resourceCatalogId: 'resource-01', unitDefinitionId: 'unit-01' });
    expect(tx.basicPriceImportBatch.update).not.toHaveBeenCalled();
  });
});
