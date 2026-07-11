import { Module } from '@nestjs/common';
import { ProjectService } from './project.service';
import { ProjectController } from './project.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { DeviationService } from './deviation.service';
import { RabIntelligenceProposalService } from './rab-intelligence-proposal.service';
import { IntelligenceModule } from '../intelligence/intelligence.module';

@Module({
  imports: [PrismaModule, IntelligenceModule],
  controllers: [ProjectController],
  providers: [ProjectService, DeviationService, RabIntelligenceProposalService],
})
export class ProjectModule {}