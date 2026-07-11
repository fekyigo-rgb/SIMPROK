import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';

import { AppController } from './app.controller';
import { AppService } from './app.service';

import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { RolesModule } from './roles/roles.module';
import { PermissionsModule } from './permissions/permissions.module';
import { CommonModule } from './common/common.module';
import { AuditModule } from './audit/audit.module';
import { RolesGuard } from './auth/guards/roles.guard';
import { PermissionsGuard } from './auth/guards/permissions.guard';
import { OrganizationModule } from './organization/organization.module';
import { WorkspaceModule } from './workspace/workspace.module';
import { AuthorityModule } from './authority/authority.module';
import { ProjectModule } from './project/project.module';
import { AhspModule } from './ahsp/ahsp.module';
import { ProgressModule } from './progress/progress.module';
import { RealityIntakeModule } from './reality-intake/reality-intake.module';
import { BasicPriceModule } from './basic-price/basic-price.module';
import { IntelligenceModule } from './intelligence/intelligence.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),

    ThrottlerModule.forRoot([{
      name: 'login',
      // Very high default limit = effectively no throttle for non-login routes.
      // Login route overrides this via @Throttle({ login: { limit: X, ttl: Y } }).
      ttl: Number(process.env.LOGIN_RATE_LIMIT_TTL_SECONDS ?? 60) * 1000,
      limit: 100000,
    }]),
    PrismaModule,
    UsersModule,
    AuthModule,
    RolesModule,
    PermissionsModule,
    CommonModule,
    AuditModule,
    OrganizationModule,
    WorkspaceModule,
    AuthorityModule,
    ProjectModule,
    AhspModule,
    BasicPriceModule,
    IntelligenceModule,
    ProgressModule,
    RealityIntakeModule,
  ],
  controllers: [AppController],
  providers: [AppService, RolesGuard, PermissionsGuard, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
