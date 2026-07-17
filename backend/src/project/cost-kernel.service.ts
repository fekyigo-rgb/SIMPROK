import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  COST_CALCULATION_POLICY,
  COST_CALCULATION_REASON,
  COST_CALCULATION_STATUS,
  CostCalculationResult,
  CostKernelBatchResult,
} from './cost-kernel.contracts';
import { calculateCostKernel } from './cost-kernel.kernel';

type BoqItemWithRelations = Prisma.BoqItemGetPayload<{
  include: { boqStructure: { include: { project: true } }; ahspVersion: true };
}>;

type OccurrenceWithResolutions = Prisma.ProjectAhspOccurrenceGetPayload<{
  include: { resourceResolutions: { include: { originalResource: true } } };
}>;

const fail = (
  boqItemId: string,
  reason: (typeof COST_CALCULATION_REASON)[keyof typeof COST_CALCULATION_REASON],
): CostCalculationResult => ({
  status: COST_CALCULATION_STATUS.FAIL_CLOSED,
  boqItemId,
  reason,
  currency: 'IDR',
  calculationPolicy: COST_CALCULATION_POLICY,
});

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
      return fail(boqItemId, COST_CALCULATION_REASON.BOQ_ITEM_NOT_FOUND);
    }

    const occurrenceGroups = await this.loadOccurrenceGroups(
      projectId,
      workspaceId,
      item.ahspVersionId ? [item.ahspVersionId] : [],
    );

    return this.safeBuildResult(
      item,
      occurrenceGroups.get(item.ahspVersionId ?? '') ?? [],
      projectId,
      workspaceId,
    );
  }

  async calculateBoqItems(
    boqItemIds: string[],
    projectId: string,
    workspaceId: string,
  ): Promise<CostKernelBatchResult> {
    if (boqItemIds.length === 0) {
      return { items: [], directCostTotal: '0' };
    }

    const uniqueIds = Array.from(new Set(boqItemIds));
    const items = await this.prisma.boqItem.findMany({
      where: { id: { in: uniqueIds }, boqStructure: { projectId } },
      include: {
        boqStructure: { include: { project: true } },
        ahspVersion: true,
      },
    });
    const itemById = new Map(items.map((item) => [item.id, item]));

    const ahspVersionIds = Array.from(
      new Set(
        items
          .map((item) => item.ahspVersionId)
          .filter((id): id is string => id !== null),
      ),
    );
    const occurrenceGroups = await this.loadOccurrenceGroups(
      projectId,
      workspaceId,
      ahspVersionIds,
    );

    let directCostTotal = new Prisma.Decimal(0);
    const results: CostCalculationResult[] = boqItemIds.map((boqItemId) => {
      const item = itemById.get(boqItemId);
      const result = !item
        ? fail(boqItemId, COST_CALCULATION_REASON.BOQ_ITEM_NOT_FOUND)
        : this.safeBuildResult(
            item,
            occurrenceGroups.get(item.ahspVersionId ?? '') ?? [],
            projectId,
            workspaceId,
          );
      if (result.status === COST_CALCULATION_STATUS.CALCULATED) {
        directCostTotal = directCostTotal.add(result.lineTotal);
      }
      return result;
    });

    return { items: results, directCostTotal: directCostTotal.toString() };
  }

  /** Wraps buildResult so one malformed line can never take down the batch. */
  private safeBuildResult(
    item: BoqItemWithRelations,
    occurrences: OccurrenceWithResolutions[],
    projectId: string,
    workspaceId: string,
  ): CostCalculationResult {
    try {
      return this.buildResult(item, occurrences, projectId, workspaceId);
    } catch {
      return fail(item.id, COST_CALCULATION_REASON.INTERNAL_CALCULATION_ERROR);
    }
  }

  private buildResult(
    item: BoqItemWithRelations,
    occurrences: OccurrenceWithResolutions[],
    projectId: string,
    workspaceId: string,
  ): CostCalculationResult {
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
      // Occurrence rows are already scoped to {projectId, workspaceId, ahspVersionId}
      // by the loadOccurrenceGroups query itself, so a present occurrence can never
      // belong to another tenant — checking its fields here again only misfires when
      // occurrence is legitimately absent (no AHSP version, no occurrence yet), which
      // must fail as MISSING_AHSP_VERSION/OCCURRENCE_NOT_FOUND, not OWNERSHIP_MISMATCH.
      ownershipMatches:
        item.boqStructure.projectId === projectId &&
        item.boqStructure.project?.workspaceId === workspaceId,
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

  private async loadOccurrenceGroups(
    projectId: string,
    workspaceId: string,
    ahspVersionIds: string[],
  ): Promise<Map<string, OccurrenceWithResolutions[]>> {
    const groups = new Map<string, OccurrenceWithResolutions[]>();
    if (ahspVersionIds.length === 0) return groups;

    const occurrences = await this.prisma.projectAhspOccurrence.findMany({
      where: { projectId, workspaceId, ahspVersionId: { in: ahspVersionIds } },
      include: {
        resourceResolutions: { include: { originalResource: true } },
      },
    });

    for (const occurrence of occurrences) {
      const bucket = groups.get(occurrence.ahspVersionId);
      if (bucket) {
        bucket.push(occurrence);
      } else {
        groups.set(occurrence.ahspVersionId, [occurrence]);
      }
    }
    return groups;
  }
}
