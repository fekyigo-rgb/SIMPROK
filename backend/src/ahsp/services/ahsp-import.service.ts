import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AhspAuditService } from './ahsp-audit.service';
import { ImportStatus } from '@prisma/client';

@Injectable()
export class AhspImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AhspAuditService,
  ) {}

  async createImportJob(idempotencyKey: string, ahspId?: string, userId?: string) {
    const job = await this.prisma.aHSPImportJob.create({
      data: {
        idempotencyKey,
        ahspId,
        status: ImportStatus.PENDING,
      }
    });

    if (ahspId && userId) {
      await this.audit.logAction({ ahspId, action: 'AHSPImportJobCreated', who: userId, after: job });
    }
    return job;
  }

  async updateJobStatus(jobId: string, status: ImportStatus) {
    return this.prisma.aHSPImportJob.update({
      where: { id: jobId },
      data: { status }
    });
  }
}
