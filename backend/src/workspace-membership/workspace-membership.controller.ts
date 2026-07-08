import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WorkspaceMembershipService } from './workspace-membership.service';

@Controller('workspace-membership')
@UseGuards(JwtAuthGuard)
export class WorkspaceMembershipController {
  constructor(
    private readonly workspaceMembershipService: WorkspaceMembershipService,
  ) {}

  @Get()
  findAll(@Req() request: any) {
    return this.workspaceMembershipService.findAllForAccount(request.user.id);
  }

  @Get('health')
  healthCheck() {
    return this.workspaceMembershipService.healthCheck();
  }

  @Get('workspace/:workspaceId')
  findByWorkspace(@Param('workspaceId') workspaceId: string, @Req() request: any) {
    return this.workspaceMembershipService.findByWorkspaceForAccount(workspaceId, request.user.id);
  }

  @Get('user/:userId')
  findByUser(@Param('userId') userId: string, @Req() request: any) {
    return this.workspaceMembershipService.findByUserForAccount(userId, request.user.id);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() request: any) {
    return this.workspaceMembershipService.findOneForAccount(id, request.user.id);
  }
}
