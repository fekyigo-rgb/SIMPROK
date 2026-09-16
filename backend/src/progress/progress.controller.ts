import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Request,
  Param,
  Query,
} from '@nestjs/common';
import { ProgressService } from './progress.service';
import {
  CorrectProgressDto,
  ProgressSemanticAttestationDto,
  ProgressTransitionDto,
  SubmitFieldProgressDto,
} from './dto/create-progress.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ProjectAccessGuard } from '../auth/guards/project-access.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../common/constants/permissions';
import type { ProjectAccessContext } from '../auth/project-access-policy.service';

interface ProgressSemanticAttestationRequest {
  user: { id: string };
  projectAccess: ProjectAccessContext;
}

@Controller('projects/:projectId/progress')
@UseGuards(JwtAuthGuard, ProjectAccessGuard, PermissionsGuard)
export class ProgressController {
  constructor(private readonly progressService: ProgressService) {}

  @Get('monitoring')
  @Permissions('PROJECT_VIEW')
  async getMonitoring(
    @Param('projectId') projectId: string,
    @Query() query: Record<string, unknown>,
  ) {
    if (Object.keys(query).some((key) => key.startsWith('cutoffDate['))) {
      throw new BadRequestException('INVALID_PROJECT_BUSINESS_CUTOFF');
    }

    if (
      Object.keys(query).some((key) => key.startsWith('includeActualSeries['))
    ) {
      throw new BadRequestException('AMBIGUOUS_INCLUDE_ACTUAL_SERIES');
    }

    const includeActualSeriesValue = query.includeActualSeries;
    let includeActualSeries = false;

    if (includeActualSeriesValue !== undefined) {
      if (typeof includeActualSeriesValue !== 'string') {
        throw new BadRequestException('AMBIGUOUS_INCLUDE_ACTUAL_SERIES');
      }
      if (
        includeActualSeriesValue !== 'true' &&
        includeActualSeriesValue !== 'false'
      ) {
        throw new BadRequestException('INVALID_INCLUDE_ACTUAL_SERIES');
      }
      includeActualSeries = includeActualSeriesValue === 'true';
    }

    if (includeActualSeries && query.cutoffDate === undefined) {
      throw new BadRequestException('ACTUAL_SERIES_REQUIRES_CUTOFF');
    }

    return this.progressService.getMonitoring(
      projectId,
      query.cutoffDate,
      includeActualSeries,
    );
  }

  @Post('field')
  // This is a write action. It must strictly require FIELD_PROGRESS_SUBMIT.
  @Permissions(PERMISSIONS.FIELD_PROGRESS_SUBMIT)
  async submitFieldProgress(
    @Param('projectId') projectId: string,
    @Body() submitDto: SubmitFieldProgressDto,
    @Request() req,
  ) {
    return this.progressService.submitFieldProgress(
      projectId,
      submitDto,
      req.user.id,
      req.projectAccess,
    );
  }

  @Get('items/:boqItemId/history')
  @Permissions('PROJECT_VIEW')
  getWorkItemHistory(
    @Param('projectId') projectId: string,
    @Param('boqItemId') boqItemId: string,
    @Request() req,
  ) {
    return this.progressService.getWorkItemHistory(
      projectId,
      boqItemId,
      req.user.id,
      req.projectAccess,
    );
  }

  @Post('entries/:entryId/semantic-attestations')
  @Permissions(PERMISSIONS.FIELD_PROGRESS_VERIFY)
  attestEntrySemantics(
    @Param('projectId') projectId: string,
    @Param('entryId') entryId: string,
    @Body() dto: ProgressSemanticAttestationDto,
    @Request() req: ProgressSemanticAttestationRequest,
  ) {
    return this.progressService.attestEntrySemantics(
      projectId,
      entryId,
      dto,
      req.user.id,
      req.projectAccess,
    );
  }

  @Post('entries/:entryId/corrections')
  @Permissions(PERMISSIONS.FIELD_PROGRESS_CORRECT)
  correctEntry(
    @Param('projectId') projectId: string,
    @Param('entryId') entryId: string,
    @Body() dto: CorrectProgressDto,
    @Request() req,
  ) {
    return this.progressService.correctEntry(
      projectId,
      entryId,
      dto,
      req.user.id,
      req.projectAccess,
    );
  }

  @Post('entries/:entryId/verify')
  @Permissions(PERMISSIONS.FIELD_PROGRESS_VERIFY)
  verifyEntry(
    @Param('projectId') projectId: string,
    @Param('entryId') entryId: string,
    @Body() dto: ProgressTransitionDto,
    @Request() req,
  ) {
    return this.progressService.transitionEntry(
      projectId,
      entryId,
      'VERIFY',
      dto.commandId,
      dto.reason,
      req.user.id,
      req.projectAccess,
    );
  }

  @Post('entries/:entryId/accept')
  @Permissions(PERMISSIONS.FIELD_PROGRESS_ACCEPT)
  acceptEntry(
    @Param('projectId') projectId: string,
    @Param('entryId') entryId: string,
    @Body() dto: ProgressTransitionDto,
    @Request() req,
  ) {
    return this.progressService.transitionEntry(
      projectId,
      entryId,
      'ACCEPT',
      dto.commandId,
      dto.reason,
      req.user.id,
      req.projectAccess,
    );
  }
}
