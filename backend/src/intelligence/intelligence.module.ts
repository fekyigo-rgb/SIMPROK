import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AiProviderConfigService } from './ai-provider.config';
import { ConstitutionalAiBoundaryService } from './constitutional-ai-boundary.service';
import { DisabledIntelligenceProvider } from './disabled-intelligence.provider';
import { IntelligenceEvidenceService } from './intelligence-evidence.service';
import { IntelligenceProviderRegistryService } from './intelligence-provider-registry';
import { SimprokIntelligenceOrchestrator } from './simprok-intelligence.orchestrator';

@Module({
  imports: [PrismaModule],
  providers: [
    ConstitutionalAiBoundaryService,
    IntelligenceEvidenceService,
    AiProviderConfigService,
    DisabledIntelligenceProvider,
    IntelligenceProviderRegistryService,
    SimprokIntelligenceOrchestrator,
  ],
  exports: [
    ConstitutionalAiBoundaryService,
    IntelligenceEvidenceService,
    SimprokIntelligenceOrchestrator,
  ],
})
export class IntelligenceModule {}
