import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { toMoneyDecimal2 } from '../common/money';
import {
  COST_CALCULATION_POLICY,
  COST_CALCULATION_STATUS,
} from './cost-kernel.contracts';
import { calculateCostKernel } from './cost-kernel.kernel';
import {
  PERSISTED_CALCULATION_REASON,
  PERSISTED_CALCULATION_STATUS,
  PersistedCalculationReason,
  PersistedCalculationResource,
  PersistedCalculationResult,
} from './persisted-calculation.contracts';

const dateOnly = (value: Date): string => value.toISOString().slice(0, 10);

/**
 * RM-03 — the read-only half of the Golden Thread.
 *
 * `RabKernelPersistenceService` writes a line and then deliberately clears
 * `BoqItem.workingOccurrenceId`, because the working pointer means "an
 * occurrence is staged for calculation", and after a successful persist
 * nothing is staged any more. The surviving link is
 * `BoqItem.calculationOccurrenceId`, which the Gate-2A truth constraint
 * guarantees is NOT NULL for every SERVER_COST_KERNEL row.
 *
 * `CostKernelService` only ever follows the *working* pointer, so it cannot
 * see a persisted line at all — it answers OCCURRENCE_NOT_FOUND for one. This
 * service follows the *calculation* pointer instead, which is what makes a
 * persisted row re-provable after a hard reload. The two are intentionally
 * separate: CostKernelService answers "what would this line cost if I priced
 * it now?", this service answers "is the money already stored on this line
 * still exactly what its own frozen provenance says it should be?".
 */
