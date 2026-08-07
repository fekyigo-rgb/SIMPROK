import { Module } from '@nestjs/common';
import { AhspService } from './services/ahsp.service';
import { AhspVersionService } from './services/ahsp-version.service';
import { AhspSnapshotService } from './services/ahsp-snapshot.service';
import { AhspImportService } from './services/ahsp-import.service';
import { AhspAuditService } from './services/ahsp-audit.service';
import { TrustedAhspActorService } from './services/trusted-ahsp-actor.service';
import { AhspController } from './ahsp.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { UnitKernelModule } from '../unit-kernel/unit-kernel.module';

@Module({
  imports: [PrismaModule, UnitKernelModule],
  controllers: [AhspController],
  providers: [AhspService, AhspVersionService, AhspSnapshotService, AhspImportService, AhspAuditService, TrustedAhspActorService],
  exports: [AhspService, AhspVersionService, AhspSnapshotService],
})
export class AhspModule {}
