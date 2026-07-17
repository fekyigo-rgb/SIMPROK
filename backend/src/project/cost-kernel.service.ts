import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  COST_CALCULATION_POLICY,
  COST_CALCULATION_REASON,
  COST_CALCULATION_STATUS,
  CostCalculationResult,
} from './cost-kernel.contracts';
import { calculateCostKernel } from './cost-kernel.kernel';

@Injectable()
export class CostKernelService {
  constructor(private readonly prisma: PrismaService) {}

  async calculateBoqItem(
    boqItemId: string,
    projectId: string,
    workspaceId: string,
  ): Promise<CostCalculationResult> {
    const item = await this.prisma.boqItem.findFirst({
      where: { id: boqItemId, boqStructure: { projectId } },
      include: {
        boqStructure: { include: { project: true } },
        ahspVersion: true,
      },
    });
    if (!item) {
      return {
        status: COST_CALCULATION_STATUS.FAIL_CLOSED,
        boqItemId,
        reason: COST_CALCULATION_REASON.BOQ_ITEM_NOT_FOUND,
        currency: 'IDR',
        calculationPolicy: COST_CALCULATION_POLICY,
      };
    }

    const occurrences = item.ahspVersionId
      ? await this.prisma.projectAhspOccurrence.findMany({
          where: { projectId, workspaceId, ahspVersionId: item.ahspVersionId },
          include: {
            resourceResolutions: { include: { originalResource: true } },
          },
          take: 2,
        })
      : [];
    const occurrence = occurrences.length === 1 ? occurrences[0] : null;

    return calculateCostKernel({
      boqItemId: item.id,
      ahspVersionId: item.ahspVersionId,
      occurrenceId: occurrence?.id ?? null,
      occurrenceCount: occurrences.length,
      itemType: item.itemType,
      volume: item.quantity.toString(),
      boqUnit: item.unit,
      outputUnit: item.ahspVersion?.outputUnit ?? null,
      ownershipMatches:
        item.boqStructure.projectId === projectId &&
        item.boqStructure.project?.workspaceId === workspaceId &&
        occurrence?.projectId === projectId &&
        occurrence?.workspaceId === workspaceId,
      resources:
        occurrence?.resourceResolutions.map((resolution) => ({
          ahspResourceId: resolution.ahspResourceId,
          resolutionId: resolution.id,
          status: resolution.status,
          ahspVersionId: resolution.originalResource.ahspVersionId,
          coefficient: resolution.ahspCoefficient.toString(),
          adaptedPriceValue: resolution.adaptedPriceValue?.toString() ?? null,
        })) ?? [],
    });
  }
}
