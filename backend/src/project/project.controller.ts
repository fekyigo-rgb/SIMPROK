import {
  Controller,
  Post,
  Put,
  Patch,
  Body,
  Get,
  Param,
  Query,
  Req,
  UseGuards,
  ForbiddenException,
  BadRequestException,
  InternalServerErrorException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ProjectService } from './project.service';
import { RabIntelligenceProposalService } from './rab-intelligence-proposal.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { InitiateProjectDto } from './dto/initiate-project.dto';
import { SaveDraftBoqDto } from './dto/save-draft-boq.dto';
import { UpdateProjectIntakeContextDto } from './dto/update-project-intake-context.dto';
import { CreateRabIntelligenceProposalDto } from './dto/create-rab-intelligence-proposal.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ProjectAccessGuard } from '../auth/guards/project-access.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { ProjectAccessPolicyService } from '../auth/project-access-policy.service';
import { Permissions } from '../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../common/constants/permissions';
import { CostKernelService } from './cost-kernel.service';
import { BoqImportService, MAX_UPLOAD_BYTES } from './boq-import.service';
import { RabLifecyclePolicyService } from './rab-lifecycle-policy.service';
import { RabEditableLifecycleGuard } from './rab-editable-lifecycle.guard';

@Controller('projects')
@UseGuards(JwtAuthGuard)
export class ProjectController {
  constructor(
    private readonly projectService: ProjectService,
    private readonly rabIntelligenceProposalService: RabIntelligenceProposalService,
    private readonly projectAccessPolicy: ProjectAccessPolicyService,
    private readonly costKernelService: CostKernelService,
    private readonly boqImportService: BoqImportService,
    private readonly rabLifecyclePolicy: RabLifecyclePolicyService,
  ) {}

