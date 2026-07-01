import { Controller, Post, Body, UseGuards, Request, Param } from '@nestjs/common';
import { ProgressService } from './progress.service';
import { SubmitFieldProgressDto } from './dto/create-progress.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ProjectAccessGuard } from '../auth/guards/project-access.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';

@Controller('projects/:projectId/progress')
@UseGuards(JwtAuthGuard, ProjectAccessGuard, PermissionsGuard)
export class ProgressController {
  constructor(private readonly progressService: ProgressService) {}

  @Post('field')
  // This is a write action. It must strictly require FIELD_PROGRESS_SUBMIT.
  @Permissions('FIELD_PROGRESS_SUBMIT')
  async submitFieldProgress(
    @Param('projectId') projectId: string,
    @Body() submitDto: SubmitFieldProgressDto,
    @Request() req,
  ) {
    submitDto.projectId = projectId; // Ensure projectId matches the URL
    return this.progressService.submitFieldProgress(submitDto, req.user);
  }
}
