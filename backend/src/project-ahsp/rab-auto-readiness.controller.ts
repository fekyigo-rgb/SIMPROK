import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { ProjectAccessGuard } from '../auth/guards/project-access.guard';
import { PERMISSIONS } from '../common/constants/permissions';
import { PermissionsAll } from '../common/decorators/permissions.decorator';
import { RabAutoReadinessService } from './rab-auto-readiness.service';

/**
 * The existing project guards grant access to this READ-ONLY readiness gate.
 * No pricing mutation routes are added by RAB-AUTO-02.
 */
@Controller('projects/:projectId/ahsp-occurrences/boq-items')
@UseGuards(JwtAuthGuard, ProjectAccessGuard, PermissionsGuard)
export class RabAutoReadinessController {
  constructor(private readonly service: RabAutoReadinessService) {}

  @Get('working-draft/automation-readiness')
  @PermissionsAll(PERMISSIONS.AHSP_VIEW, PERMISSIONS.RAB_VIEW)
  assessDraft(
    @Req() request: { projectAccess?: { workspaceId?: string } },
    @Param('projectId') projectId: string,
    @Query('businessPricingAsOfDate') asOf: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.assessDraft({
      workspaceId: request.projectAccess?.workspaceId ?? '',
      projectId,
      businessPricingAsOfDate: asOf,
      page,
      limit,
    });
  }

  @Get(':boqItemId/automation-readiness')
  @PermissionsAll(PERMISSIONS.AHSP_VIEW, PERMISSIONS.RAB_VIEW)
  assess(
    @Req() request: { projectAccess?: { workspaceId?: string } },
    @Param('projectId') projectId: string,
    @Param('boqItemId') boqItemId: string,
    @Query('businessPricingAsOfDate') asOf: string,
  ) {
    return this.service.assess({
      workspaceId: request.projectAccess?.workspaceId ?? '',
      projectId,
      boqItemId,
      businessPricingAsOfDate: asOf,
    });
  }
}
