import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { PriceSubmissionReviewService } from './price-submission-review.service';
import { PrismaService } from '../prisma/prisma.service';

// RM-02D2A-1 Work Package F — new coverage for the ONE canonical review
// lifecycle: creation (Work Package A), ACCEPT's honest UNPUBLISHED+VERIFIED
// contract with zero auto-publish (Work Package C / Owner Lock §2), and
// reject/request-correction/reassign actionability.
describe('PriceSubmissionReviewService', () => {
  let service: PriceSubmissionReviewService;
  let tx: {
    priceSubmissionReview: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock; findFirst: jest.Mock };
    priceSubmission: { findUniqueOrThrow: jest.Mock; update: jest.Mock };
    priceSubmissionAudit: { findFirst: jest.Mock; create: jest.Mock };
    priceSubmissionReviewDecision: { findFirst: jest.Mock; create: jest.Mock };
    basicPrice: { findUnique: jest.Mock; create: jest.Mock };
    $queryRaw: jest.Mock;
  };
  let prisma: {
    $transaction: jest.Mock;
    priceSubmission: { findFirst: jest.Mock };
    priceSubmissionReview: { findFirst: jest.Mock; findMany: jest.Mock };
    workspace: { findUnique: jest.Mock };
    workspaceMembership: { findFirst: jest.Mock };
    user: { findFirst: jest.Mock };
  };

  const WORKSPACE_ID = 'ws-01';
  const ORGANIZATION_ID = 'org-01';
  const REVIEW_ID = 'review-01';
  const SUBMISSION_ID = 'submission-01';
  const USER_ID = 'user-01';
  const ACCOUNT_ID = 'account-01';
  const REVISION_ID = 'revision-01';

  const submissionWithRevision = (overrides: Record<string, unknown> = {}) => ({
    id: SUBMISSION_ID,
    workspaceId: WORKSPACE_ID,
    organizationId: ORGANIZATION_ID,
    resourceId: 'resource-01',
    regionId: null,
    sourceType: 'MARKET_SURVEY',
    sourceOrigin: 'SUPPLIER',
    reportedByAccountId: ACCOUNT_ID,
    status: 'UNDER_REVIEW',
    currentRevisionId: REVISION_ID,
    revisions: [{ id: REVISION_ID, effectiveDate: new Date('2026-07-25'), value: '1100000.00' }],
    ...overrides,
  });

  const reviewRow = (overrides: Record<string, unknown> = {}) => ({
    id: REVIEW_ID,
    priceSubmissionId: SUBMISSION_ID,
    workspaceId: WORKSPACE_ID,
    organizationId: ORGANIZATION_ID,
    slaState: 'OPEN',
    submission: submissionWithRevision(),
    ...overrides,
  });

  beforeEach(async () => {
    tx = {
      priceSubmissionReview: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), findFirst: jest.fn() },
      priceSubmission: { findUniqueOrThrow: jest.fn().mockResolvedValue({ status: 'SUBMITTED' }), update: jest.fn() },
      priceSubmissionAudit: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
      priceSubmissionReviewDecision: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
      basicPrice: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn() },
      $queryRaw: jest.fn().mockResolvedValue([{ id: REVIEW_ID, slaState: 'OPEN' }]),
    };
    prisma = {
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(tx)),
      priceSubmission: { findFirst: jest.fn() },
      priceSubmissionReview: { findFirst: jest.fn().mockResolvedValue(reviewRow()), findMany: jest.fn() },
      workspace: { findUnique: jest.fn().mockResolvedValue({ organizationId: ORGANIZATION_ID }) },
      workspaceMembership: { findFirst: jest.fn().mockResolvedValue({ id: 'membership-01' }) },
      user: { findFirst: jest.fn().mockResolvedValue({ id: USER_ID, membership: { accountId: ACCOUNT_ID, workspaceId: WORKSPACE_ID } }) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [PriceSubmissionReviewService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<PriceSubmissionReviewService>(PriceSubmissionReviewService);
  });

  describe('createReviewWithinTransaction', () => {
    it('creates a new OPEN review, moves the submission to UNDER_REVIEW, and audits it', async () => {
      tx.priceSubmissionReview.findUnique.mockResolvedValue(null);
      tx.priceSubmissionReview.create.mockResolvedValue({ id: REVIEW_ID });

      const result = await service.createReviewWithinTransaction(tx as any, {
        id: SUBMISSION_ID,
        workspaceId: WORKSPACE_ID,
        organizationId: ORGANIZATION_ID,
      });

      expect(result).toEqual({ reviewId: REVIEW_ID, status: 'CREATED' });
      expect(tx.priceSubmissionReview.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ priceSubmissionId: SUBMISSION_ID, slaState: 'OPEN' }),
      });
      expect(tx.priceSubmission.update).toHaveBeenCalledWith({ where: { id: SUBMISSION_ID }, data: { status: 'UNDER_REVIEW' } });
      expect(tx.priceSubmissionAudit.create).toHaveBeenCalledTimes(1);
    });

    it('is idempotent — an existing review is reused, never duplicated', async () => {
      tx.priceSubmissionReview.findUnique.mockResolvedValue({ id: REVIEW_ID });

      const result = await service.createReviewWithinTransaction(tx as any, {
        id: SUBMISSION_ID,
        workspaceId: WORKSPACE_ID,
        organizationId: ORGANIZATION_ID,
      });

      expect(result).toEqual({ reviewId: REVIEW_ID, status: 'ALREADY_EXISTS' });
      expect(tx.priceSubmissionReview.create).not.toHaveBeenCalled();
      expect(tx.priceSubmission.update).not.toHaveBeenCalled();
    });
  });

  describe('acceptPriceSubmissionReview', () => {
    const acceptParams = { workspaceId: WORKSPACE_ID, organizationId: ORGANIZATION_ID, reviewId: REVIEW_ID, decidedByUserId: USER_ID };

    it('creates exactly one BasicPrice at UNPUBLISHED+VERIFIED and moves PriceSubmission to VERIFIED — never PUBLISHED', async () => {
      tx.priceSubmissionReviewDecision.create.mockResolvedValue({ id: 'decision-01' });
      tx.basicPrice.create.mockResolvedValue({ id: 'bp-01', status: 'UNPUBLISHED', verificationStatus: 'VERIFIED' });

      const result = await service.acceptPriceSubmissionReview(acceptParams);

      expect(tx.priceSubmission.update).toHaveBeenCalledWith({ where: { id: SUBMISSION_ID }, data: { status: 'VERIFIED' } });
      expect(tx.basicPrice.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ sourceSubmissionId: SUBMISSION_ID, verificationStatus: 'VERIFIED' }),
      });
      // The exact literal 'PUBLISHED' must never appear as a value ACCEPT writes anywhere.
      const basicPriceCreateData = tx.basicPrice.create.mock.calls[0][0].data;
      expect(basicPriceCreateData.status).toBeUndefined(); // omitted -> schema default UNPUBLISHED, never hardcoded PUBLISHED
      expect(Object.values(basicPriceCreateData)).not.toContain('PUBLISHED');
      expect(tx.priceSubmission.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'PUBLISHED' } }));

      expect(result).toEqual(
        expect.objectContaining({
          status: 'ACCEPTED',
          priceSubmissionStatus: 'VERIFIED',
          basicPriceStatus: 'UNPUBLISHED',
          basicPriceVerificationStatus: 'VERIFIED',
          publiclyEligible: false,
        }),
      );
    });

    it('never creates a BasicPricePublicationAudit row as a side effect of ACCEPT', async () => {
      tx.priceSubmissionReviewDecision.create.mockResolvedValue({ id: 'decision-01' });
      tx.basicPrice.create.mockResolvedValue({ id: 'bp-01', status: 'UNPUBLISHED', verificationStatus: 'VERIFIED' });
      await service.acceptPriceSubmissionReview(acceptParams);
      expect((tx as any).basicPricePublicationAudit).toBeUndefined();
    });

    it('is idempotent on repeated ACCEPT: returns the existing BasicPrice, creates no second decision/BasicPrice', async () => {
      tx.basicPrice.findUnique.mockResolvedValue({ id: 'bp-01', status: 'UNPUBLISHED', verificationStatus: 'VERIFIED' });

      const result = await service.acceptPriceSubmissionReview(acceptParams);

      expect(tx.priceSubmissionReviewDecision.create).not.toHaveBeenCalled();
      expect(tx.basicPrice.create).not.toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({ status: 'ALREADY_ACTIVATED', basicPriceId: 'bp-01' }));
    });

    it('rejects ACCEPT on a review already RESOLVED by a REJECT decision (no BasicPrice exists)', async () => {
      tx.$queryRaw.mockResolvedValue([{ id: REVIEW_ID, slaState: 'RESOLVED' }]);
      tx.basicPrice.findUnique.mockResolvedValue(null);

      await expect(service.acceptPriceSubmissionReview(acceptParams)).rejects.toBeInstanceOf(ConflictException);
      expect(tx.basicPrice.create).not.toHaveBeenCalled();
    });

    it('rejects when the current revision is missing', async () => {
      prisma.priceSubmissionReview.findFirst.mockResolvedValue(reviewRow({ submission: submissionWithRevision({ currentRevisionId: 'missing-revision' }) }));
      await expect(service.acceptPriceSubmissionReview(acceptParams)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects when the reviewer is not an active human in the workspace', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      await expect(service.acceptPriceSubmissionReview(acceptParams)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects a cross-tenant reviewId with NotFound', async () => {
      prisma.priceSubmissionReview.findFirst.mockResolvedValue(null);
      await expect(service.acceptPriceSubmissionReview(acceptParams)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('rejectPriceSubmissionReview / requestCorrectionForPriceSubmissionReview', () => {
    const params = { workspaceId: WORKSPACE_ID, organizationId: ORGANIZATION_ID, reviewId: REVIEW_ID, decidedByUserId: USER_ID, note: 'not a valid market price' };

    it('rejects REJECT with a blank note', async () => {
      await expect(service.rejectPriceSubmissionReview({ ...params, note: '   ' })).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects REQUEST_CORRECTION with no note', async () => {
      await expect(service.requestCorrectionForPriceSubmissionReview({ ...params, note: undefined })).rejects.toBeInstanceOf(ConflictException);
    });

    it('REJECT resolves the review, sets PriceSubmission to REJECTED, creates no BasicPrice', async () => {
      tx.priceSubmissionReviewDecision.create.mockResolvedValue({ id: 'decision-01' });
      const result = await service.rejectPriceSubmissionReview(params);
      expect(tx.priceSubmissionReview.update).toHaveBeenCalledWith({ where: { id: REVIEW_ID }, data: { slaState: 'RESOLVED', resolvedAt: expect.any(Date) } });
      expect(tx.priceSubmission.update).toHaveBeenCalledWith({ where: { id: SUBMISSION_ID }, data: { status: 'REJECTED' } });
      expect(tx.basicPrice.create).not.toHaveBeenCalled();
      expect(result.status).toBe('REJECTED');
    });

    it('REQUEST_CORRECTION leaves the review actionable (not resolved)', async () => {
      tx.priceSubmissionReviewDecision.create.mockResolvedValue({ id: 'decision-01' });
      await service.requestCorrectionForPriceSubmissionReview(params);
      expect(tx.priceSubmissionReview.update).toHaveBeenCalledWith({ where: { id: REVIEW_ID }, data: {} });
    });

    it('rejects a decision on an already-RESOLVED review', async () => {
      tx.$queryRaw.mockResolvedValue([{ id: REVIEW_ID, slaState: 'RESOLVED' }]);
      await expect(service.rejectPriceSubmissionReview(params)).rejects.toBeInstanceOf(ConflictException);
      expect(tx.priceSubmissionReviewDecision.create).not.toHaveBeenCalled();
    });

    it('rejects a decision on an EXPIRED review', async () => {
      tx.$queryRaw.mockResolvedValue([{ id: REVIEW_ID, slaState: 'EXPIRED' }]);
      await expect(service.rejectPriceSubmissionReview(params)).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('reassignPriceSubmissionReview', () => {
    it('rejects reassignment on a RESOLVED review', async () => {
      tx.$queryRaw.mockResolvedValue([{ id: REVIEW_ID, slaState: 'RESOLVED' }]);
      await expect(
        service.reassignPriceSubmissionReview({ workspaceId: WORKSPACE_ID, organizationId: ORGANIZATION_ID, reviewId: REVIEW_ID, decidedByUserId: USER_ID }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('reassigns an OPEN review to a different active user in the workspace', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: USER_ID, membership: { accountId: ACCOUNT_ID, workspaceId: WORKSPACE_ID } });
      tx.priceSubmissionReviewDecision.create.mockResolvedValue({ id: 'decision-01' });
      const result = await service.reassignPriceSubmissionReview({
        workspaceId: WORKSPACE_ID,
        organizationId: ORGANIZATION_ID,
        reviewId: REVIEW_ID,
        decidedByUserId: USER_ID,
        assignedToUserId: 'user-02',
      });
      expect(tx.priceSubmissionReview.update).toHaveBeenCalledWith({ where: { id: REVIEW_ID }, data: { assignedToUserId: 'user-02' } });
      expect(result.status).toBe('REASSIGNED');
    });
  });

  describe('resolveActingUserId', () => {
    it('resolves Account.id + workspaceId to the acting User.id via WorkspaceMembership', async () => {
      prisma.workspaceMembership.findFirst.mockResolvedValue({ id: 'membership-01' });
      prisma.user.findFirst.mockResolvedValue({ id: USER_ID });
      const result = await service.resolveActingUserId(ACCOUNT_ID, WORKSPACE_ID);
      expect(result).toBe(USER_ID);
      expect(prisma.workspaceMembership.findFirst).toHaveBeenCalledWith({
        where: { accountId: ACCOUNT_ID, workspaceId: WORKSPACE_ID, status: 'ACTIVE' },
        select: { id: true },
      });
    });

    it('throws NotFound when the account has no active membership in the workspace', async () => {
      prisma.workspaceMembership.findFirst.mockResolvedValue(null);
      await expect(service.resolveActingUserId(ACCOUNT_ID, WORKSPACE_ID)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFound when the membership has no active User profile', async () => {
      prisma.workspaceMembership.findFirst.mockResolvedValue({ id: 'membership-01' });
      prisma.user.findFirst.mockResolvedValue(null);
      await expect(service.resolveActingUserId(ACCOUNT_ID, WORKSPACE_ID)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('resolveOrganizationId', () => {
    it('resolves workspaceId -> organizationId', async () => {
      await expect(service.resolveOrganizationId(WORKSPACE_ID)).resolves.toBe(ORGANIZATION_ID);
    });

    it('throws NotFound for an unknown workspace', async () => {
      prisma.workspace.findUnique.mockResolvedValue(null);
      await expect(service.resolveOrganizationId('unknown-ws')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
