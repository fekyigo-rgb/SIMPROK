import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AhspAuditService } from './ahsp-audit.service';
import { AhspVersionStatus } from '@prisma/client';

export interface CreateAhspVersionDto {
  workspaceId?: string;
  resources: any[];
  userId: string;
  regulationReference?: string;
  effectiveDate?: Date;
}

@Injectable()
export class AhspVersionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AhspAuditService,
  ) {}

  async createVersion(ahspId: string, data: CreateAhspVersionDto) {
    data.resources.forEach(r => {
      if (r.coefficient <= 0) throw new BadRequestException('Coefficient must be > 0');
    });

    const ahsp = await this.prisma.aHSP.findUnique({ where: { id: ahspId } });
    if (!ahsp) throw new NotFoundException('AHSP not found');

    const lastVersion = await this.prisma.aHSPVersion.findFirst({
      where: { ahspId },
      orderBy: { versionNumber: 'desc' }
    });
    const versionNumber = lastVersion ? lastVersion.versionNumber + 1 : 1;

    const version = await this.prisma.aHSPVersion.create({
      data: {
        ahspId,
        workspaceId: data.workspaceId || ahsp.workspaceId,
        versionNumber,
        status: AhspVersionStatus.DRAFT,
        regulationReference: data.regulationReference,
        effectiveDate: data.effectiveDate,
        resources: {
          create: data.resources.map(r => ({
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

    await this.audit.logAction({ ahspId, ahspVersionId: version.id, action: 'AHSPVersionCreated', who: data.userId, after: version });
    return version;
  }

  async updateStatus(versionId: string, newStatus: AhspVersionStatus, userId: string, reason?: string) {
    const version = await this.prisma.aHSPVersion.findUnique({ where: { id: versionId } });
    if (!version) throw new NotFoundException('Version not found');

    const updated = await this.prisma.aHSPVersion.update({
      where: { id: versionId },
      data: { status: newStatus }
    });

    await this.audit.logAction({ ahspId: version.ahspId, ahspVersionId: version.id, action: `AHSPVersion${newStatus}`, who: userId, before: version, after: updated, reason });
    return updated;
  }
}
