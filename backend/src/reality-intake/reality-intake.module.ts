import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BusinessSubscriptionService } from './business-subscription.service';
import { ExtractionWorkerService } from './extraction-worker.service';
import { IntakeEnqueueService } from './intake-enqueue.service';
import { PriceSubmissionReviewService } from './price-submission-review.service';
import { BasicPriceReviewController } from './basic-price-review.controller';
import { PublicationWorkerService } from './publication-worker.service';
import { StorageService } from './storage.service';
import { UnderstandingValidationService } from './understanding-validation.service';
import { UploadController } from './upload.controller';

@Module({
  imports: [PrismaModule],
  controllers: [UploadController, BasicPriceReviewController],
  providers: [
    IntakeEnqueueService,
    StorageService,
    ExtractionWorkerService,
    UnderstandingValidationService,
    PublicationWorkerService,
    BusinessSubscriptionService,
    PriceSubmissionReviewService,
  ],
  // StorageService is exported as a plain FILESYSTEM PORT. It carries no
  // knowledge of IntakeJob, ExtractionArtifact or the workers, so sharing it
  // with the Basic Price vertical intake reuses infrastructure without importing
  // any RM-12 platform concept (ROADMAP.md section 15).
  exports: [PriceSubmissionReviewService, StorageService],
})
export class RealityIntakeModule {}
