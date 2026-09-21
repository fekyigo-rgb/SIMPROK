import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { UnitKernelModule } from '../unit-kernel/unit-kernel.module';
import { ResourceIdentityResolutionService } from './resource-identity-resolution.service';
import { ResourceAdmissionService } from './resource-admission.service';
import { ResourceObservationService } from './resource-observation.service';
import { ResourceObservationController } from './resource-observation.controller';
import { GhxDecisionContextTokenService } from './ghx-decision-context-token.service';
import { AhspImportService } from '../ahsp/services/ahsp-import.service';
import { AhspAuditService } from '../ahsp/services/ahsp-audit.service';

/**
 * The shared resource-catalog domain: one identity authority, one mint
 * authority, one observed-resource lifecycle — the single home AHSP, Basic
 * Price and BOQ all reach. It owns the curation controller; the domain modules
 * provide their own instances of the (stateless) services where they inject
 * them directly, exactly as they already do for the identity authority.
 */
@Module({
  imports: [PrismaModule, UnitKernelModule],
  controllers: [ResourceObservationController],
  providers: [
    ResourceIdentityResolutionService,
    ResourceAdmissionService,
    ResourceObservationService,
    // IQL-01 — the existing stateless signed-context service, second purpose.
    GhxDecisionContextTokenService,
    // GAP C2 — the AHSP journal answers for its OWN documents; the curation
    // controller composes it with the shared read. Stateless, provided here the
    // same way the domain modules already provide the identity authority.
    AhspImportService,
    AhspAuditService,
  ],
  exports: [
    ResourceIdentityResolutionService,
    ResourceAdmissionService,
    ResourceObservationService,
  ],
})
export class ResourceCatalogModule {}
