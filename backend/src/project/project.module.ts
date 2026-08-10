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
import { RabLifecyclePolicyService } from './rab-lifecycle-policy.service';
import { RabEditableLifecycleGuard } from './rab-editable-lifecycle.guard';
import { RabLockService } from './rab-lock.service';
import { RabKernelPersistenceService } from './rab-kernel-persistence.service';
import { PersistedCalculationService } from './persisted-calculation.service';
import { BasicPriceModule } from '../basic-price/basic-price.module';

@Module({
  imports: [PrismaModule, IntelligenceModule, AuthModule, BasicPriceModule],
  controllers: [ProjectController],
  providers: [ProjectService, DeviationService, RabIntelligenceProposalService, CostKernelService, BoqImportService, RabLifecyclePolicyService, RabEditableLifecycleGuard, RabKernelPersistenceService, PersistedCalculationService, RabLockService],
})
export class ProjectModule {}
