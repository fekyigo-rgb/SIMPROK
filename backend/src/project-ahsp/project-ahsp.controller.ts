import {
  Body,
  Controller,
  Get,
  InternalServerErrorException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { ProjectAccessGuard } from '../auth/guards/project-access.guard';
import { PERMISSIONS } from '../common/constants/permissions';
import {
  Permissions,
  PermissionsAll,
} from '../common/decorators/permissions.decorator';
import { SelectAhspForBoqItemDto } from './dto/create-project-ahsp-occurrence.dto';
import { ProjectAhspService } from './project-ahsp.service';

interface ProjectAhspRequest {
  user?: { id?: string };
  projectAccess?: { workspaceId?: string };
}

@Controller('projects/:projectId/ahsp-occurrences')
@UseGuards(JwtAuthGuard, ProjectAccessGuard, PermissionsGuard)
export class ProjectAhspController {
  constructor(private readonly service: ProjectAhspService) {}

  @Get('eligible-versions')
  @Permissions(PERMISSIONS.AHSP_VIEW)
  listEligibleVersions(
    @Req() request: ProjectAhspRequest,
    @Query('businessPricingAsOfDate') asOf: string,
  ) {
    return this.service.listEligibleVersions(this.workspaceId(request), asOf);
  }

  @Get('regions')
  @Permissions(PERMISSIONS.BASIC_PRICE_VIEW)
  listRegions() {
    return this.service.listActiveRegions();
  }

  @Post('boq-items/:boqItemId/select-ahsp')
  @PermissionsAll(PERMISSIONS.RAB_DRAFT_EDIT, PERMISSIONS.AHSP_VIEW)
  selectForBoqItem(
    @Req() request: ProjectAhspRequest,
    @Param('projectId') projectId: string,
    @Param('boqItemId') boqItemId: string,
    @Body() body: SelectAhspForBoqItemDto,
  ) {
    const accountId = request.user?.id;
    if (!accountId) {
      throw new InternalServerErrorException('Trusted account context is missing');
    }
    return this.service.selectForBoqItem({
      projectId,
      boqItemId,
      workspaceId: this.workspaceId(request),
      accountId,
      ...body,
    });
  }

  @Get(':occurrenceId')
  @Permissions(PERMISSIONS.AHSP_VIEW)
  findOne(
    @Req() request: ProjectAhspRequest,
    @Param('projectId') projectId: string,
    @Param('occurrenceId') occurrenceId: string,
  ) {
    return this.service.findOne(
      occurrenceId,
      projectId,
      this.workspaceId(request),
    );
  }

  private workspaceId(request: ProjectAhspRequest): string {
    const workspaceId = request.projectAccess?.workspaceId;
    if (!workspaceId) {
      throw new InternalServerErrorException(
        'Trusted project access context is missing',
      );
    }
    return workspaceId;
  }
}
