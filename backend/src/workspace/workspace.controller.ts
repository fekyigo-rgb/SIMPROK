import { Controller, Get, Param, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

import { WorkspaceService } from './workspace.service';

@Controller('workspace')
@UseGuards(JwtAuthGuard)
export class WorkspaceController {
  constructor(private readonly workspaceService: WorkspaceService) {}

  @Get()
  findAll(@Req() request: any) {
    const accountId = request.user.id;
    return this.workspaceService.findAllForAccount(accountId);
  }

  @Get('health')
  healthCheck() {
    return this.workspaceService.healthCheck();
  }

  @Get('organization/:organizationId')
  findByOrganization(@Param('organizationId') organizationId: string, @Req() request: any) {
    return this.workspaceService.findByOrganizationForAccount(organizationId, request.user.id);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() request: any) {
    return this.workspaceService.findOneForAccount(id, request.user.id);
  }
}
