import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AhspAuditService } from './ahsp-audit.service';
import { AhspVersionStatus } from '@prisma/client';
import { UnitKernelService } from '../../unit-kernel/unit-kernel.service';

export interface CreateAhspResourceInput {
  resourceId: string;
  resourceType: string;
  coefficient: number;
  baseUnit: string;
  conversionFactor?: unknown;
}

export interface CreateAhspVersionDto {
  workspaceId?: string;
  resources: CreateAhspResourceInput[];
  outputUnit: string;
  userId: string;
  regulationReference?: string;
  effectiveDate?: Date;
}

@Injectable()
export class AhspVersionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AhspAuditService,
    private readonly units: UnitKernelService,
  ) {}

  async createVersion(ahspId: string, data: CreateAhspVersionDto) {
    data.resources.forEach(r => {
      if (r.coefficient <= 0) throw new BadRequestException('Coefficient must be > 0');
      if (r.conversionFactor !== undefined && r.conversionFactor !== null)
        throw new BadRequestException('LEGACY_CONVERSION_FACTOR_WRITE_FORBIDDEN');
    });
    const outputResolution = await this.units.resolve(data.outputUnit, data.outputUnit);
    if (outputResolution.status !== 'RESOLVED' || !outputResolution.sourceUnitDefinition)
      throw new BadRequestException('AHSP_OUTPUT_UNIT_UNRESOLVED');

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
        outputUnit: data.outputUnit,
        outputUnitDefinitionId: outputResolution.sourceUnitDefinition.id,
        resources: {
          create: data.resources.map(r => ({
            resourceId: r.resourceId,
            resourceType: r.resourceType,
            coefficient: r.coefficient,
            baseUnit: r.baseUnit
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
