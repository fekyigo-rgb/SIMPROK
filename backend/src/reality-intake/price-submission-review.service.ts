import { Injectable, NotFoundException } from '@nestjs/common';
import {
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
  regionId?: string | null;
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

@Injectable()
export class PriceSubmissionReviewService {
  constructor(private readonly prisma: PrismaService) {}

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
      include: { revisions: true },
    });

    if (!submission || !submission.workspaceId || !submission.organizationId) {
      return { processed: false as const, reason: 'NO_SUBMITTED_PRICE_SUBMISSION' };
    }

    const currentRevision = this.currentRevision(submission);
    if (!currentRevision) {
      return { processed: false as const, reason: 'CURRENT_REVISION_MISSING' };
    }

    return this.prisma.$transaction(async (tx) => {
      const existingReview = await tx.priceSubmissionReview.findUnique({
        where: { priceSubmissionId: submission.id },
      });
      if (existingReview) {
        return {
          processed: true as const,
          reviewId: existingReview.id,
          priceSubmissionId: submission.id,
          status: 'ALREADY_EXISTS' as const,
        };
      }

      const review = await tx.priceSubmissionReview.create({
        data: {
          priceSubmissionId: submission.id,
          workspaceId: submission.workspaceId!,
          organizationId: submission.organizationId!,
          slaState: 'OPEN',
          openedAt: new Date(),
        },
      });

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
            fromStatus: 'SUBMITTED',
            toStatus: 'UNDER_REVIEW',
            actorType: 'SYSTEM',
            actorAccountId: null,
            reason: `STEP-2.6b_REVIEW_CREATED; reviewId:${review.id}`,
          },
        });
      }

      return {
        processed: true as const,
        reviewId: review.id,
        priceSubmissionId: submission.id,
        status: 'CREATED' as const,
      };
    });
  }

  async acceptPriceSubmissionReview(params: AcceptParams) {
    const review = await this.findReviewForTenant(params);
    const revision = this.currentRevision(review.submission);
    if (!revision) {
      throw new NotFoundException('Current price submission revision not found');
    }
    const actorAccountId = await this.assertHumanInWorkspace(
      params.decidedByUserId,
      params.workspaceId,
    );

    return this.prisma.$transaction(async (tx) => {
      const existingBasicPrice = await tx.basicPrice.findUnique({
        where: { sourceSubmissionId: review.submission.id },
      });
      const existingAccept = await tx.priceSubmissionReviewDecision.findFirst({
        where: { reviewId: review.id, action: 'ACCEPT' },
      });

      if (existingBasicPrice) {
        return {
          processed: true as const,
          reviewId: review.id,
          priceSubmissionId: review.submission.id,
          basicPriceId: existingBasicPrice.id,
          status: 'ALREADY_ACTIVATED' as const,
        };
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
          submissionId: review.submission.id,
          fromStatus: review.submission.status,
          toStatus: 'VERIFIED',
          actorType: 'HUMAN',
          actorAccountId,
          reason: `STEP-2.6b_HUMAN_ACCEPT; reviewId:${review.id}; decisionId:${decision.id}; decidedByUserId:${params.decidedByUserId}`,
        },
      });

      const basicPrice = await tx.basicPrice.create({
        data: {
          sourceSubmissionId: review.submission.id,
          resourceId: review.submission.resourceId,
          workspaceId: review.submission.workspaceId,
          organizationId: review.submission.organizationId,
          regionId: params.regionId ?? null,
          effectiveDate: revision.effectiveDate ?? new Date(),
          value: revision.value,
          sourceType: review.submission.sourceType,
          verificationStatus: 'VERIFIED',
          sourceOrigin: review.submission.sourceOrigin,
          freshnessStatus: 'CURRENT',
          reportedByAccountId: review.submission.reportedByAccountId,
          status: 'PUBLISHED',
        },
      });

      await tx.priceSubmission.update({
        where: { id: review.submission.id },
        data: { status: 'PUBLISHED' },
      });

      await tx.priceSubmissionAudit.create({
        data: {
          submissionId: review.submission.id,
          fromStatus: 'VERIFIED',
          toStatus: 'PUBLISHED',
          actorType: 'SYSTEM',
          actorAccountId: null,
          reason: `STEP-2.6b_BASIC_PRICE_ACTIVATED; reviewId:${review.id}; basicPriceId:${basicPrice.id}; sourceSubmissionId:${review.submission.id}`,
        },
      });

      return {
        processed: true as const,
        reviewId: review.id,
        priceSubmissionId: review.submission.id,
        decisionId: decision.id,
        basicPriceId: basicPrice.id,
        status: 'PUBLISHED' as const,
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

  private async resolveWithoutBasicPrice(
    params: DecisionParams,
    action: Exclude<PriceReviewActionType, 'ACCEPT' | 'REASSIGN'>,
    status: 'REJECTED' | 'NEEDS_CORRECTION',
    resolveReview: boolean,
  ) {
    const review = await this.findReviewForTenant(params);
    const actorAccountId = await this.assertHumanInWorkspace(
      params.decidedByUserId,
      params.workspaceId,
    );

    return this.prisma.$transaction(async (tx) => {
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
        membership: {
          select: {
            accountId: true,
            workspaceId: true,
          },
        },
      },
    });

    if (!user || user.membership.workspaceId !== workspaceId) {
      throw new NotFoundException('Reviewer not found');
    }

    return user.membership.accountId;
  }
}
