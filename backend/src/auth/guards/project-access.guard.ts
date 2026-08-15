import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, ProgressAuditOutcome } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { ProjectAccessPolicyService } from '../project-access-policy.service';
import { PrismaService } from '../../prisma/prisma.service';

/*
 * Apply on project-scoped controllers AFTER JwtAuthGuard, e.g.:
 * @UseGuards(JwtAuthGuard, ProjectAccessGuard)
 * Do not register globally (not all routes are project-scoped).
 */
@Injectable()
export class ProjectAccessGuard implements CanActivate {
  constructor(
    private readonly accessPolicy: ProjectAccessPolicyService,
    @Optional() private readonly prisma?: PrismaService,
  ) {}

  private progressWriteAction(request: any): string | null {
    if (request.method !== 'POST') return null;
    const path = `${request.route?.path ?? request.originalUrl ?? request.url}`;
    if (!path.includes('/progress')) return null;
    if (path.includes('/field')) return 'ACTUAL_SUBMIT';
    if (path.includes('/corrections')) return 'ACTUAL_CORRECT';
    if (path.includes('/verify')) return 'ACTUAL_VERIFY';
    if (path.includes('/accept')) return 'ACTUAL_ACCEPT';
    return null;
  }

  private progressTarget(request: any, projectId: string): {
    targetEntityType: string;
    targetEntityId: string;
  } {
    const uuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const entryId = request.params?.entryId;
    if (typeof entryId === 'string' && uuid.test(entryId)) {
      return { targetEntityType: 'PROGRESS_ENTRY', targetEntityId: entryId };
    }
    return { targetEntityType: 'PROJECT', targetEntityId: projectId };
  }

  private async auditAssignmentDenied(params: {
    request: any;
    accountId: string;
    projectId: string;
    action: string;
  }): Promise<void> {
    if (!this.prisma) {
      throw new ServiceUnavailableException('DENIAL_AUDIT_UNAVAILABLE');
    }
    const project = await this.prisma.project.findUnique({
      where: { id: params.projectId },
      select: { id: true, workspaceId: true },
    });
    if (!project) return;

    const membership = await this.prisma.workspaceMembership.findFirst({
      where: {
        accountId: params.accountId,
        workspaceId: project.workspaceId,
        status: 'ACTIVE',
        userProfile: { status: 'ACTIVE' },
      },
      select: { id: true },
    });
    if (!membership) return;

    const commandId =
      typeof params.request.body?.commandId === 'string'
        ? params.request.body.commandId
        : undefined;
    const target = this.progressTarget(params.request, project.id);

    try {
      await this.prisma.progressAuditEvent.create({
        data: {
          schemaVersion: 1,
          eventType: 'ACTUAL_PROGRESS',
          outcome: ProgressAuditOutcome.DENIED,
          workspaceId: project.workspaceId,
          projectId: project.id,
          progressEntryId: null,
          actorAccountId: params.accountId,
          actorMembershipId: membership.id,
          actorType: 'HUMAN',
          sourceModule: 'FIELD_PROGRESS',
          targetEntityType: target.targetEntityType,
          targetEntityId: target.targetEntityId,
          correlationId: randomUUID(),
          requestId: randomUUID(),
          businessCommandId: commandId,
          commandId,
          action: params.action,
          reason: 'PROJECT_ASSIGNMENT_DENIED',
          reasonCode: 'PROJECT_ASSIGNMENT_DENIED',
          reasonText:
            'The actor is not actively assigned to this project for the requested progress action.',
          metadata: { guard: 'ProjectAccessGuard' },
          occurredAt: new Date(),
          recordedAt: new Date(),
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return;
      }
      throw new ServiceUnavailableException('DENIAL_AUDIT_UNAVAILABLE');
    }
  }

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

    const resolution = await this.accessPolicy.resolveProjectAccess(
      accountId,
      projectId,
    );

    if (resolution.kind !== 'GRANTED') {
      if (
        resolution.kind === 'PROJECT_NOT_FOUND' ||
        resolution.kind === 'MEMBERSHIP_NOT_FOUND'
      ) {
        throw new NotFoundException('Project not found');
      }

      const action = this.progressWriteAction(request);
      if (action) {
        await this.auditAssignmentDenied({
          request,
          accountId,
          projectId,
          action,
        });
      }
      throw new ForbiddenException('Project assignment required');
    }

    request.projectAccess = resolution.context;
    return true;
  }
}
