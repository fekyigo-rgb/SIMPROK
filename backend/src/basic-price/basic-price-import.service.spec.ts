import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { BasicPriceImportService } from './basic-price-import.service';
import { PrismaService } from '../prisma/prisma.service';
import { PriceSubmissionReviewService } from '../reality-intake/price-submission-review.service';
import { BasicPriceSourceArchiveService } from './basic-price-source-archive.service';
import { UnitKernelService } from '../unit-kernel/unit-kernel.service';
import { BasicPriceRowResolutionProposalService } from './basic-price-row-resolution-proposal.service';
import { buildBasicPriceXlsx } from '../../test/fixtures/basic-price-xlsx.fixture';

describe('BasicPriceImportService', () => {
  let service: BasicPriceImportService;
  let sourceArchive: any;
  let tx: {
    basicPriceImportBatch: {
      create: jest.Mock;
      update: jest.Mock;
      findUniqueOrThrow: jest.Mock;
    };
    basicPriceImportRow: {
      create: jest.Mock;
      createMany: jest.Mock;
      count: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      update: jest.Mock;
    };
    priceSubmission: { create: jest.Mock; update: jest.Mock };
    priceSubmissionRevision: { create: jest.Mock };
    priceSubmissionAudit: { create: jest.Mock; findFirst: jest.Mock };
    basicPrice: { findFirst: jest.Mock };
    $queryRaw: jest.Mock;
  };
  let prisma: {
    workspace: { findUnique: jest.Mock };
    basicPriceImportBatch: {
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      findMany: jest.Mock;
    };
    basicPriceImportRow: { findMany: jest.Mock };
    /**
     * The review room asks WHICH rows are already stored — the count it also
     * publishes is derived from that one answer, so the two cannot disagree.
     */
    basicPrice: { findMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let reviewService: { createReviewWithinTransaction: jest.Mock };
  /** INT-CONNECT-01 — the seam the review read path consults. */
  let proposals: { proposeForRows: jest.Mock };

  const WORKSPACE_ID = 'ws-01';
  const ORGANIZATION_ID = 'org-01';
  const ACCOUNT_ID = 'account-01';

  const uploadFile = async () => {
    const buffer = await buildBasicPriceXlsx();
    return { buffer, size: buffer.length, originalname: 'basic-price.xlsx' };
  };

  beforeEach(async () => {
    tx = {
      basicPriceImportBatch: {
        create: jest.fn(),
        update: jest.fn(),
        findUniqueOrThrow: jest.fn(),
      },
      basicPriceImportRow: {
        create: jest.fn(),
        createMany: jest.fn(),
        count: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn(),
      },
      priceSubmission: { create: jest.fn(), update: jest.fn() },
      priceSubmissionRevision: { create: jest.fn() },
      priceSubmissionAudit: { create: jest.fn(), findFirst: jest.fn() },
      basicPrice: { findFirst: jest.fn() },
      $queryRaw: jest.fn(),
    };
    prisma = {
      workspace: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ organizationId: ORGANIZATION_ID }),
      },
      basicPriceImportBatch: {
        findUnique: jest.fn().mockResolvedValue(null),
        findUniqueOrThrow: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      basicPriceImportRow: { findMany: jest.fn().mockResolvedValue([]) },
      // Nothing kept yet, which is the ordinary state of every batch these
      // tests build. Cases about already-stored rows set it explicitly.
      basicPrice: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) =>
        callback(tx),
      ),
    };
    sourceArchive = {
      retain: jest.fn(async () => 'memory://retained-source'),
      read: jest.fn(),
    };
    reviewService = {
      createReviewWithinTransaction: jest
        .fn()
        .mockResolvedValue({ reviewId: 'review-1', status: 'CREATED' }),
    };
    proposals = { proposeForRows: jest.fn(() => Promise.resolve(new Map())) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BasicPriceImportService,
        { provide: PrismaService, useValue: prisma },
        { provide: PriceSubmissionReviewService, useValue: reviewService },
        // USI-01R2 — raw bytes are retained for this vertical-local intake
        // before any domain row is written.
        { provide: BasicPriceSourceArchiveService, useValue: sourceArchive },
        // INT-CONNECT-01 — the review read path asks the canonical Unit and
        // Resource Identity authorities through this seam. Stubbed to answer
        // "nothing proven" so THIS suite keeps testing exactly what it always
        // tested: the intake state machine, untouched by intelligence. The
        // wiring itself is proved in
        // basic-price-row-resolution-proposal.service.spec.ts.
        {
          provide: BasicPriceRowResolutionProposalService,
          useValue: proposals,
        },
        // COLUMN INTELLIGENCE — the Unit authority is consulted for ONE narrow
        // job on this path: disproving a column before a human is asked to
        // choose it (see `pruneDisprovenColumnCandidates`). Stubbed to prove
        // NOTHING, so every existing expectation in this suite still describes
        // the intake state machine with no elimination applied — the pruning's
        // own behaviour is proved against the real authority in
        // test/acceptance/real-workflow-basic-price.e2e-spec.ts.
        {
          provide: UnitKernelService,
          useValue: {
            resolveCanonicalUnitIdentities: jest.fn(() => Promise.resolve([])),
          },
        },
      ],
    }).compile();

    service = module.get<BasicPriceImportService>(BasicPriceImportService);

    let counter = 0;
    let batchCounter = 0;
    tx.basicPriceImportBatch.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => ({
        id: `batch-${++batchCounter}`,
        version: 0,
        ...data,
      }),
    );
    tx.basicPriceImportRow.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => ({
        id: `row-${++counter}`,
        version: 0,
        ...data,
      }),
    );

    // A SET-BASED WRITE, MOCKED AS ONE. `createMany` stores what it was given
    // and answers with a count, exactly as Prisma does — and the read-back that
    // follows it hands the rows back in a DELIBERATELY SCRAMBLED order.
    //
    // That scramble is the point. Prisma guarantees no order on an unsorted
    // findMany, and the service is not allowed to depend on one: it reassembles
    // its rows by the ids it minted itself. A mock that returned insertion
    // order would let an order-dependent regression pass here and fail on a
    // real database.
    const persisted: Record<string, Record<string, unknown>[]> = {};
    tx.basicPriceImportRow.createMany.mockImplementation(
      ({ data }: { data: Record<string, unknown>[] }) => {
        for (const row of data) {
          const batchId = String(row.batchId);
          persisted[batchId] = persisted[batchId] ?? [];
          persisted[batchId].push({ version: 0, ...row });
        }
        return Promise.resolve({ count: data.length });
      },
    );
    tx.basicPriceImportRow.findMany.mockImplementation(
      ({ where }: { where: { batchId: string } }) =>
        Promise.resolve([...(persisted[where.batchId] ?? [])].reverse()),
    );
    // Scoped per-batch so a test that calls preview() more than once still
    // sees an accurate count for each individual batch.
    tx.basicPriceImportRow.count.mockImplementation(
      ({ where }: { where: { batchId: string } }) =>
        Promise.resolve((persisted[where.batchId] ?? []).length),
    );
  });

  describe('preview', () => {
    it('rejects a missing file', async () => {
      await expect(
        service.preview(WORKSPACE_ID, ACCOUNT_ID, undefined as any, {}),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    // USI-01 replaced "reject anything that is not .xlsx" with a reader
    // registry: CSV is now a first-class format, so the old expectation
    // contradicted the corrected law and had to change. What must NOT change is
    // that an UNSUPPORTED format is still refused — by name, as SIMPROK's own
    // limitation rather than as a fault in the sender's file (§17).
    it('rejects a format no registered reader can read', async () => {
      const file = {
        buffer: Buffer.from('%PDF-1.7'),
        size: 8,
        originalname: 'basic-price.pdf',
      };
      await expect(
        service.preview(WORKSPACE_ID, ACCOUNT_ID, file, {}),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.preview(WORKSPACE_ID, ACCOUNT_ID, file, {}),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          message: 'UNSUPPORTED_SOURCE_FORMAT',
          supportedExtensions: ['.csv', '.xlsx'],
        }),
      });
    });

    it('throws NotFound when the workspace does not resolve to an organization', async () => {
      prisma.workspace.findUnique.mockResolvedValue(null);
      const file = await uploadFile();
      await expect(
        service.preview(WORKSPACE_ID, ACCOUNT_ID, file, {}),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('creates a persisted batch and rows, every row starting NEEDS_REVIEW (no row can be RESOLVED at parse time)', async () => {
      const file = await uploadFile();
      const result = await service.preview(WORKSPACE_ID, ACCOUNT_ID, file, {});

      expect(tx.basicPriceImportBatch.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            workspaceId: WORKSPACE_ID,
            organizationId: ORGANIZATION_ID,
            uploadedByAccountId: ACCOUNT_ID,
            status: 'NEEDS_REVIEW',
          }),
        }),
      );
      expect(tx.basicPriceImportRow.createMany).toHaveBeenCalled();
      const writtenRows = tx.basicPriceImportRow.createMany.mock.calls.flatMap(
        ([arg]: [{ data: Record<string, unknown>[] }]) => arg.data,
      );
      expect(
        writtenRows.every(
          (data: Record<string, unknown>) =>
            data.status === 'NEEDS_REVIEW' &&
            data.resolutionStatus === 'UNRESOLVED',
        ),
      ).toBe(true);
      expect(result.status).toBe('NEEDS_REVIEW');
      expect(result.totalRows).toBeGreaterThan(0);
    });

    it('writes rows in BOUNDED SET-BASED statements — never one per row (P2028)', async () => {
      // THE OWNER'S 934-ROW WORKBOOK IS WHY THIS TEST EXISTS. A per-row create
      // meant one round-trip per row inside a 5-second interactive transaction,
      // and the real upload died on Prisma P2028 at 5010 ms — a workbook SIMPROK
      // had read perfectly, answered 500. The invariant is not "it is faster":
      // it is that the number of WRITES does not grow with the number of rows.
      const file = await uploadFile();
      const result = await service.preview(WORKSPACE_ID, ACCOUNT_ID, file, {});

      expect(tx.basicPriceImportRow.create).not.toHaveBeenCalled();
      expect(
        tx.basicPriceImportRow.createMany.mock.calls.length,
      ).toBeLessThanOrEqual(Math.ceil(result.totalRows / 500));

      // Every row still arrived — a bounded write is not a truncated one.
      const writtenRows = tx.basicPriceImportRow.createMany.mock.calls.flatMap(
        ([arg]: [{ data: Record<string, unknown>[] }]) => arg.data,
      );
      expect(writtenRows).toHaveLength(result.totalRows);
    });

    it('returns rows in SOURCE ORDER even when the database reads them back shuffled', async () => {
      // `createMany` answers with a count, not rows, so the order the source
      // stated has to be reconstructed rather than inherited. It is
      // reconstructed from the ids this service minted itself — the read-back
      // in this suite is deliberately reversed, and the answer must not be.
      const file = await uploadFile();
      const result = await service.preview(WORKSPACE_ID, ACCOUNT_ID, file, {});

      const written = tx.basicPriceImportRow.createMany.mock.calls.flatMap(
        ([arg]: [{ data: Record<string, unknown>[] }]) => arg.data,
      );
      expect(result.rows.map((row) => row.id)).toEqual(
        written.map((data: Record<string, unknown>) => data.id),
      );
      const sourceRowNumbers = result.rows.map((row) => row.sourceRowNumber);
      expect([...sourceRowNumbers].sort((a, b) => a - b)).toEqual(
        sourceRowNumbers,
      );
    });

    it('REPLAY (I01): the exact same file + same metadata returns the existing batch, never re-parses into new rows', async () => {
      const file = await uploadFile();
      const existingBatch = {
        id: 'existing-batch',
        workspaceId: WORKSPACE_ID,
        uploadedByAccountId: ACCOUNT_ID,
        importFingerprint: 'X',
        status: 'NEEDS_REVIEW',
        version: 0,
      };
      prisma.basicPriceImportBatch.findUnique.mockResolvedValue(existingBatch);
      prisma.basicPriceImportRow.findMany.mockResolvedValue([
        {
          id: 'r1',
          status: 'NEEDS_REVIEW',
          resolutionStatus: 'UNRESOLVED',
          rawResourceNameText: 'X',
          sourceSection: 'LABOR',
          sourceRowNumber: 9,
        },
      ]);

      const result = await service.preview(WORKSPACE_ID, ACCOUNT_ID, file, {});

      expect(tx.basicPriceImportBatch.create).not.toHaveBeenCalled();
      expect(result.batchId).toBe('existing-batch');
      expect(result.reimport).toEqual({
        classification: 'EXACT_EXISTING',
        existingBatchId: 'existing-batch',
        updateBatchId: null,
        difference: 'NONE',
      });
    });

    it('R-8: an exact fingerprint match owned by another account is indistinguishable from absence', async () => {
      const file = await uploadFile();
      prisma.basicPriceImportBatch.findUnique.mockResolvedValue({
        id: 'foreign-batch',
        workspaceId: WORKSPACE_ID,
        uploadedByAccountId: 'other-account',
        importFingerprint: 'X',
        status: 'NEEDS_REVIEW',
        version: 0,
      });

      await expect(
        service.preview(WORKSPACE_ID, ACCOUNT_ID, file, {}),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(tx.basicPriceImportBatch.create).not.toHaveBeenCalled();
    });

    it('I02: identical file with different metadata (e.g. a different regionId) produces a different fingerprint than an empty-metadata preview', async () => {
      const file = await uploadFile();
      await service.preview(WORKSPACE_ID, ACCOUNT_ID, file, {});
      const fingerprintA =
        tx.basicPriceImportBatch.create.mock.calls[0][0].data.importFingerprint;

      tx.basicPriceImportBatch.create.mockClear();
      await service.preview(WORKSPACE_ID, ACCOUNT_ID, file, {
        regionId: '10000000-0000-4000-8000-000000000099',
      });
      const fingerprintB =
        tx.basicPriceImportBatch.create.mock.calls[0][0].data.importFingerprint;

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
      // A FIELD REPORT, because this suite exercises the CURATION door and that
      // door serves the field/community family only. It used to say GOVERNMENT,
      // which is now refused at the ENDPOINT rather than merely hidden in the
      // UI: an official list is recorded with its own source, never put to
      // community verification.
      //
      // The pair is STATED, not derived. Origin and type are independent axes
      // (BASIC-PRICE-MASTER-DECISION §10); this batch happens to be a field
      // report that is a market survey, and either value could have been
      // otherwise without the other changing.
      sourceType: 'MARKET_SURVEY',
      sourceOrigin: 'FIELD_REPORT',
      uploadedByAccountId: ACCOUNT_ID,
      importFingerprint: 'fingerprint-01',
      version: 0,
    };

    beforeEach(() => {
      tx.$queryRaw.mockImplementation(
        (query: { strings?: readonly string[] }) => {
          const sql = query?.strings?.join('') ?? '';
          if (sql.includes('basic_price_import_batches'))
            return Promise.resolve([lockedBatch]);
          if (sql.includes('"status" = \'READY_FOR_SUBMISSION\''))
            return Promise.resolve([{ id: 'row-1' }]);
          return Promise.resolve([]);
        },
      );
      tx.basicPriceImportRow.findUniqueOrThrow.mockResolvedValue({
        id: 'row-1',
        resourceCatalogId: 'resource-01',
        proposedCanonicalPrice: '158333.33',
        effectiveDateOverride: null,
      });
      tx.priceSubmission.create.mockResolvedValue({ id: 'submission-1' });
      tx.priceSubmissionRevision.create.mockResolvedValue({ id: 'revision-1' });
      tx.basicPriceImportRow.count.mockResolvedValue(0); // no REJECTED rows
      tx.basicPriceImportRow.findMany.mockResolvedValue([
        { id: 'row-1', status: 'SUBMISSION_CREATED' },
      ]);
      tx.basicPriceImportBatch.update.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) => ({
          ...lockedBatch,
          ...data,
        }),
      );
    });

    it('rejects when effectiveDate is missing', async () => {
      tx.$queryRaw.mockImplementation(
        (query: { strings?: readonly string[] }) => {
          const sql = query?.strings?.join('') ?? '';
          if (sql.includes('basic_price_import_batches'))
            return Promise.resolve([{ ...lockedBatch, effectiveDate: null }]);
          return Promise.resolve([]);
        },
      );
      await expect(
        service.submitBatch(WORKSPACE_ID, 'batch-01', ACCOUNT_ID),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects when regionId is missing', async () => {
      tx.$queryRaw.mockImplementation(
        (query: { strings?: readonly string[] }) => {
          const sql = query?.strings?.join('') ?? '';
          if (sql.includes('basic_price_import_batches'))
            return Promise.resolve([{ ...lockedBatch, regionId: null }]);
          return Promise.resolve([]);
        },
      );
      await expect(
        service.submitBatch(WORKSPACE_ID, 'batch-01', ACCOUNT_ID),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects an unconfirmed geographic scope even when regionId is set', async () => {
      tx.$queryRaw.mockImplementation(
        (query: { strings?: readonly string[] }) => {
          const sql = query?.strings?.join('') ?? '';
          if (sql.includes('basic_price_import_batches'))
            return Promise.resolve([
              {
                ...lockedBatch,
                sourceRegionScopeLabel: 'SIRIMAU',
                sourceRegionScopeGeographicEvidence: 'KECAMATAN',
                regionScopeConfirmedRegionId: null,
              },
            ]);
          if (sql.includes('"status" = \'READY_FOR_SUBMISSION\''))
            return Promise.resolve([{ id: 'row-1' }]);
          return Promise.resolve([]);
        },
      );
      await expect(
        service.submitBatch(WORKSPACE_ID, 'batch-01', ACCOUNT_ID),
      ).rejects.toMatchObject({
        message: 'REGION_SCOPE_COMPATIBILITY_UNCONFIRMED_BEFORE_SUBMISSION',
      });
      expect(tx.priceSubmission.create).not.toHaveBeenCalled();
    });

    it('accepts the same geography after the human confirmed this Region', async () => {
      tx.$queryRaw.mockImplementation(
        (query: { strings?: readonly string[] }) => {
          const sql = query?.strings?.join('') ?? '';
          if (sql.includes('basic_price_import_batches'))
            return Promise.resolve([
              {
                ...lockedBatch,
                sourceRegionScopeLabel: 'SIRIMAU',
                sourceRegionScopeGeographicEvidence: 'KECAMATAN',
                regionScopeConfirmedRegionId: 'region-01',
              },
            ]);
          if (sql.includes('"status" = \'READY_FOR_SUBMISSION\''))
            return Promise.resolve([{ id: 'row-1' }]);
          return Promise.resolve([]);
        },
      );
      const result = await service.submitBatch(
        WORKSPACE_ID,
        'batch-01',
        ACCOUNT_ID,
      );
      expect(tx.priceSubmission.create).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it('rejects when sourceOrigin is missing (structural PriceSubmission requirement, never fabricated)', async () => {
      tx.$queryRaw.mockImplementation(
        (query: { strings?: readonly string[] }) => {
          const sql = query?.strings?.join('') ?? '';
          if (sql.includes('basic_price_import_batches'))
            return Promise.resolve([{ ...lockedBatch, sourceOrigin: null }]);
          return Promise.resolve([]);
        },
      );
      await expect(
        service.submitBatch(WORKSPACE_ID, 'batch-01', ACCOUNT_ID),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('accepts a batch still NEEDS_REVIEW when ready rows exist', async () => {
      tx.$queryRaw.mockImplementation(
        (query: { strings?: readonly string[] }) => {
          const sql = query?.strings?.join('') ?? '';
          if (sql.includes('basic_price_import_batches'))
            return Promise.resolve([
              { ...lockedBatch, status: 'NEEDS_REVIEW' },
            ]);
          if (sql.includes('"status" = \'READY_FOR_SUBMISSION\''))
            return Promise.resolve([{ id: 'row-1' }]);
          return Promise.resolve([]);
        },
      );
      tx.basicPriceImportRow.count.mockImplementation(
        ({ where }: { where: { status?: string } }) =>
          Promise.resolve(where.status === 'NEEDS_REVIEW' ? 70 : 0),
      );
      tx.basicPriceImportRow.findMany.mockResolvedValue([
        { id: 'row-1', status: 'SUBMISSION_CREATED' },
        { id: 'row-unresolved', status: 'NEEDS_REVIEW' },
      ]);

      const result = await service.submitBatch(
        WORKSPACE_ID,
        'batch-01',
        ACCOUNT_ID,
      );

      expect(tx.priceSubmission.create).toHaveBeenCalledTimes(1);
      expect(result.status).toBe('NEEDS_REVIEW');
      expect(tx.basicPriceImportBatch.update).not.toHaveBeenCalled();
    });

    it('rejects a batch not yet in the review window', async () => {
      tx.$queryRaw.mockImplementation(
        (query: { strings?: readonly string[] }) => {
          const sql = query?.strings?.join('') ?? '';
          if (sql.includes('basic_price_import_batches'))
            return Promise.resolve([{ ...lockedBatch, status: 'PREVIEWED' }]);
          if (sql.includes('"status" = \'READY_FOR_SUBMISSION\''))
            return Promise.resolve([{ id: 'row-1' }]);
          return Promise.resolve([]);
        },
      );
      await expect(
        service.submitBatch(WORKSPACE_ID, 'batch-01', ACCOUNT_ID),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(tx.priceSubmission.create).not.toHaveBeenCalled();
    });

    it('rejects NEEDS_REVIEW when no row is ready (CASE 1)', async () => {
      tx.$queryRaw.mockImplementation(
        (query: { strings?: readonly string[] }) => {
          const sql = query?.strings?.join('') ?? '';
          if (sql.includes('basic_price_import_batches'))
            return Promise.resolve([
              { ...lockedBatch, status: 'NEEDS_REVIEW' },
            ]);
          return Promise.resolve([]);
        },
      );
      await expect(
        service.submitBatch(WORKSPACE_ID, 'batch-01', ACCOUNT_ID),
      ).rejects.toMatchObject({ message: 'NO_ROWS_READY_FOR_SUBMISSION' });
      expect(tx.priceSubmission.create).not.toHaveBeenCalled();
    });

    it('does not duplicate when the same open-batch wave is pressed again', async () => {
      tx.$queryRaw.mockImplementation(
        (query: { strings?: readonly string[] }) => {
          const sql = query?.strings?.join('') ?? '';
          if (sql.includes('basic_price_import_batches'))
            return Promise.resolve([
              { ...lockedBatch, status: 'NEEDS_REVIEW' },
            ]);
          return Promise.resolve([]);
        },
      );
      await expect(
        service.submitBatch(WORKSPACE_ID, 'batch-01', ACCOUNT_ID),
      ).rejects.toMatchObject({ message: 'NO_ROWS_READY_FOR_SUBMISSION' });
      expect(tx.priceSubmission.create).not.toHaveBeenCalled();
    });

    it('second wave submits only newly ready rows, not already submitted ones', async () => {
      tx.$queryRaw.mockImplementation(
        (query: { strings?: readonly string[] }) => {
          const sql = query?.strings?.join('') ?? '';
          if (sql.includes('basic_price_import_batches'))
            return Promise.resolve([
              { ...lockedBatch, status: 'NEEDS_REVIEW' },
            ]);
          if (sql.includes('"status" = \'READY_FOR_SUBMISSION\''))
            return Promise.resolve([{ id: 'row-new' }]);
          return Promise.resolve([]);
        },
      );
      tx.basicPriceImportRow.findUniqueOrThrow.mockResolvedValue({
        id: 'row-new',
        resourceCatalogId: 'resource-02',
        proposedCanonicalPrice: '1000.00',
        effectiveDateOverride: null,
      });
      tx.basicPriceImportRow.count.mockImplementation(
        ({ where }: { where: { status?: string } }) =>
          Promise.resolve(where.status === 'NEEDS_REVIEW' ? 60 : 0),
      );
      tx.basicPriceImportRow.findMany.mockResolvedValue([
        { id: 'row-1', status: 'SUBMISSION_CREATED' },
        { id: 'row-new', status: 'SUBMISSION_CREATED' },
        { id: 'row-unresolved', status: 'NEEDS_REVIEW' },
      ]);

      const result = await service.submitBatch(
        WORKSPACE_ID,
        'batch-01',
        ACCOUNT_ID,
      );

      expect(tx.priceSubmission.create).toHaveBeenCalledTimes(1);
      expect(tx.priceSubmission.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ resourceId: 'resource-02' }),
        }),
      );
      expect(tx.basicPriceImportRow.update).toHaveBeenCalledWith({
        where: { id: 'row-new' },
        data: {
          priceSubmissionId: 'submission-1',
          status: 'SUBMISSION_CREATED',
        },
      });
      expect(result.status).toBe('NEEDS_REVIEW');
    });

    it('creates exactly one PriceSubmission + Revision + Audit per READY_FOR_SUBMISSION row, links it back to the row', async () => {
      await service.submitBatch(WORKSPACE_ID, 'batch-01', ACCOUNT_ID);

      expect(tx.priceSubmission.create).toHaveBeenCalledTimes(1);
      expect(tx.priceSubmission.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            workspaceId: WORKSPACE_ID,
            organizationId: ORGANIZATION_ID,
            resourceId: 'resource-01',
            regionId: 'region-01',
            // Carried verbatim from the batch — the submission describes where
            // the price came from, and this writer substitutes nothing.
            sourceOrigin: 'FIELD_REPORT',
            sourceType: 'MARKET_SURVEY',
            status: 'SUBMITTED',
          }),
        }),
      );
      expect(tx.priceSubmissionRevision.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            submissionId: 'submission-1',
            revisionNumber: 1,
          }),
        }),
      );
      expect(tx.priceSubmissionAudit.create).toHaveBeenCalledTimes(1);
      expect(tx.basicPriceImportRow.update).toHaveBeenCalledWith({
        where: { id: 'row-1' },
        data: {
          priceSubmissionId: 'submission-1',
          status: 'SUBMISSION_CREATED',
        },
      });
      // RM-02D2A-1 Work Package A: submitBatch must call the ONE canonical
      // review-creation helper, inside the SAME transaction (tx), for every
      // new PriceSubmission — never open a second transaction, never skip it.
      expect(reviewService.createReviewWithinTransaction).toHaveBeenCalledTimes(
        1,
      );
      expect(reviewService.createReviewWithinTransaction).toHaveBeenCalledWith(
        tx,
        {
          id: 'submission-1',
          workspaceId: WORKSPACE_ID,
          organizationId: ORGANIZATION_ID,
        },
      );
    });

    it('rolls back the whole submission when review creation fails', async () => {
      reviewService.createReviewWithinTransaction.mockRejectedValueOnce(
        new Error('REVIEW_CREATION_FAILED'),
      );
      await expect(
        service.submitBatch(WORKSPACE_ID, 'batch-01', ACCOUNT_ID),
      ).rejects.toThrow('REVIEW_CREATION_FAILED');
    });

    it('final batch status is SUBMITTED when zero rows were rejected', async () => {
      tx.basicPriceImportRow.count.mockResolvedValue(0);
      const result = await service.submitBatch(
        WORKSPACE_ID,
        'batch-01',
        ACCOUNT_ID,
      );
      expect(result.status).toBe('SUBMITTED');
    });

    it('final batch status is PARTIALLY_SUBMITTED when some rows were rejected', async () => {
      tx.basicPriceImportRow.count.mockImplementation(
        ({ where }: { where: { status?: string } }) =>
          Promise.resolve(where.status === 'REJECTED' ? 1 : 0),
      );
      const result = await service.submitBatch(
        WORKSPACE_ID,
        'batch-01',
        ACCOUNT_ID,
      );
      expect(result.status).toBe('PARTIALLY_SUBMITTED');
    });

    it('is idempotent: an already-SUBMITTED batch returns existing state without re-creating submissions', async () => {
      tx.$queryRaw.mockImplementation(
        (query: { strings?: readonly string[] }) => {
          const sql = query?.strings?.join('') ?? '';
          if (sql.includes('basic_price_import_batches'))
            return Promise.resolve([{ ...lockedBatch, status: 'SUBMITTED' }]);
          return Promise.resolve([]);
        },
      );
      const result = await service.submitBatch(
        WORKSPACE_ID,
        'batch-01',
        ACCOUNT_ID,
      );
      expect(tx.priceSubmission.create).not.toHaveBeenCalled();
      expect(result.status).toBe('SUBMITTED');
    });

    it("USER-OWNED IMPORT BOUNDARY: a same-workspace account that did not upload this batch is denied (404), never submitting on someone else's behalf", async () => {
      await expect(
        service.submitBatch(
          WORKSPACE_ID,
          'batch-01',
          'another-account-in-same-workspace',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(tx.priceSubmission.create).not.toHaveBeenCalled();
    });
  });

  describe('getBatch', () => {
    const storedBatch = {
      id: 'batch-01',
      workspaceId: WORKSPACE_ID,
      status: 'NEEDS_REVIEW',
      uploadedByAccountId: ACCOUNT_ID,
    };

    beforeEach(() => {
      prisma.basicPriceImportBatch.findUnique.mockResolvedValue(storedBatch);
      prisma.basicPriceImportRow.findMany.mockResolvedValue([]);
    });

    it('positive: the uploader can read their own batch', async () => {
      const result = await service.getBatch(
        WORKSPACE_ID,
        'batch-01',
        ACCOUNT_ID,
      );
      expect(result.batchId).toBe('batch-01');
    });

    it('negative: a different workspace is denied (404)', async () => {
      prisma.basicPriceImportBatch.findUnique.mockResolvedValue({
        ...storedBatch,
        workspaceId: 'other-workspace',
      });
      await expect(
        service.getBatch(WORKSPACE_ID, 'batch-01', ACCOUNT_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('USER-OWNED IMPORT BOUNDARY negative: a same-workspace account that did not upload this batch cannot read it (404)', async () => {
      await expect(
        service.getBatch(
          WORKSPACE_ID,
          'batch-01',
          'another-account-in-same-workspace',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    /**
     * INT-CONNECT-01 — THE WIRING ITSELF, not just the seam behind it.
     *
     * A healthy engine that nobody calls is the exact defect this slice closes,
     * so "getBatch asks the authorities" is asserted here rather than assumed
     * from the fact that a service exists.
     */
    it('INT-CONNECT-01: asks the canonical authorities, and only about rows a human can still act on', async () => {
      prisma.basicPriceImportRow.findMany.mockResolvedValue([
        {
          id: 'r-open',
          status: 'NEEDS_REVIEW',
          resolutionStatus: 'UNRESOLVED',
          rawResourceNameText: 'Air',
          rawResourceCodeText: null,
          rawUnitText: 'ltr',
          sourceSection: 'MATERIAL',
          sourceRowNumber: 2,
          reasonCodes: [],
          version: 0,
        },
        {
          id: 'r-done',
          status: 'READY_FOR_SUBMISSION',
          resolutionStatus: 'RESOLVED',
          rawResourceNameText: 'Semen',
          rawResourceCodeText: null,
          rawUnitText: 'kg',
          sourceSection: 'MATERIAL',
          sourceRowNumber: 3,
          reasonCodes: [],
          version: 1,
        },
        {
          id: 'r-rejected',
          status: 'REJECTED',
          resolutionStatus: 'UNRESOLVED',
          rawResourceNameText: 'Entah',
          rawResourceCodeText: null,
          rawUnitText: 'bh',
          sourceSection: 'MATERIAL',
          sourceRowNumber: 4,
          reasonCodes: [],
          version: 1,
        },
      ]);

      await service.getBatch(WORKSPACE_ID, 'batch-01', ACCOUNT_ID);

      expect(proposals.proposeForRows).toHaveBeenCalledTimes(1);
      const [workspaceArg, rowsArg] = proposals.proposeForRows.mock
        .calls[0] as [string, ReadonlyArray<{ id: string }>];
      expect(workspaceArg).toBe(WORKSPACE_ID);
      // A resolved or rejected row has nothing left to decide; proposing an
      // identity for it would be advice nobody can act on.
      expect(rowsArg.map((r) => r.id)).toEqual(['r-open']);
      // Every fact comes from the row itself — nothing a client could steer.
      expect(rowsArg[0]).toEqual({
        id: 'r-open',
        sourceSection: 'MATERIAL',
        rawResourceNameText: 'Air',
        rawResourceCodeText: null,
        rawUnitText: 'ltr',
      });
    });

    it('INT-CONNECT-01: carries the proposal to the row, and counts proven rows honestly', async () => {
      prisma.basicPriceImportRow.findMany.mockResolvedValue([
        {
          id: 'r-open',
          status: 'NEEDS_REVIEW',
          resolutionStatus: 'UNRESOLVED',
          rawResourceNameText: 'Air',
          rawResourceCodeText: null,
          rawUnitText: 'ltr',
          sourceSection: 'MATERIAL',
          sourceRowNumber: 2,
          reasonCodes: [],
          version: 0,
        },
        {
          id: 'r-open-2',
          status: 'NEEDS_REVIEW',
          resolutionStatus: 'UNRESOLVED',
          rawResourceNameText: 'Entah',
          rawResourceCodeText: null,
          rawUnitText: 'bh',
          sourceSection: 'MATERIAL',
          sourceRowNumber: 5,
          reasonCodes: [],
          version: 0,
        },
      ]);
      const proven = {
        rowId: 'r-open',
        identityPairProven: true,
        blockingFacts: [],
        unit: {},
        resource: {},
      };
      const open = {
        rowId: 'r-open-2',
        identityPairProven: false,
        blockingFacts: ['UNKNOWN_UNIT_ALIAS'],
        unit: {},
        resource: {},
      };
      proposals.proposeForRows.mockResolvedValueOnce(
        new Map([
          ['r-open', proven],
          ['r-open-2', open],
        ]),
      );

      const result = await service.getBatch(
        WORKSPACE_ID,
        'batch-01',
        ACCOUNT_ID,
      );

      expect(result.rows[0].machineProposal).toBe(proven);
      expect(result.rows[1].machineProposal).toBe(open);
      // Reported from the proposals, never predicted from row statuses.
      expect(result.identityPairProvenRows).toBe(1);
    });

    it('INT-CONNECT-01: a row nobody asked about carries null, never a fabricated verdict', async () => {
      prisma.basicPriceImportRow.findMany.mockResolvedValue([
        {
          id: 'r-done',
          status: 'READY_FOR_SUBMISSION',
          resolutionStatus: 'RESOLVED',
          rawResourceNameText: 'Semen',
          rawResourceCodeText: null,
          rawUnitText: 'kg',
          sourceSection: 'MATERIAL',
          sourceRowNumber: 3,
          reasonCodes: [],
          version: 1,
        },
      ]);

      const result = await service.getBatch(
        WORKSPACE_ID,
        'batch-01',
        ACCOUNT_ID,
      );

      // Null means "not asked". It must never be readable as "found nothing".
      expect(result.rows[0].machineProposal).toBeNull();
      expect(result.identityPairProvenRows).toBe(0);
    });

    it('INT-CONNECT-01: preview never consults the authorities — that is the review room job', async () => {
      // Guards the intake boundary from the other side: the same harness law the
      // USI-01R fixture enforces by throwing.
      proposals.proposeForRows.mockClear();
      const file = await uploadFile();
      await service.preview(WORKSPACE_ID, ACCOUNT_ID, file, {});
      expect(proposals.proposeForRows).not.toHaveBeenCalled();
    });

    /**
     * INT-CONNECT-01 SECURITY — CASE 2.
     *
     * The existing test above proves the 404. This proves the CONSEQUENCE the
     * new payload makes worth stating: authorization runs to completion BEFORE
     * the proposal seam is consulted, so a cross-workspace batchId yields no
     * rows, no proposal, and no candidate/evidence data of any kind. If the
     * ordering in getBatch were ever inverted, the 404 would still be thrown but
     * foreign evidence would already have been computed — this test fails then.
     */
    it('INT-CONNECT-01 SECURITY: a cross-workspace batchId yields zero rows, zero proposal, and never reaches the authorities', async () => {
      prisma.basicPriceImportBatch.findUnique.mockResolvedValue({
        ...storedBatch,
        workspaceId: 'other-workspace',
      });
      prisma.basicPriceImportRow.findMany.mockResolvedValue([
        {
          id: 'foreign-row',
          status: 'NEEDS_REVIEW',
          resolutionStatus: 'UNRESOLVED',
          rawResourceNameText: 'Air',
          rawResourceCodeText: null,
          rawUnitText: 'ltr',
          sourceSection: 'MATERIAL',
          sourceRowNumber: 2,
          reasonCodes: [],
          version: 0,
        },
      ]);

      await expect(
        service.getBatch(WORKSPACE_ID, 'batch-01', ACCOUNT_ID),
      ).rejects.toBeInstanceOf(NotFoundException);

      // The rows were never even read, let alone proposed about.
      expect(prisma.basicPriceImportRow.findMany).not.toHaveBeenCalled();
      expect(proposals.proposeForRows).not.toHaveBeenCalled();
    });

    it('INT-CONNECT-01 SECURITY: a same-workspace batch owned by ANOTHER account is refused before the authorities are asked', async () => {
      // The user-owned import boundary. A teammate holding BASIC_PRICE_IMPORT in
      // the same workspace still gets plain non-existence, and the proposal seam
      // is never consulted on someone else's batch.
      prisma.basicPriceImportRow.findMany.mockResolvedValue([]);

      await expect(
        service.getBatch(
          WORKSPACE_ID,
          'batch-01',
          'another-account-in-same-workspace',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(prisma.basicPriceImportRow.findMany).not.toHaveBeenCalled();
      expect(proposals.proposeForRows).not.toHaveBeenCalled();
    });
  });

  describe('updateBatchMetadata', () => {
    const storedBatch = {
      id: 'batch-01',
      workspaceId: WORKSPACE_ID,
      status: 'NEEDS_REVIEW',
      version: 0,
      uploadedByAccountId: ACCOUNT_ID,
    };

    beforeEach(() => {
      tx.$queryRaw.mockResolvedValue([storedBatch]);
      tx.basicPriceImportBatch.update.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) => ({
          ...storedBatch,
          ...data,
        }),
      );
      tx.basicPriceImportRow.findMany.mockResolvedValue([]);
    });

    it('positive: the uploader can update their own batch metadata', async () => {
      const result = await service.updateBatchMetadata(
        WORKSPACE_ID,
        'batch-01',
        { version: 0 },
        ACCOUNT_ID,
      );
      expect(result.batchId).toBe('batch-01');
      expect(tx.basicPriceImportBatch.update).toHaveBeenCalled();
    });

    it('USER-OWNED IMPORT BOUNDARY negative: a same-workspace account that did not upload this batch cannot update it (404), and no write occurs', async () => {
      await expect(
        service.updateBatchMetadata(
          WORKSPACE_ID,
          'batch-01',
          { version: 0 } as any,
          'another-account-in-same-workspace',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(tx.basicPriceImportBatch.update).not.toHaveBeenCalled();
    });
  });

  describe('submitPrivatePrice', () => {
    const PRICE_ID = 'bp-private-01';
    const lockedPrivate = {
      id: PRICE_ID,
      workspaceId: WORKSPACE_ID,
      organizationId: ORGANIZATION_ID,
      assetScope: 'WORKSPACE_PRIVATE',
      resourceId: 'resource-01',
      regionId: 'region-01',
      sourceOrigin: 'FIELD_REPORT',
      sourceType: 'MARKET_SURVEY',
      value: '137500.00',
      effectiveDate: new Date('2026-08-01T00:00:00.000Z'),
      sourceImportRowId: 'row-1',
      status: 'UNPUBLISHED',
      verificationStatus: 'UNVERIFIED',
    };

    beforeEach(() => {
      tx.priceSubmission.create.mockResolvedValue({ id: 'submission-1' });
      tx.priceSubmissionRevision.create.mockResolvedValue({
        id: 'revision-1',
      });
      tx.priceSubmission.update.mockResolvedValue({});
      tx.priceSubmissionAudit.create.mockResolvedValue({});
      tx.priceSubmissionAudit.findFirst.mockResolvedValue(null);
      tx.basicPrice.findFirst.mockResolvedValue(null);
      tx.basicPriceImportRow.findUnique.mockResolvedValue({
        id: 'row-1',
        batchId: 'batch-01',
        priceSubmissionId: null,
        resourceCatalogId: 'resource-01',
        proposedCanonicalPrice: '137500.00',
      });
      tx.basicPriceImportBatch.findUniqueOrThrow.mockResolvedValue({
        id: 'batch-01',
        workspaceId: WORKSPACE_ID,
        organizationId: ORGANIZATION_ID,
      });
      tx.basicPriceImportRow.update.mockResolvedValue({});
      tx.$queryRaw.mockResolvedValue([lockedPrivate]);
    });

    it('creates one PriceSubmission via the same writer and leaves the private price unpublished', async () => {
      const result = await service.submitPrivatePrice(
        WORKSPACE_ID,
        PRICE_ID,
        ACCOUNT_ID,
      );

      expect(tx.priceSubmission.create).toHaveBeenCalledTimes(1);
      expect(reviewService.createReviewWithinTransaction).toHaveBeenCalledWith(
        tx,
        {
          id: 'submission-1',
          workspaceId: WORKSPACE_ID,
          organizationId: ORGANIZATION_ID,
        },
      );
      expect(result).toEqual({
        basicPriceId: PRICE_ID,
        submissionId: 'submission-1',
        alreadyProposed: false,
        status: 'UNPUBLISHED',
        assetScope: 'WORKSPACE_PRIVATE',
      });
      expect(tx.basicPriceImportRow.update).toHaveBeenCalledWith({
        where: { id: 'row-1' },
        data: {
          priceSubmissionId: 'submission-1',
          status: 'SUBMISSION_CREATED',
        },
      });
      expect(tx.basicPriceImportBatch.update).not.toHaveBeenCalled();
    });

    it('is idempotent when the import row already has a submission', async () => {
      tx.basicPriceImportRow.findUnique.mockResolvedValue({
        id: 'row-1',
        batchId: 'batch-01',
        priceSubmissionId: 'submission-existing',
      });

      const result = await service.submitPrivatePrice(
        WORKSPACE_ID,
        PRICE_ID,
        ACCOUNT_ID,
      );

      expect(result.alreadyProposed).toBe(true);
      expect(result.submissionId).toBe('submission-existing');
      expect(tx.priceSubmission.create).not.toHaveBeenCalled();
    });

    it('refuses a government private price with the same family code as batch proposal', async () => {
      tx.$queryRaw.mockResolvedValue([
        { ...lockedPrivate, sourceOrigin: 'GOVERNMENT' },
      ]);

      await expect(
        service.submitPrivatePrice(WORKSPACE_ID, PRICE_ID, ACCOUNT_ID),
      ).rejects.toMatchObject({
        message: 'SOURCE_FAMILY_NOT_ROUTED_TO_COMMUNITY_CURATION',
      });
      expect(tx.priceSubmission.create).not.toHaveBeenCalled();
    });

    it('hides catalog and foreign-workspace prices as not found', async () => {
      tx.$queryRaw.mockResolvedValue([
        { ...lockedPrivate, assetScope: 'SIMPROK_CATALOG' },
      ]);
      await expect(
        service.submitPrivatePrice(WORKSPACE_ID, PRICE_ID, ACCOUNT_ID),
      ).rejects.toBeInstanceOf(NotFoundException);

      tx.$queryRaw.mockResolvedValue([
        { ...lockedPrivate, workspaceId: 'other-ws' },
      ]);
      await expect(
        service.submitPrivatePrice(WORKSPACE_ID, PRICE_ID, ACCOUNT_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses a superseded private price', async () => {
      tx.basicPrice.findFirst.mockResolvedValue({ id: 'successor' });
      await expect(
        service.submitPrivatePrice(WORKSPACE_ID, PRICE_ID, ACCOUNT_ID),
      ).rejects.toMatchObject({ message: 'PRICE_NO_LONGER_CURRENT' });
      expect(tx.priceSubmission.create).not.toHaveBeenCalled();
    });

    it('refuses a published private price instead of echoing publication as a proposal result', async () => {
      tx.$queryRaw.mockResolvedValue([
        { ...lockedPrivate, status: 'PUBLISHED', verificationStatus: 'PUBLISHED' },
      ]);
      await expect(
        service.submitPrivatePrice(WORKSPACE_ID, PRICE_ID, ACCOUNT_ID),
      ).rejects.toMatchObject({ message: 'AUTO_PUBLISH_FORBIDDEN' });
      expect(tx.priceSubmission.create).not.toHaveBeenCalled();
    });
  });
});
