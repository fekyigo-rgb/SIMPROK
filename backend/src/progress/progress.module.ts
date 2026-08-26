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
})
export class ProgressModule {}
