import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  InternalServerErrorException,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { ProjectAccessContext } from '../auth/project-access-policy.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { ProjectAccessGuard } from '../auth/guards/project-access.guard';
import { WorkspacePermissionResolverService } from '../auth/workspace-permission-resolver.service';
import { PERMISSIONS } from '../common/constants/permissions';
import { Permissions } from '../common/decorators/permissions.decorator';
import {
  LockExecutionPlanDto,
  SaveExecutionPlanDraftDto,
} from './dto/execution-plan.dto';
import { ExecutionPlanService } from './execution-plan.service';

interface ExecutionPlanRequest {
  user?: { id?: string };
  projectAccess?: ProjectAccessContext;
}

const STRICT_BODY_PIPE = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: false },
});

@Controller('projects/:projectId/execution-plan')
@UseGuards(JwtAuthGuard, ProjectAccessGuard, PermissionsGuard)
export class ExecutionPlanController {
  constructor(
    private readonly plans: ExecutionPlanService,
    private readonly permissionResolver: WorkspacePermissionResolverService,
  ) {}

  private trusted(request: ExecutionPlanRequest) {
    const accountId = request.user?.id;
    const projectAccess = request.projectAccess;
    if (!accountId || !projectAccess?.workspaceId) {
      throw new InternalServerErrorException(
        'Trusted Execution Plan actor context is missing',
      );
    }
    return { accountId, projectAccess };
  }

  @Get()
  @Permissions(PERMISSIONS.PROJECT_VIEW)
  async get(
    @Req() request: ExecutionPlanRequest,
    @Param('projectId') projectId: string,
  ) {
    const actor = this.trusted(request);
    const effective = await this.permissionResolver.resolve(
      actor.accountId,
      actor.projectAccess.workspaceId,
    );
    if (!effective) {
      throw new ForbiddenException('You do not have access to this workspace');
    }
    return this.plans.getForMonitoring({
      projectId,
      ...actor,
      effectivePermissions: effective.permissions,
    });
  }

  @Put('draft')
  @Permissions(PERMISSIONS.EXECUTION_PLAN_EDIT)
  @UsePipes(STRICT_BODY_PIPE)
  saveDraft(
    @Req() request: ExecutionPlanRequest,
    @Param('projectId') projectId: string,
    @Body() dto: SaveExecutionPlanDraftDto,
  ) {
    return this.plans.saveDraft(projectId, dto, this.trusted(request));
  }

  @Post('lock')
  @Permissions(PERMISSIONS.EXECUTION_PLAN_LOCK)
  @UsePipes(STRICT_BODY_PIPE)
  lock(
    @Req() request: ExecutionPlanRequest,
    @Param('projectId') projectId: string,
    @Body() dto: LockExecutionPlanDto,
  ) {
    if (!dto.executionPlanVersionId) {
      throw new BadRequestException('Execution Plan identity is required');
    }
    return this.plans.lock(projectId, dto, this.trusted(request));
  }
}
