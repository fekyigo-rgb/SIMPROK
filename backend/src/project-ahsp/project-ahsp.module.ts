import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BasicPriceModule } from '../basic-price/basic-price.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ProjectAhspController } from './project-ahsp.controller';
import { ProjectAhspService } from './project-ahsp.service';
import { UnitKernelModule } from '../unit-kernel/unit-kernel.module';
import { RabLifecyclePolicyService } from '../project/rab-lifecycle-policy.service';
import { ResourceIdentityResolutionService } from '../resource-catalog/resource-identity-resolution.service';
import { AhspResourceResolutionOrchestrator } from './ahsp-resource-resolution.orchestrator';
import { GhxResourceIdentityDecisionService } from './ghx-resource-identity-decision.service';
import { GhxDecisionContextTokenService } from '../resource-catalog/ghx-decision-context-token.service';
import { RabAutoReadinessService } from './rab-auto-readiness.service';
import { RabAutoReadinessController } from './rab-auto-readiness.controller';
import { RabAutoProvenReuseController } from './rab-auto-04-reuse.controller';
import { RabAutoProvenReuseService } from './rab-auto-04-reuse.service';
import { RabAutoFirstBindController } from './rab-auto-first-bind.controller';
import { RabAutoFirstBindService } from './rab-auto-first-bind.service';

@Module({
  imports: [PrismaModule, AuthModule, BasicPriceModule, UnitKernelModule],
  controllers: [
    ProjectAhspController,
    RabAutoReadinessController,
    RabAutoProvenReuseController,
    RabAutoFirstBindController,
  ],
  providers: [
    ProjectAhspService,
    RabLifecyclePolicyService,
    ResourceIdentityResolutionService,
    AhspResourceResolutionOrchestrator,
    GhxResourceIdentityDecisionService,
    GhxDecisionContextTokenService,
    RabAutoReadinessService,
    RabAutoProvenReuseService,
    RabAutoFirstBindService,
  ],
})
export class ProjectAhspModule {}
