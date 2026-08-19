import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { ProjectAccessContext } from '../auth/project-access-policy.service';

export const PROGRESS_AUTHORITIES = {
  VERIFY: 'FIELD_PROGRESS_VERIFY',
  CORRECT: 'FIELD_PROGRESS_CORRECT',
  ACCEPT: 'FIELD_PROGRESS_ACCEPT',
} as const;

export const PROGRESS_APPROVAL_POLICY_OBJECTS = {
  VERIFY_COMBINED_RESPONSIBILITY:
    'FIELD_PROGRESS_VERIFY_COMBINED_RESPONSIBILITY',
  ACCEPT_COMBINED_RESPONSIBILITY:
    'FIELD_PROGRESS_ACCEPT_COMBINED_RESPONSIBILITY',
} as const;

type ProgressApprovalAction = 'VERIFY' | 'ACCEPT';

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
                    some: {
                      isActive: true,
                      revokedAt: null,
                      authority: { code: authorityCode },
                    },
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
                    AND project_assignment."revokedAt" IS NULL
                  LIMIT 1
                  FOR SHARE OF wm, account, profile, project_assignment`,
    );
    if (rows.length !== 1) {
      const assignment = await tx.projectAssignment.findFirst({
        where: {
          id: projectAccess.assignmentId,
          workspaceMembershipId: projectAccess.membershipId,
          projectId: projectAccess.projectId,
        },
        select: { status: true, revokedAt: true },
      });
      if (
        assignment &&
        (assignment.status !== 'ASSIGNED' || assignment.revokedAt !== null)
      ) {
        throw new ForbiddenException('PROJECT_ASSIGNMENT_REVOKED');
      }
      throw new ForbiddenException('ACTIVE_PROJECT_ACTOR_REQUIRED');
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
                    AND project_assignment."revokedAt" IS NULL
                    AND assignment."isActive" = TRUE
                    AND assignment."removedAt" IS NULL
                    AND position."workspaceId" = ${projectAccess.workspaceId}::uuid
                    AND grant_row."isActive" = TRUE
                    AND grant_row."revokedAt" IS NULL
                    AND authority."code" = ${authorityCode}
                  ORDER BY assignment."assignedAt" ASC
                  LIMIT 1
                  FOR SHARE OF wm, account, profile, project_assignment, assignment, position, grant_row, authority`,
    );
    const row = rows[0];
    if (!row) {
      const assignment = await tx.projectAssignment.findFirst({
        where: {
          id: projectAccess.assignmentId,
          workspaceMembershipId: projectAccess.membershipId,
          projectId: projectAccess.projectId,
        },
        select: { status: true, revokedAt: true },
      });
      if (
        assignment &&
        (assignment.status !== 'ASSIGNED' || assignment.revokedAt !== null)
      ) {
        throw new ForbiddenException('PROJECT_ASSIGNMENT_REVOKED');
      }

      const revokedAuthority = await tx.positionAuthority.findFirst({
        where: {
          position: {
            workspaceId: projectAccess.workspaceId,
            assignments: {
              some: {
                isActive: true,
                removedAt: null,
                user: {
                  workspaceMembershipId: projectAccess.membershipId,
                },
              },
            },
          },
          authority: { code: authorityCode },
          OR: [{ isActive: false }, { revokedAt: { not: null } }],
        },
        select: { id: true },
      });
      throw new ForbiddenException(
        revokedAuthority
          ? 'DECISION_AUTHORITY_REVOKED'
          : 'DECISION_AUTHORITY_REQUIRED',
      );
    }
    return { ...row, authorityCode };
  }

  private policyObjectType(action: ProgressApprovalAction): string {
    return action === 'VERIFY'
      ? PROGRESS_APPROVAL_POLICY_OBJECTS.VERIFY_COMBINED_RESPONSIBILITY
      : PROGRESS_APPROVAL_POLICY_OBJECTS.ACCEPT_COMBINED_RESPONSIBILITY;
  }

  private async combinedResponsibilityAllowed(
    db: Prisma.TransactionClient | PrismaService,
    projectAccess: ProjectAccessContext,
    authority: ProgressAuthorityContext,
    action: ProgressApprovalAction,
  ): Promise<boolean> {
    return (
      (await db.approvalMatrix.count({
        where: {
          workspaceId: projectAccess.workspaceId,
          isActive: true,
          objectType: this.policyObjectType(action),
          requiredPositionId: authority.positionId,
          authority: { code: authority.authorityCode },
        },
      })) > 0
    );
  }

  async canCombineResponsibility(
    projectAccess: ProjectAccessContext,
    authority: ProgressAuthorityContext,
    action: ProgressApprovalAction,
  ): Promise<boolean> {
    return this.combinedResponsibilityAllowed(
      this.prisma,
      projectAccess,
      authority,
      action,
    );
  }

  async requireSeparationPolicy(
    tx: Prisma.TransactionClient,
    projectAccess: ProjectAccessContext,
    authority: ProgressAuthorityContext,
    action: ProgressApprovalAction,
    actorAccountId: string,
    priorActorAccountIds: Array<string | null | undefined>,
  ): Promise<void> {
    const crossesOwnStage = priorActorAccountIds.some(
      (priorActorAccountId) => priorActorAccountId === actorAccountId,
    );
    if (!crossesOwnStage) return;
    if (
      await this.combinedResponsibilityAllowed(
        tx,
        projectAccess,
        authority,
        action,
      )
    ) {
      return;
    }
    throw new ForbiddenException('SEPARATION_OF_DUTIES_DENIED');
  }
}
