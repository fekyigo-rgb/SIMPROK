import {
  Body,
  Controller,
  InternalServerErrorException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ProjectAccessGuard } from '../auth/guards/project-access.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PERMISSIONS } from '../common/constants/permissions';
import { PermissionsAll } from '../common/decorators/permissions.decorator';
import { RabAutoProvenReuseService } from './rab-auto-04-reuse.service';

/** One scoped project action, not a mutation performed by GET / readiness. */
@Controller('projects/:projectId/ahsp-occurrences/boq-items')
@UseGuards(JwtAuthGuard, ProjectAccessGuard, PermissionsGuard)
export class RabAutoProvenReuseController {
  constructor(private readonly service: RabAutoProvenReuseService) {}

  @Post('working-draft/auto-reuse-proven')
  @PermissionsAll(PERMISSIONS.AHSP_VIEW, PERMISSIONS.RAB_DRAFT_EDIT)
  execute(
    @Req()
    request: {
      user?: { id?: string };
      projectAccess?: { workspaceId?: string };
    },
    @Param('projectId') projectId: string,
    @Body() body: { businessPricingAsOfDate?: string },
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const workspaceId = request.projectAccess?.workspaceId;
    const accountId = request.user?.id;
    if (!workspaceId || !accountId) {
      throw new InternalServerErrorException('TRUSTED_PROJECT_ACTOR_REQUIRED');
    }
    return this.service.execute({
      projectId,
      workspaceId,
      accountId,
      businessPricingAsOfDate: body?.businessPricingAsOfDate ?? '',
      page,
      limit,
    });
  }
}
