import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AhspAuditService } from './ahsp-audit.service';

@Injectable()
export class AhspSnapshotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AhspAuditService,
  ) {}

  async createSnapshot(ahspVersionId: string, workspaceId: string, userId: string) {
    const version = await this.prisma.aHSPVersion.findUnique({
      where: { id: ahspVersionId },
      include: { ahsp: true, resources: true }
    });

    if (!version) throw new NotFoundException('AHSP Version not found');

    const snapshot = await this.prisma.aHSPSnapshot.create({
      data: {
        workspaceId,
        sourceAhspId: version.ahsp.id,
        sourceVersionId: version.id,
        workType: version.ahsp.workType,
        methodType: version.ahsp.methodType,
        locationType: version.ahsp.locationType,
        methodName: version.ahsp.methodName,
        versionNumber: version.versionNumber,
        resources: {
          create: version.resources.map(r => ({
            resourceId: r.resourceId,
            resourceType: r.resourceType,
            coefficient: r.coefficient,
            baseUnit: r.baseUnit,
            conversionFactor: r.conversionFactor
          }))
        }
      },
      include: { resources: true }
    });

    await this.audit.logAction({ ahspId: version.ahspId, action: 'AHSPSnapshotCreated', who: userId, after: snapshot });
    return snapshot;
  }
}
