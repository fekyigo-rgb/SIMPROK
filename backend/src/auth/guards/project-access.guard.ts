import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/*
 * Apply on project-scoped controllers AFTER JwtAuthGuard, e.g.:
 * @UseGuards(JwtAuthGuard, ProjectAccessGuard)
 * Do not register globally (not all routes are project-scoped).
 */
@Injectable()
export class ProjectAccessGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const accountId = request.user?.id;

    if (!accountId) {
      throw new UnauthorizedException(
        'ProjectAccessGuard requires an authenticated account context',
      );
    }

    const projectId = request.params?.projectId;

    if (!projectId) {
      throw new Error(
        'ProjectAccessGuard may only be used on project-scoped routes (/projects/:projectId/...).',
      );
    }

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, workspaceId: true, status: true },
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    const membership = await this.prisma.workspaceMembership.findUnique({
      where: {
        accountId_workspaceId: {
          accountId,
          workspaceId: project.workspaceId,
        },
      },
      include: {
        userProfile: true,
        membershipRoles: {
          include: {
            role: true,
          },
        },
      },
    });

    if (!membership || membership.status !== 'ACTIVE') {
      throw new NotFoundException('Project not found');
    }

    const user = membership.userProfile;

    if (!user) {
      throw new NotFoundException('Project not found');
    }

    const assignment = await this.prisma.projectAssignment.findUnique({
      where: {
        workspaceMembershipId_projectId: {
          workspaceMembershipId: membership.id,
          projectId: project.id,
        },
      },
    });

    if (!assignment || assignment.status !== 'ASSIGNED') {
      throw new ForbiddenException('Project assignment required');
    }

    // TODO: Add admin bypass + AdminBypassUsed audit event when persistent project-access audit exists.
    // TODO: Enforce No-Orphan / INV-006 primary-PM rules when ProjectAssignment.isPrimaryAssignment exists.
    // TODO: Enforce lifecycle write restrictions when the final ProjectStatus matrix is available.
    request.projectAccess = {
      projectId: project.id,
      workspaceId: project.workspaceId,
      projectStatus: project.status,
      membershipId: membership.id,
      assignmentId: assignment.id,
      roleInProject: assignment.roleInProject,
      isPrimaryAssignment: assignment.isPrimaryAssignment,
      roles: membership.membershipRoles.map((mr) => mr.role.code),
    };

    return true;
  }
}
