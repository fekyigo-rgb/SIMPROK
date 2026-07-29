import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  PriceReviewActionType,
  PriceSubmission,
  PriceSubmissionReview,
  PriceSubmissionRevision,
  ReviewSlaState,
  UserStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type TenantParams = {
  workspaceId: string;
  organizationId: string;
};

type DecisionParams = TenantParams & {
  reviewId: string;
  decidedByUserId: string;
  note?: string;
};

type AcceptParams = DecisionParams & {
  explicitGeneralRegion?: boolean;
};

type ReassignParams = DecisionParams & {
  assignedToUserId?: string | null;
};

type ReviewWithSubmission = PriceSubmissionReview & {
  submission: PriceSubmission & {
    revisions: PriceSubmissionRevision[];
  };
};

/** Minimal submission shape the canonical review-creation helper needs — it
 * never re-derives workspaceId/organizationId itself, it only ever accepts
 * server-resolved values already validated by the caller. */
type SubmissionForReviewCreation = {
  id: string;
  workspaceId: string;
  organizationId: string;
};

@Injectable()
export class PriceSubmissionReviewService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * RM-02D2A-1 Work Package A — the ONE canonical, idempotent path that
   * creates a PriceSubmissionReview for a SUBMITTED PriceSubmission. Must
   * run inside the CALLER's own Prisma transaction (never opens its own),
   * so a review-creation failure rolls back the caller's whole unit of
   * work (e.g. RM-02 import batch submission never leaves an orphan
   * PriceSubmission without a review). Safe to call more than once for the
   * same submission — returns the existing review rather than creating a
   * second one, and never double-writes the UNDER_REVIEW audit trail.
   */
  async createReviewWithinTransaction(
    tx: Prisma.TransactionClient,
    submission: SubmissionForReviewCreation,
  ): Promise<{ reviewId: string; status: 'CREATED' | 'ALREADY_EXISTS' }> {
    const existingReview = await tx.priceSubmissionReview.findUnique({
      where: { priceSubmissionId: submission.id },
    });
    if (existingReview) {
      return { reviewId: existingReview.id, status: 'ALREADY_EXISTS' };
    }

    const review = await tx.priceSubmissionReview.create({
      data: {
        priceSubmissionId: submission.id,
        workspaceId: submission.workspaceId,
        organizationId: submission.organizationId,
        slaState: 'OPEN',
        openedAt: new Date(),
      },
    });

    const current = await tx.priceSubmission.findUniqueOrThrow({ where: { id: submission.id } });
    await tx.priceSubmission.update({
      where: { id: submission.id },
      data: { status: 'UNDER_REVIEW' },
    });

    const alreadyAudited = await tx.priceSubmissionAudit.findFirst({
      where: {
        submissionId: submission.id,
        reason: { contains: 'STEP-2.6b_REVIEW_CREATED' },
      },
    });
    if (!alreadyAudited) {
      await tx.priceSubmissionAudit.create({
        data: {
          submissionId: submission.id,
          fromStatus: current.status,
          toStatus: 'UNDER_REVIEW',
          actorType: 'SYSTEM',
          actorAccountId: null,
          reason: `STEP-2.6b_REVIEW_CREATED; reviewId:${review.id}`,
        },
      });
    }

    return { reviewId: review.id, status: 'CREATED' };
  }

  /**
   * Recovery/service path for a SUBMITTED PriceSubmission that somehow has
   * no review yet (e.g. non-import submission flows outside RM-02).
   * Delegates to the same canonical helper used by the RM-02 import path —
   * there is exactly one review-creation implementation, never two.
   */
  async processSubmittedPriceSubmissionReviewOnce(params: TenantParams) {
    const submission = await this.prisma.priceSubmission.findFirst({
      where: {
        workspaceId: params.workspaceId,
        organizationId: params.organizationId,
        status: 'SUBMITTED',
        currentRevisionId: { not: null },
        review: null,
      },
      orderBy: { createdAt: 'asc' },
    });

    if (!submission || !submission.workspaceId || !submission.organizationId) {
      return { processed: false as const, reason: 'NO_SUBMITTED_PRICE_SUBMISSION' };
    }

    return this.prisma.$transaction(async (tx) => {
      const result = await this.createReviewWithinTransaction(tx, {
        id: submission.id,
        workspaceId: submission.workspaceId!,
        organizationId: submission.organizationId!,
      });
      return {
        processed: true as const,
        reviewId: result.reviewId,
        priceSubmissionId: submission.id,
        status: result.status === 'CREATED' ? ('CREATED' as const) : ('ALREADY_EXISTS' as const),
      };
    });
  }

  /**
   * RM-02D2A-1 Owner Lock — ACCEPT is the "verified" half of the two
   * separate human actions (§2). It proves the price VERIFIED and creates
   * exactly one BasicPrice at UNPUBLISHED+VERIFIED. It NEVER publishes:
   * publication is BasicPricePublicationService.publish()'s job alone, run
   * later by a DIFFERENT human. No code path here ever writes
   * BasicPrice.status/PriceSubmission.status to PUBLISHED.
   */
  async acceptPriceSubmissionReview(params: AcceptParams) {
    const review = await this.findReviewForTenant(params);
    const actorAccountId = await this.assertHumanInWorkspace(
      params.decidedByUserId,
      params.workspaceId,
    );
    const basicPriceBeforeLock = await this.prisma.basicPrice.findUnique({
      where: { sourceSubmissionId: review.submission.id },
      select: { id: true },
    });

    return this.prisma.$transaction(async (tx) => {
      // Row-lock the review for the duration of the transaction so two
      // concurrent ACCEPT calls on the same review serialize instead of
      // racing to create duplicate decisions/BasicPrice rows, and so the
      // actionability check below sees the live state, not a stale read.
      const { slaState: freshSlaState } = await this.lockReviewForUpdate(
        tx,
        review.id,
        params.workspaceId,
        params.organizationId,
      );

      const liveSubmission = await tx.priceSubmission.findFirst({
        where: {
          id: review.submission.id,
          workspaceId: params.workspaceId,
          organizationId: params.organizationId,
        },
        include: { revisions: true },
      });
      if (!liveSubmission) {
        throw new NotFoundException('Price submission review not found');
      }

      const existingBasicPrice = await tx.basicPrice.findUnique({
        where: { sourceSubmissionId: liveSubmission.id },
      });
      const existingAccept = await tx.priceSubmissionReviewDecision.findFirst({
        where: { reviewId: review.id, action: 'ACCEPT' },
      });

      if (existingBasicPrice && existingAccept) {
        if (!basicPriceBeforeLock) {
          throw new ConflictException('ACCEPT_CONCURRENTLY_COMPLETED');
        }
        return {
          processed: true as const,
          reviewId: review.id,
          priceSubmissionId: review.submission.id,
          decisionId: existingAccept.id,
          basicPriceId: existingBasicPrice.id,
          status: 'ALREADY_ACTIVATED' as const,
          priceSubmissionStatus: 'VERIFIED' as const,
          basicPriceStatus: existingBasicPrice.status,
          basicPriceVerificationStatus: existingBasicPrice.verificationStatus,
          publiclyEligible:
            existingBasicPrice.status === 'PUBLISHED' &&
            existingBasicPrice.verificationStatus === 'PUBLISHED',
        };
      }
      if (existingBasicPrice || existingAccept) {
        throw new ConflictException('ACCEPT_IDEMPOTENCY_EVIDENCE_INCONSISTENT');
      }
      if (liveSubmission.status === 'NEEDS_CORRECTION') {
        throw new ConflictException('CORRECTION_RESUBMISSION_REQUIRED');
      }
      if (liveSubmission.status !== 'UNDER_REVIEW') {
        throw new ConflictException('SUBMISSION_NOT_UNDER_REVIEW');
      }
      if (freshSlaState === 'RESOLVED' || freshSlaState === 'EXPIRED') {
        throw new ConflictException('REVIEW_NOT_ACTIONABLE');
      }

      const revision = this.currentRevision(liveSubmission);
      if (!revision?.effectiveDate) {
        throw new ConflictException('EFFECTIVE_DATE_REQUIRED_BEFORE_ACCEPT');
      }
      if (liveSubmission.regionId && params.explicitGeneralRegion === true) {
        throw new ConflictException('REGION_DECISION_CONFLICT');
      }
      if (!liveSubmission.regionId && params.explicitGeneralRegion !== true) {
        throw new ConflictException('REGION_REQUIRED_OR_EXPLICIT_GENERAL_REGION');
      }

      const decision =
        existingAccept ??
        (await tx.priceSubmissionReviewDecision.create({
          data: {
            reviewId: review.id,
            decidedByUserId: params.decidedByUserId,
            action: 'ACCEPT',
            note: params.note,
          },
        }));

      await tx.priceSubmissionReview.update({
        where: { id: review.id },
        data: {
          slaState: 'RESOLVED',
          resolvedAt: new Date(),
        },
      });

      await tx.priceSubmission.update({
        where: { id: review.submission.id },
        data: { status: 'VERIFIED' },
      });

      await tx.priceSubmissionAudit.create({
        data: {
          submissionId: liveSubmission.id,
          fromStatus: liveSubmission.status,
          toStatus: 'VERIFIED',
          actorType: 'HUMAN',
          actorAccountId,
          reason: `STEP-2.6b_HUMAN_ACCEPT; reviewId:${review.id}; decisionId:${decision.id}; decidedByUserId:${params.decidedByUserId}${liveSubmission.regionId ? '' : '; GENERAL_REGION_EXPLICIT'}`,
        },
      });

      const basicPrice = await tx.basicPrice.create({
        data: {
          sourceSubmissionId: liveSubmission.id,
          resourceId: liveSubmission.resourceId,
          workspaceId: liveSubmission.workspaceId,
          organizationId: liveSubmission.organizationId,
          regionId: liveSubmission.regionId,
          effectiveDate: revision.effectiveDate,
          value: revision.value,
          sourceType: liveSubmission.sourceType,
          verificationStatus: 'VERIFIED',
          sourceOrigin: liveSubmission.sourceOrigin,
          freshnessStatus: 'CURRENT',
          reportedByAccountId: liveSubmission.reportedByAccountId,
          // RM-02D2A-1 Owner Lock: status is intentionally omitted here so
          // the row takes the schema's default ('UNPUBLISHED'). ACCEPT
          // proves the price VERIFIED, never PUBLISHED. Publication is a
          // separate, human-gated action performed by a DIFFERENT human
          // via BasicPricePublicationService — never auto-triggered from
          // here. There is no writer anywhere in this method (or anywhere
          // else in the codebase) that advances PriceSubmission.status or
          // BasicPrice.status to PUBLISHED as a side effect of ACCEPT.
        },
      });

      return {
        processed: true as const,
        reviewId: review.id,
        priceSubmissionId: review.submission.id,
        decisionId: decision.id,
        basicPriceId: basicPrice.id,
        status: 'ACCEPTED' as const,
        priceSubmissionStatus: 'VERIFIED' as const,
        basicPriceStatus: basicPrice.status,
        basicPriceVerificationStatus: basicPrice.verificationStatus,
        publiclyEligible: false as const,
      };
    });
  }

  async rejectPriceSubmissionReview(params: DecisionParams) {
    return this.resolveWithoutBasicPrice(params, 'REJECT', 'REJECTED', true);
  }

  async requestCorrectionForPriceSubmissionReview(params: DecisionParams) {
    return this.resolveWithoutBasicPrice(
      params,
      'REQUEST_CORRECTION',
      'NEEDS_CORRECTION',
      false,
    );
  }

  async reassignPriceSubmissionReview(params: ReassignParams) {
    const review = await this.findReviewForTenant(params);
    const actorAccountId = await this.assertHumanInWorkspace(
      params.decidedByUserId,
      params.workspaceId,
    );
    if (params.assignedToUserId) {
      await this.assertHumanInWorkspace(params.assignedToUserId, params.workspaceId);
    }

    return this.prisma.$transaction(async (tx) => {
      const { slaState: freshSlaState } = await this.lockReviewForUpdate(
        tx,
        review.id,
        params.workspaceId,
        params.organizationId,
      );
      if (freshSlaState === 'RESOLVED' || freshSlaState === 'EXPIRED') {
        throw new ConflictException('REVIEW_NOT_ACTIONABLE');
      }

      const decision = await tx.priceSubmissionReviewDecision.create({
        data: {
          reviewId: review.id,
          decidedByUserId: params.decidedByUserId,
          action: 'REASSIGN',
          note: params.note,
        },
      });

      await tx.priceSubmissionReview.update({
        where: { id: review.id },
        data: { assignedToUserId: params.assignedToUserId ?? null },
      });

      await tx.priceSubmissionAudit.create({
        data: {
          submissionId: review.submission.id,
          fromStatus: review.submission.status,
          toStatus: review.submission.status,
          actorType: 'HUMAN',
          actorAccountId,
          reason: `STEP-2.6b_REASSIGN; reviewId:${review.id}; decisionId:${decision.id}; assignedToUserId:${params.assignedToUserId ?? 'UNASSIGNED'}`,
        },
      });

      return {
        processed: true as const,
        reviewId: review.id,
        decisionId: decision.id,
        status: 'REASSIGNED' as const,
      };
    });
  }

  async processPriceSubmissionReviewSlaOnce(now = new Date()) {
    const review = await this.prisma.priceSubmissionReview.findFirst({
      where: {
        resolvedAt: null,
        slaState: { in: ['OPEN', 'ESCALATED'] },
      },
      orderBy: { openedAt: 'asc' },
      include: { submission: true },
    });

    if (!review) {
      return { processed: false as const, reason: 'NO_OPEN_REVIEW' };
    }

    const ageMs = now.getTime() - review.openedAt.getTime();
    const ageDays = ageMs / (24 * 60 * 60 * 1000);
    if (ageDays >= 30 && review.slaState !== 'EXPIRED') {
      return this.applySlaTransition(review, 'EXPIRED', now);
    }
    if (ageDays >= 7 && review.slaState === 'OPEN') {
      return this.applySlaTransition(review, 'ESCALATED', now);
    }

    return {
      processed: true as const,
      reviewId: review.id,
      status: 'NO_SLA_TRANSITION' as const,
    };
  }

  /**
   * RM-02D2A-1 Work Package B — read-only queue for BASIC_PRICE_REVIEW_VIEW.
   * Tenant-scoped by workspaceId + organizationId server-resolved by the
   * caller; never accepts them from client input.
   */
  async listReviewQueue(params: TenantParams & { slaState?: ReviewSlaState }) {
    return this.prisma.priceSubmissionReview.findMany({
      where: {
        workspaceId: params.workspaceId,
        organizationId: params.organizationId,
        ...(params.slaState ? { slaState: params.slaState } : {}),
      },
      orderBy: { openedAt: 'asc' },
    });
  }

  async getReviewDetailForApi(params: TenantParams & { reviewId: string }) {
    return this.findReviewForTenant(params);
  }

  /** Server-side workspaceId -> organizationId lookup; never trusts client input. */
  async resolveOrganizationId(workspaceId: string): Promise<string> {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { organizationId: true },
    });
    if (!workspace) throw new NotFoundException('Workspace not found');
    return workspace.organizationId;
  }

  /**
   * Resolves the acting User.id for an authenticated Account within a
   * workspace. request.user.id from JwtAuthGuard is always an Account.id
   * (see JwtStrategy) — decidedByUserId on PriceSubmissionReviewDecision is
   * a User.id, so every controller entry point must resolve through this
   * before calling any decision method. Never accepts a userId from the
   * request body.
   */
  async resolveActingUserId(accountId: string, workspaceId: string): Promise<string> {
    const membership = await this.prisma.workspaceMembership.findFirst({
      where: {
        accountId,
        workspaceId,
        status: 'ACTIVE',
        account: { status: 'ACTIVE' },
      },
      select: { id: true },
    });
    if (!membership) {
      throw new NotFoundException('Active workspace membership not found for this account');
    }
    const user = await this.prisma.user.findFirst({
      where: { workspaceMembershipId: membership.id, workspaceId, status: UserStatus.ACTIVE },
      select: { id: true },
    });
    if (!user) {
      throw new NotFoundException('Active user profile not found for this account in this workspace');
    }
    return user.id;
  }

  private async resolveWithoutBasicPrice(
    params: DecisionParams,
    action: Exclude<PriceReviewActionType, 'ACCEPT' | 'REASSIGN'>,
    status: 'REJECTED' | 'NEEDS_CORRECTION',
    resolveReview: boolean,
  ) {
    if (!params.note || !params.note.trim()) {
      throw new ConflictException('DECISION_NOTE_REQUIRED');
    }
    const review = await this.findReviewForTenant(params);
    const actorAccountId = await this.assertHumanInWorkspace(
      params.decidedByUserId,
      params.workspaceId,
    );

    return this.prisma.$transaction(async (tx) => {
      const { slaState: freshSlaState } = await this.lockReviewForUpdate(
        tx,
        review.id,
        params.workspaceId,
        params.organizationId,
      );
      if (freshSlaState === 'RESOLVED' || freshSlaState === 'EXPIRED') {
        throw new ConflictException('REVIEW_NOT_ACTIONABLE');
      }

      const decision = await tx.priceSubmissionReviewDecision.create({
        data: {
          reviewId: review.id,
          decidedByUserId: params.decidedByUserId,
          action,
          note: params.note,
        },
      });

      await tx.priceSubmissionReview.update({
        where: { id: review.id },
        data: resolveReview
          ? { slaState: 'RESOLVED', resolvedAt: new Date() }
          : {},
      });
      await tx.priceSubmission.update({
        where: { id: review.submission.id },
        data: { status },
      });
      await tx.priceSubmissionAudit.create({
        data: {
          submissionId: review.submission.id,
          fromStatus: review.submission.status,
          toStatus: status,
          actorType: 'HUMAN',
          actorAccountId,
          reason: `STEP-2.6b_${action}; reviewId:${review.id}; decisionId:${decision.id}; decidedByUserId:${params.decidedByUserId}`,
        },
      });

      return {
        processed: true as const,
        reviewId: review.id,
        priceSubmissionId: review.submission.id,
        decisionId: decision.id,
        status,
      };
    });
  }

  private async applySlaTransition(
    review: PriceSubmissionReview & { submission: PriceSubmission },
    slaState: Extract<ReviewSlaState, 'ESCALATED' | 'EXPIRED'>,
    now: Date,
  ) {
    const reason = `SLA_BREACH:SLA-001:${slaState}`;
    return this.prisma.$transaction(async (tx) => {
      const existingAudit = await tx.priceSubmissionAudit.findFirst({
        where: {
          submissionId: review.submission.id,
          reason: { contains: reason },
        },
      });

      await tx.priceSubmissionReview.update({
        where: { id: review.id },
        data:
          slaState === 'ESCALATED'
            ? { slaState, escalatedAt: now }
            : { slaState, expiredAt: now },
      });

      if (!existingAudit) {
        await tx.priceSubmissionAudit.create({
          data: {
            submissionId: review.submission.id,
            fromStatus: review.submission.status,
            toStatus: review.submission.status,
            actorType: 'SYSTEM',
            actorAccountId: null,
            reason,
          },
        });
      }

      return {
        processed: true as const,
        reviewId: review.id,
        priceSubmissionId: review.submission.id,
        status: slaState,
      };
    });
  }

  private async findReviewForTenant(
    params: TenantParams & { reviewId: string },
  ): Promise<ReviewWithSubmission> {
    const review = await this.prisma.priceSubmissionReview.findFirst({
      where: {
        id: params.reviewId,
        workspaceId: params.workspaceId,
        organizationId: params.organizationId,
      },
      include: {
        submission: {
          include: { revisions: true },
        },
      },
    });

    if (
      !review ||
      !review.submission ||
      review.submission.workspaceId !== params.workspaceId ||
      review.submission.organizationId !== params.organizationId
    ) {
      throw new NotFoundException('Price submission review not found');
    }

    return review;
  }

  /**
   * Row-locks the review and returns its live slaState from inside the
   * transaction — the pre-transaction findReviewForTenant() read can be
   * stale under concurrency, so every decision method must re-check
   * actionability against this fresh value, not the outer read.
   */
  private async lockReviewForUpdate(
    tx: Prisma.TransactionClient,
    reviewId: string,
    workspaceId: string,
    organizationId: string,
  ): Promise<{ slaState: ReviewSlaState }> {
    const locked = await tx.$queryRaw<Array<{ id: string; slaState: ReviewSlaState }>>(
      Prisma.sql`SELECT "id", "slaState" FROM "price_submission_reviews"
                 WHERE "id" = ${reviewId}::uuid
                   AND "workspaceId" = ${workspaceId}::uuid
                   AND "organizationId" = ${organizationId}::uuid
                 FOR UPDATE`,
    );
    if (!locked[0]) throw new NotFoundException('Price submission review not found');
    return { slaState: locked[0].slaState };
  }

  private currentRevision(
    submission: PriceSubmission & { revisions: PriceSubmissionRevision[] },
  ) {
    return (
      submission.revisions.find(
        (revision) => revision.id === submission.currentRevisionId,
      ) ?? null
    );
  }

  private async assertHumanInWorkspace(userId: string, workspaceId: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        id: userId,
        workspaceId,
        status: UserStatus.ACTIVE,
      },
      select: {
        id: true,
        workspaceMembershipId: true,
        membership: {
          select: {
            id: true,
            accountId: true,
            workspaceId: true,
            status: true,
            account: { select: { id: true, status: true } },
          },
        },
      },
    });

    if (
      !user ||
      user.membership.id !== user.workspaceMembershipId ||
      user.membership.workspaceId !== workspaceId ||
      user.membership.status !== 'ACTIVE' ||
      user.membership.account.id !== user.membership.accountId ||
      user.membership.account.status !== 'ACTIVE'
    ) {
      throw new NotFoundException('Reviewer not found');
    }

    return user.membership.accountId;
  }
}
