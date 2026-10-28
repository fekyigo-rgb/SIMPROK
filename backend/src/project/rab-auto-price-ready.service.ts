import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { parseDateOnlyUtc } from '../common/date-only.util';
import { COST_CALCULATION_STATUS } from './cost-kernel.contracts';
import { CostKernelService } from './cost-kernel.service';
import { RabKernelPersistenceService } from './rab-kernel-persistence.service';
import { WORKING_DRAFT_STRUCTURE_NAME } from './rab-lifecycle-policy.service';

/**
 * RAB-AUTO-03 — finish ALREADY-AUTHORIZED priced BOQ lines only.
 * One canonical Cost Kernel and the existing transaction-managed RAB writer;
 * no AHSP matcher, no Resource/Basic Price selector, no new RAB calculator.
 * The RAB-level action never approves or locks the RAB.
 */
@Injectable()
export class RabAutoPriceReadyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cost: CostKernelService,
    private readonly writer: RabKernelPersistenceService,
  ) {}

  async execute(input: {
    projectId: string;
    workspaceId: string;
    calculationAsOfDate: string;
    page?: string;
    limit?: string;
  }) {
    // Reuse the same date-only validator as the canonical persistence writer.
    parseDateOnlyUtc(input.calculationAsOfDate, 'calculationAsOfDate');
    const page = input.page == null ? 1 : Number(input.page);
    const limit = input.limit == null ? 25 : Number(input.limit);
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      page > 10000 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 25
    ) {
      throw new BadRequestException('RAB_AUTO_PAGE_INVALID');
    }
    const found = await this.prisma.boqItem.findMany({
      where: {
        itemType: 'WORK_ITEM',
        boqStructure: {
          projectId: input.projectId,
          name: WORKING_DRAFT_STRUCTURE_NAME,
          status: 'DRAFT',
          project: { workspaceId: input.workspaceId },
        },
      },
      select: {
        id: true,
        ahspVersionId: true,
        workingOccurrenceId: true,
        priceOrigin: true,
        calculationAsOfDate: true,
      },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      skip: (page - 1) * limit,
      take: limit + 1,
    });
    const hasNext = found.length > limit;
    const verdicts: Array<{
      boqItemId: string;
      status: string;
      reason?: string;
    }> = [];
    for (const item of found.slice(0, limit)) {
      if (item.priceOrigin === 'MANUAL_CLIENT') {
        verdicts.push({ boqItemId: item.id, status: 'MANUAL_PRICE_PRESERVED' });
        continue;
      }
      if (item.priceOrigin === 'SERVER_COST_KERNEL') {
        verdicts.push({ boqItemId: item.id, status: 'ALREADY_CALCULATED' });
        continue;
      }
      if (!item.ahspVersionId || !item.workingOccurrenceId) {
        verdicts.push({
          boqItemId: item.id,
          status: 'UNPRICED',
          reason: 'AHSP_OR_OCCURRENCE_NOT_LINKED',
        });
        continue;
      }
      try {
        const evaluation = await this.cost.calculateBoqItem(
          item.id,
          input.projectId,
          input.workspaceId,
        );
        if (evaluation.status !== COST_CALCULATION_STATUS.CALCULATED) {
          verdicts.push({
            boqItemId: item.id,
            status: 'UNPRICED',
            reason: evaluation.reason,
          });
          continue;
        }
        // Revalidates price, provenance, unit, date, and BOQ lifecycle
        // under its own project-row lock. Never copy money from this read.
        await this.writer.persistBoqItemCalculation({
          projectId: input.projectId,
          boqItemId: item.id,
          workspaceId: input.workspaceId,
          calculationAsOfDateRaw: input.calculationAsOfDate,
        });
        verdicts.push({
          boqItemId: item.id,
          status: 'CALCULATED_AND_PERSISTED',
        });
      } catch {
        // No fabricated SUCCESS or zero. Any concurrent change/lifecycle
        // refusal stays a line exception and does not block other rows.
        verdicts.push({
          boqItemId: item.id,
          status: 'WRITE_REVALIDATION_REQUIRED',
        });
      }
    }
    const counts = {
      checked: verdicts.length,
      calculatedAndPersisted: verdicts.filter(
        (v) => v.status === 'CALCULATED_AND_PERSISTED',
      ).length,
      alreadyCalculated: verdicts.filter(
        (v) => v.status === 'ALREADY_CALCULATED',
      ).length,
      unpriced: verdicts.filter((v) => v.status === 'UNPRICED').length,
      requiresRevalidation: verdicts.filter(
        (v) => v.status === 'WRITE_REVALIDATION_REQUIRED',
      ).length,
    };
    return {
      projectId: input.projectId,
      page,
      limit,
      hasNext,
      results: verdicts,
      counts,
      rabApproved: false,
      rabLocked: false,
    };
  }
}
