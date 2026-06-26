import { Controller, Get, Param } from '@nestjs/common';
import { WorkspaceMembershipService } from './workspace-membership.service';

@Controller('workspace-membership')
export class WorkspaceMembershipController {
  constructor(
    private readonly workspaceMembershipService: WorkspaceMembershipService,
  ) {}

  @Get()
  findAll() {
    return this.workspaceMembershipService.findAll();
  }

  @Get('health')
  healthCheck() {
    return this.workspaceMembershipService.healthCheck();
  }

  @Get('workspace/:workspaceId')
  findByWorkspace(@Param('workspaceId') workspaceId: string) {
    return this.workspaceMembershipService.findByWorkspace(workspaceId);
  }

  @Get('user/:userId')
  findByUser(@Param('userId') userId: string) {
    return this.workspaceMembershipService.findByUser(userId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.workspaceMembershipService.findOne(id);
  }
}