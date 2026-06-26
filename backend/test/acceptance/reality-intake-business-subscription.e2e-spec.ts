import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  PriceSourceOrigin,
  PriceSourceType,
  PrismaClient,
  ResourceType,
} from '@prisma/client';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { BusinessSubscriptionService } from '../../src/reality-intake/business-subscription.service';

const PROJECT_CODE = 'ACC-X';

type EventFixtureOptions = {
  sourceOrigin?: PriceSourceOrigin;
  unit?: string;
  baseUnit?: string;
  linkResource?: boolean;
  workspaceId?: string;
  organizationId?: string;
};

const SOURCE_TYPE_BY_ORIGIN: Record<PriceSourceOrigin, PriceSourceType> = {
  GOVERNMENT: 'REGULATION',
  SUPPLIER: 'VENDOR_QUOTE',
  STORE: 'VENDOR_QUOTE',
  DISTRIBUTOR: 'VENDOR_QUOTE',
  FIELD_REPORT: 'MARKET_SURVEY',
  COMMUNITY_REPORT: 'MARKET_SURVEY',
};

describe('Reality intake business subscription worker (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let worker: BusinessSubscriptionService;
  let workspaceAId: string;
  let organizationId: string;
  let uploadedByAccountId: string;

  beforeAll(async () => {
    process.env.INTAKE_BUSINESS_SUBSCRIPTION_WORKER_ENABLED = 'false';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = new PrismaClient();
    worker = app.get(BusinessSubscriptionService);

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
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  async function cleanup() {
    await prisma.priceSubmissionReviewDecision.deleteMany();
    await prisma.priceSubmissionReview.deleteMany();
    await prisma.priceSubmissionAudit.deleteMany();
    await prisma.priceSubmissionRevision.deleteMany();
    await prisma.priceSubmission.deleteMany();
    await prisma.knowledgeEvent.deleteMany();
    await prisma.reviewDecision.deleteMany();
    await prisma.reviewTask.deleteMany();
    await prisma.validationResult.deleteMany();
    await prisma.knowledgeCandidate.deleteMany();
    await prisma.canonicalPricePoint.deleteMany();
    await prisma.extractionArtifact.deleteMany();
    await prisma.intakeJob.deleteMany();
    await prisma.sourceDocument.deleteMany();
    await prisma.resourceCatalog.deleteMany({
      where: { code: { startsWith: 'STEP26A-' } },
    });
    await prisma.workspace.deleteMany({
      where: { name: { startsWith: 'STEP26A-' } },
    });
    await prisma.organization.deleteMany({
      where: { name: { startsWith: 'STEP26A-' } },
    });
  }

  async function counts() {
    const [
      basicPrices,
      priceSubmissions,
      revisions,
      audits,
      reviewTasks,
      reviewDecisions,
      resourceCatalogs,
      knowledgeEvents,
      canonicalPricePoints,
    ] = await Promise.all([
      prisma.basicPrice.count(),
      prisma.priceSubmission.count(),
      prisma.priceSubmissionRevision.count(),
      prisma.priceSubmissionAudit.count(),
      prisma.reviewTask.count(),
      prisma.reviewDecision.count(),
      prisma.resourceCatalog.count(),
      prisma.knowledgeEvent.count(),
      prisma.canonicalPricePoint.count(),
    ]);

    return {
      basicPrices,
      priceSubmissions,
      revisions,
      audits,
      reviewTasks,
      reviewDecisions,
      resourceCatalogs,
      knowledgeEvents,
      canonicalPricePoints,
    };
  }

  async function createEventFixture(options: EventFixtureOptions = {}) {
    const stamp = `${Date.now()}-${Math.random()}`;
    const unit = options.unit ?? 'kg';
    const baseUnit = options.baseUnit ?? unit;
    const sourceOrigin = options.sourceOrigin ?? PriceSourceOrigin.SUPPLIER;
    const fixtureWorkspaceId = options.workspaceId ?? workspaceAId;
    const fixtureOrganizationId = options.organizationId ?? organizationId;
    const resource = options.linkResource !== false
      ? await prisma.resourceCatalog.create({
          data: {
            workspaceId: fixtureWorkspaceId,
            code: `STEP26A-${stamp}`,
            name: `STEP26A Resource ${stamp}`,
            type: ResourceType.MATERIAL,
            baseUnit,
          },
        })
      : null;

    const sourceDocument = await prisma.sourceDocument.create({
      data: {
        workspaceId: fixtureWorkspaceId,
        organizationId: fixtureOrganizationId,
        uploadedByAccountId,
        fileName: `subscription-${stamp}.xlsx`,
        mimeType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        byteSize: 128,
        checksum: `subscription-${stamp}`,
        storageRef: `test://subscription-${stamp}`,
      },
    });

    const intakeJob = await prisma.intakeJob.create({
      data: {
        sourceDocumentId: sourceDocument.id,
        workspaceId: fixtureWorkspaceId,
        organizationId: fixtureOrganizationId,
        idempotencyKey: `subscription-${stamp}:${fixtureWorkspaceId}`,
        status: 'PUBLISHED',
        lastCompletedStage: 'PUBLICATION',
        correlationId: `subscription-${stamp}`,
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

    const canonical = await prisma.canonicalPricePoint.create({
      data: {
        resourceRef: `resource-${stamp}`,
        resourceCatalogId: resource?.id,
        value: 12345,
        unit,
        sourceOrigin,
        effectiveDate: new Date('2026-01-15T00:00:00.000Z'),
      },
    });

    const candidate = await prisma.knowledgeCandidate.create({
      data: {
          intakeJobId: intakeJob.id,
          extractionArtifactId: artifact.id,
          workspaceId: fixtureWorkspaceId,
          organizationId: fixtureOrganizationId,
        knowledgeType: 'PRICE_POINT',
        contextPath: JSON.stringify({ rowNumber: 2 }),
        canonicalPricePointId: canonical.id,
        lifecycleStatus: 'PUBLISHED',
        confidence: 1,
      },
    });

    await prisma.validationResult.create({
      data: {
        candidateId: candidate.id,
        status: 'MATCHED',
        confidence: 1,
        messages: JSON.stringify(['MATCHED']),
      },
    });

    const event = await prisma.knowledgeEvent.create({
      data: {
        envelopeId: candidate.id,
        knowledgeType: 'PRICE_POINT',
        workspaceId: fixtureWorkspaceId,
        organizationId: fixtureOrganizationId,
        canonicalPricePointId: canonical.id,
        publishedByRef:
          'SYSTEM_POLICY:STEP-2.5_VALIDATED_KNOWLEDGE_PUBLICATION_v1',
        revision: 1,
        provenanceChain: {
          intakeJobId: intakeJob.id,
          sourceDocumentId: sourceDocument.id,
          extractionArtifactId: artifact.id,
          candidateId: candidate.id,
          canonicalPricePointId: canonical.id,
          stage: 'PUBLICATION',
          policy: 'STEP-2.5_FIRST_PUBLICATION',
        },
      },
    });

    return { event, canonical, resource };
  }

  async function createTenant(label: string) {
    const organization = await prisma.organization.create({
      data: { name: `STEP26A-${label}-Org`, type: 'COMPANY' },
    });
    const workspace = await prisma.workspace.create({
      data: {
        organizationId: organization.id,
        name: `STEP26A-${label}-Workspace`,
      },
    });

    return { organizationId: organization.id, workspaceId: workspace.id };
  }

  it('creates a SUBMITTED PriceSubmission, revision 1, and SYSTEM audit when resource is linked and units match', async () => {
    const fixture = await createEventFixture({
      sourceOrigin: PriceSourceOrigin.SUPPLIER,
      unit: ' KG ',
      baseUnit: 'kg',
    });
    const before = await counts();

    await expect(worker.processOnce()).resolves.toMatchObject({
      processed: true,
      knowledgeEventId: fixture.event.id,
      status: 'SUBMITTED',
    });

    const submission = await prisma.priceSubmission.findFirstOrThrow({
      include: { revisions: true, audits: true },
    });
    expect(submission).toMatchObject({
      workspaceId: workspaceAId,
      organizationId: fixture.event.organizationId,
      resourceId: fixture.resource?.id,
      regionId: null,
      reportedByAccountId: null,
      sourceOrigin: 'SUPPLIER',
      sourceType: 'VENDOR_QUOTE',
      status: 'SUBMITTED',
    });
    expect(submission.revisions).toHaveLength(1);
    expect(submission.revisions[0]).toMatchObject({
      revisionNumber: 1,
      validationPassed: false,
      validationMessage: null,
      effectiveDate: new Date('2026-01-15T00:00:00.000Z'),
    });
    expect(submission.revisions[0].value.toString()).toBe('12345');
    expect(submission.revisions[0].note).toContain(
      `knowledgeEventId:${fixture.event.id}`,
    );
    expect(submission.revisions[0].note).toContain('canonicalUnit: KG ');
    expect(submission.revisions[0].note).toContain('resourceCatalogBaseUnit:kg');
    expect(submission.currentRevisionId).toBe(submission.revisions[0].id);
    expect(submission.audits).toHaveLength(1);
    expect(submission.audits[0]).toMatchObject({
      fromStatus: null,
      toStatus: 'SUBMITTED',
      actorType: 'SYSTEM',
      actorAccountId: null,
    });
    expect(submission.audits[0].reason).toContain('STEP-2.6a');
    expect(submission.audits[0].reason).toContain(
      `knowledgeEventId:${fixture.event.id}`,
    );
    expect(submission.audits[0].reason).toContain('unitResolved: KG ->kg');
    expect(await counts()).toMatchObject({
      basicPrices: before.basicPrices,
      reviewTasks: before.reviewTasks,
      reviewDecisions: before.reviewDecisions,
      resourceCatalogs: before.resourceCatalogs,
      knowledgeEvents: before.knowledgeEvents,
      canonicalPricePoints: before.canonicalPricePoints,
    });
  });

  it('skips resource-not-linked events without creating PriceSubmission, BasicPrice, or ResourceCatalog placeholder', async () => {
    const fixture = await createEventFixture({ linkResource: false });
    const before = await counts();
    const logSpy = jest.spyOn(console, 'log').mockImplementation();

    await expect(worker.processOnce()).resolves.toMatchObject({
      processed: true,
      knowledgeEventId: fixture.event.id,
      status: 'SKIPPED_RESOURCE_NOT_LINKED',
    });

    expect(await prisma.priceSubmission.count()).toBe(before.priceSubmissions);
    expect(await prisma.basicPrice.count()).toBe(before.basicPrices);
    expect(await prisma.resourceCatalog.count()).toBe(before.resourceCatalogs);
    await expect(
      worker.listPendingResourceLinks(workspaceAId, organizationId),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: fixture.event.id }),
      ]),
    );
    expect(logSpy).toHaveBeenCalledWith(
      'reality-intake.business-subscription.skipped',
      expect.objectContaining({
        knowledgeEventId: fixture.event.id,
        reason: 'SKIPPED_RESOURCE_NOT_LINKED',
      }),
    );
    logSpy.mockRestore();
  });

  it('skips unit mismatch without conversion guessing and exposes it as pending unit adjustment', async () => {
    const fixture = await createEventFixture({ unit: 'bag', baseUnit: 'kg' });
    const before = await counts();
    const logSpy = jest.spyOn(console, 'log').mockImplementation();

    await expect(worker.processOnce()).resolves.toMatchObject({
      processed: true,
      knowledgeEventId: fixture.event.id,
      status: 'SKIPPED_UNIT_MISMATCH',
    });

    expect(await prisma.priceSubmission.count()).toBe(before.priceSubmissions);
    expect(await prisma.basicPrice.count()).toBe(before.basicPrices);
    await expect(
      worker.listPendingUnitAdjustments(workspaceAId, organizationId),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: fixture.event.id }),
      ]),
    );
    expect(logSpy).toHaveBeenCalledWith(
      'reality-intake.business-subscription.skipped',
      expect.objectContaining({
        knowledgeEventId: fixture.event.id,
        reason: 'SKIPPED_UNIT_MISMATCH',
      }),
    );
    logSpy.mockRestore();
  });

  it('maps every PriceSourceOrigin deterministically without SYSTEM_ESTIMATE', async () => {
    for (const [origin, expectedSourceType] of Object.entries(
      SOURCE_TYPE_BY_ORIGIN,
    ) as Array<[PriceSourceOrigin, PriceSourceType]>) {
      const fixture = await createEventFixture({
        sourceOrigin: origin,
        unit: 'm3',
        baseUnit: 'm3',
      });

      await expect(worker.processOnce()).resolves.toMatchObject({
        processed: true,
        knowledgeEventId: fixture.event.id,
        status: 'SUBMITTED',
      });

      const submission = await prisma.priceSubmission.findFirstOrThrow({
        where: { audits: { some: { reason: { contains: fixture.event.id } } } },
      });
      expect(submission.sourceOrigin).toBe(origin);
      expect(submission.sourceType).toBe(expectedSourceType);
      expect(submission.sourceType).not.toBe('SYSTEM_ESTIMATE');
    }
  });

  it('is idempotent when processOnce is called twice for the same KnowledgeEvent', async () => {
    const fixture = await createEventFixture();

    await worker.processOnce();
    await expect(worker.processOnce()).resolves.toEqual({
      processed: false,
      reason: 'NO_EVENT',
    });

    expect(
      await prisma.priceSubmissionAudit.count({
        where: { reason: { contains: fixture.event.id } },
      }),
    ).toBe(1);
    expect(
      await prisma.priceSubmission.count({
        where: { audits: { some: { reason: { contains: fixture.event.id } } } },
      }),
    ).toBe(1);
  });

  it('reprocesses an initially skipped event after resource and unit are resolved externally', async () => {
    const fixture = await createEventFixture({ linkResource: false, unit: 'kg' });

    await expect(worker.processOnce()).resolves.toMatchObject({
      status: 'SKIPPED_RESOURCE_NOT_LINKED',
    });
    expect(await prisma.priceSubmission.count()).toBe(0);

    const resource = await prisma.resourceCatalog.create({
      data: {
        workspaceId: workspaceAId,
        code: `STEP26A-RESOLVED-${Date.now()}`,
        name: 'STEP26A Resolved Resource',
        type: ResourceType.MATERIAL,
        baseUnit: 'kg',
      },
    });
    await prisma.canonicalPricePoint.update({
      where: { id: fixture.canonical.id },
      data: { resourceCatalogId: resource.id },
    });

    await expect(worker.processOnce()).resolves.toMatchObject({
      processed: true,
      knowledgeEventId: fixture.event.id,
      status: 'SUBMITTED',
    });
    expect(await prisma.priceSubmission.count()).toBe(1);
  });

  it('keeps regionId null only for SUBMITTED proposal and does not create BasicPrice', async () => {
    const before = await counts();
    await createEventFixture({ unit: 'liter', baseUnit: 'liter' });

    await worker.processOnce();

    const submission = await prisma.priceSubmission.findFirstOrThrow();
    expect(submission.status).toBe('SUBMITTED');
    expect(submission.regionId).toBeNull();
    expect(await prisma.basicPrice.count()).toBe(before.basicPrices);
  });

  it('does not mutate KnowledgeEvent or CanonicalPricePoint and does not create forbidden records', async () => {
    const fixture = await createEventFixture();
    const before = await counts();
    const eventBefore = await prisma.knowledgeEvent.findUniqueOrThrow({
      where: { id: fixture.event.id },
    });
    const canonicalBefore = await prisma.canonicalPricePoint.findUniqueOrThrow({
      where: { id: fixture.canonical.id },
    });

    await worker.processOnce();

    const eventAfter = await prisma.knowledgeEvent.findUniqueOrThrow({
      where: { id: fixture.event.id },
    });
    const canonicalAfter = await prisma.canonicalPricePoint.findUniqueOrThrow({
      where: { id: fixture.canonical.id },
    });
    expect(eventAfter).toEqual(eventBefore);
    expect(canonicalAfter).toEqual(canonicalBefore);
    expect(await counts()).toMatchObject({
      basicPrices: before.basicPrices,
      reviewTasks: before.reviewTasks,
      reviewDecisions: before.reviewDecisions,
      resourceCatalogs: before.resourceCatalogs,
      knowledgeEvents: before.knowledgeEvents,
      canonicalPricePoints: before.canonicalPricePoints,
    });
  });

  it('tenant-scopes pending resource-link virtual query', async () => {
    const tenantB = await createTenant('ResourceLink-B');
    const eventA = await createEventFixture({ linkResource: false });
    const eventB = await createEventFixture({
      linkResource: false,
      workspaceId: tenantB.workspaceId,
      organizationId: tenantB.organizationId,
    });

    const pendingA = await worker.listPendingResourceLinks(
      workspaceAId,
      organizationId,
    );
    const pendingB = await worker.listPendingResourceLinks(
      tenantB.workspaceId,
      tenantB.organizationId,
    );

    expect(pendingA.map((event) => event.id)).toContain(eventA.event.id);
    expect(pendingA.map((event) => event.id)).not.toContain(eventB.event.id);
    expect(pendingB.map((event) => event.id)).toContain(eventB.event.id);
    expect(pendingB.map((event) => event.id)).not.toContain(eventA.event.id);
  });

  it('tenant-scopes pending unit-adjustment virtual query', async () => {
    const tenantB = await createTenant('UnitAdjust-B');
    const eventA = await createEventFixture({ unit: 'bag', baseUnit: 'kg' });
    const eventB = await createEventFixture({
      unit: 'sak',
      baseUnit: 'kg',
      workspaceId: tenantB.workspaceId,
      organizationId: tenantB.organizationId,
    });

    const pendingA = await worker.listPendingUnitAdjustments(
      workspaceAId,
      organizationId,
    );
    const pendingB = await worker.listPendingUnitAdjustments(
      tenantB.workspaceId,
      tenantB.organizationId,
    );

    expect(pendingA.map((event) => event.id)).toContain(eventA.event.id);
    expect(pendingA.map((event) => event.id)).not.toContain(eventB.event.id);
    expect(pendingB.map((event) => event.id)).toContain(eventB.event.id);
    expect(pendingB.map((event) => event.id)).not.toContain(eventA.event.id);
  });

  it('returns no pending records when workspace and organization belong to different tenants', async () => {
    const tenantB = await createTenant('Mismatch-B');
    await createEventFixture({ linkResource: false });
    await createEventFixture({
      unit: 'bag',
      baseUnit: 'kg',
      workspaceId: tenantB.workspaceId,
      organizationId: tenantB.organizationId,
    });

    await expect(
      worker.listPendingResourceLinks(workspaceAId, tenantB.organizationId),
    ).resolves.toHaveLength(0);
    await expect(
      worker.listPendingUnitAdjustments(workspaceAId, tenantB.organizationId),
    ).resolves.toHaveLength(0);
  });
});
