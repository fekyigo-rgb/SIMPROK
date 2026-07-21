import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../prisma/prisma.module'; // Wajib: akses database langsung
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ProjectAccessGuard } from './guards/project-access.guard';
import { getRequiredJwtSecret } from './jwt-secret';
import { ProjectAccessPolicyService } from './project-access-policy.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { WorkspacePermissionResolverService } from './workspace-permission-resolver.service';

// @Global(): PermissionsGuard is referenced via @UseGuards(PermissionsGuard)
// (a class reference) across many feature modules that do not import
// AuthModule explicitly. Nest resolves a guard class's constructor
// dependencies from the DI scope of whichever module references it, so
// WorkspacePermissionResolverService must be globally resolvable — exactly
// like PrismaService already is via @Global() PrismaModule, which is what
// let PermissionsGuard work everywhere before this dependency existed.
@Global()
@Module({
  imports: [
    PrismaModule, // Menggantikan UsersModule agar AuthService bisa mengakses model Account
    JwtModule.register({
      secret: getRequiredJwtSecret(),
      signOptions: {
        expiresIn: '1d',
      },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    ProjectAccessPolicyService,
    ProjectAccessGuard,
    WorkspacePermissionResolverService,
  ],
  exports: [
    ProjectAccessPolicyService,
    ProjectAccessGuard,
    WorkspacePermissionResolverService,
  ],
})
export class AuthModule {}
