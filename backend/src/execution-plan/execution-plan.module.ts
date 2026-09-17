import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ProgressModule } from '../progress/progress.module';
import { ExecutionPlanController } from './execution-plan.controller';
import { ExecutionPlanService } from './execution-plan.service';

@Module({
  imports: [PrismaModule, AuthModule, ProgressModule],
  controllers: [ExecutionPlanController],
  providers: [ExecutionPlanService],
  exports: [ExecutionPlanService],
})
export class ExecutionPlanModule {}
