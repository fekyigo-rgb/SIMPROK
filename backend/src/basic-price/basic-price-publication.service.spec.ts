import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { BasicPricePublicationService } from './basic-price-publication.service';
import { PrismaService } from '../prisma/prisma.service';

// RM-02D2A-1 CONTRACT_UPDATE: publish() signature changed from
// (basicPriceId, actorAccountId) to a single { workspaceId, basicPriceId,
// publisherAccountId } params object (D-01/D-02/D-03 workspace scoping),
// and the source-state precondition changed from a single-axis
// verificationStatus check to the atomic two-axis Owner Lock contract
// (D-04..D-15): publisher must differ from the ACCEPT-decision verifier,
// traced through BasicPrice.sourceSubmission -> PriceSubmission.review ->
// PriceSubmissionReviewDecision(ACCEPT) -> decidedByUserId -> User ->
// WorkspaceMembership.accountId. Every test below reflects that contract;
// this is the entire suite being replaced, not "cleanup."
describe('BasicPricePublicationService', () => {
  let service: BasicPricePublicationService;
  let tx: {
    $queryRaw: jest.Mock;
    basicPrice: { findUniqueOrThrow: jest.Mock; update: jest.Mock };
    basicPricePublicationAudit: { create: jest.Mock };
    priceSubmission: { findFirst: jest.Mock };
    user: { findFirst: jest.Mock };
  };
  let prisma: {
    $transaction: jest.Mock;
    workspaceMembership: { findFirst: jest.Mock };
    workspace: { findUnique: jest.Mock };
    basicPrice: { findFirst: jest.Mock; findMany?: jest.Mock };
  };

  const WORKSPACE_ID = 'ws-01';
  const PUBLISHER_ACCOUNT_ID = 'account-publisher-01';
  const VERIFIER_ACCOUNT_ID = 'account-verifier-01';
  const BASIC_PRICE_ID = 'bp-01';
  const SUBMISSION_ID = 'submission-01';
  const VERIFIER_USER_ID = 'user-verifier-01';

  const publishParams = { workspaceId: WORKSPACE_ID, basicPriceId: BASIC_PRICE_ID, publisherAccountId: PUBLISHER_ACCOUNT_ID };

  const acceptedSubmission = {
    review: { decisions: [{ decidedByUserId: VERIFIER_USER_ID }] },
  };

  beforeEach(async () => {
    tx = {
      $queryRaw: jest.fn(),
      basicPrice: { findUniqueOrThrow: jest.fn(), update: jest.fn() },
      basicPricePublicationAudit: { create: jest.fn() },
      priceSubmission: { findFirst: jest.fn().mockResolvedValue(acceptedSubmission) },
      user: {
        findFirst: jest.fn().mockResolvedValue({
          status: 'ACTIVE',
          workspaceMembershipId: 'membership-verifier-01',
          membership: {
            id: 'membership-verifier-01',
            accountId: VERIFIER_ACCOUNT_ID,
            workspaceId: WORKSPACE_ID,
            status: 'ACTIVE',
            account: { id: VERIFIER_ACCOUNT_ID, status: 'ACTIVE' },
          },
        }),
      },
    };
    prisma = {
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(tx)),
      workspaceMembership: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'membership-publisher-01',
          accountId: PUBLISHER_ACCOUNT_ID,
          workspaceId: WORKSPACE_ID,
          status: 'ACTIVE',
          account: { id: PUBLISHER_ACCOUNT_ID, status: 'ACTIVE' },
          userProfile: {
            workspaceMembershipId: 'membership-publisher-01',
            workspaceId: WORKSPACE_ID,
            status: 'ACTIVE',
          },
        }),
      },
      workspace: { findUnique: jest.fn().mockResolvedValue({ organizationId: 'org-01' }) },
      basicPrice: {
        findFirst: jest.fn().mockResolvedValue({
          status: 'UNPUBLISHED',
          verificationStatus: 'VERIFIED',
        }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [BasicPricePublicationService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<BasicPricePublicationService>(BasicPricePublicationService);
  });

  const mockConsistentSourceState = () =>
    tx.$queryRaw.mockResolvedValue([
      { id: BASIC_PRICE_ID, status: 'UNPUBLISHED', verificationStatus: 'VERIFIED', sourceSubmissionId: SUBMISSION_ID },
    ]);

  it('rejects with no publisherAccountId — never defaults to a system/AI publisher', async () => {
    await expect(service.publish({ ...publishParams, publisherAccountId: '' })).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects (D-01) when the publisher has no active membership in the workspace', async () => {
    prisma.workspaceMembership.findFirst.mockResolvedValue(null);
    await expect(service.publish(publishParams)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects (D-01) when the publisher Account itself is not ACTIVE', async () => {
    prisma.workspaceMembership.findFirst.mockResolvedValue({ id: 'membership-01', account: { status: 'SUSPENDED' } });
    await expect(service.publish(publishParams)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects (D-01) when the publisher User is missing with zero publication writes', async () => {
    prisma.workspaceMembership.findFirst.mockResolvedValue({
      id: 'membership-publisher-01',
      accountId: PUBLISHER_ACCOUNT_ID,
      workspaceId: WORKSPACE_ID,
      status: 'ACTIVE',
      account: { id: PUBLISHER_ACCOUNT_ID, status: 'ACTIVE' },
      userProfile: null,
    });
    await expect(service.publish(publishParams)).rejects.toThrow(
      'PUBLISHER_NOT_ACTIVE_IN_WORKSPACE',
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.basicPrice.update).not.toHaveBeenCalled();
    expect(tx.basicPricePublicationAudit.create).not.toHaveBeenCalled();
  });

  it('rejects (D-01) when the publisher User is inactive with zero publication writes', async () => {
    prisma.workspaceMembership.findFirst.mockResolvedValue({
      id: 'membership-publisher-01',
      accountId: PUBLISHER_ACCOUNT_ID,
      workspaceId: WORKSPACE_ID,
      status: 'ACTIVE',
      account: { id: PUBLISHER_ACCOUNT_ID, status: 'ACTIVE' },
      userProfile: {
        workspaceMembershipId: 'membership-publisher-01',
        workspaceId: WORKSPACE_ID,
        status: 'INACTIVE',
      },
    });
    await expect(service.publish(publishParams)).rejects.toThrow(
      'PUBLISHER_NOT_ACTIVE_IN_WORKSPACE',
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.basicPrice.update).not.toHaveBeenCalled();
    expect(tx.basicPricePublicationAudit.create).not.toHaveBeenCalled();
  });

  it('throws NotFound (D-02/D-03) when the BasicPrice row does not exist in this workspace', async () => {
    tx.$queryRaw.mockResolvedValue([]);
    await expect(service.publish(publishParams)).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.basicPrice.update).not.toHaveBeenCalled();
  });

  it('rejects (D-04/D-12) a price that is not yet VERIFIED', async () => {
    tx.$queryRaw.mockResolvedValue([{ id: BASIC_PRICE_ID, status: 'UNPUBLISHED', verificationStatus: 'UNVERIFIED', sourceSubmissionId: SUBMISSION_ID }]);
    await expect(service.publish(publishParams)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.basicPrice.update).not.toHaveBeenCalled();
    expect(tx.basicPricePublicationAudit.create).not.toHaveBeenCalled();
  });

  it('rejects (D-12) an inconsistent cross state PUBLISHED+VERIFIED, never self-heals it', async () => {
    tx.$queryRaw.mockResolvedValue([{ id: BASIC_PRICE_ID, status: 'PUBLISHED', verificationStatus: 'VERIFIED', sourceSubmissionId: SUBMISSION_ID }]);
    await expect(service.publish(publishParams)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.basicPrice.update).not.toHaveBeenCalled();
  });

  it('rejects (D-12) an inconsistent cross state UNPUBLISHED+PUBLISHED, never self-heals it', async () => {
    tx.$queryRaw.mockResolvedValue([{ id: BASIC_PRICE_ID, status: 'UNPUBLISHED', verificationStatus: 'PUBLISHED', sourceSubmissionId: SUBMISSION_ID }]);
    await expect(service.publish(publishParams)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.basicPrice.update).not.toHaveBeenCalled();
  });

  it('rejects (D-07) when there is no sourceSubmissionId at all — VERIFIER_EVIDENCE_MISSING', async () => {
    tx.$queryRaw.mockResolvedValue([{ id: BASIC_PRICE_ID, status: 'UNPUBLISHED', verificationStatus: 'VERIFIED', sourceSubmissionId: null }]);
    await expect(service.publish(publishParams)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.basicPrice.update).not.toHaveBeenCalled();
  });

  it('rejects (D-07) when there is no ACCEPT decision on the review — VERIFIER_EVIDENCE_MISSING', async () => {
    mockConsistentSourceState();
    tx.priceSubmission.findFirst.mockResolvedValue({ review: { decisions: [] } });
    await expect(service.publish(publishParams)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.basicPrice.update).not.toHaveBeenCalled();
  });

  it('rejects (D-07) when there are two ACCEPT decisions (ambiguous) — VERIFIER_EVIDENCE_MISSING, never guesses', async () => {
    mockConsistentSourceState();
    tx.priceSubmission.findFirst.mockResolvedValue({
      review: { decisions: [{ decidedByUserId: 'u1' }, { decidedByUserId: 'u2' }] },
    });
    await expect(service.publish(publishParams)).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects (D-07) when the review has no ACCEPT decision resolvable to a User — VERIFIER_EVIDENCE_MISSING', async () => {
    mockConsistentSourceState();
    tx.user.findFirst.mockResolvedValue(null);
    await expect(service.publish(publishParams)).rejects.toThrow(
      'VERIFIER_EVIDENCE_MISSING',
    );
    expect(tx.basicPrice.update).not.toHaveBeenCalled();
    expect(tx.basicPricePublicationAudit.create).not.toHaveBeenCalled();
  });

  it('rejects inactive verifier User evidence with zero publication writes', async () => {
    mockConsistentSourceState();
    tx.user.findFirst.mockResolvedValue(null);
    await expect(service.publish(publishParams)).rejects.toThrow(
      'VERIFIER_EVIDENCE_MISSING',
    );
    expect(tx.basicPrice.update).not.toHaveBeenCalled();
    expect(tx.basicPricePublicationAudit.create).not.toHaveBeenCalled();
  });

  it('rejects (D-08) VERIFIER_CANNOT_PUBLISH when the publisher is the same human who verified it', async () => {
    mockConsistentSourceState();
    tx.user.findFirst.mockResolvedValue({
      status: 'ACTIVE',
      workspaceMembershipId: 'membership-publisher-01',
      membership: {
        id: 'membership-publisher-01',
        accountId: PUBLISHER_ACCOUNT_ID,
        workspaceId: WORKSPACE_ID,
        status: 'ACTIVE',
        account: { id: PUBLISHER_ACCOUNT_ID, status: 'ACTIVE' },
      },
    });
    await expect(service.publish(publishParams)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.basicPrice.update).not.toHaveBeenCalled();
    expect(tx.basicPricePublicationAudit.create).not.toHaveBeenCalled();
  });

  it('rejects cross-tenant submission evidence with zero publication writes', async () => {
    mockConsistentSourceState();
    tx.priceSubmission.findFirst.mockResolvedValue(null);
    await expect(service.publish(publishParams)).rejects.toThrow('VERIFIER_EVIDENCE_MISSING');
    expect(tx.basicPrice.update).not.toHaveBeenCalled();
    expect(tx.basicPricePublicationAudit.create).not.toHaveBeenCalled();
  });

  it('rejects cross-tenant verifier membership evidence', async () => {
    mockConsistentSourceState();
    tx.user.findFirst.mockResolvedValue({
      status: 'ACTIVE',
      workspaceMembershipId: 'membership-verifier-01',
      membership: {
        id: 'membership-verifier-01',
        accountId: VERIFIER_ACCOUNT_ID,
        workspaceId: 'ws-other',
        status: 'ACTIVE',
        account: { id: VERIFIER_ACCOUNT_ID, status: 'ACTIVE' },
      },
    });
    await expect(service.publish(publishParams)).rejects.toThrow('VERIFIER_EVIDENCE_MISSING');
    expect(tx.basicPrice.update).not.toHaveBeenCalled();
  });

  it('rejects inactive verifier membership evidence', async () => {
    mockConsistentSourceState();
    tx.user.findFirst.mockResolvedValue({
      status: 'ACTIVE',
      workspaceMembershipId: 'membership-verifier-01',
      membership: {
        id: 'membership-verifier-01',
        accountId: VERIFIER_ACCOUNT_ID,
        workspaceId: WORKSPACE_ID,
        status: 'SUSPENDED',
        account: { id: VERIFIER_ACCOUNT_ID, status: 'ACTIVE' },
      },
    });
    await expect(service.publish(publishParams)).rejects.toThrow('VERIFIER_EVIDENCE_MISSING');
    expect(tx.basicPrice.update).not.toHaveBeenCalled();
  });

  it('rejects inactive verifier Account evidence', async () => {
    mockConsistentSourceState();
    tx.user.findFirst.mockResolvedValue({
      status: 'ACTIVE',
      workspaceMembershipId: 'membership-verifier-01',
      membership: {
        id: 'membership-verifier-01',
        accountId: VERIFIER_ACCOUNT_ID,
        workspaceId: WORKSPACE_ID,
        status: 'ACTIVE',
        account: { id: VERIFIER_ACCOUNT_ID, status: 'SUSPENDED' },
      },
    });
    await expect(service.publish(publishParams)).rejects.toThrow('VERIFIER_EVIDENCE_MISSING');
    expect(tx.basicPrice.update).not.toHaveBeenCalled();
  });

  it('propagates publication-audit failure so the transaction cannot report success', async () => {
    mockConsistentSourceState();
    tx.basicPrice.update.mockResolvedValue({
      id: BASIC_PRICE_ID,
      status: 'PUBLISHED',
      verificationStatus: 'PUBLISHED',
    });
    tx.basicPricePublicationAudit.create.mockRejectedValue(new Error('FORCED_AUDIT_FAILURE'));
    await expect(service.publish(publishParams)).rejects.toThrow('FORCED_AUDIT_FAILURE');
  });

  it('publishes (D-09) atomically on both axes and writes exactly one audit row with the human publisher', async () => {
    mockConsistentSourceState();
    tx.basicPrice.update.mockResolvedValue({ id: BASIC_PRICE_ID, status: 'PUBLISHED', verificationStatus: 'PUBLISHED' });

    const result = await service.publish(publishParams);

    expect(tx.basicPrice.update).toHaveBeenCalledWith({
      where: { id: BASIC_PRICE_ID },
      data: { status: 'PUBLISHED', verificationStatus: 'PUBLISHED' },
    });
    expect(tx.basicPricePublicationAudit.create).toHaveBeenCalledTimes(1);
    expect(tx.basicPricePublicationAudit.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ basicPriceId: BASIC_PRICE_ID, action: 'PUBLISH', actorAccountId: PUBLISHER_ACCOUNT_ID }),
    });
    expect(result).toEqual({ id: BASIC_PRICE_ID, status: 'PUBLISHED', verificationStatus: 'PUBLISHED' });
  });

  it('is idempotent at PUBLISHED+PUBLISHED without a duplicate audit', async () => {
    prisma.basicPrice.findFirst.mockResolvedValue({
      status: 'PUBLISHED',
      verificationStatus: 'PUBLISHED',
    });
    tx.$queryRaw.mockResolvedValue([{ id: BASIC_PRICE_ID, status: 'PUBLISHED', verificationStatus: 'PUBLISHED', sourceSubmissionId: SUBMISSION_ID }]);
    tx.basicPrice.findUniqueOrThrow.mockResolvedValue({ id: BASIC_PRICE_ID, status: 'PUBLISHED', verificationStatus: 'PUBLISHED' });

    const result = await service.publish(publishParams);
    expect(tx.basicPrice.update).not.toHaveBeenCalled();
    expect(tx.basicPricePublicationAudit.create).not.toHaveBeenCalled();
    expect(result).toEqual({ id: BASIC_PRICE_ID, status: 'PUBLISHED', verificationStatus: 'PUBLISHED' });
  });

  it('exposes a workspace-scoped publication queue of UNPUBLISHED+VERIFIED prices only', async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: BASIC_PRICE_ID }]);
    (prisma as unknown as { basicPrice: { findMany: jest.Mock } }).basicPrice = { findMany };

    const result = await service.getPublicationQueue(WORKSPACE_ID);

    expect(findMany).toHaveBeenCalledWith({
      where: { workspaceId: WORKSPACE_ID, status: 'UNPUBLISHED', verificationStatus: 'VERIFIED' },
      orderBy: { createdAt: 'asc' },
    });
    expect(result).toEqual([{ id: BASIC_PRICE_ID }]);
  });
});
