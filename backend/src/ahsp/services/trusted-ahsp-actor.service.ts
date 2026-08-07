import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * RM-03B remediation — who is allowed to be recorded as the actor behind an
 * AHSP fact.
 *
 * Every AHSP mutation persists provenance: `createdByUserId`,
 * `approvedByUserId`, `archivedByUserId`, `deletedByUserId`,
 * `ownershipTransferredByUserId`, and an `AHSPAuditLog.who` row. All of those
 * previously took their actor from `body.userId` — a value the browser sends.
 *
 * That meant an authenticated User A could post `userId = <User B>` and the
 * database would record User B as the author of a fact User A created. The
 * workspace was already trusted, so this was never a cross-tenant data leak —
 * it was worse in a different way: the audit trail said something untrue, and
 * in SIMPROK provenance is load-bearing truth, not decoration.
 *
 * The actor is therefore derived server-side, walking the canonical identity
 * chain and nothing else:
 *
 *   JWT Account
 *     → ACTIVE WorkspaceMembership for the selected workspace  (guard-verified)
 *       → ACTIVE User profile belonging to that membership
 *         → trusted User.id
 *
 * `User.workspaceMembershipId` is `@unique`, so a membership resolves to at
 * most one User — the actor is deterministic, never a choice between candidates.
 */
@Injectable()
export class TrustedAhspActorService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolves the one User who may be recorded as the actor for this request.
   *
   * Fails closed. There is deliberately NO fallback: not to `body.userId`, not
   * to the Account id, not to "any User in this workspace", and not to a null
   * actor. An AHSP fact with no trustworthy author must not come into
   * existence at all — an unattributable record is worse than a refused one,
   * because it is indistinguishable from an attributable one later.
   */
  async resolveActorUserId(workspaceContext: unknown): Promise<string> {
    const context = workspaceContext as
      | { workspaceId?: unknown; membershipId?: unknown }
      | undefined;
    const workspaceId = context?.workspaceId;
    const membershipId = context?.membershipId;

    if (typeof workspaceId !== 'string' || typeof membershipId !== 'string') {
      throw new BadRequestException('AHSP_WORKSPACE_CONTEXT_REQUIRED');
    }

    // Each ACTIVE predicate is asserted here rather than assumed from the
    // guard: the guard proves the caller may act in this workspace, which is a
    // different question from whether this membership still has a live human
    // profile to attribute the fact to. The membership's own workspaceId is
    // re-checked too, so a context whose two halves disagree cannot resolve.
    const actor = await this.prisma.user.findFirst({
      where: {
        workspaceMembershipId: membershipId,
        workspaceId,
        status: 'ACTIVE',
        membership: {
          status: 'ACTIVE',
          workspaceId,
          account: { status: 'ACTIVE' },
        },
      },
      select: { id: true },
    });

    if (!actor) {
      throw new ForbiddenException('NO_TRUSTED_USER_PROFILE');
    }

    return actor.id;
  }
}
