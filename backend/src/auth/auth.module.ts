import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../prisma/prisma.module'; // Wajib: akses database langsung
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ProjectAccessGuard } from './guards/project-access.guard';
import { getRequiredJwtSecret } from './jwt-secret';
import { ProjectAccessPolicyService } from './project-access-policy.service';
import { JwtStrategy } from './strategies/jwt.strategy';

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
  ],
  exports: [ProjectAccessPolicyService, ProjectAccessGuard],
})
export class AuthModule {}
