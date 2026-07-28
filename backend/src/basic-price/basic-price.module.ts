import { Module } from '@nestjs/common';
import { BasicPriceService } from './basic-price.service';
import { BasicPriceController } from './basic-price.controller';
import { BasicPriceEligibilityPolicy } from './basic-price-eligibility.policy';
import { BasicPriceImportService } from './basic-price-import.service';
import { BasicPriceRowResolutionService } from './basic-price-row-resolution.service';
import { BasicPricePublicationService } from './basic-price-publication.service';
import { BasicPriceImportController, BasicPricePublicationController } from './basic-price-import.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { BasicPriceImportLookupController } from './basic-price-import-lookup.controller';
import { BasicPriceImportLookupService } from './basic-price-import-lookup.service';
import { BasicPriceRowMappingCandidatesService } from './basic-price-row-mapping-candidates.service';

@Module({
  imports: [PrismaModule],
  controllers: [BasicPriceController, BasicPriceImportController, BasicPricePublicationController, BasicPriceImportLookupController],
  providers: [
    BasicPriceService,
    BasicPriceEligibilityPolicy,
    BasicPriceImportService,
    BasicPriceRowResolutionService,
    BasicPricePublicationService,
    BasicPriceImportLookupService,
    BasicPriceRowMappingCandidatesService,
  ],
  exports: [BasicPriceService, BasicPriceEligibilityPolicy],
})
export class BasicPriceModule {}
