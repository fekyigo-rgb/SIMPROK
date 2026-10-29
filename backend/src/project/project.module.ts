import { Module } from '@nestjs/common';
import { ProjectService } from './project.service';
import { ProjectController } from './project.controller';
import { ProjectIntakeReferenceController } from './project-intake-reference.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { DeviationService } from './deviation.service';
import { RabIntelligenceProposalService } from './rab-intelligence-proposal.service';
import { IntelligenceModule } from '../intelligence/intelligence.module';
import { AuthModule } from '../auth/auth.module';
import { CostKernelService } from './cost-kernel.service';
import { RabAutoPriceReadyController } from './rab-auto-price-ready.controller';
import { RabAutoPriceReadyService } from './rab-auto-price-ready.service';
import { BoqImportService } from './boq-import.service';
import { RabLifecyclePolicyService } from './rab-lifecycle-policy.service';
import { RabEditableLifecycleGuard } from './rab-editable-lifecycle.guard';
import { RabLockService } from './rab-lock.service';
import { RabApprovalService } from './rab-approval.service';
import { ProgressModule } from '../progress/progress.module';
import { RabKernelPersistenceService } from './rab-kernel-persistence.service';
import { PersistedCalculationService } from './persisted-calculation.service';
import { BasicPriceModule } from '../basic-price/basic-price.module';
import { ConstructionClassificationModule } from '../construction-classification/construction-classification.module';
import { UnitKernelModule } from '../unit-kernel/unit-kernel.module';
import { AhspResourceResolutionOrchestrator } from '../project-ahsp/ahsp-resource-resolution.orchestrator';
import { ResourceIdentityResolutionService } from '../resource-catalog/resource-identity-resolution.service';
import { RealityIntakeModule } from '../reality-intake/reality-intake.module';

@Module({
  // Keep main's RealityIntakeModule and RI-01's canonical reference services together.
  imports: [
    PrismaModule,
    IntelligenceModule,
    AuthModule,
    BasicPriceModule,
    ConstructionClassificationModule,
    UnitKernelModule,
    ProgressModule,
    RealityIntakeModule,
  ],
  controllers: [
    ProjectController,
    ProjectIntakeReferenceController,
    RabAutoPriceReadyController,
  ],
  providers: [
    ProjectService,
    DeviationService,
    RabIntelligenceProposalService,
    RabAutoPriceReadyService,
    CostKernelService,
    BoqImportService,
    RabLifecyclePolicyService,
    RabEditableLifecycleGuard,
    RabKernelPersistenceService,
    PersistedCalculationService,
    RabLockService,
    RabApprovalService,
    AhspResourceResolutionOrchestrator,
    ResourceIdentityResolutionService,
  ],
})
export class ProjectModule {}
