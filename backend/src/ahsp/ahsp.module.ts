import { Module } from '@nestjs/common';
import { AhspService } from './services/ahsp.service';
import { AhspVersionService } from './services/ahsp-version.service';
import { AhspSnapshotService } from './services/ahsp-snapshot.service';
import { AhspImportService } from './services/ahsp-import.service';
import { AhspAuditService } from './services/ahsp-audit.service';
import { AhspController } from './ahsp.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { UnitKernelModule } from '../unit-kernel/unit-kernel.module';

@Module({
  imports: [PrismaModule, UnitKernelModule],
  controllers: [AhspController],
  providers: [AhspService, AhspVersionService, AhspSnapshotService, AhspImportService, AhspAuditService],
  exports: [AhspService, AhspVersionService, AhspSnapshotService],
})
export class AhspModule {}
