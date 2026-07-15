import {
  Body,
  Controller,
  Get,
  InternalServerErrorException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ProjectAccessGuard } from '../auth/guards/project-access.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../common/constants/permissions';
import { CreateProjectAhspOccurrenceDto } from './dto/create-project-ahsp-occurrence.dto';
import { ProjectAhspService } from './project-ahsp.service';

interface ProjectAhspRequest {
  user?: { id?: string };
  projectAccess?: { workspaceId?: string };
}

@Controller('projects/:projectId/ahsp-occurrences')
@UseGuards(JwtAuthGuard, ProjectAccessGuard, PermissionsGuard)
export class ProjectAhspController {
  constructor(private readonly service: ProjectAhspService) {}

  @Post()
  @Permissions(PERMISSIONS.AHSP_MANAGE)
  create(
    @Req() request: ProjectAhspRequest,
    @Param('projectId') projectId: string,
    @Body() body: CreateProjectAhspOccurrenceDto,
  ) {
    const workspaceId = request.projectAccess?.workspaceId;
    const createdByAccountId = request.user?.id;
    if (!workspaceId || !createdByAccountId) {
      throw new InternalServerErrorException(
        'Trusted project access context is missing',
      );
    }
    return this.service.create({
      projectId,
      workspaceId,
      createdByAccountId,
      ahspVersionId: body.ahspVersionId,
      ahspResourceId: body.ahspResourceId,
      idempotencyKey: body.idempotencyKey,
    });
  }

  @Get(':occurrenceId')
  @Permissions(PERMISSIONS.AHSP_VIEW)
  findOne(
    @Req() request: ProjectAhspRequest,
    @Param('projectId') projectId: string,
    @Param('occurrenceId') occurrenceId: string,
  ) {
    const workspaceId = request.projectAccess?.workspaceId;
    if (!workspaceId) {
      throw new InternalServerErrorException(
        'Trusted project access context is missing',
      );
    }
    return this.service.findOne(occurrenceId, projectId, workspaceId);
  }
}
