import { Module } from '@nestjs/common';
import { ProjectService } from './project.service';
import { ProjectController } from './project.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { DeviationService } from './deviation.service';
import { RabIntelligenceProposalService } from './rab-intelligence-proposal.service';
import { IntelligenceModule } from '../intelligence/intelligence.module';
import { AuthModule } from '../auth/auth.module';
import { CostKernelService } from './cost-kernel.service';
import { BoqImportService } from './boq-import.service';
import { BoqImportProjectAccessGuard } from './boq-import-project-access.guard';

@Module({
  imports: [PrismaModule, IntelligenceModule, AuthModule],
  controllers: [ProjectController],
  providers: [ProjectService, DeviationService, RabIntelligenceProposalService, CostKernelService, BoqImportService, BoqImportProjectAccessGuard],
})
export class ProjectModule {}
