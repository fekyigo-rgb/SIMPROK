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
import { Permissions } from '../common/decorators/permissions.decorator';
import { RabAutoPriceReadyService } from './rab-auto-price-ready.service';

/** A single RAB-level action; no per-resource user microapproval. */
@Controller('projects/:projectId/rab')
@UseGuards(JwtAuthGuard, ProjectAccessGuard, PermissionsGuard)
export class RabAutoPriceReadyController {
  constructor(private readonly service: RabAutoPriceReadyService) {}

  @Post('auto-price-ready')
  @Permissions(PERMISSIONS.RAB_DRAFT_EDIT)
  execute(
    @Req() request: { projectAccess?: { workspaceId?: string } },
    @Param('projectId') projectId: string,
    @Body() body: { calculationAsOfDate?: string },
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const workspaceId = request.projectAccess?.workspaceId;
    if (!workspaceId)
      throw new InternalServerErrorException('PROJECT_WORKSPACE_MISSING');
    return this.service.execute({
      projectId,
      workspaceId,
      calculationAsOfDate: body?.calculationAsOfDate ?? '',
      page,
      limit,
    });
  }
}
