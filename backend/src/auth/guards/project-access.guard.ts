import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ProjectAccessPolicyService } from '../project-access-policy.service';

/*
 * Apply on project-scoped controllers AFTER JwtAuthGuard, e.g.:
 * @UseGuards(JwtAuthGuard, ProjectAccessGuard)
 * Do not register globally (not all routes are project-scoped).
 */
@Injectable()
export class ProjectAccessGuard implements CanActivate {
  constructor(private readonly accessPolicy: ProjectAccessPolicyService) {}

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

      throw new ForbiddenException('Project assignment required');
    }

    request.projectAccess = resolution.context;
    return true;
  }
}
