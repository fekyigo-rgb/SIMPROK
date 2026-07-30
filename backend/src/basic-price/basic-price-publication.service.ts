import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  mapPublicationQueueItem,
  type PublicationQueueItem,
} from '../common/basic-price-workflow.projection';

/**
 * RM-02D2A-1 Owner Lock (docs/implementation-gates/rm02d2a1/OWNER-LOCK.md) —
 * the ONLY code path permitted to write BasicPrice.status = 'PUBLISHED'
 * AND BasicPrice.verificationStatus = 'PUBLISHED'. Both axes move
 * together, atomically, in one transaction (D-09) — this is a deliberate
 * fail-safe redundancy, never simplified to a single-axis predicate.
 *
 * D-01..D-15 (see OWNER-LOCK.md for the full contract):
 * - Publisher must be a different human than the ACCEPT-decision verifier
 *   (D-08, VERIFIER_CANNOT_PUBLISH, 409). AUTO_PUBLISH is forbidden — there
 *   is no code path anywhere that calls publish() automatically from
 *   ACCEPT or any other system trigger.
 * - Source state must be exactly UNPUBLISHED+VERIFIED (D-04); any other
 *   two-axis combination fails closed (D-12), never self-heals.
 * - Idempotent only at the PUBLISHED+PUBLISHED terminal state (D-13).
 */
