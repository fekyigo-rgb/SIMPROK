import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BusinessSubscriptionService } from './business-subscription.service';
import { ExtractionWorkerService } from './extraction-worker.service';
import { IntakeEnqueueService } from './intake-enqueue.service';
import { PriceSubmissionReviewService } from './price-submission-review.service';
import { PublicationWorkerService } from './publication-worker.service';
import { StorageService } from './storage.service';
import { UnderstandingValidationService } from './understanding-validation.service';
import { UploadController } from './upload.controller';

@Module({
  imports: [PrismaModule],
  controllers: [UploadController],
  providers: [
    IntakeEnqueueService,
    StorageService,
    ExtractionWorkerService,
    UnderstandingValidationService,
    PublicationWorkerService,
    BusinessSubscriptionService,
    PriceSubmissionReviewService,
  ],
})
export class RealityIntakeModule {}
