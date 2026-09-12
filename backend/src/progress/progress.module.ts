import { Module } from '@nestjs/common';
import { ProgressController } from './progress.controller';
import { ProgressService } from './progress.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { ProgressAuthorityService } from './progress-authority.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [ProgressController],
  providers: [ProgressService, ProgressAuthorityService],
  // PAB-03 — ProgressAuthorityService is the ONE live
  // Position -> PositionAuthority -> Authority resolver, and it is generic:
  // the authority code is a parameter, not a Progress constant. Exporting it
  // is precisely what stops the RAB approval bridge from growing a second
  // copy of Position resolution that could drift from this one.
  exports: [ProgressAuthorityService],
})
export class ProgressModule {}