@Injectable()
export class BasicPricePublicationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * RM-02D2A2 — the publication queue is projected, never a raw BasicPrice
   * row: a publisher must see a human-readable resource identity, region, and
   * an exact two-digit decimal price string before publishing. Same
   * workspace-scoped UNPUBLISHED+VERIFIED source set as before.
   */
  async getPublicationQueue(workspaceId: string): Promise<PublicationQueueItem[]> {
    const rows = await this.prisma.basicPrice.findMany({
      where: { workspaceId, status: 'UNPUBLISHED', verificationStatus: 'VERIFIED' },
      orderBy: { createdAt: 'asc' },
      include: { resource: true, region: true },
    });
    return rows.map((row) => mapPublicationQueueItem(row));
  }

  async publish(params: {
    workspaceId: string;
    basicPriceId: string;
    publisherAccountId: string;
  }) {
    const { workspaceId, basicPriceId, publisherAccountId } = params;
    if (!publisherAccountId) throw new ConflictException('PUBLISH_ACTOR_REQUIRED');

    // D-01 — publisher must be an ACTIVE Account with an ACTIVE membership
    // in the target workspace.
    const publisherMembership = await this.prisma.workspaceMembership.findFirst(
      {
        where: {
          accountId: publisherAccountId,
          workspaceId,
          status: 'ACTIVE',
          account: { status: 'ACTIVE' },
          userProfile: {
            is: {
              workspaceId,
              status: UserStatus.ACTIVE,
            },
          },
        },
        select: {
          id: true,
          accountId: true,
          workspaceId: true,
          status: true,
          account: { select: { id: true, status: true } },
          userProfile: {
            select: {
              workspaceMembershipId: true,
              workspaceId: true,
              status: true,
            },
          },
        },
      },
    );
    if (
      !publisherMembership ||
      publisherMembership.account.id !== publisherMembership.accountId ||
      publisherMembership.account.status !== 'ACTIVE' ||
      publisherMembership.workspaceId !== workspaceId ||
      publisherMembership.status !== 'ACTIVE' ||
      !publisherMembership.userProfile ||
      publisherMembership.userProfile.workspaceMembershipId !==
        publisherMembership.id ||
      publisherMembership.userProfile.workspaceId !== workspaceId ||
      publisherMembership.userProfile.status !== UserStatus.ACTIVE
    ) {
      throw new ForbiddenException('PUBLISHER_NOT_ACTIVE_IN_WORKSPACE');
    }
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { organizationId: true },
    });
    if (!workspace) throw new NotFoundException('Workspace not found');
    const organizationId = workspace.organizationId;
    const stateBeforeLock = await this.prisma.basicPrice.findFirst({
      where: { id: basicPriceId, workspaceId, organizationId },
      select: { status: true, verificationStatus: true },
    });

    return this.prisma.$transaction(async (tx) => {
      // D-02 — lock exact row, scoped to basicPriceId + workspaceId.
      // D-03 — cross-tenant / unknown id: 404 (the workspaceId predicate
      // makes a cross-tenant id indistinguishable from a missing id).
      const locked = await tx.$queryRaw<
        Array<{
          id: string;
          status: string;
          verificationStatus: string;
          sourceSubmissionId: string | null;
          organizationId: string | null;
        }>
      >(
        Prisma.sql`SELECT "id", "status", "verificationStatus", "sourceSubmissionId", "organizationId"
                    FROM "basic_prices"
                    WHERE "id" = ${basicPriceId}::uuid
                      AND "workspaceId" = ${workspaceId}::uuid
                      AND "organizationId" = ${organizationId}::uuid
                    FOR UPDATE`,
      );
      const basicPrice = locked[0];
      if (!basicPrice) throw new NotFoundException('BasicPrice not found');

      // D-13 — the only idempotent terminal state: already PUBLISHED+PUBLISHED.
      if (basicPrice.status === 'PUBLISHED' && basicPrice.verificationStatus === 'PUBLISHED') {
        if (
          stateBeforeLock?.status !== 'PUBLISHED' ||
          stateBeforeLock.verificationStatus !== 'PUBLISHED'
        ) {
          throw new ConflictException('PUBLICATION_CONCURRENTLY_COMPLETED');
        }
        return tx.basicPrice.findUniqueOrThrow({ where: { id: basicPriceId } });
      }

      // D-04 / D-12 — the only source state allowed to transition is exactly
      // UNPUBLISHED+VERIFIED. Every other combination (including partial
      // drift like PUBLISHED+VERIFIED or UNPUBLISHED+PUBLISHED) fails
      // closed — never silently repaired.
      if (basicPrice.status !== 'UNPUBLISHED' || basicPrice.verificationStatus !== 'VERIFIED') {
        throw new ConflictException('INCONSISTENT_BASIC_PRICE_STATE');
      }

      // D-05/D-06/D-07 — trace the exact ACCEPT decision through
      // BasicPrice.sourceSubmission -> PriceSubmission.review ->
      // PriceSubmissionReviewDecision(action=ACCEPT) -> decidedByUserId ->
      // User.workspaceMembershipId -> WorkspaceMembership.accountId. Missing
      // or ambiguous evidence fails closed, never guesses.
      if (!basicPrice.sourceSubmissionId) {
        throw new ConflictException('VERIFIER_EVIDENCE_MISSING');
      }
      const submission = await tx.priceSubmission.findFirst({
        where: {
          id: basicPrice.sourceSubmissionId,
          workspaceId,
          organizationId,
        },
        include: {
          review: {
            where: { workspaceId, organizationId },
            include: {
              decisions: { where: { action: 'ACCEPT' } },
            },
          },
        },
      });
      const acceptDecisions = submission?.review?.decisions ?? [];
      if (acceptDecisions.length !== 1) {
        throw new ConflictException('VERIFIER_EVIDENCE_MISSING');
      }
      const verifierUser = await tx.user.findFirst({
        where: {
          id: acceptDecisions[0].decidedByUserId,
          workspaceId,
          status: UserStatus.ACTIVE,
        },
        select: {
          status: true,
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
        !verifierUser ||
        verifierUser.status !== UserStatus.ACTIVE ||
        verifierUser.membership.id !== verifierUser.workspaceMembershipId ||
        verifierUser.membership.workspaceId !== workspaceId ||
        verifierUser.membership.status !== 'ACTIVE' ||
        verifierUser.membership.account.id !== verifierUser.membership.accountId ||
        verifierUser.membership.account.status !== 'ACTIVE'
      ) {
        throw new ConflictException('VERIFIER_EVIDENCE_MISSING');
      }
      const verifierAccountId = verifierUser.membership.accountId;

      // D-08 — separation of duties. AUTO_PUBLISH=FORBIDDEN,
      // VERIFIER_MUST_DIFFER_FROM_PUBLISHER=YES per Owner Lock.
      if (verifierAccountId === publisherAccountId) {
        throw new ConflictException('VERIFIER_CANNOT_PUBLISH');
      }

      // D-09 — atomic two-axis write + exactly one audit row.
      const updated = await tx.basicPrice.update({
        where: { id: basicPriceId },
        data: { status: 'PUBLISHED', verificationStatus: 'PUBLISHED' },
      });

      await tx.basicPricePublicationAudit.create({
        data: {
          basicPriceId,
          action: 'PUBLISH',
          actorAccountId: publisherAccountId,
          reason: 'status:UNPUBLISHED->PUBLISHED; verificationStatus:VERIFIED->PUBLISHED',
        },
      });

      return updated;
    });
  }
}
