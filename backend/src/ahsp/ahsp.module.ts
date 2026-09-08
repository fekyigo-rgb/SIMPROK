import { Module } from '@nestjs/common';
import { AhspService } from './services/ahsp.service';
import { AhspVersionService } from './services/ahsp-version.service';
import { AhspSnapshotService } from './services/ahsp-snapshot.service';
import { AhspImportService } from './services/ahsp-import.service';
import { AhspAuditService } from './services/ahsp-audit.service';
import { TrustedAhspActorService } from './services/trusted-ahsp-actor.service';
import { AhspDocumentCanonicalizationService } from './services/ahsp-document-canonicalization.service';
import { AhspController } from './ahsp.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { UnitKernelModule } from '../unit-kernel/unit-kernel.module';
import { ResourceIdentityResolutionService } from '../resource-catalog/resource-identity-resolution.service';
import { ResourceAdmissionService } from '../resource-catalog/resource-admission.service';
import { ResourceObservationService } from '../resource-catalog/resource-observation.service';

@Module({
  imports: [PrismaModule, UnitKernelModule],
  controllers: [AhspController],
  providers: [
    AhspService,
    AhspVersionService,
    AhspSnapshotService,
    AhspImportService,
    AhspAuditService,
    TrustedAhspActorService,
    AhspDocumentCanonicalizationService,
    ResourceIdentityResolutionService,
    // Shared new-resource lifecycle: AHSP records observations through the ONE
    // shared service, which mints through the ONE admission authority.
    ResourceAdmissionService,
    ResourceObservationService,
  ],
  exports: [AhspService, AhspVersionService, AhspSnapshotService],
})
export class AhspModule {}
