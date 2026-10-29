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
import { RabAutoFirstBindService } from './rab-auto-first-bind.service';

/** A governed RAB-level action; never a side-effect of GET/readiness. */
@Controller('projects/:projectId/ahsp-occurrences/boq-items')
@UseGuards(JwtAuthGuard, ProjectAccessGuard, PermissionsGuard)
export class RabAutoFirstBindController {
  constructor(private readonly service: RabAutoFirstBindService) {}

  @Post('working-draft/auto-bind-explicit-references')
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
