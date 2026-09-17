import { Test, TestingModule } from '@nestjs/testing';
import { ImportStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AhspDocumentKnowledge } from '../document/ahsp-document-knowledge';
import { AhspAuditService } from './ahsp-audit.service';
import { AhspImportService, ahspImportJobKey } from './ahsp-import.service';

describe('AhspImportService', () => {
  let service: AhspImportService;
  let prisma: {
    aHSPImportJob: {
      create: jest.Mock;
      update: jest.Mock;
    };
  };
  let audit: {
    logAction: jest.Mock;
  };

  const importJob = {
    id: 'import-job-1',
    idempotencyKey: 'import-key-1',
    ahspId: 'ahsp-1',
    status: ImportStatus.PENDING,
  };

  beforeEach(async () => {
    prisma = {
      aHSPImportJob: {
        create: jest.fn(),
        update: jest.fn(),
      },
    };
    audit = {
      logAction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AhspImportService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
        {
          provide: AhspAuditService,
          useValue: audit,
        },
      ],
    }).compile();

    service = module.get<AhspImportService>(AhspImportService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('createImportJob creates a pending import job and writes audit when ahspId and userId exist', async () => {
    prisma.aHSPImportJob.create.mockResolvedValue(importJob);
    audit.logAction.mockResolvedValue({ id: 'audit-1' });

    await expect(
      service.createImportJob(
        importJob.idempotencyKey,
        importJob.ahspId,
        'user-1',
      ),
    ).resolves.toEqual(importJob);

    expect(prisma.aHSPImportJob.create).toHaveBeenCalledWith({
      data: {
        idempotencyKey: importJob.idempotencyKey,
        ahspId: importJob.ahspId,
        status: ImportStatus.PENDING,
      },
    });
    expect(audit.logAction).toHaveBeenCalledWith({
      ahspId: importJob.ahspId,
      action: 'AHSPImportJobCreated',
      who: 'user-1',
      after: importJob,
    });
  });

  it('updateJobStatus updates an import job status and returns the Prisma result', async () => {
    const updatedJob = {
      ...importJob,
      status: ImportStatus.COMPLETED,
    };
    prisma.aHSPImportJob.update.mockResolvedValue(updatedJob);

    await expect(
      service.updateJobStatus(importJob.id, ImportStatus.COMPLETED),
    ).resolves.toEqual(updatedJob);

    expect(prisma.aHSPImportJob.update).toHaveBeenCalledWith({
      where: { id: importJob.id },
      data: { status: ImportStatus.COMPLETED },
    });
  });
});

/**
 * IMPORT-SEAM-02 — THE DURABLE INTAKE JOURNAL, AS A CONTRACT.
 *
 * What a document was read into is kept before anything is decided, once per
 * workspace + bytes + contracts, and a line that is represented in the AHSP
 * tables is never un-represented by a later evaluation.
 */
describe('AhspImportService — intake journal', () => {
  const WS = '11111111-1111-4111-8111-111111111111';
  const JOB = '22222222-2222-4222-8222-222222222222';
  const knowledge = {
    contractVersion: 'AHSP_DOCUMENT_USI01_V1',
    source: {
      fileName: 'analisa.xlsx',
      contentDigestSha256: 'a'.repeat(64),
      readerId: 'XLSX_EXCELJS',
      readerContractVersion: 'XLSX_V1',
      byteSize: 10,
    },
    document: {
      title: null,
      regulationReference: null,
      effectiveDate: null,
      authorityProven: false,
    },
    status: 'UNRESOLVED',
    reasonCodes: ['CURRENTNESS_UNPROVEN'],
    workItems: [
      {
        status: 'UNRESOLVED',
        reasonCodes: ['MISSING_OUTPUT_UNIT'],
        workType: { raw: 'B.13' },
        methodName: { raw: 'Gorong-gorong' },
        resources: [],
      },
      {
        status: 'READY',
        reasonCodes: [],
        workType: { raw: 'B.14' },
        methodName: { raw: 'Saluran' },
        resources: [],
      },
    ],
  } as unknown as AhspDocumentKnowledge;

  /** The first argument of a mock's first call, in the shape the service sends. */
  const firstArgument = <T>(mock: jest.Mock): T =>
    (mock.mock.calls as T[][])[0][0];

  let tx: {
    aHSPImportJob: { upsert: jest.Mock };
    aHSPImportLine: { createMany: jest.Mock; findMany: jest.Mock };
  };
  let prisma: {
    $transaction: jest.Mock;
    aHSPImportJob: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      updateMany: jest.Mock;
    };
    aHSPImportLine: { findMany: jest.Mock; updateMany: jest.Mock };
    $queryRaw: jest.Mock;
  };
  let service: AhspImportService;

  beforeEach(() => {
    tx = {
      aHSPImportJob: {
        upsert: jest.fn().mockResolvedValue({ id: JOB, workspaceId: WS }),
      },
      aHSPImportLine: {
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
        findMany: jest.fn().mockResolvedValue([
          { id: 'line-1', lineNumber: 1, status: ImportStatus.PENDING },
          { id: 'line-2', lineNumber: 2, status: ImportStatus.PENDING },
        ]),
      },
    };
    prisma = {
      $transaction: jest.fn((callback: (client: unknown) => unknown) =>
        callback(tx),
      ),
      aHSPImportJob: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        updateMany: jest.fn(),
      },
      aHSPImportLine: {
        findMany: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    service = new AhspImportService(
      prisma as unknown as PrismaService,
      { logAction: jest.fn() } as unknown as AhspAuditService,
    );
  });

  it('records the document once, keyed on workspace + bytes + contracts, and every work item as one line', async () => {
    const recorded = await service.recordDocument({
      workspaceId: WS,
      userId: 'user-1',
      knowledge,
    });
    const upsert = firstArgument<{
      where: { idempotencyKey: string };
      update: unknown;
      create: { documentKnowledge: unknown };
    }>(tx.aHSPImportJob.upsert);
    expect(upsert.where.idempotencyKey).toBe(
      ahspImportJobKey({
        workspaceId: WS,
        sourceSha256: 'a'.repeat(64),
        parserContractVersion: 'XLSX_V1',
        knowledgeContractVersion: 'AHSP_DOCUMENT_USI01_V1',
      }),
    );
    // An existing job is found again, never modified.
    expect(upsert.update).toEqual({});
    expect(upsert.create).toMatchObject({
      workspaceId: WS,
      sourceSha256: 'a'.repeat(64),
      sourceFileName: 'analisa.xlsx',
      parserContractVersion: 'XLSX_V1',
      knowledgeContractVersion: 'AHSP_DOCUMENT_USI01_V1',
      createdByUserId: 'user-1',
    });
    // The document-level half only — the work items live on lines.
    expect(upsert.create.documentKnowledge).not.toHaveProperty('workItems');
    const lines = firstArgument<{
      skipDuplicates: boolean;
      data: Array<{
        lineNumber: number;
        rawData: { workType: { raw: string } };
        reasonCodes: string[];
      }>;
    }>(tx.aHSPImportLine.createMany);
    expect(lines.skipDuplicates).toBe(true);
    expect(
      lines.data.map((line) => [
        line.lineNumber,
        line.rawData.workType.raw,
        line.reasonCodes,
      ]),
    ).toEqual([
      [1, 'B.13', ['MISSING_OUTPUT_UNIT']],
      [2, 'B.14', []],
    ]);
    expect(recorded).toEqual({
      importJobId: JOB,
      lines: [
        { id: 'line-1', lineNumber: 1, status: ImportStatus.PENDING },
        { id: 'line-2', lineNumber: 2, status: ImportStatus.PENDING },
      ],
    });
  });

  it('a different workspace can never share a job, even with identical bytes', () => {
    const base = {
      sourceSha256: 'a'.repeat(64),
      parserContractVersion: 'XLSX_V1',
      knowledgeContractVersion: 'AHSP_DOCUMENT_USI01_V1',
    };
    expect(ahspImportJobKey({ ...base, workspaceId: WS })).not.toBe(
      ahspImportJobKey({
        ...base,
        workspaceId: '33333333-3333-4333-8333-333333333333',
      }),
    );
  });

  it('refuses a job whose stored scope disagrees with the caller', async () => {
    tx.aHSPImportJob.upsert.mockResolvedValue({
      id: JOB,
      workspaceId: 'someone-else',
    });
    await expect(
      service.recordDocument({ workspaceId: WS, userId: 'user-1', knowledge }),
    ).rejects.toThrow('AHSP_IMPORT_JOB_SCOPE_MISMATCH');
    expect(tx.aHSPImportLine.createMany).not.toHaveBeenCalled();
  });

  it('settling a line never downgrades or re-points a line already represented in the AHSP tables', async () => {
    type LineClient = Parameters<AhspImportService['settleLine']>[0];
    const settled = await service.settleLine(prisma as unknown as LineClient, {
      workspaceId: WS,
      lineId: 'line-1',
      status: ImportStatus.PENDING,
      reasonCodes: ['RESOURCE_UNRESOLVED'],
    });
    // F01 — the guard's ANSWER travels to the caller: how many lines really changed.
    expect(settled).toBe(1);
    expect(prisma.aHSPImportLine.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'line-1',
        workspaceId: WS,
        status: { not: ImportStatus.COMPLETED },
      },
      data: {
        status: ImportStatus.PENDING,
        reasonCodes: ['RESOURCE_UNRESOLVED'],
        ahspId: null,
        ahspVersionId: null,
        errorMessage: null,
      },
    });
  });

  it('job status follows its lines: all represented, some, or none yet', async () => {
    const statusFor = async (lineStatuses: ImportStatus[]) => {
      prisma.aHSPImportLine.findMany.mockResolvedValueOnce(
        lineStatuses.map((status) => ({ status })),
      );
      return service.refreshJobStatus(WS, JOB);
    };
    expect(
      await statusFor([ImportStatus.COMPLETED, ImportStatus.COMPLETED]),
    ).toBe(ImportStatus.COMPLETED);
    expect(
      await statusFor([ImportStatus.COMPLETED, ImportStatus.PENDING]),
    ).toBe(ImportStatus.PARTIAL_SUCCESS);
    expect(await statusFor([ImportStatus.PENDING, ImportStatus.FAILED])).toBe(
      ImportStatus.PENDING,
    );
    expect(prisma.aHSPImportJob.updateMany).toHaveBeenLastCalledWith({
      where: { id: JOB, workspaceId: WS },
      data: { status: ImportStatus.PENDING },
    });
  });

  it('a continuation reads only held lines of its own workspace, exactly as understood', async () => {
    prisma.aHSPImportJob.findFirst.mockResolvedValue({
      documentKnowledge: { contractVersion: 'AHSP_DOCUMENT_USI01_V1' },
      knowledgeContractVersion: 'AHSP_DOCUMENT_USI01_V1',
    });
    prisma.aHSPImportLine.findMany.mockResolvedValue([
      {
        id: 'line-1',
        lineNumber: 1,
        status: ImportStatus.PENDING,
        rawData: knowledge.workItems[0],
      },
    ]);
    const held = await service.loadHeld(WS, JOB);
    expect(
      firstArgument<{ where: unknown }>(prisma.aHSPImportJob.findFirst).where,
    ).toEqual({ id: JOB, workspaceId: WS });
    expect(
      firstArgument<{ where: unknown }>(prisma.aHSPImportLine.findMany).where,
    ).toEqual({
      importJobId: JOB,
      workspaceId: WS,
      status: { in: [ImportStatus.PENDING, ImportStatus.FAILED] },
    });
    expect(held.lines[0].knowledge).toBe(knowledge.workItems[0]);
  });

  it('a foreign or malformed job id is simply not found — nothing is queried with it', async () => {
    await expect(service.loadHeld(WS, 'not-a-uuid')).rejects.toThrow(
      'AHSP_IMPORT_JOB_NOT_FOUND',
    );
    expect(prisma.aHSPImportJob.findFirst).not.toHaveBeenCalled();
    prisma.aHSPImportJob.findFirst.mockResolvedValue(null);
    await expect(service.loadHeld(WS, JOB)).rejects.toThrow(
      'AHSP_IMPORT_JOB_NOT_FOUND',
    );
  });

  it('F01 — a settlement that changed nothing is not success: the write that depends on it is refused', async () => {
    type LineClient = Parameters<AhspImportService['settleLine']>[0];
    const outcome = {
      workspaceId: WS,
      lineId: 'line-1',
      status: ImportStatus.COMPLETED,
      reasonCodes: [],
      ahspId: 'ahsp-1',
      ahspVersionId: 'version-1',
    };
    prisma.aHSPImportLine.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      service.settleOrThrow(prisma as unknown as LineClient, outcome),
    ).rejects.toThrow('AHSP_IMPORT_LINE_ALREADY_SETTLED');
    prisma.aHSPImportLine.updateMany.mockResolvedValueOnce({ count: 1 });
    await expect(
      service.settleOrThrow(prisma as unknown as LineClient, outcome),
    ).resolves.toBeUndefined();
  });

  it('F01 — the line is LOCKED and re-read in the caller\'s transaction, scoped to its own workspace', async () => {
    type LockClient = Parameters<AhspImportService['lockLine']>[0];
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        id: 'line-1',
        status: ImportStatus.COMPLETED,
        ahspId: 'ahsp-1',
        ahspVersionId: 'version-1',
        reasonCodes: ['DUPLICATE_IDENTITY'],
      },
    ]);
    const locked = await service.lockLine(prisma as unknown as LockClient, {
      workspaceId: WS,
      lineId: '33333333-3333-4333-8333-333333333333',
    });
    expect(locked).toMatchObject({
      status: ImportStatus.COMPLETED,
      ahspId: 'ahsp-1',
    });
    const sql = (
      prisma.$queryRaw.mock.calls[0][0] as { strings: string[] }
    ).strings.join('?');
    expect(sql).toContain('FOR UPDATE');
    expect(sql).toContain('ahsp_import_lines');
    expect(sql).toContain('"workspaceId"');
    // A line of another workspace simply is not there.
    prisma.$queryRaw.mockResolvedValueOnce([]);
    await expect(
      service.lockLine(prisma as unknown as LockClient, {
        workspaceId: WS,
        lineId: '33333333-3333-4333-8333-333333333333',
      }),
    ).resolves.toBeNull();
    // A malformed id is never even asked.
    prisma.$queryRaw.mockClear();
    await expect(
      service.lockLine(prisma as unknown as LockClient, {
        workspaceId: WS,
        lineId: 'not-a-uuid',
      }),
    ).resolves.toBeNull();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('F02a — a page of imports carries the way on to the older ones, and a cursor is proved before it positions anything', async () => {
    const olderThanTwenty = Array.from({ length: 21 }, (_, index) => ({
      id: `000000${String(index).padStart(2, '0')}-0000-4000-8000-000000000000`,
      sourceFileName: `doc-${index}.xlsx`,
      status: ImportStatus.COMPLETED,
      createdAt: new Date(Date.UTC(2026, 8, 15, 0, 0, index)),
      updatedAt: new Date(Date.UTC(2026, 8, 15, 0, 0, index)),
      lines: [],
    }));
    prisma.aHSPImportJob.findMany.mockResolvedValue(olderThanTwenty);
    prisma.aHSPImportLine.findMany.mockResolvedValue([]);
    const page = await service.listDocuments(WS);
    const query = firstArgument<{
      take: number;
      orderBy: unknown;
      where: unknown;
    }>(prisma.aHSPImportJob.findMany);
    // One more than the page is read: that is how "there is more" is KNOWN, not guessed.
    expect(query.take).toBe(21);
    expect(query.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    expect(query.where).toEqual({ workspaceId: WS });
    expect(page.jobs).toHaveLength(20);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toEqual(expect.any(String));

    // The next page continues from the last row of this one — by key, never by offset.
    prisma.aHSPImportJob.findMany.mockClear();
    prisma.aHSPImportJob.findMany.mockResolvedValue([]);
    await service.listDocuments(WS, { cursor: page.nextCursor });
    const continued = firstArgument<{ where: { OR: unknown[] } }>(
      prisma.aHSPImportJob.findMany,
    );
    const last = page.jobs[page.jobs.length - 1];
    expect(continued.where.OR).toEqual([
      { createdAt: { lt: last.createdAt } },
      { createdAt: last.createdAt, id: { lt: last.importJobId } },
    ]);

    // A cursor that is not one this listing wrote is refused, and nothing is read.
    prisma.aHSPImportJob.findMany.mockClear();
    await expect(
      service.listDocuments(WS, { cursor: 'not-a-cursor' }),
    ).rejects.toThrow('AHSP_IMPORT_JOBS_CURSOR_INVALID');
    expect(prisma.aHSPImportJob.findMany).not.toHaveBeenCalled();
  });

  it('lists recent documents with their counts and every waiting line named as the source names it', async () => {
    prisma.aHSPImportJob.findMany.mockResolvedValue([
      {
        id: JOB,
        sourceFileName: 'analisa.xlsx',
        status: ImportStatus.PARTIAL_SUCCESS,
        createdAt: new Date('2026-09-15T00:00:00.000Z'),
        updatedAt: new Date('2026-09-15T00:00:00.000Z'),
        lines: [
          {
            lineNumber: 1,
            status: ImportStatus.PENDING,
            reasonCodes: ['MISSING_OUTPUT_UNIT'],
          },
          {
            lineNumber: 2,
            status: ImportStatus.COMPLETED,
            reasonCodes: ['RESOURCE_UNRESOLVED'],
          },
          { lineNumber: 3, status: ImportStatus.COMPLETED, reasonCodes: [] },
        ],
      },
    ]);
    prisma.aHSPImportLine.findMany.mockResolvedValue([
      {
        importJobId: JOB,
        lineNumber: 1,
        status: ImportStatus.PENDING,
        reasonCodes: ['MISSING_OUTPUT_UNIT'],
        rawData: knowledge.workItems[0],
      },
    ]);
    const [listed] = (await service.listDocuments(WS)).jobs;
    expect(
      firstArgument<{ where: unknown }>(prisma.aHSPImportJob.findMany).where,
    ).toEqual({ workspaceId: WS });
    // No "identity pending" count: a settled line's reasons go stale once a person curates.
    expect(listed.counts).toEqual({ received: 3, represented: 2, waiting: 1 });
    expect(listed.waiting).toEqual([
      {
        lineNumber: 1,
        status: ImportStatus.PENDING,
        reasonCodes: ['MISSING_OUTPUT_UNIT'],
        workType: 'B.13',
        methodName: 'Gorong-gorong',
      },
    ]);
  });

  it('AHSP COMPLETION: reads every line of the listed imports with the AHSP and version a saved line points to — whatever reasons settled it', async () => {
    // CHANGE NOTE (closeout P1-A): a saved line's settling reasons are not what
    // decides completeness any more — the recipe it points to is asked instead —
    // so a PROVEN line (no reasons at all) is read too, with its pointers.
    prisma.aHSPImportLine.findMany.mockResolvedValue([
      {
        id: 'line-2',
        importJobId: JOB,
        lineNumber: 2,
        status: ImportStatus.COMPLETED,
        reasonCodes: [],
        ahspId: 'ahsp-1',
        ahspVersionId: 'version-1',
        rawData: knowledge.workItems[0],
      },
    ]);
    const lines = await service.loadCompletionLines(WS, [JOB]);
    const query = firstArgument<{ where: unknown; select: unknown }>(
      prisma.aHSPImportLine.findMany,
    );
    expect(query.where).toEqual({
      workspaceId: WS,
      importJobId: { in: [JOB] },
    });
    expect(query.select).toEqual({
      id: true,
      importJobId: true,
      lineNumber: true,
      status: true,
      reasonCodes: true,
      ahspId: true,
      ahspVersionId: true,
      rawData: true,
    });
    expect(lines).toEqual([
      {
        id: 'line-2',
        importJobId: JOB,
        lineNumber: 2,
        status: ImportStatus.COMPLETED,
        reasonCodes: [],
        ahspId: 'ahsp-1',
        ahspVersionId: 'version-1',
        knowledge: knowledge.workItems[0],
      },
    ]);
    // No job, no query.
    prisma.aHSPImportLine.findMany.mockClear();
    expect(await service.loadCompletionLines(WS, [])).toEqual([]);
    expect(prisma.aHSPImportLine.findMany).not.toHaveBeenCalled();
  });
});
