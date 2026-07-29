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
    priceSubmission: { findUniqueOrThrow: jest.Mock; findFirst: jest.Mock; update: jest.Mock };
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
    basicPrice: { findUnique: jest.Mock };
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
    regionId: 'region-01',
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
      priceSubmission: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ status: 'SUBMITTED' }),
        findFirst: jest.fn().mockResolvedValue(submissionWithRevision()),
        update: jest.fn(),
      },
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
      user: {
        findFirst: jest.fn().mockResolvedValue({
          id: USER_ID,
          workspaceMembershipId: 'membership-01',
          membership: {
            id: 'membership-01',
            accountId: ACCOUNT_ID,
            workspaceId: WORKSPACE_ID,
            status: 'ACTIVE',
            account: { id: ACCOUNT_ID, status: 'ACTIVE' },
          },
        }),
      },
      basicPrice: { findUnique: jest.fn().mockResolvedValue(null) },
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

    it('is idempotent on repeated ACCEPT and creates no second decision/BasicPrice', async () => {
      tx.basicPrice.findUnique.mockResolvedValue({
        id: 'bp-01',
        sourceSubmissionId: SUBMISSION_ID,
        status: 'UNPUBLISHED',
        verificationStatus: 'VERIFIED',
      });
      tx.priceSubmissionReviewDecision.findFirst.mockResolvedValue({
        id: 'decision-01',
        reviewId: REVIEW_ID,
      });
      prisma.basicPrice.findUnique.mockResolvedValue({ id: 'bp-01' });
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
      tx.priceSubmission.findFirst.mockResolvedValue(
        submissionWithRevision({ currentRevisionId: 'missing-revision' }),
      );
      await expect(service.acceptPriceSubmissionReview(acceptParams)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('rejects when the reviewer is not an active human in the workspace', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      await expect(service.acceptPriceSubmissionReview(acceptParams)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects an actor whose WorkspaceMembership is inactive with zero writes', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: USER_ID,
        workspaceMembershipId: 'membership-01',
        membership: {
          id: 'membership-01',
          accountId: ACCOUNT_ID,
          workspaceId: WORKSPACE_ID,
          status: 'SUSPENDED',
          account: { id: ACCOUNT_ID, status: 'ACTIVE' },
        },
      });
      await expect(service.acceptPriceSubmissionReview(acceptParams)).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects an actor whose Account is inactive with zero writes', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: USER_ID,
        workspaceMembershipId: 'membership-01',
        membership: {
          id: 'membership-01',
          accountId: ACCOUNT_ID,
          workspaceId: WORKSPACE_ID,
          status: 'ACTIVE',
          account: { id: ACCOUNT_ID, status: 'SUSPENDED' },
        },
      });
      await expect(service.acceptPriceSubmissionReview(acceptParams)).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a cross-tenant reviewId with NotFound', async () => {
      prisma.priceSubmissionReview.findFirst.mockResolvedValue(null);
      await expect(service.acceptPriceSubmissionReview(acceptParams)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('inherits authoritative region and effective date from the live submission revision', async () => {
      tx.priceSubmissionReviewDecision.create.mockResolvedValue({ id: 'decision-01' });
      tx.basicPrice.create.mockResolvedValue({ id: 'bp-01', status: 'UNPUBLISHED', verificationStatus: 'VERIFIED' });
      await service.acceptPriceSubmissionReview(acceptParams);
      expect(tx.basicPrice.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          regionId: 'region-01',
          effectiveDate: new Date('2026-07-25'),
        }),
      });
    });

    it('rejects null region without explicit general before any decision write', async () => {
      tx.priceSubmission.findFirst.mockResolvedValue(submissionWithRevision({ regionId: null }));
      await expect(service.acceptPriceSubmissionReview(acceptParams)).rejects.toThrow('REGION_REQUIRED_OR_EXPLICIT_GENERAL_REGION');
      expect(tx.priceSubmissionReviewDecision.create).not.toHaveBeenCalled();
      expect(tx.basicPrice.create).not.toHaveBeenCalled();
    });

    it('accepts null region only with explicit general and audits that decision', async () => {
      tx.priceSubmission.findFirst.mockResolvedValue(submissionWithRevision({ regionId: null }));
      tx.priceSubmissionReviewDecision.create.mockResolvedValue({ id: 'decision-01' });
      tx.basicPrice.create.mockResolvedValue({ id: 'bp-01', status: 'UNPUBLISHED', verificationStatus: 'VERIFIED' });
      await service.acceptPriceSubmissionReview({ ...acceptParams, explicitGeneralRegion: true });
      expect(tx.basicPrice.create).toHaveBeenCalledWith({ data: expect.objectContaining({ regionId: null }) });
      expect(tx.priceSubmissionAudit.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ reason: expect.stringContaining('GENERAL_REGION_EXPLICIT') }),
      });
    });

    it('rejects explicit general when the submission already has a region', async () => {
      await expect(service.acceptPriceSubmissionReview({ ...acceptParams, explicitGeneralRegion: true })).rejects.toThrow('REGION_DECISION_CONFLICT');
      expect(tx.priceSubmissionReviewDecision.create).not.toHaveBeenCalled();
    });

    it('rejects missing effective date without a clock fallback', async () => {
      tx.priceSubmission.findFirst.mockResolvedValue(submissionWithRevision({
        revisions: [{ id: REVISION_ID, effectiveDate: null, value: '1100000.00' }],
      }));
      await expect(service.acceptPriceSubmissionReview(acceptParams)).rejects.toThrow('EFFECTIVE_DATE_REQUIRED_BEFORE_ACCEPT');
      expect(tx.priceSubmissionReviewDecision.create).not.toHaveBeenCalled();
    });

    it('blocks direct ACCEPT after REQUEST_CORRECTION with zero writes', async () => {
      tx.priceSubmission.findFirst.mockResolvedValue(submissionWithRevision({ status: 'NEEDS_CORRECTION' }));
      await expect(service.acceptPriceSubmissionReview(acceptParams)).rejects.toThrow('CORRECTION_RESUBMISSION_REQUIRED');
      expect(tx.priceSubmissionReviewDecision.create).not.toHaveBeenCalled();
      expect(tx.priceSubmissionAudit.create).not.toHaveBeenCalled();
      expect(tx.basicPrice.create).not.toHaveBeenCalled();
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

    it('rejects an assignee with inactive membership before assignment writes', async () => {
      const activeActor = prisma.user.findFirst.getMockImplementation();
      prisma.user.findFirst
        .mockImplementationOnce(activeActor!)
        .mockResolvedValueOnce({
          id: 'user-02',
          workspaceMembershipId: 'membership-02',
          membership: {
            id: 'membership-02',
            accountId: 'account-02',
            workspaceId: WORKSPACE_ID,
            status: 'SUSPENDED',
            account: { id: 'account-02', status: 'ACTIVE' },
          },
        });
      await expect(service.reassignPriceSubmissionReview({
        workspaceId: WORKSPACE_ID,
        organizationId: ORGANIZATION_ID,
        reviewId: REVIEW_ID,
        decidedByUserId: USER_ID,
        assignedToUserId: 'user-02',
      })).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects an assignee with inactive Account before assignment writes', async () => {
      const activeActor = prisma.user.findFirst.getMockImplementation();
      prisma.user.findFirst
        .mockImplementationOnce(activeActor!)
        .mockResolvedValueOnce({
          id: 'user-02',
          workspaceMembershipId: 'membership-02',
          membership: {
            id: 'membership-02',
            accountId: 'account-02',
            workspaceId: WORKSPACE_ID,
            status: 'ACTIVE',
            account: { id: 'account-02', status: 'SUSPENDED' },
          },
        });
      await expect(service.reassignPriceSubmissionReview({
        workspaceId: WORKSPACE_ID,
        organizationId: ORGANIZATION_ID,
        reviewId: REVIEW_ID,
        decidedByUserId: USER_ID,
        assignedToUserId: 'user-02',
      })).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('resolveActingUserId', () => {
    it('resolves Account.id + workspaceId to the acting User.id via WorkspaceMembership', async () => {
      prisma.workspaceMembership.findFirst.mockResolvedValue({ id: 'membership-01' });
      prisma.user.findFirst.mockResolvedValue({ id: USER_ID });
      const result = await service.resolveActingUserId(ACCOUNT_ID, WORKSPACE_ID);
      expect(result).toBe(USER_ID);
      expect(prisma.workspaceMembership.findFirst).toHaveBeenCalledWith({
        where: {
          accountId: ACCOUNT_ID,
          workspaceId: WORKSPACE_ID,
          status: 'ACTIVE',
          account: { status: 'ACTIVE' },
        },
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
