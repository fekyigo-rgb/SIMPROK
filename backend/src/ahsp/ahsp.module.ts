import { Module } from '@nestjs/common';
import { AhspService } from './services/ahsp.service';
import { AhspVersionService } from './services/ahsp-version.service';
import { AhspSnapshotService } from './services/ahsp-snapshot.service';
import { AhspImportService } from './services/ahsp-import.service';
import { AhspAuditService } from './services/ahsp-audit.service';

@Module({
  providers: [AhspService, AhspVersionService, AhspSnapshotService, AhspImportService, AhspAuditService]
})
export class AhspModule {}
