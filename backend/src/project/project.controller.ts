import { Controller, Post, Body, Get, Param, Req, UseGuards } from '@nestjs/common';
import { ProjectService } from './project.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { InitiateProjectDto } from './dto/initiate-project.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ProjectAccessGuard } from '../auth/guards/project-access.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';

@Controller('projects')
@UseGuards(JwtAuthGuard)
export class ProjectController {
  constructor(private readonly projectService: ProjectService) {}

  @Post()
  @UseGuards(PermissionsGuard)
  @Permissions('PROJECT_CREATE')
  async create(@Body() createProjectDto: CreateProjectDto) {
    return this.projectService.create(createProjectDto);
  }

  @Post(':projectId/initiate')
  @UseGuards(ProjectAccessGuard, PermissionsGuard)
  @Permissions('PROJECT_CREATE')
  async initiateSetup(
    @Param('projectId') projectId: string,
    @Body() initiateProjectDto: InitiateProjectDto,
  ) {
    return this.projectService.initiateSetup(projectId, initiateProjectDto);
  }

  @Get()
  @UseGuards(PermissionsGuard)
  @Permissions('PROJECT_VIEW')
  async findAllGlobal(@Req() request: any) {
    return this.projectService.findAllByWorkspace(
      request.workspaceContext.workspaceId,
    );
  }

  @Get('workspace/:workspaceId')
  @UseGuards(PermissionsGuard)
  @Permissions('PROJECT_VIEW')
  async findAll(@Param('workspaceId') workspaceId: string) {
    return this.projectService.findAllByWorkspace(workspaceId);
  }

  @Get(':projectId')
  @UseGuards(ProjectAccessGuard, PermissionsGuard)
  @Permissions('PROJECT_VIEW')
  async findOne(@Param('projectId') projectId: string) {
    return this.projectService.findOne(projectId);
  }

  @Get(':projectId/reality')
  @UseGuards(ProjectAccessGuard, PermissionsGuard)
  @Permissions('PROJECT_VIEW')
  async getReality(@Param('projectId') projectId: string) {
    return this.projectService.getReality(projectId);
  }

  @Get(':projectId/horizon')
  @UseGuards(ProjectAccessGuard, PermissionsGuard)
  @Permissions('PROJECT_VIEW')
  async getHorizon(@Param('projectId') projectId: string) {
    return this.projectService.getHorizon(projectId);
  }

  @Get(':projectId/storm')
  @UseGuards(ProjectAccessGuard, PermissionsGuard)
  @Permissions('PROJECT_VIEW')
  async getStorm(@Param('projectId') projectId: string) {
    return this.projectService.getStorm(projectId);
  }

  @Get(':projectId/wisdom')
  @UseGuards(ProjectAccessGuard, PermissionsGuard)
  @Permissions('PROJECT_VIEW')
  async getWisdom(@Param('projectId') projectId: string) {
    return this.projectService.getWisdom(projectId);
  }

  @Get(':projectId/authority')
  @UseGuards(ProjectAccessGuard, PermissionsGuard)
  @Permissions('PROJECT_VIEW')
  async getAuthority(@Param('projectId') projectId: string) {
    return this.projectService.getAuthority(projectId);
  }

  @Get(':projectId/boq')
  @UseGuards(ProjectAccessGuard, PermissionsGuard)
  @Permissions('PROJECT_VIEW')
  async getBoq(@Param('projectId') projectId: string) {
    return this.projectService.getBoq(projectId);
  }
}
