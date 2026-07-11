import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ConstitutionalAiBoundaryService } from './constitutional-ai-boundary.service';

@Module({
  imports: [PrismaModule],
  providers: [ConstitutionalAiBoundaryService],
  exports: [ConstitutionalAiBoundaryService],
})
export class IntelligenceModule {}
