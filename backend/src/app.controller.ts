import { Controller, Get, UseGuards } from '@nestjs/common';
import { AppService } from './app.service';
import { Roles } from './common/decorators/roles.decorator';
import { Permissions } from './common/decorators/permissions.decorator';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';
import { PermissionsGuard } from './auth/guards/permissions.guard';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('rbac/super-admin-test')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN')
  superAdminTest() {
    return {
      message: 'Access Granted',
      role: 'SUPER_ADMIN',
    };
  }

  @Get('rbac/project-view-test')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('PROJECT_VIEW')
  projectViewTest() {
    return {
      message: 'Access Granted',
      permission: 'PROJECT_VIEW',
    };
  }
}
