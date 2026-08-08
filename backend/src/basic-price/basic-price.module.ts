import { Module } from '@nestjs/common';
import { BasicPriceService } from './basic-price.service';
import { BasicPriceController } from './basic-price.controller';
import { BasicPriceEligibilityPolicy } from './basic-price-eligibility.policy';
import { BasicPriceImportService } from './basic-price-import.service';
import { BasicPriceRowResolutionService } from './basic-price-row-resolution.service';
import { BasicPricePublicationService } from './basic-price-publication.service';
import { BasicPriceImportController } from './basic-price-import.controller';
import { BasicPricePublicationController } from './basic-price-publication.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { RealityIntakeModule } from '../reality-intake/reality-intake.module';
import { BasicPriceImportLookupController } from './basic-price-import-lookup.controller';
import { BasicPriceImportLookupService } from './basic-price-import-lookup.service';
import { BasicPriceRowMappingCandidatesService } from './basic-price-row-mapping-candidates.service';
import { BasicPricePrivateAssetService } from './basic-price-private-asset.service';
import { TrustedBasicPriceActorService } from './trusted-basic-price-actor.service';
import { ResourceIdentityResolutionService } from '../resource-catalog/resource-identity-resolution.service';
import { UnitKernelModule } from '../unit-kernel/unit-kernel.module';

@Module({
  // UnitKernelModule: admission asks the EXISTING unit authority whether the
  // canonical base unit it is about to write is representable. No unit law is
  // re-implemented here.
  imports: [PrismaModule, RealityIntakeModule, UnitKernelModule],
  controllers: [BasicPriceController, BasicPriceImportController, BasicPricePublicationController, BasicPriceImportLookupController],
  providers: [
    BasicPriceService,
    BasicPriceEligibilityPolicy,
    BasicPriceImportService,
    BasicPriceRowResolutionService,
    BasicPricePublicationService,
    BasicPriceImportLookupService,
    BasicPriceRowMappingCandidatesService,
    BasicPricePrivateAssetService,
    TrustedBasicPriceActorService,
    // THE resource identity authority, listed exactly as ProjectAhspModule
    // already lists it. It is a stateless loader/delegator over PrismaModule,
    // so both consumers judge identity with one kernel and one evidence law —
    // there is no second matcher anywhere in this module.
    ResourceIdentityResolutionService,
  ],
  exports: [BasicPriceService, BasicPriceEligibilityPolicy],
})
export class BasicPriceModule {}
