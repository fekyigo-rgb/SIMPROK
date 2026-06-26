import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient, PriceSourceOrigin } from '@prisma/client';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { PublicationWorkerService } from '../../src/reality-intake/publication-worker.service';

const PROJECT_CODE = 'ACC-X';

type CandidateSpec = {
  lifecycleStatus: 'VALIDATED' | 'NEEDS_REVIEW';
  validationStatus: 'MATCHED' | 'UNRESOLVED' | 'NEEDS_REVIEW';
  withCanonical: boolean;
};

describe('Reality intake publication worker (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let worker: PublicationWorkerService;
  let workspaceAId: string;
  let organizationId: string;
  let uploadedByAccountId: string;

  beforeAll(async () => {
    process.env.INTAKE_PUBLICATION_WORKER_ENABLED = 'false';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = new PrismaClient();
    worker = app.get(PublicationWorkerService);

    const project = await prisma.project.findFirstOrThrow({
      where: { code: PROJECT_CODE },
      select: { workspaceId: true, organizationId: true },
    });
    workspaceAId = project.workspaceId;
    organizationId = project.organizationId;

    const account = await prisma.account.findUniqueOrThrow({
      where: { email: 'assigned@test.local' },
      select: { id: true },
    });
    uploadedByAccountId = account.id;
  });

  beforeEach(async () => {
    await cleanupIntakeTables();
  });

  afterAll(async () => {
    await cleanupIntakeTables();
    await prisma.$disconnect();
    await app.close();
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

  async function negativeCounts() {
    const [basicPrices, priceSubmissions, reviewTasks, reviewDecisions] =
      await Promise.all([
        prisma.basicPrice.count(),
        prisma.priceSubmission.count(),
        prisma.reviewTask.count(),
        prisma.reviewDecision.count(),
      ]);

    return { basicPrices, priceSubmissions, reviewTasks, reviewDecisions };
  }

  async function createPublicationFixture(specs: CandidateSpec[]) {
    const stamp = `${Date.now()}-${Math.random()}`;
    const sourceDocument = await prisma.sourceDocument.create({
      data: {
        workspaceId: workspaceAId,
        organizationId,
        uploadedByAccountId,
        fileName: `publication-${stamp}.xlsx`,
        mimeType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        byteSize: 128,
        checksum: `publication-${stamp}`,
        storageRef: `test://publication-${stamp}`,
      },
    });

    const intakeJob = await prisma.intakeJob.create({
      data: {
        sourceDocumentId: sourceDocument.id,
        workspaceId: workspaceAId,
        organizationId,
        idempotencyKey: `publication-${stamp}:${workspaceAId}`,
        status: 'NEEDS_REVIEW',
        lastCompletedStage: 'VALIDATION',
        correlationId: `publication-${stamp}`,
      },
    });

    const artifact = await prisma.extractionArtifact.create({
      data: {
        intakeJobId: intakeJob.id,
        rawRows: [{ rowNumber: 1, values: ['resource', 'unit', 'price'] }],
        detectedColumns: { columns: [] },
        rowCount: 1,
      },
    });

    const candidates = [];
    for (let index = 0; index < specs.length; index += 1) {
      const spec = specs[index];
      const canonicalPricePoint = spec.withCanonical
        ? await prisma.canonicalPricePoint.create({
            data: {
              resourceRef: `resource-${stamp}-${index}`,
              value: 1000 + index,
              unit: 'unit',
              sourceOrigin: PriceSourceOrigin.SUPPLIER,
              effectiveDate: null,
            },
          })
        : null;

      const candidate = await prisma.knowledgeCandidate.create({
        data: {
          intakeJobId: intakeJob.id,
          extractionArtifactId: artifact.id,
          workspaceId: workspaceAId,
          organizationId,
          knowledgeType: 'PRICE_POINT',
          contextPath: JSON.stringify({ rowNumber: index + 2 }),
          canonicalPricePointId: canonicalPricePoint?.id,
          lifecycleStatus: spec.lifecycleStatus,
          confidence: spec.lifecycleStatus === 'VALIDATED' ? 1 : 0,
        },
      });

      await prisma.validationResult.create({
        data: {
          candidateId: candidate.id,
          status: spec.validationStatus,
          confidence: spec.validationStatus === 'MATCHED' ? 1 : 0,
          messages: JSON.stringify([spec.validationStatus]),
        },
      });

      candidates.push(candidate);
    }

    return { sourceDocument, intakeJob, artifact, candidates };
  }

  it('publishes a VALIDATED MATCHED candidate with canonicalPricePointId into one KnowledgeEvent', async () => {
    expect(await negativeCounts()).toEqual({
      basicPrices: 0,
      priceSubmissions: 0,
      reviewTasks: 0,
      reviewDecisions: 0,
    });
    const fixture = await createPublicationFixture([
      {
        lifecycleStatus: 'VALIDATED',
        validationStatus: 'MATCHED',
        withCanonical: true,
      },
    ]);

    await expect(worker.processOnce()).resolves.toMatchObject({
      processed: true,
      intakeJobId: fixture.intakeJob.id,
      status: 'PUBLISHED',
      eventsCreated: 1,
    });

    const event = await prisma.knowledgeEvent.findFirstOrThrow({
      where: { envelopeId: fixture.candidates[0].id, revision: 1 },
    });
    expect(event).toMatchObject({
      knowledgeType: 'PRICE_POINT',
      workspaceId: workspaceAId,
      organizationId,
      canonicalPricePointId: fixture.candidates[0].canonicalPricePointId,
      publishedByRef:
        'SYSTEM_POLICY:STEP-2.5_VALIDATED_KNOWLEDGE_PUBLICATION_v1',
      revision: 1,
    });
    expect(event.sequence).toBeTruthy();
    expect(event.provenanceChain).toMatchObject({
      intakeJobId: fixture.intakeJob.id,
      sourceDocumentId: fixture.sourceDocument.id,
      extractionArtifactId: fixture.artifact.id,
      candidateId: fixture.candidates[0].id,
      canonicalPricePointId: fixture.candidates[0].canonicalPricePointId,
      stage: 'PUBLICATION',
      policy: 'STEP-2.5_FIRST_PUBLICATION',
    });

    const candidate = await prisma.knowledgeCandidate.findUniqueOrThrow({
      where: { id: fixture.candidates[0].id },
    });
    expect(candidate.lifecycleStatus).toBe('PUBLISHED');
  });

  it('publishes only valid candidates in a mixed job and leaves the job in NEEDS_REVIEW', async () => {
    const fixture = await createPublicationFixture([
      {
        lifecycleStatus: 'VALIDATED',
        validationStatus: 'MATCHED',
        withCanonical: true,
      },
      {
        lifecycleStatus: 'VALIDATED',
        validationStatus: 'MATCHED',
        withCanonical: true,
      },
      {
        lifecycleStatus: 'NEEDS_REVIEW',
        validationStatus: 'UNRESOLVED',
        withCanonical: false,
      },
      {
        lifecycleStatus: 'NEEDS_REVIEW',
        validationStatus: 'NEEDS_REVIEW',
        withCanonical: false,
      },
    ]);

    await expect(worker.processOnce()).resolves.toMatchObject({
      processed: true,
      intakeJobId: fixture.intakeJob.id,
      status: 'NEEDS_REVIEW',
      eventsCreated: 2,
    });

    expect(
      await prisma.knowledgeEvent.count({
        where: { envelopeId: { in: fixture.candidates.map((candidate) => candidate.id) } },
      }),
    ).toBe(2);

    const candidates = await prisma.knowledgeCandidate.findMany({
      where: { intakeJobId: fixture.intakeJob.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(candidates.map((candidate) => candidate.lifecycleStatus)).toEqual([
      'PUBLISHED',
      'PUBLISHED',
      'NEEDS_REVIEW',
      'NEEDS_REVIEW',
    ]);

    const job = await prisma.intakeJob.findUniqueOrThrow({
      where: { id: fixture.intakeJob.id },
    });
    expect(job.status).toBe('NEEDS_REVIEW');
    expect(job.lastCompletedStage).toBe('PARTIAL_PUBLICATION');
  });

  it('marks a fully published job PUBLISHED with PUBLICATION stage', async () => {
    const fixture = await createPublicationFixture([
      {
        lifecycleStatus: 'VALIDATED',
        validationStatus: 'MATCHED',
        withCanonical: true,
      },
      {
        lifecycleStatus: 'VALIDATED',
        validationStatus: 'MATCHED',
        withCanonical: true,
      },
    ]);

    await expect(worker.processOnce()).resolves.toMatchObject({
      processed: true,
      intakeJobId: fixture.intakeJob.id,
      status: 'PUBLISHED',
      eventsCreated: 2,
    });

    const job = await prisma.intakeJob.findUniqueOrThrow({
      where: { id: fixture.intakeJob.id },
    });
    expect(job.status).toBe('PUBLISHED');
    expect(job.lastCompletedStage).toBe('PUBLICATION');
  });

  it('returns a structured no-op when no publishable candidate exists and does not fail the job', async () => {
    const fixture = await createPublicationFixture([
      {
        lifecycleStatus: 'NEEDS_REVIEW',
        validationStatus: 'UNRESOLVED',
        withCanonical: false,
      },
    ]);

    await expect(worker.processOnce()).resolves.toEqual({
      processed: false,
      reason: 'NO_JOB',
    });

    expect(await prisma.knowledgeEvent.count()).toBe(0);
    const job = await prisma.intakeJob.findUniqueOrThrow({
      where: { id: fixture.intakeJob.id },
    });
    expect(job.status).toBe('NEEDS_REVIEW');
    expect(job.status).not.toBe('FAILED');
  });

  it('is idempotent when processOnce is called twice', async () => {
    const fixture = await createPublicationFixture([
      {
        lifecycleStatus: 'VALIDATED',
        validationStatus: 'MATCHED',
        withCanonical: true,
      },
    ]);

    await worker.processOnce();
    expect(await prisma.knowledgeEvent.count()).toBe(1);

    await expect(worker.processOnce()).resolves.toEqual({
      processed: false,
      reason: 'NO_JOB',
    });
    expect(
      await prisma.knowledgeEvent.count({
        where: { envelopeId: fixture.candidates[0].id, revision: 1 },
      }),
    ).toBe(1);
  });

  it('reports integrity violation for VALIDATED candidate with null canonicalPricePointId without publishing an empty event', async () => {
    const fixture = await createPublicationFixture([
      {
        lifecycleStatus: 'VALIDATED',
        validationStatus: 'MATCHED',
        withCanonical: false,
      },
    ]);
    const logSpy = jest.spyOn(console, 'error').mockImplementation();

    await expect(worker.processOnce()).resolves.toMatchObject({
      processed: true,
      intakeJobId: fixture.intakeJob.id,
      status: 'NEEDS_REVIEW',
      eventsCreated: 0,
      integrityViolations: 1,
    });

    expect(await prisma.knowledgeEvent.count()).toBe(0);
    expect(logSpy).toHaveBeenCalledWith(
      'reality-intake.publication.integrity_violation',
      expect.objectContaining({
        intakeJobId: fixture.intakeJob.id,
        candidateId: fixture.candidates[0].id,
        canonicalPricePointId: null,
        stage: 'PUBLICATION',
      }),
    );
    logSpy.mockRestore();
  });

  it('does not create forbidden business or review records', async () => {
    expect(await negativeCounts()).toEqual({
      basicPrices: 0,
      priceSubmissions: 0,
      reviewTasks: 0,
      reviewDecisions: 0,
    });
    await createPublicationFixture([
      {
        lifecycleStatus: 'VALIDATED',
        validationStatus: 'MATCHED',
        withCanonical: true,
      },
    ]);

    await worker.processOnce();

    expect(await negativeCounts()).toEqual({
      basicPrices: 0,
      priceSubmissions: 0,
      reviewTasks: 0,
      reviewDecisions: 0,
    });
  });
});