  @Post(':projectId/boq/import/preview')
  @UseGuards(ProjectAccessGuard, PermissionsGuard, RabEditableLifecycleGuard)
  @Permissions(PERMISSIONS.RAB_VIEW)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }),
  )
  async previewBoqImport(
    @Req() request: any,
    @Param('projectId') projectId: string,
    @UploadedFile() file: any,
    @Body('selectedSheet') selectedSheet?: string,
  ) {
    return this.boqImportService.preview(
      projectId,
      request.projectAccess.workspaceId,
      file,
      selectedSheet,
    );
  }

  @Post(':projectId/boq/import/approve')
  @UseGuards(ProjectAccessGuard, PermissionsGuard, RabEditableLifecycleGuard)
  @Permissions(PERMISSIONS.RAB_DRAFT_EDIT)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }),
  )
  async approveBoqImport(
    @Req() request: any,
    @Param('projectId') projectId: string,
    @UploadedFile() file: any,
    @Body('importFingerprint') fingerprint: string,
    @Body('selectedSheet') selectedSheet?: string,
  ) {
    return this.boqImportService.approve(
      projectId,
      request.projectAccess.workspaceId,
      fingerprint,
      file,
      selectedSheet,
    );
  }

  @Post()
  @UseGuards(PermissionsGuard)
  @Permissions('PROJECT_CREATE')
  async create(
    @Req() request: any,
    @Body() createProjectDto: CreateProjectDto,
  ) {
    const contextWorkspaceId = request.workspaceContext?.workspaceId;
    if (!contextWorkspaceId) {
      throw new BadRequestException('Workspace context is required');
    }
    if (
      createProjectDto.workspaceId &&
      createProjectDto.workspaceId !== contextWorkspaceId
    ) {
      throw new ForbiddenException(
        'Body workspaceId does not match active workspace context',
      );
    }

    const accountId = request.user?.id;
    return this.projectService.create(
      createProjectDto,
      contextWorkspaceId,
      accountId,
    );
  }

  @Post(':projectId/initiate')
  @UseGuards(ProjectAccessGuard, PermissionsGuard)
  @Permissions(PERMISSIONS.RAB_DRAFT_EDIT)
  async initiateSetup(
    @Param('projectId') projectId: string,
    @Body() initiateProjectDto: InitiateProjectDto,
  ) {
    return this.projectService.initiateSetup(projectId, initiateProjectDto);
  }

  @Get()
  @UseGuards(PermissionsGuard)
  @Permissions(PERMISSIONS.OBSERVATORY_VIEW)
  async findAllGlobal(@Req() request: any) {
    return this.projectService.findAllByWorkspace(
      request.workspaceContext.workspaceId,
    );
  }

  @Get('mine')
  @UseGuards(PermissionsGuard)
  @Permissions('PROJECT_VIEW')
  async findMine(@Req() request: any) {
    const contextWorkspaceId = request.workspaceContext?.workspaceId;
    const accountId = request.user?.id;

    if (!contextWorkspaceId) {
      throw new BadRequestException('Workspace context is required');
    }

    if (!accountId) {
      throw new BadRequestException(
        'Authenticated account context is required',
      );
    }

    const projects = await this.projectAccessPolicy.listAccessibleProjects(
      accountId,
      contextWorkspaceId,
    );
    const projectStatusById = new Map(
      projects.map((project) => [project.id, project.status]),
    );
    const rabLifecycleByProjectId = await this.rabLifecyclePolicy.evaluateBatch(
      projects.map((project) => project.id),
      projectStatusById,
    );

    return projects.map((project) => ({
      ...project,
      rabLifecycle: rabLifecycleByProjectId.get(project.id),
    }));
  }

  @Get('workspace/:workspaceId')
  @UseGuards(PermissionsGuard)
  @Permissions(PERMISSIONS.OBSERVATORY_VIEW)
  async findAll(
    @Req() request: any,
    @Param('workspaceId') workspaceId: string,
  ) {
    const contextWorkspaceId = request.workspaceContext?.workspaceId;
    if (!contextWorkspaceId) {
      throw new BadRequestException('Workspace context is required');
    }
    // URL param must match context — reject cross-tenant param override
    if (workspaceId !== contextWorkspaceId) {
      throw new ForbiddenException(
        'Workspace param does not match active workspace context',
      );
    }
    return this.projectService.findAllByWorkspace(contextWorkspaceId);
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

  @Get(':projectId/intake-mode')
  @UseGuards(ProjectAccessGuard, PermissionsGuard)
  @Permissions('PROJECT_VIEW')
  async getIntakeMode(@Param('projectId') projectId: string) {
    return this.projectService.getIntakeMode(projectId);
  }

  @Patch(':projectId/intake-context')
  @UseGuards(ProjectAccessGuard, PermissionsGuard)
  // TODO(P7C-PERMISSION-DEBT): Replace PROJECT_CREATE with a dedicated project intake-context edit permission after Identity/Permission design approval.
  @Permissions('PROJECT_CREATE')
  async updateIntakeContext(
    @Param('projectId') projectId: string,
    @Body() dto: UpdateProjectIntakeContextDto,
  ) {
    return this.projectService.updateIntakeContext(projectId, dto);
  }

  @Get(':projectId/boq')
  @UseGuards(ProjectAccessGuard, PermissionsGuard)
  @Permissions(PERMISSIONS.RAB_VIEW)
  async getBoq(@Param('projectId') projectId: string) {
    return this.projectService.getBoq(projectId);
  }

  @Get(':projectId/boq/draft')
  @UseGuards(ProjectAccessGuard, PermissionsGuard)
  @Permissions(PERMISSIONS.RAB_VIEW)
  async getDraftBoq(
    @Req() request: any,
    @Param('projectId') projectId: string,
  ) {
    const projectStatus = request.projectAccess?.projectStatus;
    if (!projectStatus) {
      throw new InternalServerErrorException(
        'PROJECT_STATUS_MISSING_FROM_ACCESS_CONTEXT',
      );
    }
    return this.projectService.getDraftBoq(projectId, projectStatus);
  }

  @Get(':projectId/boq/items/:boqItemId/cost-calculation')
  @UseGuards(ProjectAccessGuard, PermissionsGuard)
  @Permissions(PERMISSIONS.PROJECT_VIEW)
  async calculateBoqItemCost(
    @Req() request: any,
    @Param('projectId') projectId: string,
    @Param('boqItemId') boqItemId: string,
  ) {
    const workspaceId = request.projectAccess?.workspaceId;
    if (!workspaceId) {
      throw new BadRequestException('Trusted project workspace is required');
    }
    return this.costKernelService.calculateBoqItem(
      boqItemId,
      projectId,
      workspaceId,
    );
  }

  @Get(':projectId/boq/cost-calculations')
  @UseGuards(ProjectAccessGuard, PermissionsGuard)
  @Permissions(PERMISSIONS.PROJECT_VIEW)
  async calculateBoqItemsCost(
    @Req() request: any,
    @Param('projectId') projectId: string,
    @Query('boqItemIds') boqItemIdsParam?: string,
  ) {
    const workspaceId = request.projectAccess?.workspaceId;
    if (!workspaceId) {
      throw new BadRequestException('Trusted project workspace is required');
    }
    const boqItemIds = (boqItemIdsParam ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0);
    return this.costKernelService.calculateBoqItems(
      boqItemIds,
      projectId,
      workspaceId,
    );
  }

  @Put(':projectId/boq/draft')
  @UseGuards(ProjectAccessGuard, PermissionsGuard)
  @Permissions(PERMISSIONS.RAB_DRAFT_EDIT)
  async saveDraftBoq(
    @Param('projectId') projectId: string,
    @Body() dto: SaveDraftBoqDto,
  ) {
    return this.projectService.saveDraftBoq(projectId, dto);
  }

  @Get(':projectId/ahsp-snapshot')
  @UseGuards(ProjectAccessGuard, PermissionsGuard)
  @Permissions('AHSP_VIEW')
  async getAhspSnapshot(@Param('projectId') projectId: string) {
    return this.projectService.getAhspSnapshot(projectId);
  }

  @Post(':projectId/rab-intelligence/proposals')
  @UseGuards(ProjectAccessGuard, PermissionsGuard)
  @Permissions('PROJECT_VIEW')
  async createRabIntelligenceProposal(
    @Req() request: any,
    @Param('projectId') projectId: string,
    @Body() dto: CreateRabIntelligenceProposalDto,
  ) {
    const accountId = request.user?.id;
    return this.rabIntelligenceProposalService.propose(
      projectId,
      accountId,
      dto,
    );
  }
}
