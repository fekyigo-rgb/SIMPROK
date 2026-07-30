import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PriceSubmissionReviewService } from './price-submission-review.service';
import { PrismaService } from '../prisma/prisma.service';

// RM-02D2A2 — new coverage for the read/projection contracts and the
// tenant-scoped active-reviewer directory that back the review & publication
// UI. Kept in a dedicated spec so the existing lifecycle spec is untouched.
describe('PriceSubmissionReviewService — reads & reviewer candidates (RM-02D2A2)', () => {
  let service: PriceSubmissionReviewService;
  let prisma: {
    priceSubmissionReview: { findMany: jest.Mock; findFirst: jest.Mock };
    user: { findMany: jest.Mock };
  };

  const WS = 'ws-01';
  const ORG = 'org-01';

  const reviewRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'review-1',
    priceSubmissionId: 'sub-1',
    slaState: 'OPEN',
    openedAt: new Date('2026-07-20T00:00:00.000Z'),
    escalatedAt: null,
    expiredAt: null,
    resolvedAt: null,
    submission: {
      workspaceId: WS,
      organizationId: ORG,
      status: 'UNDER_REVIEW',
      sourceType: 'MARKET_SURVEY',
      sourceOrigin: 'SUPPLIER',
      currentRevisionId: 'rev-1',
      resource: { id: 'r1', code: 'M.01', name: 'Semen', type: 'MATERIAL' },
      region: { id: 'reg1', code: 'ID-JK', name: 'DKI Jakarta' },
      revisions: [
        { id: 'rev-1', value: '125000.00', effectiveDate: new Date('2026-07-19T00:00:00.000Z') },
      ],
    },
    assignedTo: { id: 'u1', fullName: 'Budi', membership: { account: { email: 'budi@x.co' } } },
    ...overrides,
  });

  const activeUser = (overrides: Record<string, unknown> = {}) => ({
    id: 'u1',
    fullName: 'Budi',
    status: 'ACTIVE',
    workspaceId: WS,
    workspaceMembershipId: 'm1',
    membership: {
      id: 'm1',
      workspaceId: WS,
      status: 'ACTIVE',
      account: { status: 'ACTIVE', email: 'budi@x.co' },
    },
    ...overrides,
  });

  beforeEach(async () => {
    prisma = {
      priceSubmissionReview: { findMany: jest.fn(), findFirst: jest.fn() },
      user: { findMany: jest.fn() },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [PriceSubmissionReviewService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get<PriceSubmissionReviewService>(PriceSubmissionReviewService);
  });

  describe('listReviewQueue', () => {
    it('scopes by workspaceId+organizationId and projects a human-readable, decimal-string row', async () => {
      prisma.priceSubmissionReview.findMany.mockResolvedValue([reviewRow()]);
      const result = await service.listReviewQueue({ workspaceId: WS, organizationId: ORG });

      expect(prisma.priceSubmissionReview.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ workspaceId: WS, organizationId: ORG }) }),
      );
      expect(result).toEqual([
        expect.objectContaining({
          reviewId: 'review-1',
          resource: { id: 'r1', code: 'M.01', name: 'Semen', type: 'MATERIAL' },
          region: { id: 'reg1', code: 'ID-JK', name: 'DKI Jakarta' },
          currentPrice: '125000.00',
          assignedReviewer: { userId: 'u1', fullName: 'Budi', email: 'budi@x.co' },
        }),
      ]);
      expect(typeof result[0].currentPrice).toBe('string');
    });

    it('passes an slaState filter through when present', async () => {
      prisma.priceSubmissionReview.findMany.mockResolvedValue([]);
      await service.listReviewQueue({ workspaceId: WS, organizationId: ORG, slaState: 'ESCALATED' });
      expect(prisma.priceSubmissionReview.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ slaState: 'ESCALATED' }) }),
      );
    });
  });

  describe('getReviewDetailForApi', () => {
    it('projects detail with source axes and a decision history', async () => {
      prisma.priceSubmissionReview.findFirst.mockResolvedValue(
        reviewRow({
          decisions: [
            {
              id: 'd1',
              action: 'REASSIGN',
              note: 'dialihkan ke Budi',
              decidedAt: new Date('2026-07-21T00:00:00.000Z'),
              decidedBy: { id: 'u2', fullName: 'Sari', membership: { account: { email: 'sari@x.co' } } },
            },
          ],
        }),
      );
      const detail = await service.getReviewDetailForApi({ workspaceId: WS, organizationId: ORG, reviewId: 'review-1' });
      expect(detail.sourceType).toBe('MARKET_SURVEY');
      expect(detail.currentPrice).toBe('125000.00');
      expect(detail.decisions).toEqual([
        {
          id: 'd1',
          action: 'REASSIGN',
          note: 'dialihkan ke Budi',
          decidedAt: '2026-07-21T00:00:00.000Z',
          decidedBy: { userId: 'u2', fullName: 'Sari', email: 'sari@x.co' },
        },
      ]);
    });

    it('404s a missing review', async () => {
      prisma.priceSubmissionReview.findFirst.mockResolvedValue(null);
      await expect(
        service.getReviewDetailForApi({ workspaceId: WS, organizationId: ORG, reviewId: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('404s a cross-tenant review whose submission belongs to another workspace', async () => {
      prisma.priceSubmissionReview.findFirst.mockResolvedValue(
        reviewRow({ submission: { ...reviewRow().submission, workspaceId: 'ws-other' } }),
      );
      await expect(
        service.getReviewDetailForApi({ workspaceId: WS, organizationId: ORG, reviewId: 'review-1' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('listReviewerCandidates', () => {
    it('scopes the query to an ACTIVE user/membership/account in the target workspace', async () => {
      prisma.user.findMany.mockResolvedValue([activeUser()]);
      const result = await service.listReviewerCandidates({ workspaceId: WS });

      const where = prisma.user.findMany.mock.calls[0][0].where;
      expect(where).toEqual(
        expect.objectContaining({
          workspaceId: WS,
          status: 'ACTIVE',
          membership: {
            is: expect.objectContaining({
              workspaceId: WS,
              status: 'ACTIVE',
              account: { is: { status: 'ACTIVE' } },
            }),
          },
        }),
      );
      expect(result).toEqual([{ userId: 'u1', fullName: 'Budi', email: 'budi@x.co' }]);
    });

    it('adds a case-insensitive q filter on fullName or email', async () => {
      prisma.user.findMany.mockResolvedValue([]);
      await service.listReviewerCandidates({ workspaceId: WS, q: 'bud' });
      const where = prisma.user.findMany.mock.calls[0][0].where;
      expect(where.OR).toBeDefined();
      expect(JSON.stringify(where.OR)).toContain('insensitive');
      expect(JSON.stringify(where.OR)).toContain('bud');
    });

    it('drops an inactive User even if the DB returned it', async () => {
      prisma.user.findMany.mockResolvedValue([activeUser({ status: 'INACTIVE' })]);
      expect(await service.listReviewerCandidates({ workspaceId: WS })).toEqual([]);
    });

    it('drops an inactive WorkspaceMembership', async () => {
      prisma.user.findMany.mockResolvedValue([
        activeUser({ membership: { id: 'm1', workspaceId: WS, status: 'SUSPENDED', account: { status: 'ACTIVE', email: 'x@x.co' } } }),
      ]);
      expect(await service.listReviewerCandidates({ workspaceId: WS })).toEqual([]);
    });

    it('drops an inactive Account', async () => {
      prisma.user.findMany.mockResolvedValue([
        activeUser({ membership: { id: 'm1', workspaceId: WS, status: 'ACTIVE', account: { status: 'SUSPENDED', email: 'x@x.co' } } }),
      ]);
      expect(await service.listReviewerCandidates({ workspaceId: WS })).toEqual([]);
    });

    it('drops a cross-tenant membership', async () => {
      prisma.user.findMany.mockResolvedValue([
        activeUser({ membership: { id: 'm1', workspaceId: 'ws-other', status: 'ACTIVE', account: { status: 'ACTIVE', email: 'x@x.co' } } }),
      ]);
      expect(await service.listReviewerCandidates({ workspaceId: WS })).toEqual([]);
    });

    it('drops a user whose workspaceMembershipId does not match its membership.id', async () => {
      prisma.user.findMany.mockResolvedValue([activeUser({ workspaceMembershipId: 'm-DANGLING' })]);
      expect(await service.listReviewerCandidates({ workspaceId: WS })).toEqual([]);
    });
  });
});
