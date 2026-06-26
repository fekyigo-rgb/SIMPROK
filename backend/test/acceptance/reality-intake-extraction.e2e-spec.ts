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
import { StorageService } from '../../src/reality-intake/storage.service';

const PASSWORD = 'Test1234!';
const PROJECT_CODE = 'ACC-X';

describe('Reality intake extraction worker (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let storageDir: string;
  let workspaceAId: string;
  let worker: ExtractionWorkerService;
  let storage: StorageService;

  beforeAll(async () => {
    process.env.INTAKE_WORKER_ENABLED = 'false';
    storageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'simprok-extract-'));
    process.env.INTAKE_STORAGE_DIR = storageDir;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = new PrismaClient();
    worker = app.get(ExtractionWorkerService);
    storage = app.get(StorageService);

    const project = await prisma.project.findFirstOrThrow({
      where: { code: PROJECT_CODE },
      select: { workspaceId: true },
    });
    workspaceAId = project.workspaceId;
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
    await prisma.extractionArtifact.deleteMany();
    await prisma.intakeJob.deleteMany();
    await prisma.sourceDocument.deleteMany();
  }

  async function login(email = 'assigned@test.local'): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: PASSWORD })
      .expect(201);

    return response.body.access_token;
  }

  async function makeXlsxBuffer(label: string): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sheet1');
    sheet.addRow(['resource', 'unit', 'price', label]);
    sheet.addRow(['cement', 'bag', 71000, label]);
    sheet.addRow(['sand', 'm3', 125000, label]);
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  async function uploadFile(
    file: Buffer,
    filename: string,
    contentType: string,
  ) {
    const token = await login();
    const response = await request(app.getHttpServer())
      .post('/reality-intake/uploads')
      .set('Authorization', `Bearer ${token}`)
      .field('workspaceId', workspaceAId)
      .attach('file', file, { filename, contentType })
      .expect(201);

    return response.body as {
      intakeJobId: string;
      sourceDocumentId: string;
      status: string;
      checksum: string;
      duplicate: boolean;
    };
  }

  async function countForbiddenRecords() {
    const [
      knowledgeCandidates,
      canonicalPricePoints,
      validationResults,
      reviewTasks,
      knowledgeEvents,
      basicPrices,
      priceSubmissions,
    ] = await Promise.all([
      prisma.knowledgeCandidate.count(),
      prisma.canonicalPricePoint.count(),
      prisma.validationResult.count(),
      prisma.reviewTask.count(),
      prisma.knowledgeEvent.count(),
      prisma.basicPrice.count(),
      prisma.priceSubmission.count(),
    ]);

    return {
      knowledgeCandidates,
      canonicalPricePoints,
      validationResults,
      reviewTasks,
      knowledgeEvents,
      basicPrices,
      priceSubmissions,
    };
  }

  async function waitForStatus(jobId: string, status: string) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const job = await prisma.intakeJob.findUniqueOrThrow({
        where: { id: jobId },
        select: { status: true },
      });

      if (job.status === status) {
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    throw new Error(`Timed out waiting for job ${jobId} to be ${status}`);
  }

  it('keeps uploaded xlsx QUEUED while worker is off, then extracts raw rows on processOnce', async () => {
    const beforeForbidden = await countForbiddenRecords();
    const xlsx = await makeXlsxBuffer('happy');
    const upload = await uploadFile(
      xlsx,
      'prices.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );

    let job = await prisma.intakeJob.findUniqueOrThrow({
      where: { id: upload.intakeJobId },
      include: { extractionArtifacts: true },
    });
    expect(job.status).toBe('QUEUED');
    expect(job.extractionArtifacts).toHaveLength(0);

    const originalReadFinal = storage.readFinal.bind(storage);
    let releaseRead: ((bytes: Buffer) => void) | null = null;
    jest.spyOn(storage, 'readFinal').mockImplementation(
      () =>
        new Promise<Buffer>((resolve) => {
          releaseRead = resolve;
        }),
    );

    const processing = worker.processOnce();
    await waitForStatus(upload.intakeJobId, 'EXTRACTING');
    releaseRead!(xlsx);

    await expect(processing).resolves.toMatchObject({
      processed: true,
      intakeJobId: upload.intakeJobId,
      status: 'UNDERSTANDING',
    });
    jest.spyOn(storage, 'readFinal').mockImplementation(originalReadFinal);

    job = await prisma.intakeJob.findUniqueOrThrow({
      where: { id: upload.intakeJobId },
      include: { extractionArtifacts: true },
    });
    expect(job.status).toBe('UNDERSTANDING');
    expect(job.lastCompletedStage).toBe('EXTRACTION');
    expect(job.extractionArtifacts).toHaveLength(1);
    expect(job.extractionArtifacts[0].rowCount).toBeGreaterThan(0);
    expect(job.extractionArtifacts[0].rawRows).toBeTruthy();
    expect(job.extractionArtifacts[0].detectedColumns).toBeTruthy();

    expect(await countForbiddenRecords()).toEqual(beforeForbidden);
  });

  it('marks pdf jobs failed with PDF_EXTRACTION_DEFERRED and structured log', async () => {
    const pdfUpload = await uploadFile(
      Buffer.from('%PDF-1.4 acceptance'),
      'deferred.pdf',
      'application/pdf',
    );
    const before = await prisma.intakeJob.findUniqueOrThrow({
      where: { id: pdfUpload.intakeJobId },
      select: { attempts: true },
    });
    const logSpy = jest.spyOn(console, 'error').mockImplementation();

    await expect(worker.processOnce()).resolves.toMatchObject({
      processed: true,
      intakeJobId: pdfUpload.intakeJobId,
      status: 'FAILED',
      errorCode: 'PDF_EXTRACTION_DEFERRED',
    });

    const failedJob = await prisma.intakeJob.findUniqueOrThrow({
      where: { id: pdfUpload.intakeJobId },
    });
    expect(failedJob.status).toBe('FAILED');
    expect(failedJob.attempts).toBe(before.attempts + 1);
    expect(logSpy).toHaveBeenCalledWith(
      'reality-intake.extraction.failed',
      expect.objectContaining({
        correlationId: failedJob.correlationId,
        intakeJobId: failedJob.id,
        workspaceId: failedJob.workspaceId,
        organizationId: failedJob.organizationId,
        errorCode: 'PDF_EXTRACTION_DEFERRED',
        stage: 'EXTRACTION',
      }),
    );
    expect(await prisma.extractionArtifact.count()).toBe(0);
    logSpy.mockRestore();
  });

  it('marks corrupt xlsx jobs failed without creating an artifact', async () => {
    const corruptUpload = await uploadFile(
      Buffer.from('not a real xlsx'),
      'corrupt.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    const before = await prisma.intakeJob.findUniqueOrThrow({
      where: { id: corruptUpload.intakeJobId },
      select: { attempts: true },
    });
    const logSpy = jest.spyOn(console, 'error').mockImplementation();

    await expect(worker.processOnce()).resolves.toMatchObject({
      processed: true,
      intakeJobId: corruptUpload.intakeJobId,
      status: 'FAILED',
      errorCode: 'XLSX_UNREADABLE',
    });

    const failedJob = await prisma.intakeJob.findUniqueOrThrow({
      where: { id: corruptUpload.intakeJobId },
    });
    expect(failedJob.status).toBe('FAILED');
    expect(failedJob.attempts).toBe(before.attempts + 1);
    expect(logSpy).toHaveBeenCalledWith(
      'reality-intake.extraction.failed',
      expect.objectContaining({
        errorCode: 'XLSX_UNREADABLE',
        reason: expect.any(String),
        stage: 'EXTRACTION',
      }),
    );
    expect(await prisma.extractionArtifact.count()).toBe(0);
    logSpy.mockRestore();
  });

  it('does not create a second artifact when one already exists for the job', async () => {
    const upload = await uploadFile(
      await makeXlsxBuffer('idempotent'),
      'idempotent.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    await prisma.extractionArtifact.create({
      data: {
        intakeJobId: upload.intakeJobId,
        rawRows: [{ rowNumber: 1, values: ['existing'] }],
        detectedColumns: { columns: [{ columnIndex: 1, headerValue: 'existing' }] },
        rowCount: 1,
      },
    });

    await expect(worker.processOnce()).resolves.toMatchObject({
      processed: true,
      intakeJobId: upload.intakeJobId,
      status: 'UNDERSTANDING',
    });

    expect(
      await prisma.extractionArtifact.count({
        where: { intakeJobId: upload.intakeJobId },
      }),
    ).toBe(1);
  });

  it('does not process the same queued job twice under concurrent processOnce calls', async () => {
    const upload = await uploadFile(
      await makeXlsxBuffer('concurrent'),
      'concurrent.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );

    const results = await Promise.all([
      worker.processOnce(),
      worker.processOnce(),
    ]);

    expect(results.filter((result) => result.processed)).toHaveLength(1);
    expect(results.filter((result) => !result.processed)).toHaveLength(1);
    expect(
      await prisma.extractionArtifact.count({
        where: { intakeJobId: upload.intakeJobId },
      }),
    ).toBe(1);
    const job = await prisma.intakeJob.findUniqueOrThrow({
      where: { id: upload.intakeJobId },
    });
    expect(job.status).toBe('UNDERSTANDING');
  });
});
