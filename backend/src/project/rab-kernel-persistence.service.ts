import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ProjectStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  RabLifecyclePolicyService,
  WORKING_DRAFT_STRUCTURE_NAME,
} from './rab-lifecycle-policy.service';
import { BasicPriceEligibilityPolicy } from '../basic-price/basic-price-eligibility.policy';
import { parseDateOnlyUtc } from '../common/date-only.util';
import { toMoneyDecimal2 } from '../common/money';
import { buildDraftRecap } from './rab-draft-recap';
import {
  RAB_KERNEL_PERSISTENCE_POLICY,
  RAB_KERNEL_PERSISTENCE_REASON,
} from './rab-kernel-persistence.contracts';
import { calculateCostKernel } from './cost-kernel.kernel';
import {
  COST_CALCULATION_REASON,
  COST_CALCULATION_STATUS,
  CostKernelResourceInput,
} from './cost-kernel.contracts';

export interface PersistBoqItemCalculationParams {
  projectId: string;
  boqItemId: string;
  workspaceId: string;
  calculationAsOfDateRaw: string;
}

export interface PersistBoqItemCalculationResult {
  boqItemId: string;
  unitPrice: string;
  lineTotal: string;
  priceOrigin: 'SERVER_COST_KERNEL';
  calculationOccurrenceId: string;
  calculationAsOfDate: string;
  calculatedAt: string;
  calculationPolicyVersion: string;
  rabTotals: {
    pricingStatus: 'COMPLETE';
    totalBaseCost: string;
    totalFinalCost: string;
  };
}

/**
 * GATE-2A — the one and only server-authoritative command that may write
 * BoqItem.unitPrice/lineTotal from a Cost Kernel calculation, and the one
 * and only writer of priceOrigin = SERVER_COST_KERNEL. Distinct from (and
 * never called by) the read-only GET cost-calculation endpoints — this is
 * the "separate server-authoritative command" the locked contract requires.
 *
 * All-or-nothing (§5.1): this command only ever succeeds when, as a result
 * of pricing this one line, every WORK_ITEM in the Working Draft is priced.
 * If any other line is still unpriced, the whole transaction rolls back —
 * this line's money/provenance is never partially persisted while the RAB
 * total stays incomplete.
 */
