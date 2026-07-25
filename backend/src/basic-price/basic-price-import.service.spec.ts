import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { BasicPriceImportService } from './basic-price-import.service';
import { PrismaService } from '../prisma/prisma.service';
import { buildBasicPriceXlsx } from '../../test/fixtures/basic-price-xlsx.fixture';

describe('BasicPriceImportService', () => {
  let service: BasicPriceImportService;
  let tx: {
    basicPriceImportBatch: { create: jest.Mock; update: jest.Mock; findUniqueOrThrow: jest.Mock };
    basicPriceImportRow: { create: jest.Mock; count: jest.Mock; findMany: jest.Mock; findUniqueOrThrow: jest.Mock; update: jest.Mock };
    priceSubmission: { create: jest.Mock; update: jest.Mock };
    priceSubmissionRevision: { create: jest.Mock };
    priceSubmissionAudit: { create: jest.Mock };
    $queryRaw: jest.Mock;
  };
  let prisma: {
    workspace: { findUnique: jest.Mock };
    basicPriceImportBatch: { findUnique: jest.Mock; findUniqueOrThrow: jest.Mock };
    basicPriceImportRow: { findMany: jest.Mock };
    $transaction: jest.Mock;
  };

  const WORKSPACE_ID = 'ws-01';
  const ORGANIZATION_ID = 'org-01';
  const ACCOUNT_ID = 'account-01';

  const uploadFile = async () => {
    const buffer = await buildBasicPriceXlsx();
    return { buffer, size: buffer.length, originalname: 'basic-price.xlsx' };
  };

  beforeEach(async () => {
    tx = {
      basicPriceImportBatch: { create: jest.fn(), update: jest.fn(), findUniqueOrThrow: jest.fn() },
      basicPriceImportRow: { create: jest.fn(), count: jest.fn(), findMany: jest.fn(), findUniqueOrThrow: jest.fn(), update: jest.fn() },
      priceSubmission: { create: jest.fn(), update: jest.fn() },
      priceSubmissionRevision: { create: jest.fn() },
      priceSubmissionAudit: { create: jest.fn() },
      $queryRaw: jest.fn(),
    };
    prisma = {
      workspace: { findUnique: jest.fn().mockResolvedValue({ organizationId: ORGANIZATION_ID }) },
      basicPriceImportBatch: { findUnique: jest.fn().mockResolvedValue(null), findUniqueOrThrow: jest.fn() },
      basicPriceImportRow: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(tx)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [BasicPriceImportService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<BasicPriceImportService>(BasicPriceImportService);

    let counter = 0;
    let batchCounter = 0;
    tx.basicPriceImportBatch.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ id: `batch-${++batchCounter}`, version: 0, ...data }));
    tx.basicPriceImportRow.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ id: `row-${++counter}`, version: 0, ...data }));
    // Scoped per-batch (by counting create() calls for that exact batchId)
    // so a test that calls preview() more than once still sees an accurate
    // count for each individual batch, matching real Prisma semantics.
    tx.basicPriceImportRow.count.mockImplementation(({ where }: { where: { batchId: string } }) =>
      Promise.resolve(tx.basicPriceImportRow.create.mock.calls.filter(([arg]: [{ data: Record<string, unknown> }]) => arg.data.batchId === where.batchId).length),
    );
  });

  describe('preview', () => {
    it('rejects a missing file', async () => {
      await expect(service.preview(WORKSPACE_ID, ACCOUNT_ID, undefined as any, {})).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a non-.xlsx filename', async () => {
      const file = { buffer: Buffer.from('x'), size: 1, originalname: 'basic-price.csv' };
      await expect(service.preview(WORKSPACE_ID, ACCOUNT_ID, file, {})).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws NotFound when the workspace does not resolve to an organization', async () => {
      prisma.workspace.findUnique.mockResolvedValue(null);
      const file = await uploadFile();
      await expect(service.preview(WORKSPACE_ID, ACCOUNT_ID, file, {})).rejects.toBeInstanceOf(NotFoundException);
    });

    it('creates a persisted batch and rows, every row starting NEEDS_REVIEW (no row can be RESOLVED at parse time)', async () => {
      const file = await uploadFile();
      const result = await service.preview(WORKSPACE_ID, ACCOUNT_ID, file, {});

      expect(tx.basicPriceImportBatch.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ workspaceId: WORKSPACE_ID, organizationId: ORGANIZATION_ID, uploadedByAccountId: ACCOUNT_ID, status: 'NEEDS_REVIEW' }),
        }),
      );
      expect(tx.basicPriceImportRow.create).toHaveBeenCalled();
      const allRowCreateCalls = tx.basicPriceImportRow.create.mock.calls;
      expect(allRowCreateCalls.every(([arg]: [{ data: Record<string, unknown> }]) => arg.data.status === 'NEEDS_REVIEW' && arg.data.resolutionStatus === 'UNRESOLVED')).toBe(true);
      expect(result.status).toBe('NEEDS_REVIEW');
      expect(result.totalRows).toBeGreaterThan(0);
    });

    it('REPLAY (I01): the exact same file + same metadata returns the existing batch, never re-parses into new rows', async () => {
      const file = await uploadFile();
      const existingBatch = { id: 'existing-batch', workspaceId: WORKSPACE_ID, importFingerprint: 'X', status: 'NEEDS_REVIEW', version: 0 };
      prisma.basicPriceImportBatch.findUnique.mockResolvedValue(existingBatch);
      prisma.basicPriceImportRow.findMany.mockResolvedValue([{ id: 'r1', status: 'NEEDS_REVIEW', resolutionStatus: 'UNRESOLVED', rawResourceNameText: 'X', sourceSection: 'LABOR', sourceRowNumber: 9 }]);

      const result = await service.preview(WORKSPACE_ID, ACCOUNT_ID, file, {});

      expect(tx.basicPriceImportBatch.create).not.toHaveBeenCalled();
      expect(result.batchId).toBe('existing-batch');
    });

    it('I02: identical file with different metadata (e.g. a different regionId) produces a different fingerprint than an empty-metadata preview', async () => {
      const file = await uploadFile();
      await service.preview(WORKSPACE_ID, ACCOUNT_ID, file, {});
      const fingerprintA = tx.basicPriceImportBatch.create.mock.calls[0][0].data.importFingerprint;

      tx.basicPriceImportBatch.create.mockClear();
      await service.preview(WORKSPACE_ID, ACCOUNT_ID, file, { regionId: '10000000-0000-4000-8000-000000000099' });
      const fingerprintB = tx.basicPriceImportBatch.create.mock.calls[0][0].data.importFingerprint;

      expect(fingerprintA).not.toBe(fingerprintB);
    });
  });

  describe('submitBatch', () => {
    const lockedBatch = {
      id: 'batch-01',
      workspaceId: WORKSPACE_ID,
      organizationId: ORGANIZATION_ID,
      status: 'READY_FOR_REVIEW',
      effectiveDate: new Date('2026-01-01'),
      regionId: 'region-01',
      sourceType: 'MARKET_SURVEY',
      sourceOrigin: 'GOVERNMENT',
      uploadedByAccountId: ACCOUNT_ID,
    };

    beforeEach(() => {
      tx.$queryRaw.mockImplementation((query: { strings?: readonly string[] }) => {
        const sql = query?.strings?.join('') ?? '';
        if (sql.includes('basic_price_import_batches')) return Promise.resolve([lockedBatch]);
        if (sql.includes("\"status\" = 'READY_FOR_SUBMISSION'")) return Promise.resolve([{ id: 'row-1' }]);
        return Promise.resolve([]);
      });
      tx.basicPriceImportRow.findUniqueOrThrow.mockResolvedValue({
        id: 'row-1',
        resourceCatalogId: 'resource-01',
        proposedCanonicalPrice: '158333.33',
        effectiveDateOverride: null,
      });
      tx.priceSubmission.create.mockResolvedValue({ id: 'submission-1' });
      tx.priceSubmissionRevision.create.mockResolvedValue({ id: 'revision-1' });
      tx.basicPriceImportRow.count.mockResolvedValue(0); // no REJECTED rows
      tx.basicPriceImportRow.findMany.mockResolvedValue([{ id: 'row-1', status: 'SUBMISSION_CREATED' }]);
      tx.basicPriceImportBatch.update.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ ...lockedBatch, ...data }));
    });

    it('rejects when effectiveDate is missing', async () => {
      tx.$queryRaw.mockImplementation((query: { strings?: readonly string[] }) => {
        const sql = query?.strings?.join('') ?? '';
        if (sql.includes('basic_price_import_batches')) return Promise.resolve([{ ...lockedBatch, effectiveDate: null }]);
        return Promise.resolve([]);
      });
      await expect(service.submitBatch(WORKSPACE_ID, 'batch-01')).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects when regionId is missing', async () => {
      tx.$queryRaw.mockImplementation((query: { strings?: readonly string[] }) => {
        const sql = query?.strings?.join('') ?? '';
        if (sql.includes('basic_price_import_batches')) return Promise.resolve([{ ...lockedBatch, regionId: null }]);
        return Promise.resolve([]);
      });
      await expect(service.submitBatch(WORKSPACE_ID, 'batch-01')).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects when sourceOrigin is missing (structural PriceSubmission requirement, never fabricated)', async () => {
      tx.$queryRaw.mockImplementation((query: { strings?: readonly string[] }) => {
        const sql = query?.strings?.join('') ?? '';
        if (sql.includes('basic_price_import_batches')) return Promise.resolve([{ ...lockedBatch, sourceOrigin: null }]);
        return Promise.resolve([]);
      });
      await expect(service.submitBatch(WORKSPACE_ID, 'batch-01')).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects a batch not in READY_FOR_REVIEW', async () => {
      tx.$queryRaw.mockImplementation((query: { strings?: readonly string[] }) => {
        const sql = query?.strings?.join('') ?? '';
        if (sql.includes('basic_price_import_batches')) return Promise.resolve([{ ...lockedBatch, status: 'NEEDS_REVIEW' }]);
        return Promise.resolve([]);
      });
      await expect(service.submitBatch(WORKSPACE_ID, 'batch-01')).rejects.toBeInstanceOf(ConflictException);
    });

    it('creates exactly one PriceSubmission + Revision + Audit per READY_FOR_SUBMISSION row, links it back to the row', async () => {
      await service.submitBatch(WORKSPACE_ID, 'batch-01');

      expect(tx.priceSubmission.create).toHaveBeenCalledTimes(1);
      expect(tx.priceSubmission.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            workspaceId: WORKSPACE_ID,
            organizationId: ORGANIZATION_ID,
            resourceId: 'resource-01',
            regionId: 'region-01',
            sourceOrigin: 'GOVERNMENT',
            status: 'SUBMITTED',
          }),
        }),
      );
      expect(tx.priceSubmissionRevision.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ submissionId: 'submission-1', revisionNumber: 1 }) }),
      );
      expect(tx.priceSubmissionAudit.create).toHaveBeenCalledTimes(1);
      expect(tx.basicPriceImportRow.update).toHaveBeenCalledWith({
        where: { id: 'row-1' },
        data: { priceSubmissionId: 'submission-1', status: 'SUBMISSION_CREATED' },
      });
    });

    it('final batch status is SUBMITTED when zero rows were rejected', async () => {
      tx.basicPriceImportRow.count.mockResolvedValue(0);
      const result = await service.submitBatch(WORKSPACE_ID, 'batch-01');
      expect(result.status).toBe('SUBMITTED');
    });

    it('final batch status is PARTIALLY_SUBMITTED when some rows were rejected', async () => {
      tx.basicPriceImportRow.count.mockResolvedValue(1); // one REJECTED row exists
      const result = await service.submitBatch(WORKSPACE_ID, 'batch-01');
      expect(result.status).toBe('PARTIALLY_SUBMITTED');
    });

    it('is idempotent: an already-SUBMITTED batch returns existing state without re-creating submissions', async () => {
      tx.$queryRaw.mockImplementation((query: { strings?: readonly string[] }) => {
        const sql = query?.strings?.join('') ?? '';
        if (sql.includes('basic_price_import_batches')) return Promise.resolve([{ ...lockedBatch, status: 'SUBMITTED' }]);
        return Promise.resolve([]);
      });
      const result = await service.submitBatch(WORKSPACE_ID, 'batch-01');
      expect(tx.priceSubmission.create).not.toHaveBeenCalled();
      expect(result.status).toBe('SUBMITTED');
    });
  });
});