@Injectable()
export class PersistedCalculationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * RM-03D1 LOCK v1 — the two reads this service performs, narrowed to what it
   * actually needs. Accepting a client lets the pre-lock revalidation run this
   * SAME authority inside the lock transaction instead of duplicating the
   * re-proof, which is the only way §9's "no window between revalidation and
   * freeze" can hold.
   */
  async getPersistedCalculation(
    boqItemId: string,
    projectId: string,
    workspaceId: string,
    client: Pick<PrismaService, 'boqItem' | 'projectAhspOccurrence'> = this.prisma,
  ): Promise<PersistedCalculationResult> {
    const fail = (
      reason: PersistedCalculationReason,
    ): PersistedCalculationResult => ({
      status: PERSISTED_CALCULATION_STATUS.FAIL_CLOSED,
      boqItemId,
      reason,
      currency: 'IDR',
      calculationPolicy: COST_CALCULATION_POLICY,
    });

    const item = await client.boqItem.findFirst({
      where: {
        id: boqItemId,
        boqStructure: { projectId, project: { workspaceId } },
      },
      include: {
        boqStructure: { include: { project: true } },
        ahspVersion: true,
      },
    });
    if (!item) {
      return fail(PERSISTED_CALCULATION_REASON.BOQ_ITEM_NOT_FOUND);
    }

    if (item.priceOrigin === null) {
      return fail(PERSISTED_CALCULATION_REASON.NOT_CALCULATED);
    }
    if (item.priceOrigin === 'MANUAL_CLIENT') {
      return fail(PERSISTED_CALCULATION_REASON.MANUAL_PRICE_NOT_REPROVABLE);
    }

    // From here the Gate-2A truth constraint guarantees every provenance
    // column is NOT NULL. Each is still checked rather than asserted: a
    // constraint proves what the database will accept, not what this process
    // actually read back, and a null here would mean the guarantee has been
    // broken out-of-band.
    if (
      item.calculationOccurrenceId === null ||
      item.calculationAsOfDate === null ||
      item.calculatedAt === null ||
      item.calculationPolicyVersion === null
    ) {
      return fail(PERSISTED_CALCULATION_REASON.CALCULATION_OCCURRENCE_MISSING);
    }
    if (item.unitPrice === null || item.lineTotal === null) {
      return fail(PERSISTED_CALCULATION_REASON.STORED_MONEY_MISSING);
    }

    const occurrence = await client.projectAhspOccurrence.findFirst({
      where: { id: item.calculationOccurrenceId, projectId, workspaceId },
      include: {
        referenceRegion: true,
        resourceResolutions: {
          include: { originalResource: true, resolvedCatalog: true },
          orderBy: { id: 'asc' },
        },
      },
    });
    if (!occurrence) {
      return fail(PERSISTED_CALCULATION_REASON.CALCULATION_OCCURRENCE_MISSING);
    }

    // The SAME pure kernel the persist command ran, over the SAME frozen
    // resolution rows. Nothing is re-resolved and no Basic Price is re-read:
    // re-reading prices here would answer a different question (what the line
    // would cost today) and would make a legitimately unchanged line look
    // changed whenever the market moved.
    const kernelResult = calculateCostKernel({
      boqItemId: item.id,
      ahspVersionId: item.ahspVersionId,
      occurrenceId: occurrence.id,
      occurrenceCount: 1,
      itemType: item.itemType,
      volume: item.quantity.toString(),
      boqUnit: item.unit,
      outputUnit: item.ahspVersion?.outputUnit ?? null,
      ownershipMatches:
        item.boqStructure.projectId === projectId &&
        item.boqStructure.project?.workspaceId === workspaceId,
      resources: occurrence.resourceResolutions.map((resolution) => ({
        ahspResourceId: resolution.ahspResourceId,
        resolutionId: resolution.id,
        status: resolution.status,
        ahspVersionId: resolution.originalResource.ahspVersionId,
        coefficient: resolution.ahspCoefficient.toString(),
        adaptedPriceValue: resolution.adaptedPriceValue?.toString() ?? null,
      })),
    });

    if (kernelResult.status !== COST_CALCULATION_STATUS.CALCULATED) {
      return {
        status: PERSISTED_CALCULATION_STATUS.FAIL_CLOSED,
        boqItemId,
        reason: PERSISTED_CALCULATION_REASON.RECOMPUTATION_FAIL_CLOSED,
        kernelReason: kernelResult.reason,
        currency: 'IDR',
        calculationPolicy: COST_CALCULATION_POLICY,
      };
    }

    // Same rounding authority as the write path (OD-04, scale 2,
    // ROUND_HALF_UP) applied at the same single boundary, so this comparison
    // asks "did the kernel produce the stored number?" and never "does an
    // unrounded kernel value happen to differ from a rounded stored one?".
    const recomputedUnitPrice = toMoneyDecimal2(kernelResult.ahspUnitPrice);
    const recomputedLineTotal = toMoneyDecimal2(kernelResult.lineTotal);

    const unitPriceMatches = recomputedUnitPrice.equals(
      new Prisma.Decimal(item.unitPrice),
    );
    const lineTotalMatches = recomputedLineTotal.equals(
      new Prisma.Decimal(item.lineTotal),
    );

    const costByResolutionId = new Map(
      kernelResult.resources.map((resource) => [
        resource.resolutionId,
        resource.resourceCost,
      ]),
    );

    const resources: PersistedCalculationResource[] =
      occurrence.resourceResolutions.map((resolution) => ({
        resolutionId: resolution.id,
        ahspResourceId: resolution.ahspResourceId,
        rawAhspResourceRef: resolution.rawAhspResourceRef,
        rawAhspResourceType: resolution.rawAhspResourceType,
        resourceCatalogId: resolution.resourceCatalogId,
        resourceCatalogName: resolution.resolvedCatalog?.name ?? null,
        coefficient: resolution.ahspCoefficient.toString(),
        ahspUnit: resolution.ahspUnit,
        selectedBasicPriceId: resolution.selectedBasicPriceId,
        sourcePriceValue: resolution.sourcePriceValue?.toString() ?? null,
        sourceUnit: resolution.sourceUnit,
        adaptedPriceValue: resolution.adaptedPriceValue?.toString() ?? null,
        canonicalUnit: resolution.canonicalUnit,
        quantityFactor: resolution.quantityFactor?.toString() ?? null,
        selectedSourceOrigin: resolution.selectedSourceOrigin,
        selectedFreshnessStatus: resolution.selectedFreshnessStatus,
        selectedEffectiveDate: resolution.selectedEffectiveDate
          ? dateOnly(resolution.selectedEffectiveDate)
          : null,
        status: resolution.status,
        resolutionMethod: resolution.resolutionMethod,
        reasonCodes: resolution.reasonCodes,
        explanation: resolution.explanation,
        policyVersion: resolution.policyVersion,
        resourceCost: costByResolutionId.get(resolution.id) ?? '0',
      }));

    const allResourceCostsReproduced = occurrence.resourceResolutions.every(
      (resolution) => costByResolutionId.has(resolution.id),
    );

    return {
      status:
        unitPriceMatches && lineTotalMatches && allResourceCostsReproduced
          ? PERSISTED_CALCULATION_STATUS.VERIFIED
          : PERSISTED_CALCULATION_STATUS.MISMATCH,
      boqItemId: item.id,
      priceOrigin: 'SERVER_COST_KERNEL',
      stored: {
        volume: item.quantity.toString(),
        unit: item.unit,
        unitPrice: new Prisma.Decimal(item.unitPrice).toFixed(2),
        lineTotal: new Prisma.Decimal(item.lineTotal).toFixed(2),
      },
      recomputed: {
        unitPrice: recomputedUnitPrice.toFixed(2),
        lineTotal: recomputedLineTotal.toFixed(2),
      },
      integrity: {
        unitPriceMatches,
        lineTotalMatches,
        allResourceCostsReproduced,
      },
      provenance: {
        calculationOccurrenceId: occurrence.id,
        ahspVersionId: item.ahspVersionId as string,
        ahspOutputUnit: item.ahspVersion?.outputUnit as string,
        calculationAsOfDate: dateOnly(item.calculationAsOfDate),
        calculatedAt: item.calculatedAt.toISOString(),
        calculationPolicyVersion: item.calculationPolicyVersion,
        resolutionPolicyVersion: occurrence.resolutionPolicyVersion,
        referenceRegionId: occurrence.referenceRegionId,
        referenceRegionName: occurrence.referenceRegion?.name ?? null,
        occurrenceGeneration: occurrence.generation,
      },
      resources,
      currency: 'IDR',
      calculationPolicy: COST_CALCULATION_POLICY,
    };
  }
}