@Injectable()
export class RabKernelPersistenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rabLifecyclePolicy: RabLifecyclePolicyService,
    private readonly eligibility: BasicPriceEligibilityPolicy,
  ) {}

  async persistBoqItemCalculation(
    params: PersistBoqItemCalculationParams,
  ): Promise<PersistBoqItemCalculationResult> {
    const calculationAsOfDate = parseDateOnlyUtc(
      params.calculationAsOfDateRaw,
      'calculationAsOfDate',
    );

    return this.prisma.$transaction(async (tx) => {
      // 1. Lock the Project row — the same serialization point saveDraftBoq
      // and initiateSetup already use for every RAB-draft-touching write.
      const lockedProject = await tx.$queryRaw<
        Array<{ id: string; status: string; workspaceId: string | null }>
      >(
        Prisma.sql`SELECT "id", "status", "workspaceId" FROM "projects" WHERE "id" = ${params.projectId}::uuid FOR UPDATE`,
      );
      const project = lockedProject[0];
      if (!project) {
        throw new NotFoundException(
          RAB_KERNEL_PERSISTENCE_REASON.PROJECT_NOT_FOUND,
        );
      }

      // 2. Tenant scope: the trusted workspaceId from ProjectAccessGuard must
      // match the locked row. A mismatch is indistinguishable from "not
      // found" — never a distinguishable 403 that would leak existence.
      if (project.workspaceId !== params.workspaceId) {
        throw new NotFoundException(
          RAB_KERNEL_PERSISTENCE_REASON.PROJECT_NOT_FOUND,
        );
      }

      // 3. RabLifecyclePolicyService — the single canonical lifecycle
      // authority. No parallel guard is introduced here.
      const capability = await this.rabLifecyclePolicy.evaluateInTransaction(
        tx,
        params.projectId,
        project.status as ProjectStatus,
      );
      if (!capability.canEditDraft) {
        throw new ConflictException(capability.reasonCode);
      }

      // 4. Working Draft + the target WORK_ITEM — DRAFT only, never a
      // baseline/approved structure.
      const structure = await tx.boqStructure.findFirst({
        where: {
          projectId: params.projectId,
          name: WORKING_DRAFT_STRUCTURE_NAME,
          status: 'DRAFT',
        },
        orderBy: { createdAt: 'desc' },
      });
      if (!structure) {
        throw new NotFoundException(
          RAB_KERNEL_PERSISTENCE_REASON.WORKING_DRAFT_NOT_FOUND,
        );
      }

      const item = await tx.boqItem.findFirst({
        where: { id: params.boqItemId, boqStructureId: structure.id },
      });
      if (!item) {
        throw new NotFoundException(
          RAB_KERNEL_PERSISTENCE_REASON.BOQ_ITEM_NOT_FOUND,
        );
      }
      if (item.itemType !== 'WORK_ITEM') {
        throw new ConflictException(COST_CALCULATION_REASON.BOQ_ITEM_NOT_WORK_ITEM);
      }
      if (!item.ahspVersionId) {
        throw new ConflictException(COST_CALCULATION_REASON.MISSING_AHSP_VERSION);
      }

      const ahspVersion = await tx.aHSPVersion.findUnique({
        where: { id: item.ahspVersionId },
      });

      // 5. Current ProjectAhspOccurrence + resource resolutions — tenant- and
      // AHSP-version-scoped exactly like CostKernelService's own read path.
      const occurrences = await tx.projectAhspOccurrence.findMany({
        where: {
          projectId: params.projectId,
          workspaceId: params.workspaceId,
          ahspVersionId: item.ahspVersionId,
        },
        include: { resourceResolutions: { include: { originalResource: true } } },
      });
      if (occurrences.length === 0) {
        throw new ConflictException(
          RAB_KERNEL_PERSISTENCE_REASON.OCCURRENCE_NOT_FOUND,
        );
      }
      if (occurrences.length > 1) {
        throw new ConflictException(
          RAB_KERNEL_PERSISTENCE_REASON.AMBIGUOUS_OCCURRENCE,
        );
      }
      const occurrence = occurrences[0];
      if (occurrence.resourceResolutions.length === 0) {
        throw new ConflictException(
          RAB_KERNEL_PERSISTENCE_REASON.EMPTY_RESOURCES,
        );
      }

      // 6-8. Every resolution must be RESOLVED; its selected BasicPrice is
      // re-read fresh (never trusted from the frozen resolution snapshot),
      // must still be publicly eligible, must satisfy
      // effectiveDate <= asOf AND (validUntil IS NULL OR validUntil >= asOf),
      // must not have drifted from the value the resolution adapted, and
      // must be traceable end-to-end through the real publication chain
      // (§3.3) — never inferred from status fields alone.
      const resources: CostKernelResourceInput[] = [];
      for (const resolution of occurrence.resourceResolutions) {
        if (resolution.status !== 'RESOLVED') {
          throw new ConflictException(
            RAB_KERNEL_PERSISTENCE_REASON.UNRESOLVED_RESOURCE,
          );
        }
        if (
          !resolution.selectedBasicPriceId ||
          resolution.adaptedPriceValue === null ||
          resolution.sourcePriceValue === null
        ) {
          throw new ConflictException(
            RAB_KERNEL_PERSISTENCE_REASON.MISSING_ADAPTED_PRICE,
          );
        }

        const basicPrice = await tx.basicPrice.findFirst({
          where: {
            id: resolution.selectedBasicPriceId,
            ...this.eligibility.publicEligibilityWhere(),
            OR: [{ workspaceId: params.workspaceId }, { workspaceId: null }],
          },
          select: {
            id: true,
            value: true,
            effectiveDate: true,
            validUntil: true,
            sourceSubmissionId: true,
          },
        });
        if (!basicPrice) {
          throw new ConflictException(
            RAB_KERNEL_PERSISTENCE_REASON.SELECTED_BASIC_PRICE_NOT_ELIGIBLE,
          );
        }
        if (basicPrice.effectiveDate.getTime() > calculationAsOfDate.getTime()) {
          throw new ConflictException(
            RAB_KERNEL_PERSISTENCE_REASON.BASIC_PRICE_NOT_YET_EFFECTIVE,
          );
        }
        if (
          basicPrice.validUntil !== null &&
          basicPrice.validUntil.getTime() < calculationAsOfDate.getTime()
        ) {
          throw new ConflictException(
            RAB_KERNEL_PERSISTENCE_REASON.BASIC_PRICE_EXPIRED,
          );
        }
        if (!basicPrice.value.equals(resolution.sourcePriceValue)) {
          throw new ConflictException(
            RAB_KERNEL_PERSISTENCE_REASON.BASIC_PRICE_VALUE_DRIFTED,
          );
        }

        await this.assertTraceableProvenance(tx, basicPrice);

        resources.push({
          ahspResourceId: resolution.ahspResourceId,
          resolutionId: resolution.id,
          status: resolution.status,
          ahspVersionId: resolution.originalResource.ahspVersionId,
          coefficient: resolution.ahspCoefficient.toString(),
          adaptedPriceValue: resolution.adaptedPriceValue.toString(),
        });
      }

      // 9. The existing Cost Kernel, unchanged — exact Decimal, no
      // intermediate rounding.
      const kernelResult = calculateCostKernel({
        boqItemId: item.id,
        ahspVersionId: item.ahspVersionId,
        occurrenceId: occurrence.id,
        occurrenceCount: occurrences.length,
        itemType: item.itemType,
        volume: item.quantity.toString(),
        boqUnit: item.unit,
        outputUnit: ahspVersion?.outputUnit ?? null,
        ownershipMatches: true,
        resources,
      });
      if (kernelResult.status !== COST_CALCULATION_STATUS.CALCULATED) {
        throw new ConflictException(kernelResult.reason);
      }

      const unitPrice = toMoneyDecimal2(kernelResult.ahspUnitPrice);
      const lineTotal = toMoneyDecimal2(kernelResult.lineTotal);
      const calculatedAt = new Date();

      // §5.1 — projected completeness BEFORE any monetary write. Read every
      // other WORK_ITEM row in the draft and check as though this line's
      // target result were already applied; if any other line is still
      // unpriced, throw and roll back before touching a single row.
      const otherItems = await tx.boqItem.findMany({
        where: { boqStructureId: structure.id, id: { not: item.id } },
        select: { itemType: true, unitPrice: true },
      });
      const anyOtherIncomplete = otherItems.some(
        (row) => row.itemType === 'WORK_ITEM' && row.unitPrice === null,
      );
      if (anyOtherIncomplete) {
        throw new ConflictException(
          RAB_KERNEL_PERSISTENCE_REASON.RAB_TOTAL_INCOMPLETE,
        );
      }

      // 10-11. Persist server unitPrice/lineTotal + SERVER_COST_KERNEL
      // provenance. OD-04 rounding (scale 2, ROUND_HALF_UP) happens exactly
      // once, here, at the canonical persistence boundary.
      await tx.boqItem.update({
        where: { id: item.id },
        data: {
          unitPrice,
          lineTotal,
          priceOrigin: 'SERVER_COST_KERNEL',
          calculationOccurrenceId: occurrence.id,
          calculationAsOfDate,
          calculatedAt,
          calculationPolicyVersion: RAB_KERNEL_PERSISTENCE_POLICY,
        },
      });

      // 12-13. Every WORK_ITEM is now complete (proven above) — re-read the
      // full current row set (including this line's own just-written
      // unitPrice/lineTotal) and persist the exact, complete RAB total using
      // the same canonical recap formula saveDraftBoq already uses.
      const subtotal = await this.computeSubtotal(tx, structure.id);

      const existingRab = await tx.rabDocument.findFirst({
        where: {
          projectId: params.projectId,
          boqStructureId: structure.id,
          status: 'DRAFT',
        },
        orderBy: { updatedAt: 'desc' },
      });

      const recap = buildDraftRecap(
        subtotal,
        existingRab?.profitPercent,
        existingRab?.taxPercent,
      );
      const rabData = {
        overheadPercent: new Prisma.Decimal(0),
        profitPercent: toMoneyDecimal2(recap.marginPercent),
        taxPercent: toMoneyDecimal2(recap.taxPercent),
        totalBaseCost: toMoneyDecimal2(recap.subtotal),
        totalFinalCost: toMoneyDecimal2(recap.grandTotal),
      };

      const updated = await tx.rabDocument.updateMany({
        where: {
          projectId: params.projectId,
          boqStructureId: structure.id,
          status: 'DRAFT',
        },
        data: rabData,
      });
      if (updated.count === 0) {
        await tx.rabDocument.create({
          data: {
            projectId: params.projectId,
            boqStructureId: structure.id,
            name: 'Working Draft RAB',
            version: 1,
            status: 'DRAFT',
            ...rabData,
          },
        });
      }

      // 14. Any failure above throws inside this callback — Prisma rolls the
      // whole interactive transaction back, so no step 10-13 write is ever
      // partially committed.
      return {
        boqItemId: item.id,
        unitPrice: unitPrice.toFixed(2),
        lineTotal: lineTotal.toFixed(2),
        priceOrigin: 'SERVER_COST_KERNEL' as const,
        calculationOccurrenceId: occurrence.id,
        calculationAsOfDate: calculationAsOfDate.toISOString().slice(0, 10),
        calculatedAt: calculatedAt.toISOString(),
        calculationPolicyVersion: RAB_KERNEL_PERSISTENCE_POLICY,
        rabTotals: {
          pricingStatus: 'COMPLETE',
          totalBaseCost: rabData.totalBaseCost.toFixed(2),
          totalFinalCost: rabData.totalFinalCost.toFixed(2),
        },
      };
    });
  }

  /** Subtotal re-read fresh after this line's own update, over the full current row set. */
  private async computeSubtotal(
    tx: Prisma.TransactionClient,
    boqStructureId: string,
  ): Promise<Prisma.Decimal> {
    const allItems = await tx.boqItem.findMany({
      where: { boqStructureId },
      select: { itemType: true, lineTotal: true },
    });
    return allItems.reduce(
      (sum, row) =>
        sum.add(row.itemType === 'WORK_ITEM' && row.lineTotal ? row.lineTotal : 0),
      new Prisma.Decimal(0),
    );
  }

  /**
   * §3.3 — reuses the exact relations BasicPricePublicationService.publish()
   * already relies on (PriceSubmission -> PriceSubmissionReview -> an ACCEPT
   * PriceSubmissionReviewDecision -> User -> WorkspaceMembership for the
   * verifier; BasicPricePublicationAudit for the publisher). No second
   * lifecycle implementation, no inference from status fields alone. Any
   * missing link fails closed with one stable reason.
   */
  private async assertTraceableProvenance(
    tx: Prisma.TransactionClient,
    basicPrice: { id: string; sourceSubmissionId: string | null },
  ): Promise<void> {
    const INCOMPLETE = RAB_KERNEL_PERSISTENCE_REASON.BASIC_PRICE_PROVENANCE_INCOMPLETE;

    if (basicPrice.sourceSubmissionId === null) {
      throw new ConflictException(INCOMPLETE);
    }
    const sourceSubmissionId: string = basicPrice.sourceSubmissionId;

    const submission = await tx.priceSubmission.findFirst({
      where: { id: sourceSubmissionId },
      include: {
        review: {
          include: { decisions: { where: { action: 'ACCEPT' } } },
        },
      },
    });
    const acceptDecisions = submission?.review?.decisions ?? [];
    if (acceptDecisions.length !== 1) {
      throw new ConflictException(INCOMPLETE);
    }

    const verifierUser = await tx.user.findFirst({
      where: { id: acceptDecisions[0].decidedByUserId },
      select: { membership: { select: { accountId: true } } },
    });
    const verifierAccountId = verifierUser?.membership?.accountId;
    if (!verifierAccountId) {
      throw new ConflictException(INCOMPLETE);
    }

    const publicationAudit = await tx.basicPricePublicationAudit.findFirst({
      where: { basicPriceId: basicPrice.id, action: 'PUBLISH' },
      orderBy: { createdAt: 'desc' },
    });
    const publisherAccountId = publicationAudit?.actorAccountId;
    if (!publisherAccountId) {
      throw new ConflictException(INCOMPLETE);
    }

    if (verifierAccountId === publisherAccountId) {
      throw new ConflictException(INCOMPLETE);
    }
  }
}
