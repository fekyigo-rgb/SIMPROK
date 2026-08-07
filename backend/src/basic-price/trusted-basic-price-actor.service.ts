import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface TrustedBasicPriceActor {
  /** Account that will be recorded as the reporter of the private price fact. */
  accountId: string;
  /** The one live human profile behind that account in this workspace. */
  userId: string;
  /** Server-derived workspace. Never the client's claim. */
  workspaceId: string;
}

/**
 * RM-03C — who is allowed to be recorded as the actor behind a
 * WORKSPACE_PRIVATE Basic Price, and which workspace that price belongs to.
 *
 * A private Basic Price needs no verifier and no publisher. That makes its
 * WRITE-TIME authority chain the ONLY authority chain it will ever have: there
 * is no later human review to catch a wrong workspace or an unattributable
 * author. So it is derived server-side, walking the canonical identity chain
 * and nothing else:
 *
 *   JWT Account
 *     → ACTIVE WorkspaceMembership for the selected workspace  (guard-verified)
 *       → ACTIVE User profile belonging to that membership
 *         → trusted { accountId, userId, workspaceId }
 *
 * `User.workspaceMembershipId` is `@unique`, so a membership resolves to at
 * most one User — the actor is deterministic, never a choice between
 * candidates.
 *
 * WHY THIS EXISTS ALONGSIDE TrustedAhspActorService: that service answers the
 * AHSP domain's question ("which User.id may author this AHSP fact") and
 * returns a User id only. A Basic Price records its reporter as an Account
 * (`BasicPrice.reportedByAccountId`) and must also pin the owning workspace,
 * so it needs all three values. Collapsing the two into one shared helper
 * would mean editing the RM-03B AHSP path, which RM-03C is not authorized to
 * touch. The identity law they both walk is identical and stated once, here
 * and there, deliberately — not silently forked.
 *
 * PermissionsGuard proves the caller may ACT in this workspace. That is a
 * different question from whether the account is still ACTIVE and still has a
 * live human profile to attribute a fact to, so every predicate is asserted
 * here rather than assumed.
 */
@Injectable()
export class TrustedBasicPriceActorService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Fails closed. There is deliberately NO fallback: not to a client-supplied
   * workspaceId, not to the Account id alone, not to "any User in this
   * workspace", and not to a null actor. A price with no trustworthy author
   * must not come into existence at all — an unattributable record is worse
   * than a refused one, because it is indistinguishable from an attributable
   * one later.
   */
  async resolveActor(
    workspaceContext: unknown,
    jwtAccountId: unknown,
  ): Promise<TrustedBasicPriceActor> {
    const context = workspaceContext as
      | { workspaceId?: unknown; membershipId?: unknown }
      | undefined;
    const workspaceId = context?.workspaceId;
    const membershipId = context?.membershipId;

    if (
      typeof workspaceId !== 'string' ||
      typeof membershipId !== 'string' ||
      typeof jwtAccountId !== 'string' ||
      jwtAccountId.length === 0
    ) {
      throw new BadRequestException('BASIC_PRICE_WORKSPACE_CONTEXT_REQUIRED');
    }

    // The membership's own accountId is re-checked against the JWT account, so
    // a context whose two halves disagree cannot resolve. The membership's own
    // workspaceId is re-checked too, for the same reason.
    const actor = await this.prisma.user.findFirst({
      where: {
        workspaceMembershipId: membershipId,
        workspaceId,
        status: 'ACTIVE',
        membership: {
          status: 'ACTIVE',
          workspaceId,
          accountId: jwtAccountId,
          account: { status: 'ACTIVE' },
        },
      },
      select: {
        id: true,
        membership: { select: { accountId: true } },
      },
    });

    if (!actor) {
      throw new ForbiddenException('NO_TRUSTED_USER_PROFILE');
    }

    return {
      accountId: actor.membership.accountId,
      userId: actor.id,
      workspaceId,
    };
  }
}
