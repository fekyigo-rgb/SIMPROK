import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { ExtractionWorkerService } from '../../src/reality-intake/extraction-worker.service';
import { UnderstandingValidationService } from '../../src/reality-intake/understanding-validation.service';

const PASSWORD = 'Test1234!';
const PROJECT_CODE = 'ACC-X';

describe('Reality intake understanding and validation (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let storageDir: string;
  let workspaceAId: string;
  let organizationId: string;
  let extractionWorker: ExtractionWorkerService;
  let understandingWorker: UnderstandingValidationService;

  beforeAll(async () => {
    process.env.INTAKE_WORKER_ENABLED = 'false';
    process.env.INTAKE_UNDERSTANDING_WORKER_ENABLED = 'false';
    storageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'simprok-understand-'));
    process.env.INTAKE_STORAGE_DIR = storageDir;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = new PrismaClient();
    extractionWorker = app.get(ExtractionWorkerService);
    understandingWorker = app.get(UnderstandingValidationService);

    const project = await prisma.project.findFirstOrThrow({
      where: { code: PROJECT_CODE },
      select: { workspaceId: true, organizationId: true },
    });
    workspaceAId = project.workspaceId;
    organizationId = project.organizationId;
  });

  beforeEach(async () => {
    await cleanupIntakeTables();
  });

  afterAll(async () => {
    await cleanupIntakeTables();
    await prisma.$disconnect();
    await app.close();
    await fs.rm(storageDir, { recursive: true, force: true });
  });

  async function cleanupIntakeTables() {
    await prisma.knowledgeEvent.deleteMany();
    await prisma.reviewDecision.deleteMany();
    await prisma.reviewTask.deleteMany();
    await prisma.validationResult.deleteMany();
    await prisma.knowledgeCandidate.deleteMany();
    await prisma.canonicalPricePoint.deleteMany();
    await prisma.extractionArtifact.deleteMany();
    await prisma.intakeJob.deleteMany();
    await prisma.sourceDocument.deleteMany();
  }

  async function login(): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'assigned@test.local', password: PASSWORD })
      .expect(201);

    return response.body.access_token;
  }

  async function makeXlsxBuffer(
    headers: string[],
    rows: Array<Array<string | number | null>>,
  ): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sheet1');
    sheet.addRow(headers);
    for (const row of rows) {
      sheet.addRow(row);
    }

    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  async function uploadAndExtract(
    file: Buffer,
    filename = `understanding-${Date.now()}.xlsx`,
  ) {
    const token = await login();
    const upload = await request(app.getHttpServer())
      .post('/reality-intake/uploads')
      .set('Authorization', `Bearer ${token}`)
      .field('workspaceId', workspaceAId)
      .attach('file', file, {
        filename,
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      .expect(201);

    await expect(extractionWorker.processOnce()).resolves.toMatchObject({
      processed: true,
      intakeJobId: upload.body.intakeJobId,
      status: 'UNDERSTANDING',
    });

    return upload.body as {
      intakeJobId: string;
      sourceDocumentId: string;
    };
  }

  async function countNegativeSpace() {
    const [
      knowledgeEvents,
      reviewTasks,
      reviewDecisions,
      basicPrices,
      priceSubmissions,
    ] = await Promise.all([
      prisma.knowledgeEvent.count(),
      prisma.reviewTask.count(),
      prisma.reviewDecision.count(),
      prisma.basicPrice.count(),
      prisma.priceSubmission.count(),
    ]);

    return {
      knowledgeEvents,
      reviewTasks,
      reviewDecisions,
      basicPrices,
      priceSubmissions,
    };
  }

  it('detects headers and validates a complete row into a candidate, canonical price point, and MATCHED result', async () => {
    const beforeNegative = await countNegativeSpace();
    const upload = await uploadAndExtract(
      await makeXlsxBuffer(
        ['uraian', 'satuan', 'harga', 'sumber'],
        [['cement', 'bag', 71000, 'SUPPLIER']],
      ),
      'valid-understanding.xlsx',
    );

    const beforeUnderstandingJob = await prisma.intakeJob.findUniqueOrThrow({
      where: { id: upload.intakeJobId },
    });
    expect(beforeUnderstandingJob.status).toBe('UNDERSTANDING');
    expect(await prisma.knowledgeCandidate.count()).toBe(0);

    await expect(understandingWorker.processOnce()).resolves.toMatchObject({
      processed: true,
      intakeJobId: upload.intakeJobId,
      status: 'NEEDS_REVIEW',
      candidatesCreated: 1,
    });

    const job = await prisma.intakeJob.findUniqueOrThrow({
      where: { id: upload.intakeJobId },
    });
    expect(job.status).toBe('NEEDS_REVIEW');

    const candidate = await prisma.knowledgeCandidate.findFirstOrThrow({
      where: { intakeJobId: upload.intakeJobId },
      include: {
        canonicalPricePoint: true,
        validationResults: true,
      },
    });

    expect(candidate.workspaceId).toBe(workspaceAId);
    expect(candidate.organizationId).toBe(organizationId);
    expect(candidate.knowledgeType).toBe('PRICE_POINT');
    expect(candidate.lifecycleStatus).toBe('VALIDATED');
    expect(candidate.confidence).toBe(1);
    expect(candidate.canonicalPricePointId).toBeTruthy();
    expect(candidate.validationResults).toHaveLength(1);
    expect(candidate.validationResults[0].status).toBe('MATCHED');
    expect(JSON.parse(candidate.validationResults[0].messages ?? '[]')).toEqual(
      expect.arrayContaining([
        'RESOURCE_PRESENT',
        'UNIT_PRESENT',
        'PRICE_PRESENT',
        'PRICE_NUMERIC',
        'PRICE_NON_NEGATIVE',
        'SOURCE_ORIGIN_VALID',
      ]),
    );

    expect(candidate.canonicalPricePoint).toMatchObject({
      resourceRef: 'cement',
      unit: 'bag',
      sourceOrigin: 'SUPPLIER',
    });
    expect(candidate.canonicalPricePoint?.value.toString()).toBe('71000');

    const context = JSON.parse(candidate.contextPath ?? '{}');
    expect(context.rowNumber).toBe(2);
    expect(context.rawValues).toEqual(['cement', 'bag', 71000, 'SUPPLIER']);
    expect(context.detectedColumns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'resource', columnIndex: 1 }),
        expect.objectContaining({ role: 'unit', columnIndex: 2 }),
        expect.objectContaining({ role: 'price', columnIndex: 3 }),
        expect.objectContaining({ role: 'sourceOrigin', columnIndex: 4 }),
      ]),
    );

    expect(await countNegativeSpace()).toEqual(beforeNegative);
  });

  it('parks missing sourceOrigin rows in NEEDS_REVIEW with UNRESOLVED validation and no canonical price point', async () => {
    const upload = await uploadAndExtract(
      await makeXlsxBuffer(
        ['resource', 'unit', 'price'],
        [['sand', 'm3', 125000]],
      ),
      'missing-source-origin.xlsx',
    );

    await expect(understandingWorker.processOnce()).resolves.toMatchObject({
      processed: true,
      intakeJobId: upload.intakeJobId,
      status: 'NEEDS_REVIEW',
      candidatesCreated: 1,
    });

    const candidate = await prisma.knowledgeCandidate.findFirstOrThrow({
      where: { intakeJobId: upload.intakeJobId },
      include: { validationResults: true },
    });

    expect(candidate.lifecycleStatus).toBe('NEEDS_REVIEW');
    expect(candidate.confidence).toBe(0);
    expect(candidate.canonicalPricePointId).toBeNull();
    expect(candidate.validationResults).toHaveLength(1);
    expect(candidate.validationResults[0].status).toBe('UNRESOLVED');
    expect(JSON.parse(candidate.validationResults[0].messages ?? '[]')).toEqual(
      expect.arrayContaining(['MISSING_SOURCE_ORIGIN']),
    );
    expect(await prisma.canonicalPricePoint.count()).toBe(0);
  });

  it('marks non-numeric and negative prices as NEEDS_REVIEW without canonical price points', async () => {
    const upload = await uploadAndExtract(
      await makeXlsxBuffer(
        ['resource', 'unit', 'price', 'sourceOrigin'],
        [
          ['steel', 'kg', 'abc', 'SUPPLIER'],
          ['water', 'liter', -5, 'SUPPLIER'],
        ],
      ),
      'bad-prices.xlsx',
    );

    await expect(understandingWorker.processOnce()).resolves.toMatchObject({
      processed: true,
      intakeJobId: upload.intakeJobId,
      status: 'NEEDS_REVIEW',
      candidatesCreated: 2,
    });

    const candidates = await prisma.knowledgeCandidate.findMany({
      where: { intakeJobId: upload.intakeJobId },
      include: { validationResults: true },
      orderBy: { createdAt: 'asc' },
    });

    expect(candidates).toHaveLength(2);
    for (const candidate of candidates) {
      expect(candidate.lifecycleStatus).toBe('NEEDS_REVIEW');
      expect(candidate.canonicalPricePointId).toBeNull();
      expect(candidate.validationResults).toHaveLength(1);
      expect(candidate.validationResults[0].status).toBe('NEEDS_REVIEW');
    }
    expect(JSON.parse(candidates[0].validationResults[0].messages ?? '[]')).toEqual(
      expect.arrayContaining(['NON_NUMERIC_PRICE']),
    );
    expect(JSON.parse(candidates[1].validationResults[0].messages ?? '[]')).toEqual(
      expect.arrayContaining(['NEGATIVE_PRICE']),
    );
    expect(await prisma.canonicalPricePoint.count()).toBe(0);
  });

  it('does not create duplicates when processOnce is called again for an already understood job', async () => {
    const upload = await uploadAndExtract(
      await makeXlsxBuffer(
        ['resource', 'unit', 'price', 'sourceOrigin'],
        [['aggregate', 'm3', 95000, 'STORE']],
      ),
      'idempotent-understanding.xlsx',
    );

    await understandingWorker.processOnce();
    const countsAfterFirstRun = {
      candidates: await prisma.knowledgeCandidate.count(),
      canonicals: await prisma.canonicalPricePoint.count(),
      validations: await prisma.validationResult.count(),
    };

    await expect(understandingWorker.processOnce()).resolves.toEqual({
      processed: false,
      reason: 'NO_JOB',
    });

    expect({
      candidates: await prisma.knowledgeCandidate.count(),
      canonicals: await prisma.canonicalPricePoint.count(),
      validations: await prisma.validationResult.count(),
    }).toEqual(countsAfterFirstRun);

    expect(
      await prisma.knowledgeCandidate.count({
        where: { intakeJobId: upload.intakeJobId },
      }),
    ).toBe(1);
  });

  it('does not create forbidden publication, review, or business records', async () => {
    const beforeNegative = await countNegativeSpace();
    const upload = await uploadAndExtract(
      await makeXlsxBuffer(
        ['resource', 'unit', 'price', 'sourceOrigin'],
        [['paint', 'pail', 250000, 'DISTRIBUTOR']],
      ),
      'negative-space.xlsx',
    );

    await understandingWorker.processOnce();

    expect(await countNegativeSpace()).toEqual(beforeNegative);
    const job = await prisma.intakeJob.findUniqueOrThrow({
      where: { id: upload.intakeJobId },
    });
    expect(job.status).toBe('NEEDS_REVIEW');
    expect(job.status).not.toBe('PUBLISHED');
  });
});
