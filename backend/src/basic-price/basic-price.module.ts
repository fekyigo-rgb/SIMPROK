import { Module } from '@nestjs/common';
import { BasicPriceService } from './basic-price.service';
import { BasicPriceController } from './basic-price.controller';
import { BasicPriceEligibilityPolicy } from './basic-price-eligibility.policy';
import { BasicPriceImportService } from './basic-price-import.service';
import { BasicPriceRowResolutionService } from './basic-price-row-resolution.service';
import { BasicPricePublicationService } from './basic-price-publication.service';
import { BasicPricePromotionService } from './basic-price-promotion.service';
import { BasicPriceImportController } from './basic-price-import.controller';
import { BasicPricePublicationController } from './basic-price-publication.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { RealityIntakeModule } from '../reality-intake/reality-intake.module';
import { BasicPriceImportLookupController } from './basic-price-import-lookup.controller';
import { BasicPriceImportLookupService } from './basic-price-import-lookup.service';
import { BasicPriceRowMappingCandidatesService } from './basic-price-row-mapping-candidates.service';
import { BasicPriceRowResolutionProposalService } from './basic-price-row-resolution-proposal.service';
import { BasicPriceSmartSaveService } from './basic-price-smart-save.service';
import { BasicPricePrivateAssetService } from './basic-price-private-asset.service';
import { TrustedBasicPriceActorService } from './trusted-basic-price-actor.service';
import { ResourceIdentityResolutionService } from '../resource-catalog/resource-identity-resolution.service';
import { UnitKernelModule } from '../unit-kernel/unit-kernel.module';
import { UniversalIntakeModule } from '../universal-intake/universal-intake.module';
import { BasicPriceSupplierBridgeService } from './basic-price-supplier-bridge.service';
import { BasicPriceSourceArchiveService } from './basic-price-source-archive.service';

@Module({
  // UnitKernelModule: admission asks the EXISTING unit authority whether the
  // canonical base unit it is about to write is representable. No unit law is
  // re-implemented here.
  //
  // UniversalIntakeModule: the connector authorization boundary. It is imported
  // for IngestionConnectorService alone — the readers, structure detector and
  // source envelope are stateless and need no container.
  imports: [PrismaModule, RealityIntakeModule, UnitKernelModule, UniversalIntakeModule],
  controllers: [BasicPriceController, BasicPriceImportController, BasicPricePublicationController, BasicPriceImportLookupController],
  providers: [
    BasicPriceService,
    BasicPriceEligibilityPolicy,
    BasicPriceImportService,
    // USI-01R2 §5 — retains raw source bytes for this vertical-local intake.
    BasicPriceSourceArchiveService,
    // USI-01 — the supplier-facing connector entry. It has no controller: it
    // authorizes, then calls the SAME intake door the browser upload calls.
    BasicPriceSupplierBridgeService,
    BasicPriceRowResolutionService,
    BasicPricePublicationService,
    BasicPricePromotionService,
    BasicPriceImportLookupService,
    BasicPriceRowMappingCandidatesService,
    // INT-CONNECT-01 — the composition seam between this module and the two
    // canonical authorities already listed here. It owns no domain law of its
    // own; it exists so the review room asks them BEFORE it asks a human.
    BasicPriceRowResolutionProposalService,
    BasicPriceSmartSaveService,
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
