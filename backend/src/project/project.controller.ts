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
  UsePipes,
  ValidationPipe,
  ForbiddenException,
  BadRequestException,
  InternalServerErrorException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ProjectStatus } from '@prisma/client';
import { ProjectService } from './project.service';
import { RabIntelligenceProposalService } from './rab-intelligence-proposal.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { InitiateProjectDto } from './dto/initiate-project.dto';
import { SaveDraftBoqDto } from './dto/save-draft-boq.dto';
import { PersistBoqItemCalculationDto } from './dto/persist-boq-item-calculation.dto';
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
import { RabKernelPersistenceService } from './rab-kernel-persistence.service';
import { PersistedCalculationService } from './persisted-calculation.service';
import { RabLockService } from './rab-lock.service';

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
    private readonly rabKernelPersistenceService: RabKernelPersistenceService,
    private readonly persistedCalculationService: PersistedCalculationService,
    private readonly rabLockService: RabLockService,
  ) {}

  /**
   * RM-03D1 — DRAFT → LOCKED on the SAME RabDocument. One RAB, one house.
   *
   * PERMISSION — the existing RAB_DRAFT_EDIT, deliberately not a new code.
   * Locking is the terminal act of the draft-authoring phase and belongs to
   * exactly the people who authored the draft. APPROVAL is a different
   * authority and is not reachable from here.
   *
   * NO RabEditableLifecycleGuard on purpose. That guard rejects whenever
   * canEditDraft is false — which becomes true of this very RAB the instant
   * this command succeeds. Mounting it here would make the second, idempotent
   * lock attempt fail with the state the first one just produced. The service
   * re-reads the lifecycle itself under a FOR UPDATE lock, which is the only
   * place DRAFT→LOCKED and LOCKED→LOCKED can be told apart safely.
   */
  @Post(':projectId/rab/lock')
  @UseGuards(ProjectAccessGuard, PermissionsGuard)
  @Permissions(PERMISSIONS.RAB_DRAFT_EDIT)
  async lockRab(@Req() request: any, @Param('projectId') projectId: string) {
    const workspaceId = request.projectAccess?.workspaceId;
    if (!workspaceId) {
      throw new BadRequestException('Trusted project workspace is required');
    }
    // Both halves of the identity are server-derived: the workspace from the
    // guard-resolved project context, the actor from the verified JWT. Neither
    // comes from the body or the query, so a forged id cannot steer a freeze.
    const actorAccountId = request.user?.id;
    if (!actorAccountId) {
      throw new InternalServerErrorException('Trusted account context is missing');
    }
    return this.rabLockService.lockWorkingDraft({ projectId, workspaceId, actorAccountId });
  }

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
    const project = await this.projectService.findOne(projectId);

    // Detail Project shows a "Status" of its own. Without the RAB's lifecycle
    // it had only Project.status to show, and read a project still in
    // perencanaan as a RAB that was not yet locked — while the repository
    // held it LOCKED. The same policy service that answers /projects/mine
    // answers here, so both doors state one truth.
    return {
      ...project,
      rabLifecycle: await this.rabLifecyclePolicy.evaluate(
        project.id,
        project.status as ProjectStatus,
      ),
    };
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

  /**
   * GATE-2A — the one server-authoritative command that may persist a Cost
   * Kernel result. Distinct from, and never replacing, the read-only GET
   * above: this route always performs a real, atomic write and requires
   * RAB_DRAFT_EDIT, not PROJECT_VIEW.
   */
  @Post(':projectId/boq/items/:boqItemId/cost-calculation/persist')
  @UseGuards(ProjectAccessGuard, PermissionsGuard)
  @Permissions(PERMISSIONS.RAB_DRAFT_EDIT)
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  )
  async persistBoqItemCostCalculation(
    @Req() request: any,
    @Param('projectId') projectId: string,
    @Param('boqItemId') boqItemId: string,
    @Body() dto: PersistBoqItemCalculationDto,
  ) {
    const workspaceId = request.projectAccess?.workspaceId;
    if (!workspaceId) {
      throw new BadRequestException('Trusted project workspace is required');
    }
    return this.rabKernelPersistenceService.persistBoqItemCalculation({
      projectId,
      boqItemId,
      workspaceId,
      calculationAsOfDateRaw: dto.calculationAsOfDate,
    });
  }

  /**
   * RM-03 — read-only re-proof of an ALREADY-PERSISTED line. Never writes.
   *
   * Distinct from the GET above in the question it answers: that route prices
   * a line from its *working* occurrence ("what would this cost now?"), and
   * returns OCCURRENCE_NOT_FOUND once a line has been persisted, because the
   * persist command clears the working pointer. This route follows the
   * *calculation* occurrence instead, so a persisted line stays re-provable
   * across a hard reload — which is the only way a human can confirm that the
   * money on screen is still the money the kernel derived, and see the
   * per-resource breakdown behind it.
   *
   * RAB_VIEW, matching GET :projectId/boq/draft: this exposes the same
   * persisted RAB line, in more detail.
   */
  @Get(':projectId/boq/items/:boqItemId/persisted-calculation')
  @UseGuards(ProjectAccessGuard, PermissionsGuard)
  @Permissions(PERMISSIONS.RAB_VIEW)
  async getPersistedBoqItemCalculation(
    @Req() request: any,
    @Param('projectId') projectId: string,
    @Param('boqItemId') boqItemId: string,
  ) {
    const workspaceId = request.projectAccess?.workspaceId;
    if (!workspaceId) {
      throw new BadRequestException('Trusted project workspace is required');
    }
    return this.persistedCalculationService.getPersistedCalculation(
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
    @Req() request: any,
    @Param('projectId') projectId: string,
    @Body() dto: SaveDraftBoqDto,
  ) {
    // GATE-2A §4.2: distinguishing "client sent unitPrice:null" from "client
    // omitted unitPrice entirely" requires the pre-transform raw body —
    // class-transformer's plainToInstance (useDefineForClassFields target)
    // makes every declared DTO field an own property regardless of what the
    // client actually sent, so that distinction cannot survive on `dto`.
    const rawRows: unknown[] = Array.isArray(request.body?.rows)
      ? request.body.rows
      : [];
    return this.projectService.saveDraftBoq(projectId, dto, rawRows);
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
