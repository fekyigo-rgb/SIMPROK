import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { ProjectAccessContext } from '../auth/project-access-policy.service';

export const PROGRESS_AUTHORITIES = {
  VERIFY: 'FIELD_PROGRESS_VERIFY',
  CORRECT: 'FIELD_PROGRESS_CORRECT',
  ACCEPT: 'FIELD_PROGRESS_ACCEPT',
} as const;

export interface ProgressAuthorityContext {
  positionId: string;
  positionCode: string;
  authorityCode: string;
}

export interface TransactionalProjectActor {
  roleInProject: string;
}

@Injectable()
export class ProgressAuthorityService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(
    accountId: string,
    projectAccess: ProjectAccessContext,
    authorityCode: string,
  ): Promise<ProgressAuthorityContext | null> {
    const membership = await this.prisma.workspaceMembership.findFirst({
      where: {
        id: projectAccess.membershipId,
        accountId,
        workspaceId: projectAccess.workspaceId,
        status: 'ACTIVE',
      },
      select: {
        userProfile: {
          select: {
            status: true,
            positionAssignments: {
              where: {
                isActive: true,
                removedAt: null,
                position: {
                  workspaceId: projectAccess.workspaceId,
                  positionAuthorities: {
                    some: { authority: { code: authorityCode } },
                  },
                },
              },
              select: {
                position: { select: { id: true, code: true } },
              },
              orderBy: { assignedAt: 'asc' },
              take: 1,
            },
          },
        },
      },
    });

    const assignment = membership?.userProfile?.positionAssignments[0];
    if (membership?.userProfile?.status !== 'ACTIVE' || !assignment) {
      return null;
    }

    return {
      positionId: assignment.position.id,
      positionCode: assignment.position.code,
      authorityCode,
    };
  }

  async require(
    accountId: string,
    projectAccess: ProjectAccessContext,
    authorityCode: string,
  ): Promise<ProgressAuthorityContext> {
    const authority = await this.resolve(
      accountId,
      projectAccess,
      authorityCode,
    );
    if (!authority) {
      throw new ForbiddenException('Configured project authority required');
    }
    return authority;
  }

  async requireActiveActor(
    tx: Prisma.TransactionClient,
    accountId: string,
    projectAccess: ProjectAccessContext,
  ): Promise<TransactionalProjectActor> {
    const rows = await tx.$queryRaw<Array<TransactionalProjectActor>>(
      Prisma.sql`SELECT project_assignment."roleInProject" AS "roleInProject"
                   FROM "workspace_memberships" wm
                   JOIN "accounts" account ON account."id" = wm."accountId"
                   JOIN "users" profile ON profile."workspaceMembershipId" = wm."id"
                   JOIN "project_assignments" project_assignment ON project_assignment."workspaceMembershipId" = wm."id"
                  WHERE wm."id" = ${projectAccess.membershipId}::uuid
                    AND wm."accountId" = ${accountId}::uuid
                    AND wm."workspaceId" = ${projectAccess.workspaceId}::uuid
                    AND wm."status" = 'ACTIVE'
                    AND account."status" = 'ACTIVE'
                    AND profile."status" = 'ACTIVE'
                    AND project_assignment."id" = ${projectAccess.assignmentId}::uuid
                    AND project_assignment."projectId" = ${projectAccess.projectId}::uuid
                    AND project_assignment."status" = 'ASSIGNED'
                  LIMIT 1
                  FOR SHARE OF wm, account, profile, project_assignment`,
    );
    if (rows.length !== 1) {
      throw new ForbiddenException('Active trusted actor required');
    }
    return rows[0];
  }

  async requireWithinTransaction(
    tx: Prisma.TransactionClient,
    accountId: string,
    projectAccess: ProjectAccessContext,
    authorityCode: string,
  ): Promise<ProgressAuthorityContext> {
    const rows = await tx.$queryRaw<
      Array<{ positionId: string; positionCode: string }>
    >(
      Prisma.sql`SELECT position."id" AS "positionId", position."code" AS "positionCode"
                   FROM "workspace_memberships" wm
                   JOIN "accounts" account ON account."id" = wm."accountId"
                   JOIN "users" profile ON profile."workspaceMembershipId" = wm."id"
                   JOIN "project_assignments" project_assignment ON project_assignment."workspaceMembershipId" = wm."id"
                   JOIN "position_assignments" assignment ON assignment."userId" = profile."id"
                   JOIN "positions" position ON position."id" = assignment."positionId"
                   JOIN "position_authorities" grant_row ON grant_row."positionId" = position."id"
                   JOIN "authorities" authority ON authority."id" = grant_row."authorityId"
                  WHERE wm."id" = ${projectAccess.membershipId}::uuid
                    AND wm."accountId" = ${accountId}::uuid
                    AND wm."workspaceId" = ${projectAccess.workspaceId}::uuid
                    AND wm."status" = 'ACTIVE'
                    AND account."status" = 'ACTIVE'
                    AND profile."status" = 'ACTIVE'
                    AND project_assignment."id" = ${projectAccess.assignmentId}::uuid
                    AND project_assignment."projectId" = ${projectAccess.projectId}::uuid
                    AND project_assignment."status" = 'ASSIGNED'
                    AND assignment."isActive" = TRUE
                    AND assignment."removedAt" IS NULL
                    AND position."workspaceId" = ${projectAccess.workspaceId}::uuid
                    AND authority."code" = ${authorityCode}
                  ORDER BY assignment."assignedAt" ASC
                  LIMIT 1
                  FOR SHARE OF wm, account, profile, project_assignment, assignment, position, grant_row, authority`,
    );
    const row = rows[0];
    if (!row) {
      throw new ForbiddenException('Configured project authority required');
    }
    return { ...row, authorityCode };
  }
}
