import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface ProjectAccessContext {
  projectId: string;
  workspaceId: string;
  projectStatus: string;
  membershipId: string;
  assignmentId: string;
  roleInProject: string;
  isPrimaryAssignment: boolean;
  roles: string[];
}

export type ProjectAccessResolution =
  | {
      kind: 'GRANTED';
      context: ProjectAccessContext;
    }
  | {
      kind: 'PROJECT_NOT_FOUND' | 'MEMBERSHIP_NOT_FOUND' | 'ASSIGNMENT_REQUIRED';
    };

@Injectable()
export class ProjectAccessPolicyService {
  constructor(private readonly prisma: PrismaService) {}

  private async findEligibleMembership(accountId: string, workspaceId: string) {
    const membership = await this.prisma.workspaceMembership.findUnique({
      where: {
        accountId_workspaceId: {
          accountId,
          workspaceId,
        },
      },
      include: {
        userProfile: true,
        membershipRoles: {
          where: { isActive: true },
          include: {
            role: true,
          },
        },
      },
    });

    if (
      !membership ||
      membership.status !== 'ACTIVE' ||
      !membership.userProfile
    ) {
      return null;
    }

    return membership;
  }

  private buildActiveAssignmentWhere(
    membershipId: string,
    workspaceId: string,
    projectId?: string,
  ): Prisma.ProjectAssignmentWhereInput {
    return {
      workspaceMembershipId: membershipId,
      status: 'ASSIGNED',
      ...(projectId ? { projectId } : {}),
      project: {
        workspaceId,
      },
    };
  }

  /**
   * Canonical assignment predicate for both project-scoped guard checks and
   * the accessible-project list. Keeping the membership eligibility and
   * ProjectAssignment query in one function prevents guard/list drift.
   */
  private async findAssignedAccess(
    accountId: string,
    workspaceId: string,
    projectId?: string,
  ) {
    const membership = await this.findEligibleMembership(accountId, workspaceId);

    if (!membership) {
      return null;
    }

    const assignments = await this.prisma.projectAssignment.findMany({
      where: this.buildActiveAssignmentWhere(
        membership.id,
        workspaceId,
        projectId,
      ),
      include: {
        project: true,
      },
      orderBy: {
        assignedAt: 'desc',
      },
    });

    return {
      membership,
      assignments,
    };
  }

  async resolveProjectAccess(
    accountId: string,
    projectId: string,
  ): Promise<ProjectAccessResolution> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, workspaceId: true, status: true },
    });

    if (!project) {
      return { kind: 'PROJECT_NOT_FOUND' };
    }

    const access = await this.findAssignedAccess(
      accountId,
      project.workspaceId,
      project.id,
    );

    if (!access) {
      return { kind: 'MEMBERSHIP_NOT_FOUND' };
    }

    const assignment = access.assignments[0];

    if (!assignment) {
      return { kind: 'ASSIGNMENT_REQUIRED' };
    }

    return {
      kind: 'GRANTED',
      context: {
        projectId: project.id,
        workspaceId: project.workspaceId,
        projectStatus: project.status,
        membershipId: access.membership.id,
        assignmentId: assignment.id,
        roleInProject: assignment.roleInProject,
        isPrimaryAssignment: assignment.isPrimaryAssignment,
        roles: access.membership.membershipRoles.map(
          (membershipRole) => membershipRole.role.code,
        ),
      },
    };
  }

  async listAccessibleProjects(accountId: string, workspaceId: string) {
    const access = await this.findAssignedAccess(accountId, workspaceId);

    if (!access) {
      return [];
    }

    return access.assignments.map((assignment) => ({
      ...assignment.project,
      access: {
        assignmentId: assignment.id,
        roleInProject: assignment.roleInProject,
        isPrimaryAssignment: assignment.isPrimaryAssignment,
        assignedAt: assignment.assignedAt,
      },
    }));
  }
}
