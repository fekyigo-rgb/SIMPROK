import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  AccountStatus,
  MembershipStatus,
  OrganizationType,
  PriceSourceOrigin,
  PriceSourceType,
  PrismaClient,
  ResourceType,
  UserStatus,
} from '@prisma/client';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { PriceSubmissionReviewService } from '../../src/reality-intake/price-submission-review.service';

const PROJECT_CODE = 'ACC-X';

describe('Reality intake price submission human review (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let service: PriceSubmissionReviewService;
  let workspaceAId: string;
  let organizationAId: string;
  let reviewerAId: string;
  let reviewerAAccountId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = new PrismaClient();
    service = app.get(PriceSubmissionReviewService);

    const project = await prisma.project.findFirstOrThrow({
      where: { code: PROJECT_CODE },
      select: { workspaceId: true, organizationId: true },
    });
    workspaceAId = project.workspaceId;
    organizationAId = project.organizationId;

    const membership = await prisma.workspaceMembership.findFirstOrThrow({
      where: {
        workspaceId: workspaceAId,
        account: { email: 'assigned@test.local' },
      },
      include: { userProfile: true },
    });
    reviewerAId = membership.userProfile!.id;
    reviewerAAccountId = membership.accountId;
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
    await prisma.basicPrice.deleteMany();
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
      where: { code: { startsWith: 'STEP26B-' } },
    });
    await prisma.user.deleteMany({
      where: { fullName: { startsWith: 'STEP26B-' } },
    });
    await prisma.workspaceMembership.deleteMany({
      where: { account: { email: { startsWith: 'step26b-' } } },
    });
    await prisma.account.deleteMany({
      where: { email: { startsWith: 'step26b-' } },
    });
    await prisma.workspace.deleteMany({
      where: { name: { startsWith: 'STEP26B-' } },
    });
    await prisma.organization.deleteMany({
      where: { name: { startsWith: 'STEP26B-' } },
    });
  }

  async function createTenant(label: string) {
    const organization = await prisma.organization.create({
      data: { name: `STEP26B-${label}-Org`, type: OrganizationType.COMPANY },
    });
    const workspace = await prisma.workspace.create({
      data: {
        organizationId: organization.id,
        name: `STEP26B-${label}-Workspace`,
      },
    });
    const account = await prisma.account.create({
      data: {
        email: `step26b-${label}-${Date.now()}@test.local`,
        passwordHash: 'not-used',
        displayName: `STEP26B-${label}`,
        status: AccountStatus.ACTIVE,
      },
    });
    const membership = await prisma.workspaceMembership.create({
      data: {
        accountId: account.id,
        workspaceId: workspace.id,
        status: MembershipStatus.ACTIVE,
      },
    });
    const user = await prisma.user.create({
      data: {
        workspaceMembershipId: membership.id,
        workspaceId: workspace.id,
        fullName: `STEP26B-${label} User`,
        status: UserStatus.ACTIVE,
      },
    });

    return {
      organizationId: organization.id,
      workspaceId: workspace.id,
      accountId: account.id,
      userId: user.id,
    };
  }

  async function createSubmissionFixture(
    options: {
      workspaceId?: string;
      organizationId?: string | null;
      status?: 'SUBMITTED' | 'UNDER_REVIEW';
      currentRevision?: boolean;
      createReview?: boolean;
      openedAt?: Date;
    } = {},
  ) {
    const stamp = `${Date.now()}-${Math.random()}`;
    const workspaceId = options.workspaceId ?? workspaceAId;
    const organizationId = options.organizationId ?? organizationAId;
    const resource = await prisma.resourceCatalog.create({
      data: {
        workspaceId,
        code: `STEP26B-${stamp}`,
        name: `STEP26B Resource ${stamp}`,
        type: ResourceType.MATERIAL,
        baseUnit: 'kg',
      },
    });
    const submission = await prisma.priceSubmission.create({
      data: {
        workspaceId,
        organizationId,
        resourceId: resource.id,
        regionId: null,
        reportedByAccountId: null,
        sourceOrigin: PriceSourceOrigin.SUPPLIER,
        sourceType: PriceSourceType.VENDOR_QUOTE,
        status: options.status ?? 'SUBMITTED',
      },
    });

    let revision = null;
    if (options.currentRevision !== false) {
      revision = await prisma.priceSubmissionRevision.create({
        data: {
          submissionId: submission.id,
          revisionNumber: 1,
          value: 5000,
          effectiveDate: new Date('2026-02-01T00:00:00.000Z'),
          validUntil: null,
          validationPassed: false,
          validationMessage: null,
          note: 'STEP-2.6b fixture',
        },
      });
      await prisma.priceSubmission.update({
        where: { id: submission.id },
        data: { currentRevisionId: revision.id },
      });
    }

    const review = options.createReview
      ? await prisma.priceSubmissionReview.create({
          data: {
            priceSubmissionId: submission.id,
            workspaceId,
            organizationId: organizationId!,
            slaState: 'OPEN',
            openedAt: options.openedAt ?? new Date(),
          },
        })
      : null;

    return {
      resource,
      submission: await prisma.priceSubmission.findUniqueOrThrow({
        where: { id: submission.id },
        include: { revisions: true },
      }),
      revision,
      review,
    };
  }

  async function createImmutableRealityPair() {
    const sourceDocument = await prisma.sourceDocument.create({
      data: {
        workspaceId: workspaceAId,
        organizationId: organizationAId,
        uploadedByAccountId: (await prisma.account.findFirstOrThrow()).id,
        fileName: 'step26b.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        byteSize: 10,
        checksum: `step26b-${Date.now()}`,
        storageRef: 'test://step26b',
      },
    });
    const intakeJob = await prisma.intakeJob.create({
      data: {
        sourceDocumentId: sourceDocument.id,
        workspaceId: workspaceAId,
        organizationId: organizationAId,
        idempotencyKey: `step26b-${Date.now()}`,
        status: 'PUBLISHED',
        lastCompletedStage: 'PUBLICATION',
        correlationId: `step26b-${Date.now()}`,
      },
    });
    const artifact = await prisma.extractionArtifact.create({
      data: {
        intakeJobId: intakeJob.id,
        rawRows: [],
        detectedColumns: {},
        rowCount: 0,
      },
    });
    const canonical = await prisma.canonicalPricePoint.create({
      data: {
        resourceRef: 'immutable',
        value: 100,
        unit: 'kg',
        sourceOrigin: PriceSourceOrigin.SUPPLIER,
      },
    });
    const candidate = await prisma.knowledgeCandidate.create({
      data: {
        intakeJobId: intakeJob.id,
        extractionArtifactId: artifact.id,
        workspaceId: workspaceAId,
        organizationId: organizationAId,
        canonicalPricePointId: canonical.id,
        lifecycleStatus: 'PUBLISHED',
        confidence: 1,
      },
    });
    const event = await prisma.knowledgeEvent.create({
      data: {
        envelopeId: candidate.id,
        knowledgeType: 'PRICE_POINT',
        workspaceId: workspaceAId,
        organizationId: organizationAId,
        canonicalPricePointId: canonical.id,
        publishedByRef: 'SYSTEM_POLICY:STEP-2.5_VALIDATED_KNOWLEDGE_PUBLICATION_v1',
        provenanceChain: {},
        revision: 1,
      },
    });

    return { event, canonical };
  }

  it('auto-creates PriceSubmissionReview once for valid submitted PriceSubmission', async () => {
    const fixture = await createSubmissionFixture();

    await expect(
      service.processSubmittedPriceSubmissionReviewOnce({
        workspaceId: workspaceAId,
        organizationId: organizationAId,
      }),
    ).resolves.toMatchObject({
      processed: true,
      priceSubmissionId: fixture.submission.id,
      status: 'CREATED',
    });

    await expect(
      service.processSubmittedPriceSubmissionReviewOnce({
        workspaceId: workspaceAId,
        organizationId: organizationAId,
      }),
    ).resolves.toMatchObject({ processed: false });

    const review = await prisma.priceSubmissionReview.findFirstOrThrow({
      where: { priceSubmissionId: fixture.submission.id },
    });
    expect(review).toMatchObject({
      workspaceId: workspaceAId,
      organizationId: organizationAId,
      slaState: 'OPEN',
    });
    expect(await prisma.priceSubmissionReview.count()).toBe(1);
    expect(await prisma.basicPrice.count()).toBe(0);
    expect(
      await prisma.priceSubmissionAudit.count({
        where: {
          submissionId: fixture.submission.id,
          reason: { contains: 'STEP-2.6b_REVIEW_CREATED' },
        },
      }),
    ).toBe(1);
  });

  it('does not create review or BasicPrice for invalid submission missing tenant/current revision', async () => {
    await createSubmissionFixture({ organizationId: null, currentRevision: false });

    await expect(
      service.processSubmittedPriceSubmissionReviewOnce({
        workspaceId: workspaceAId,
        organizationId: organizationAId,
      }),
    ).resolves.toMatchObject({ processed: false });

    expect(await prisma.priceSubmissionReview.count()).toBe(0);
    expect(await prisma.basicPrice.count()).toBe(0);
  });

  it('human ACCEPT resolves review, creates BasicPrice, audits, and leaves knowledge records immutable', async () => {
    const fixture = await createSubmissionFixture({ createReview: true });
    const immutable = await createImmutableRealityPair();
    const eventBefore = await prisma.knowledgeEvent.findUniqueOrThrow({
      where: { id: immutable.event.id },
    });
    const canonicalBefore = await prisma.canonicalPricePoint.findUniqueOrThrow({
      where: { id: immutable.canonical.id },
    });

    await expect(
      service.acceptPriceSubmissionReview({
        workspaceId: workspaceAId,
        organizationId: organizationAId,
        reviewId: fixture.review!.id,
        decidedByUserId: reviewerAId,
        explicitGeneralRegion: true,
        note: 'accepted',
      }),
    ).resolves.toMatchObject({ status: 'PUBLISHED' });

    const decision = await prisma.priceSubmissionReviewDecision.findFirstOrThrow({
      where: { reviewId: fixture.review!.id },
    });
    expect(decision).toMatchObject({
      action: 'ACCEPT',
      decidedByUserId: reviewerAId,
    });
    const review = await prisma.priceSubmissionReview.findUniqueOrThrow({
      where: { id: fixture.review!.id },
    });
    expect(review.slaState).toBe('RESOLVED');
    expect(review.resolvedAt).toBeTruthy();

    const basicPrice = await prisma.basicPrice.findUniqueOrThrow({
      where: { sourceSubmissionId: fixture.submission.id },
    });
    expect(basicPrice).toMatchObject({
      sourceSubmissionId: fixture.submission.id,
      resourceId: fixture.submission.resourceId,
      workspaceId: workspaceAId,
      organizationId: organizationAId,
      regionId: null,
      verificationStatus: 'VERIFIED',
      status: 'PUBLISHED',
    });
    expect(basicPrice.value.toString()).toBe('5000');
    const submission = await prisma.priceSubmission.findUniqueOrThrow({
      where: { id: fixture.submission.id },
    });
    expect(submission.status).toBe('PUBLISHED');

    const acceptAudit = await prisma.priceSubmissionAudit.findFirstOrThrow({
      where: {
        submissionId: fixture.submission.id,
        actorType: 'HUMAN',
        reason: { contains: `decisionId:${decision.id}` },
        toStatus: 'VERIFIED',
      },
    });
    expect(acceptAudit.actorAccountId).toBe(reviewerAAccountId);
    expect(acceptAudit.fromStatus).toBe(fixture.submission.status);
    const publishAudit = await prisma.priceSubmissionAudit.findFirstOrThrow({
      where: {
        submissionId: fixture.submission.id,
        reason: { contains: 'STEP-2.6b_BASIC_PRICE_ACTIVATED' },
      },
    });
    expect(publishAudit).toMatchObject({
      fromStatus: 'VERIFIED',
      toStatus: 'PUBLISHED',
      actorType: 'SYSTEM',
      actorAccountId: null,
    });

    await expect(
      prisma.knowledgeEvent.findUniqueOrThrow({ where: { id: immutable.event.id } }),
    ).resolves.toEqual(eventBefore);
    await expect(
      prisma.canonicalPricePoint.findUniqueOrThrow({
        where: { id: immutable.canonical.id },
      }),
    ).resolves.toEqual(canonicalBefore);
  });

  it('does not create BasicPrice without ACCEPT', async () => {
    const fixture = await createSubmissionFixture({ createReview: true });

    await service.requestCorrectionForPriceSubmissionReview({
      workspaceId: workspaceAId,
      organizationId: organizationAId,
      reviewId: fixture.review!.id,
      decidedByUserId: reviewerAId,
      note: 'fix required',
    });

    expect(await prisma.basicPrice.count()).toBe(0);
  });

  it('human REJECT resolves review and does not create BasicPrice', async () => {
    const fixture = await createSubmissionFixture({ createReview: true });

    await service.rejectPriceSubmissionReview({
      workspaceId: workspaceAId,
      organizationId: organizationAId,
      reviewId: fixture.review!.id,
      decidedByUserId: reviewerAId,
      note: 'rejected',
    });

    const review = await prisma.priceSubmissionReview.findUniqueOrThrow({
      where: { id: fixture.review!.id },
    });
    const submission = await prisma.priceSubmission.findUniqueOrThrow({
      where: { id: fixture.submission.id },
    });
    expect(review.slaState).toBe('RESOLVED');
    expect(submission.status).toBe('REJECTED');
    expect(await prisma.priceSubmissionReviewDecision.count()).toBe(1);
    expect(await prisma.basicPrice.count()).toBe(0);
  });

  it('human REQUEST_CORRECTION records decision and audit without BasicPrice', async () => {
    const fixture = await createSubmissionFixture({ createReview: true });

    await service.requestCorrectionForPriceSubmissionReview({
      workspaceId: workspaceAId,
      organizationId: organizationAId,
      reviewId: fixture.review!.id,
      decidedByUserId: reviewerAId,
      note: 'please correct',
    });

    const decision = await prisma.priceSubmissionReviewDecision.findFirstOrThrow();
    const submission = await prisma.priceSubmission.findUniqueOrThrow({
      where: { id: fixture.submission.id },
    });
    const review = await prisma.priceSubmissionReview.findUniqueOrThrow({
      where: { id: fixture.review!.id },
    });
    const audit = await prisma.priceSubmissionAudit.findFirstOrThrow({
      where: {
        submissionId: fixture.submission.id,
        actorType: 'HUMAN',
        reason: { contains: `decisionId:${decision.id}` },
      },
    });
    expect(decision.action).toBe('REQUEST_CORRECTION');
    expect(audit.actorAccountId).toBe(reviewerAAccountId);
    expect(submission.status).toBe('NEEDS_CORRECTION');
    expect(review.slaState).toBe('OPEN');
    expect(await prisma.basicPrice.count()).toBe(0);
  });

  it('SLA checker escalates 7-day unresolved reviews idempotently without BasicPrice or rejection', async () => {
    const fixture = await createSubmissionFixture({
      createReview: true,
      openedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    await service.processPriceSubmissionReviewSlaOnce(
      new Date('2026-01-09T00:00:00.000Z'),
    );
    await service.processPriceSubmissionReviewSlaOnce(
      new Date('2026-01-09T00:00:00.000Z'),
    );

    const review = await prisma.priceSubmissionReview.findUniqueOrThrow({
      where: { id: fixture.review!.id },
    });
    const submission = await prisma.priceSubmission.findUniqueOrThrow({
      where: { id: fixture.submission.id },
    });
    expect(review.slaState).toBe('ESCALATED');
    expect(review.escalatedAt).toBeTruthy();
    expect(submission.status).not.toBe('REJECTED');
    expect(await prisma.basicPrice.count()).toBe(0);
    expect(
      await prisma.priceSubmissionAudit.count({
        where: { reason: { contains: 'SLA_BREACH:SLA-001:ESCALATED' } },
      }),
    ).toBe(1);
  });

  it('SLA checker expires 30-day unresolved reviews idempotently without BasicPrice or rejection', async () => {
    const fixture = await createSubmissionFixture({
      createReview: true,
      openedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    await service.processPriceSubmissionReviewSlaOnce(
      new Date('2026-02-01T00:00:00.000Z'),
    );
    await service.processPriceSubmissionReviewSlaOnce(
      new Date('2026-02-01T00:00:00.000Z'),
    );

    const review = await prisma.priceSubmissionReview.findUniqueOrThrow({
      where: { id: fixture.review!.id },
    });
    const submission = await prisma.priceSubmission.findUniqueOrThrow({
      where: { id: fixture.submission.id },
    });
    expect(review.slaState).toBe('EXPIRED');
    expect(review.expiredAt).toBeTruthy();
    expect(submission.status).not.toBe('REJECTED');
    expect(await prisma.basicPrice.count()).toBe(0);
    expect(
      await prisma.priceSubmissionAudit.count({
        where: { reason: { contains: 'SLA_BREACH:SLA-001:EXPIRED' } },
      }),
    ).toBe(1);
  });

  it('enforces tenant isolation for review actions and prevents cross-tenant BasicPrice', async () => {
    const tenantB = await createTenant('Tenant-B');
    const fixtureA = await createSubmissionFixture({ createReview: true });
    const fixtureB = await createSubmissionFixture({
      workspaceId: tenantB.workspaceId,
      organizationId: tenantB.organizationId,
      createReview: true,
    });

    await expect(
      service.acceptPriceSubmissionReview({
        workspaceId: workspaceAId,
        organizationId: tenantB.organizationId,
        reviewId: fixtureA.review!.id,
        decidedByUserId: reviewerAId,
        explicitGeneralRegion: true,
      }),
    ).rejects.toThrow();
    await expect(
      service.acceptPriceSubmissionReview({
        workspaceId: workspaceAId,
        organizationId: organizationAId,
        reviewId: fixtureB.review!.id,
        decidedByUserId: reviewerAId,
        explicitGeneralRegion: true,
      }),
    ).rejects.toThrow();

    await service.acceptPriceSubmissionReview({
      workspaceId: tenantB.workspaceId,
      organizationId: tenantB.organizationId,
      reviewId: fixtureB.review!.id,
      decidedByUserId: tenantB.userId,
      explicitGeneralRegion: true,
    });

    expect(
      await prisma.basicPrice.count({
        where: { sourceSubmissionId: fixtureA.submission.id },
      }),
    ).toBe(0);
    expect(
      await prisma.basicPrice.count({
        where: { sourceSubmissionId: fixtureB.submission.id },
      }),
    ).toBe(1);
    const tenantBAudit = await prisma.priceSubmissionAudit.findFirstOrThrow({
      where: {
        submissionId: fixtureB.submission.id,
        actorType: 'HUMAN',
        toStatus: 'VERIFIED',
      },
    });
    expect(tenantBAudit.actorAccountId).toBe(tenantB.accountId);
  });

  it('keeps review creation, SLA, and ACCEPT activation idempotent', async () => {
    const fixture = await createSubmissionFixture();
    await service.processSubmittedPriceSubmissionReviewOnce({
      workspaceId: workspaceAId,
      organizationId: organizationAId,
    });
    await service.processSubmittedPriceSubmissionReviewOnce({
      workspaceId: workspaceAId,
      organizationId: organizationAId,
    });
    expect(await prisma.priceSubmissionReview.count()).toBe(1);

    const review = await prisma.priceSubmissionReview.findFirstOrThrow();
    await prisma.priceSubmissionReview.update({
      where: { id: review.id },
      data: { openedAt: new Date('2026-01-01T00:00:00.000Z') },
    });
    await service.processPriceSubmissionReviewSlaOnce(
      new Date('2026-01-09T00:00:00.000Z'),
    );
    await service.processPriceSubmissionReviewSlaOnce(
      new Date('2026-01-09T00:00:00.000Z'),
    );
    expect(
      await prisma.priceSubmissionAudit.count({
        where: { reason: { contains: 'SLA_BREACH:SLA-001:ESCALATED' } },
      }),
    ).toBe(1);

    await service.acceptPriceSubmissionReview({
      workspaceId: workspaceAId,
      organizationId: organizationAId,
      reviewId: review.id,
      decidedByUserId: reviewerAId,
      explicitGeneralRegion: true,
    });
    await service.acceptPriceSubmissionReview({
      workspaceId: workspaceAId,
      organizationId: organizationAId,
      reviewId: review.id,
      decidedByUserId: reviewerAId,
      explicitGeneralRegion: true,
    });
    expect(await prisma.basicPrice.count()).toBe(1);
    expect(
      await prisma.basicPrice.count({
        where: { sourceSubmissionId: fixture.submission.id },
      }),
    ).toBe(1);
  });
});
