import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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
 *   - Permissions come only from RolePermission -> Permission; role codes
 *     are never treated as permissions.
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

    const codes = membership.membershipRoles.flatMap((membershipRole) =>
      membershipRole.role.rolePermissions.map(
        (rolePermission) => rolePermission.permission.code,
      ),
    );

    return {
      membershipId: membership.id,
      permissions: Array.from(new Set(codes)).sort(),
    };
  }
}
