import { Module } from '@nestjs/common';
import { AhspService } from './services/ahsp.service';
import { AhspVersionService } from './services/ahsp-version.service';
import { AhspSnapshotService } from './services/ahsp-snapshot.service';
import { AhspImportService } from './services/ahsp-import.service';
import { AhspAuditService } from './services/ahsp-audit.service';
import { TrustedAhspActorService } from './services/trusted-ahsp-actor.service';
import { RealityNormalizationEngine } from './services/reality-normalization.engine';
import { AhspDocumentCanonicalizationService } from './services/ahsp-document-canonicalization.service';
import { AhspController } from './ahsp.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { UnitKernelModule } from '../unit-kernel/unit-kernel.module';
import { RealityIntakeModule } from '../reality-intake/reality-intake.module';
import { BasicPriceSourceArchiveService } from '../basic-price/basic-price-source-archive.service';
import { ResourceIdentityResolutionService } from '../resource-catalog/resource-identity-resolution.service';
import { ResourceAdmissionService } from '../resource-catalog/resource-admission.service';
import { ResourceObservationService } from '../resource-catalog/resource-observation.service';
import { GhxDecisionContextTokenService } from '../resource-catalog/ghx-decision-context-token.service';

@Module({
  imports: [
    PrismaModule,
    UnitKernelModule,
    // C1 — for StorageService, which RealityIntakeModule exports as a PLAIN
    // FILESYSTEM PORT precisely so a vertical may retain its own source bytes
    // without importing an RM-12 platform concept. Its own export comment says
    // so. Acyclic: RealityIntakeModule imports only PrismaModule.
    RealityIntakeModule,
  ],
  controllers: [AhspController],
  providers: [
    AhspService,
    AhspVersionService,
    AhspSnapshotService,
    AhspImportService,
    AhspAuditService,
    TrustedAhspActorService,
    // The one AHSP normalization home, now injected (it powers the POSSIBLY
    // signal of the duplicate classifier). No second normalizer is created.
    RealityNormalizationEngine,
    AhspDocumentCanonicalizationService,
    /**
     * C1 — THE ONE SOURCE ARCHIVE, reached by a second injector.
     *
     * Its name is historical, not a scope: the class is domain-neutral given
     * (workspaceId, digest, bytes), and it holds law this batch must not
     * duplicate — declared-digest verification, content-address integrity,
     * read-failure told apart from absent, post-move verification, and the
     * rename race. Writing an AHSP-shaped copy of that would be the second
     * archive authority the mandate forbids; listing the same stateless class
     * here is one implementation with two injectors, and it changes nothing
     * about Basic Price — not its key, not its behaviour, not its files.
     *
     * The address is content-addressed per workspace, so two verticals that see
     * the same bytes share one object rather than colliding, and nothing in the
     * codebase deletes an artifact this service retained.
     */
    BasicPriceSourceArchiveService,
    ResourceIdentityResolutionService,
    // Shared new-resource lifecycle: AHSP records observations through the ONE
    // shared service, which mints through the ONE admission authority.
    ResourceAdmissionService,
    ResourceObservationService,
    // The existing stateless signed-context service the observation lifecycle
    // now also uses for IQL-01 exact-question decisions.
    GhxDecisionContextTokenService,
  ],
  exports: [AhspService, AhspVersionService, AhspSnapshotService],
})
export class AhspModule {}
