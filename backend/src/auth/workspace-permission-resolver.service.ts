import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ACTIVE_MEMBERSHIP_BASELINE_PERMISSION_CODES } from '../common/constants/permissions';

export interface EffectivePermissions {
  membershipId: string;
  permissions: string[];
}

/**
 * Canonical, single authority for "which permission codes does this account
 * effectively hold in this workspace right now". PermissionsGuard and
 * GET /auth/capabilities both call this — no second RBAC query is allowed to
 * exist alongside it, so the two can never drift.
 *
 * Semantics (do not weaken without an Owner/Architect decision):
 *   - WorkspaceMembership must belong to this exact account + workspace and
 *     be ACTIVE.
 *   - MembershipRole must be isActive and not past its endDate.
 *   - Effective permissions = ACTIVE_MEMBERSHIP_BASELINE_PERMISSION_CODES
 *     (Owner Decision: ONE SIMPROK BASIC PRICE PRODUCT MODEL — every ACTIVE
 *     membership, any role/custom-role/no-role, gets Basic Price's own
 *     catalog + own-import baseline) UNIONED with whatever RolePermission
 *     grants on top. Role codes themselves are never treated as
 *     permissions. Internal curation codes (BASIC_PRICE_REVIEW_VIEW/
 *     _VERIFY/_PUBLISH) are deliberately excluded from the baseline and
 *     remain strictly role-granted — this precedent does not extend to any
 *     other permission without a new Owner decision.
 *   - No cross-workspace leakage: the query is scoped to one workspaceId.
 *   - No fallback: a missing/inactive membership resolves to null, which
 *     callers must treat as denied, never as an empty-but-granted result.
 */
@Injectable()
export class WorkspacePermissionResolverService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(
    accountId: string,
    workspaceId: string,
  ): Promise<EffectivePermissions | null> {
    const membership = await this.prisma.workspaceMembership.findFirst({
      where: {
        accountId,
        workspaceId,
        status: 'ACTIVE',
      },
      select: {
        id: true,
        membershipRoles: {
          where: {
            isActive: true,
            OR: [{ endDate: null }, { endDate: { gte: new Date() } }],
          },
          select: {
            role: {
              select: {
                rolePermissions: {
                  select: {
                    permission: {
                      select: { code: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!membership) {
      return null;
    }

    const roleGrantedCodes = membership.membershipRoles.flatMap(
      (membershipRole) =>
        membershipRole.role.rolePermissions.map(
          (rolePermission) => rolePermission.permission.code,
        ),
    );

    const codes = [
      ...ACTIVE_MEMBERSHIP_BASELINE_PERMISSION_CODES,
      ...roleGrantedCodes,
    ];

    return {
      membershipId: membership.id,
      permissions: Array.from(new Set(codes)).sort(),
    };
  }
}
