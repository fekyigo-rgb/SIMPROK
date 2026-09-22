import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ConstructionClassificationService } from './construction-classification.service';

/**
 * Slice 1 — service-domain foundation only.
 * No public controller/route: FOUNDATION_READY_FOR_NEXT_CONSUMER
 * (Slice 2 assignment, Slice 6 assisted import, Slice 10 filter/RAB).
 */
@Module({
  imports: [PrismaModule],
  providers: [ConstructionClassificationService],
  exports: [ConstructionClassificationService],
})
export class ConstructionClassificationModule {}
