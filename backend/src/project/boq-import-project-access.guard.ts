import { CanActivate, ExecutionContext, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ProjectAccessPolicyService } from '../auth/project-access-policy.service';

@Injectable()
export class BoqImportProjectAccessGuard implements CanActivate {
  constructor(private readonly accessPolicy: ProjectAccessPolicyService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    if (!request.user?.id) throw new UnauthorizedException('Authenticated account required');
    const resolution = await this.accessPolicy.resolveProjectAccess(request.user.id, request.params?.projectId);
    if (resolution.kind !== 'GRANTED') throw new NotFoundException('Project not found');
    request.projectAccess = resolution.context;
    return true;
  }
}
