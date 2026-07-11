import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ConstitutionalAiBoundaryService } from './constitutional-ai-boundary.service';
import { IntelligenceEvidenceService } from './intelligence-evidence.service';

@Module({
  imports: [PrismaModule],
  providers: [ConstitutionalAiBoundaryService, IntelligenceEvidenceService],
  exports: [ConstitutionalAiBoundaryService, IntelligenceEvidenceService],
})
export class IntelligenceModule {}
